import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { useProjectScope } from "../components/contexts";
import {
	subscribeAnnotationEvents,
	subscribeAnnotationResync,
} from "../queries/annotation-live-events";
import {
	annotationListQueryKey,
	annotationListQueryOptions,
	containerKey,
	fetchAnnotation,
} from "../queries/annotations";
import type {
	AnnotationContainer,
	AnnotationFileEvent,
} from "../services/annotations.types";
import {
	editorAnnotationsStore,
	hydrateAnnotations,
	openAnnotationContainer,
	removeAnnotation,
	setAnnotationsError,
	upsertAnnotation,
} from "../stores/editor-annotations-store";

const isSameContainer = (a: AnnotationContainer, b: AnnotationContainer) =>
	containerKey(a) === containerKey(b);

/**
 * Keeps the editor's annotations of `container` (a design, or a component
 * in the component editor) in step with the store on disk:
 *
 * - lists them once (`GET /api/trickroom/annotations`) on the checkout's
 *   branch into `editorAnnotationsStore`;
 * - on an `annotation` event for that container, refetches that one
 *   annotation unless the editor already holds the event's revision
 *   (typically its own write echoing back), or drops it when deleted;
 * - lists again after the event stream reconnects.
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
		...annotationListQueryOptions(
			stableContainer ?? { kind: "design", designId: "" },
			"current",
			projectScope,
		),
		enabled: stableContainer !== null,
	});

	useEffect(() => {
		if (!stableContainer) return;
		if (listQuery.data) {
			hydrateAnnotations(
				stableContainer,
				listQuery.data.scope,
				listQuery.data.annotations,
			);
		} else if (listQuery.isError) {
			setAnnotationsError(stableContainer);
		}
	}, [listQuery.data, listQuery.isError, stableContainer]);

	useEffect(() => {
		if (!stableContainer) return;
		// The newest refetch of an annotation wins over slower earlier ones.
		const latest = new Map<string, number>();
		let sequence = 0;

		const refetch = async (annotationId: string) => {
			sequence += 1;
			const mine = sequence;
			latest.set(annotationId, mine);
			try {
				const annotation = await fetchAnnotation(annotationId, stableContainer);
				if (latest.get(annotationId) === mine) upsertAnnotation(annotation);
			} catch {
				// Gone meanwhile; its `deleted` event removes it.
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
				latest.delete(event.annotationId);
				removeAnnotation(event.annotationId);
				return;
			}
			const held = editorAnnotationsStore.get().byId[event.annotationId];
			if (held && event.revision !== null && held.revision === event.revision) {
				return;
			}
			void refetch(event.annotationId);
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
			unsubscribeEvents();
			unsubscribeResync();
		};
	}, [projectScope, queryClient, stableContainer]);

	return listQuery;
}
