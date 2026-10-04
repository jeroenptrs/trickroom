import { useEffect } from "react";
import {
	fetchDesignBoard,
	fetchDesignFile,
	fetchDesignManifest,
} from "../queries/design-file";
import {
	subscribeDesignEvents,
	subscribeDesignResync,
} from "../queries/design-live-events";
import { editorChannelReady } from "../queries/editor-channel";
import type { DesignFileRevision } from "../services/design-file-service.types";
import { type DesignPartRevisions, designStore } from "../stores/design-store";
import {
	applyDiskDesign,
	type DiskDesignState,
	diskRevisionsFromParts,
	diskStateFromDesign,
	type ExternalDesignChange,
	getDiskContentNeeds,
} from "../stores/design-sync";
import type { Node } from "../types";
import type { TrickroomFileEvent } from "./useProjectFileEvents";

const MIN_SYNC_INTERVAL_MS = 300;

type SyncJob =
	| { kind: "parts"; revision: DesignFileRevision; parts: DesignPartRevisions }
	/** Ask the server for the current revisions (cheap: no board contents). */
	| { kind: "check" }
	/** Read the whole design: when revisions are not available. */
	| { kind: "full" };

/**
 * Brings the parts of the open design that changed on disk into the editor:
 * the boards whose revision differs from what the editor holds (one request
 * each) and the top-level fields when they changed, never the whole design.
 * Change events carry every part's revision, so an event whose parts all
 * match needs no request at all. Syncs run one at a time and wait for an
 * in-flight save, whose response already carries the stored design; events
 * arriving meanwhile collapse into the latest one.
 */
export async function syncDesignParts(
	designId: string,
	revision: DesignFileRevision,
	parts: DesignPartRevisions,
): Promise<ExternalDesignChange | null> {
	const revisions = diskRevisionsFromParts(revision, parts);
	const state = designStore.get();
	if (revision === state.persistedRevision) {
		return null;
	}
	const needs = getDiskContentNeeds(state, revisions);
	const [boards, manifest] = await Promise.all([
		Promise.all(
			needs.boardIds.map((boardId) => fetchDesignBoard(designId, boardId)),
		),
		needs.manifest ? fetchDesignManifest(designId) : null,
	]);
	if (boards.some((board) => board === null)) {
		// A board went away after the event: a newer event is on its way.
		return null;
	}
	const contents: Record<string, Node> = {};
	const boardRevisions = { ...revisions.boardRevisions };
	let exact = true;
	boards.forEach((entry, index) => {
		const boardId = needs.boardIds[index] as string;
		if (!entry) return;
		contents[boardId] = entry.board;
		if (entry.revision !== boardRevisions[boardId]) exact = false;
		boardRevisions[boardId] = entry.revision;
	});
	if (manifest && manifest.manifestRevision !== revisions.manifestRevision) {
		exact = false;
	}
	const disk: DiskDesignState = {
		...revisions,
		// A board read newer than the event no longer matches its revision;
		// the event for that write settles the revision.
		revision: exact ? revision : null,
		boardRevisions,
		manifestRevision: manifest?.manifestRevision ?? revisions.manifestRevision,
		...(manifest ? { manifest: manifest.manifest } : {}),
		boards: contents,
	};
	return applyDiskDesign(disk);
}

export function useDesignLiveSync({
	designId,
	enabled,
}: {
	designId: string | null;
	/** Once the design is loaded into the store. */
	enabled: boolean;
}) {
	useEffect(() => {
		if (!designId || !enabled) {
			return;
		}
		let disposed = false;
		let running = false;
		let pending: SyncJob | null = null;
		let lastStartedAt = Number.NEGATIVE_INFINITY;
		let timer: ReturnType<typeof setTimeout> | null = null;

		const runJob = async (job: SyncJob) => {
			if (job.kind === "parts") {
				await syncDesignParts(designId, job.revision, job.parts);
				return;
			}
			if (job.kind === "check") {
				const manifest = await fetchDesignManifest(designId);
				if (manifest.revision === designStore.get().persistedRevision) {
					return;
				}
				await syncDesignParts(designId, manifest.revision, {
					manifest: manifest.manifestRevision,
					boards: manifest.boards,
				});
				return;
			}
			const snapshot = await fetchDesignFile(designId);
			applyDiskDesign(
				diskStateFromDesign(snapshot.design, snapshot.revision, snapshot.parts),
			);
		};

		const run = async () => {
			if (running || disposed || !pending || timer) return;
			if (designStore.get().designSavePending) return;
			// A steady stream of writes syncs at most every MIN_SYNC_INTERVAL_MS,
			// each time with the latest revisions.
			const wait = lastStartedAt + MIN_SYNC_INTERVAL_MS - Date.now();
			if (wait > 0) {
				timer = setTimeout(() => {
					timer = null;
					void run();
				}, wait);
				return;
			}
			lastStartedAt = Date.now();
			const job = pending;
			pending = null;
			running = true;
			try {
				await runJob(job);
			} catch (error) {
				// Content went missing between the event and the reads, or a
				// read failed: fall back to the whole design once.
				if (job.kind !== "full" && !disposed) {
					pending ??= { kind: "full" };
				} else {
					console.warn("Design live sync failed", error);
				}
			} finally {
				running = false;
			}
			if (!disposed && pending) void run();
		};

		const schedule = (job: SyncJob) => {
			// A whole read covers anything; otherwise the latest revisions win.
			if (pending?.kind !== "full") pending = job;
			void run();
		};

		const unsubscribeEvents = subscribeDesignEvents(
			designId,
			(event: TrickroomFileEvent) => {
				if (event.revision === null) return;
				schedule(
					event.state
						? { kind: "parts", revision: event.revision, parts: event.state }
						: { kind: "full" },
				);
			},
		);
		const unsubscribeResync = subscribeDesignResync(designId, () =>
			schedule({ kind: "check" }),
		);
		// Events missed while the stream was down: compare revisions again.
		const unsubscribeReady = editorChannelReady.subscribe(() =>
			schedule({ kind: "check" }),
		);
		// Jobs wait for a save in flight; pick them up when it settles.
		const saveSubscription = designStore.subscribe(() => {
			if (pending && !running && !designStore.get().designSavePending) {
				void run();
			}
		});

		return () => {
			disposed = true;
			if (timer) clearTimeout(timer);
			unsubscribeEvents();
			unsubscribeResync();
			unsubscribeReady();
			saveSubscription.unsubscribe();
		};
	}, [designId, enabled]);
}
