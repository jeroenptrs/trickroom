import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { useProjectScope } from "../components/contexts";
import {
	subscribeAnnotationEvents,
	subscribeAnnotationResync,
} from "../queries/annotation-live-events";
import {
	annotationListQueryKey,
	containerKey,
	fetchAnnotation,
	fetchAnnotationList,
} from "../queries/annotations";
import type {
	AnnotationContainer,
	AnnotationFileEvent,
} from "../services/annotations.types";
import {
	applyAnnotationRead,
	beginAnnotationRead,
	confirmAnnotationRevision,
	editorAnnotationsStore,
	hydrateAnnotations,
	openAnnotationContainer,
	removeAnnotation,
	setAnnotationsError,
} from "../stores/editor-annotations-store";

const isSameContainer = (a: AnnotationContainer, b: AnnotationContainer) =>
	containerKey(a) === containerKey(b);

/** Reads again at most this often when a read lost to a newer change. */
const MAX_STALE_REREADS = 3;

/**
 * Keeps the editor's annotations of `container` (a design, or a component
 * in the component editor) in step with the store on disk:
 *
 * - lists them once (`GET /api/trickroom/annotations`) on the checkout's
 *   branch into `editorAnnotationsStore`;
 * - on an `annotation` event for that container, reads that one annotation
 *   unless the editor already holds the event's revision (typically its own
 *   write echoing back), or drops it when deleted;
 * - lists again after the event stream reconnects.
 *
 * Responses arrive in any order: each read takes a sequence when it starts
 * and the store applies it only when nothing newer (a later read, the
 * editor's own write, a delete) set that annotation since. Leaving the
 * container aborts what is in flight; nothing from it applies to the next.
 *
 * Agents write the store through MCP in another process; this is how the
 * editor sees their replies, transitions and change records live.
 */
export function useAnnotationLiveSync(container: AnnotationContainer | null) {
	const projectScope = useProjectScope();
	const queryClient = useQueryClient();
	// Stable while the container is the same, however it was built.
	const key = container ? containerKey(container) : null;
	// biome-ignore lint/correctness/useExhaustiveDependencies: keyed by the container's identity, not the object.
	const stableContainer = useMemo(() => container, [key]);

	useEffect(() => {
		openAnnotationContainer(stableContainer);
		return () => openAnnotationContainer(null);
	}, [stableContainer]);

	const listQuery = useQuery({
		queryKey: annotationListQueryKey(
			stableContainer ?? { kind: "design", designId: "" },
			"current",
			projectScope,
		),
		// The read's token travels with its answer, so hydration knows what
		// changed since it started.
		queryFn: async ({ signal }) => {
			const token = beginAnnotationRead();
			const data = await fetchAnnotationList(
				stableContainer ?? { kind: "design", designId: "" },
				"current",
				signal,
			);
			return { token, data };
		},
		enabled: stableContainer !== null,
		retry: false,
		refetchOnWindowFocus: false,
		// Every visit reads again: a cached answer belongs to an earlier visit.
		gcTime: 0,
	});

	useEffect(() => {
		if (!stableContainer) return;
		if (listQuery.data) {
			hydrateAnnotations(
				stableContainer,
				listQuery.data.data.scope,
				listQuery.data.data.annotations,
				listQuery.data.token,
			);
		} else if (listQuery.isError) {
			setAnnotationsError(stableContainer);
		}
	}, [listQuery.data, listQuery.isError, stableContainer]);

	useEffect(() => {
		if (!stableContainer) return;
		const abort = new AbortController();

		const read = async (annotationId: string, attempt = 0): Promise<void> => {
			const token = beginAnnotationRead();
			let annotation: Awaited<ReturnType<typeof fetchAnnotation>>;
			try {
				annotation = await fetchAnnotation(
					annotationId,
					stableContainer,
					abort.signal,
				);
			} catch {
				// Aborted, or gone meanwhile (its `deleted` event removes it).
				return;
			}
			if (abort.signal.aborted) return;
			if (
				applyAnnotationRead(token, annotation) === "stale" &&
				attempt < MAX_STALE_REREADS
			) {
				// Something newer set it while this read was out, and this answer
				// differs from it: it may be newer still. Read once more.
				await read(annotationId, attempt + 1);
			}
		};

		const onEvent = (event: AnnotationFileEvent) => {
			if (!isSameContainer(event.container, stableContainer)) return;
			// Annotations of other branches show only on request; that list
			// refetches when it is open.
			void queryClient.invalidateQueries({
				queryKey: annotationListQueryKey(stableContainer, "all", projectScope),
			});
			if (event.operation === "deleted") {
				removeAnnotation(event.annotationId);
				return;
			}
			const held = editorAnnotationsStore.get().byId[event.annotationId];
			if (held && event.revision !== null && held.revision === event.revision) {
				// Already shown (typically the editor's own write): reads that
				// started before this event are older than that.
				confirmAnnotationRevision(event.annotationId);
				return;
			}
			void read(event.annotationId);
		};

		const unsubscribeEvents = subscribeAnnotationEvents(onEvent);
		const unsubscribeResync = subscribeAnnotationResync(() => {
			void queryClient.invalidateQueries({
				queryKey: annotationListQueryKey(
					stableContainer,
					"current",
					projectScope,
				),
			});
		});
		return () => {
			abort.abort();
			unsubscribeEvents();
			unsubscribeResync();
		};
	}, [projectScope, queryClient, stableContainer]);

	return listQuery;
}
