import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { useProjectScope } from "../components/contexts";
import {
	deliverAnnotationScope,
	subscribeAnnotationEvents,
	subscribeAnnotationResync,
	subscribeAnnotationRound,
	subscribeAnnotationScope,
} from "../queries/annotation-live-events";
import {
	annotationCountsQueryKey,
	annotationListQueryKey,
	containerKey,
	fetchAnnotation,
	fetchAnnotationList,
	fetchOpenRound,
} from "../queries/annotations";
import { acknowledgementExpiresAt } from "../services/annotation-model";
import type {
	AnnotationContainer,
	AnnotationFileEvent,
} from "../services/annotations.types";
import {
	applyAnnotationRead,
	applyOpenRound,
	beginAnnotationRead,
	beginRoundRead,
	changeAnnotationScope,
	confirmAnnotationRevision,
	editorAnnotationsStore,
	hydrateAnnotations,
	isHeldAnnotationScope,
	openAnnotationContainer,
	removeAnnotation,
	setAnnotationsError,
} from "../stores/editor-annotations-store";

const isSameContainer = (a: AnnotationContainer, b: AnnotationContainer) =>
	containerKey(a) === containerKey(b);

/** Reads again at most this often when a read lost to a newer change. */
const MAX_STALE_REREADS = 3;

/** An acknowledgement is read again this long after it would go idle. */
const ACKNOWLEDGEMENT_RECHECK_DELAY_MS = 1_000;

/** The earliest moment an active acknowledgement held would go idle, with whose. */
const nextAcknowledgementExpiry = () => {
	let at = Number.POSITIVE_INFINITY;
	let ids: string[] = [];
	for (const annotation of Object.values(editorAnnotationsStore.get().byId)) {
		const expires = annotation.acknowledgement
			? acknowledgementExpiresAt(annotation.acknowledgement)
			: null;
		if (expires === null || expires > at) continue;
		if (expires < at) ids = [];
		at = expires;
		ids.push(annotation.id);
	}
	return ids.length > 0 ? { at, ids } : null;
};

/**
 * Keeps the editor's annotations of `container` (a design, or a component
 * in the component editor) in step with the store on disk:
 *
 * - lists them once (`GET /api/trickroom/annotations`) on the checkout's
 *   branch into `editorAnnotationsStore`;
 * - on an `annotation` event for that container, reads that one annotation
 *   unless the editor already holds the event's revision (typically its own
 *   write echoing back), or drops it when deleted;
 * - lists again after the event stream reconnects;
 * - when the server reports another checkout scope than the one listed
 *   (an `annotation-scope` event after a `git checkout`, the scope of a
 *   read, a `SCOPE_CHANGED` refusal), drops what it holds and lists the
 *   new branch's annotations, and the design-list counts refetch;
 * - reads the container's open round (`GET /annotations/rounds`) on open,
 *   on an `annotation-round` event for the container, after the event
 *   stream reconnects, and when the checkout scope changes;
 * - reads an acknowledged annotation again when its acknowledgement would
 *   go idle (the editor counts it down from `lastSeenAt`), in case the
 *   agent session has called since.
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
			const applied = hydrateAnnotations(
				stableContainer,
				listQuery.data.data.scope,
				listQuery.data.data.annotations,
				listQuery.data.token,
			);
			if (applied === "scope-changed") {
				// The list itself said the checkout changed: the other lists
				// of the old scope are stale too.
				void queryClient.invalidateQueries({
					queryKey: annotationListQueryKey(
						stableContainer,
						"all",
						projectScope,
					),
				});
				void queryClient.invalidateQueries({
					queryKey: annotationCountsQueryKey(projectScope),
				});
			}
		} else if (listQuery.isError) {
			setAnnotationsError(stableContainer);
		}
	}, [
		listQuery.data,
		listQuery.isError,
		projectScope,
		queryClient,
		stableContainer,
	]);

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

		const listAgain = () =>
			queryClient.invalidateQueries({
				queryKey: annotationListQueryKey(
					stableContainer,
					"current",
					projectScope,
				),
			});

		const unsubscribeEvents = subscribeAnnotationEvents(onEvent);
		const unsubscribeResync = subscribeAnnotationResync(() => {
			void listAgain();
		});
		const unsubscribeScope = subscribeAnnotationScope((scope) => {
			// Another branch's annotations are held: start over on this one.
			// Drafts stay; they are keyed by target, not branch.
			if (!changeAnnotationScope(scope)) return;
			void listAgain();
			void queryClient.invalidateQueries({
				queryKey: annotationListQueryKey(stableContainer, "all", projectScope),
			});
			void queryClient.invalidateQueries({
				queryKey: annotationCountsQueryKey(projectScope),
			});
		});

		// Acknowledgements go idle on the editor's clock; at that moment the
		// session may have called since, which only a read tells.
		let expiryTimer: ReturnType<typeof setTimeout> | null = null;
		let expiryAt = Number.POSITIVE_INFINITY;
		const scheduleExpiry = () => {
			const next = nextAcknowledgementExpiry();
			if (next?.at === expiryAt) return;
			if (expiryTimer !== null) clearTimeout(expiryTimer);
			expiryTimer = null;
			expiryAt = next?.at ?? Number.POSITIVE_INFINITY;
			if (!next) return;
			expiryTimer = setTimeout(
				() => {
					expiryTimer = null;
					expiryAt = Number.POSITIVE_INFINITY;
					for (const id of next.ids) void read(id);
				},
				Math.max(0, next.at - Date.now()) + ACKNOWLEDGEMENT_RECHECK_DELAY_MS,
			);
		};
		scheduleExpiry();
		const expirySubscription = editorAnnotationsStore.subscribe(scheduleExpiry);

		return () => {
			abort.abort();
			unsubscribeEvents();
			unsubscribeResync();
			unsubscribeScope();
			expirySubscription.unsubscribe();
			if (expiryTimer !== null) clearTimeout(expiryTimer);
		};
	}, [projectScope, queryClient, stableContainer]);

	useEffect(() => {
		if (!stableContainer) return;
		const abort = new AbortController();

		// Takes its place in the order when it starts; the store drops it if
		// something newer was applied, or the container or scope moved on.
		const load = async () => {
			const sequence = beginRoundRead();
			try {
				const answer = await fetchOpenRound(stableContainer, abort.signal);
				if (abort.signal.aborted) return;
				if (answer.scope && !isHeldAnnotationScope(answer.scope)) {
					// Another checkout than the one listed: the editor lists again,
					// and reads the round once that scope is held.
					deliverAnnotationScope(answer.scope);
					return;
				}
				applyOpenRound(sequence, stableContainer, answer.scope, answer.round);
			} catch {
				// Aborted or unreachable: the round shown stays, and the next event
				// reads it again.
			}
		};
		void load();

		const unsubscribeRound = subscribeAnnotationRound((event) => {
			if (isSameContainer(event.container, stableContainer)) void load();
		});
		const unsubscribeResync = subscribeAnnotationResync(() => void load());
		// Another checkout scope drops the round with the annotations; the new
		// branch has its own open round (or none).
		let heldScope = editorAnnotationsStore.get().scope;
		let heldRound = editorAnnotationsStore.get().round;
		const scopeSubscription = editorAnnotationsStore.subscribe(() => {
			const { scope: next, round } = editorAnnotationsStore.get();
			const previous = heldScope;
			const droppedRound = heldRound !== null && round === null;
			heldScope = next;
			heldRound = round;
			if (next === previous || next === null) return;
			// A first scope after none is only the first list, which keeps the
			// round; one that dropped the round is a scope change.
			const changed =
				previous === null
					? droppedRound
					: previous.branch !== next.branch ||
						previous.worktreePath !== next.worktreePath;
			if (changed) void load();
		});

		return () => {
			abort.abort();
			unsubscribeRound();
			unsubscribeResync();
			scopeSubscription.unsubscribe();
		};
	}, [stableContainer]);

	return listQuery;
}
