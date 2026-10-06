import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import {
	type DesignFileSnapshot,
	designFileQueryKey,
	designSummariesProjectQueryKey,
} from "../queries/design-file";
import { deliverDesignEvent } from "../queries/design-live-events";
import {
	editorChannelReady,
	editorFocusRequests,
	getProjectEventsUrl,
	parseEditorFocusEvent,
} from "../queries/editor-channel";
import type { ProjectQueryScope } from "../queries/project-scope";

export type TrickroomFileEvent = {
	/** What changed, relative to `.trickroom`; `designs/<id>` for designs. */
	file: string;
	/** Opaque revision of the file or design, or null when it was deleted. */
	revision: string | null;
	operation: "changed" | "deleted";
	/** Set on design events. */
	designId?: string;
	/** Boards that changed in this design event, with their new revision. */
	boards?: { id: string; revision: string | null }[];
	/** The manifest revision and every board's revision, in board order. */
	state?: {
		manifest: string;
		boards: { id: string; revision: string }[];
	};
};

const systemQueryPrefixes = new Set([
	"trickroom-systems",
	"trickroom-tailwind-tokens",
	"trickroom-tailwind-class-catalog",
	"trickroom-tailwind-class-inspect",
	"trickroom-system-assets",
	"trickroom-system-asset-used-by",
	"trickroom-system-icons",
	"trickroom-system-icon-svg",
	"trickroom-system-fonts",
	"trickroom-system-components",
	"trickroom-system-component",
	"trickroom-system-component-used-by",
	"trickroom-system-component-usage",
	"trickroom-system-components-usage",
	"trickroom-system-lint",
	"trickroom-design-system-component-usage",
	"trickroom-system-used-by",
	"trickroom-memory",
	"trickroom-memory-reference-targets",
]);

const designUsageQueryPrefixes = new Set([
	"trickroom-system-component-used-by",
	"trickroom-system-component-usage",
	"trickroom-system-components-usage",
	"trickroom-design-system-component-usage",
	"trickroom-system-used-by",
]);

const memoryQueryPrefixes = new Set([
	"trickroom-memory",
	"trickroom-memory-reference-targets",
]);

const invalidatePrefixes = (
	queryClient: QueryClient,
	prefixes: ReadonlySet<string>,
) =>
	queryClient.invalidateQueries({
		predicate: (query) =>
			typeof query.queryKey[0] === "string" && prefixes.has(query.queryKey[0]),
	});

export async function invalidateTrickroomFileEvent(
	queryClient: QueryClient,
	event: TrickroomFileEvent,
	projectScope?: ProjectQueryScope,
) {
	if (event.designId !== undefined) {
		// An editor that has the design open reloads only the changed boards;
		// otherwise the whole design is refetched.
		const delivered =
			event.operation === "changed" && deliverDesignEvent(event);
		const designKey = designFileQueryKey(event.designId, projectScope);
		// The browser already holds this exact revision (typically its own
		// save echoing back), so refetching the design would return the same
		// bytes. Summaries and usage still change with every write.
		const alreadyHasRevision =
			event.revision !== null &&
			queryClient.getQueryData<DesignFileSnapshot>(designKey)?.revision ===
				event.revision;
		await Promise.all([
			queryClient.invalidateQueries({
				queryKey: designSummariesProjectQueryKey(projectScope),
			}),
			alreadyHasRevision || delivered
				? undefined
				: queryClient.invalidateQueries({ queryKey: designKey }),
			invalidatePrefixes(queryClient, designUsageQueryPrefixes),
		]);
		return;
	}

	if (event.file.startsWith("designs/") && event.file.endsWith("memory.json")) {
		await invalidatePrefixes(queryClient, memoryQueryPrefixes);
		return;
	}

	if (event.file.startsWith("systems/")) {
		await invalidatePrefixes(queryClient, systemQueryPrefixes);
	}
}

const coalesceDelayMs = 50;
const coalesceMaxWaitMs = 250;

// Events that invalidate the same queries share a key: every file under
// `systems/` refreshes the same query families.
const getCoalesceKey = (event: TrickroomFileEvent) =>
	event.file.startsWith("systems/") ? "systems/" : event.file;

/**
 * Two events for the same design: the later one, naming every board either
 * of them changed (the server lists boards changed since its previous event).
 */
const mergeDesignEvents = (
	earlier: TrickroomFileEvent,
	later: TrickroomFileEvent,
): TrickroomFileEvent => {
	if (!earlier.boards || !later.boards) {
		return later;
	}
	const boards = new Map(earlier.boards.map((board) => [board.id, board]));
	for (const board of later.boards) boards.set(board.id, board);
	return { ...later, boards: [...boards.values()] };
};

/**
 * Collapses a burst of file events into one flush per key, carrying the latest
 * event (for a design, with every board the burst changed). A flush happens once events for a key go quiet for `delayMs`, and at
 * most `maxWaitMs` after the first event of the burst so a steady stream of
 * writes still refreshes the editor.
 */
export function createFileEventCoalescer(
	flush: (event: TrickroomFileEvent) => void,
	{ delayMs = coalesceDelayMs, maxWaitMs = coalesceMaxWaitMs } = {},
) {
	const pending = new Map<
		string,
		{
			event: TrickroomFileEvent;
			timer: ReturnType<typeof setTimeout>;
			firstAt: number;
		}
	>();

	const flushKey = (key: string) => {
		const entry = pending.get(key);
		if (!entry) return;
		pending.delete(key);
		clearTimeout(entry.timer);
		flush(entry.event);
	};

	return {
		push(event: TrickroomFileEvent) {
			const key = getCoalesceKey(event);
			const now = Date.now();
			const previous = pending.get(key);
			if (previous) clearTimeout(previous.timer);
			const firstAt = previous?.firstAt ?? now;
			const wait = Math.max(0, Math.min(delayMs, firstAt + maxWaitMs - now));
			pending.set(key, {
				event:
					previous && event.designId !== undefined
						? mergeDesignEvents(previous.event, event)
						: event,
				firstAt,
				timer: setTimeout(() => flushKey(key), wait),
			});
		},
		dispose() {
			for (const entry of pending.values()) clearTimeout(entry.timer);
			pending.clear();
		},
	};
}

export function useProjectFileEvents(
	projectScope: ProjectQueryScope,
	enabled: boolean,
) {
	const queryClient = useQueryClient();
	const hasConnectedRef = useRef(false);

	useEffect(() => {
		if (!enabled) {
			return;
		}

		const source = new EventSource(getProjectEventsUrl());
		const coalescer = createFileEventCoalescer((event) => {
			void invalidateTrickroomFileEvent(queryClient, event, projectScope);
		});
		const invalidateSystemQueries = () =>
			invalidatePrefixes(queryClient, systemQueryPrefixes);
		const handleReady = () => {
			if (hasConnectedRef.current) {
				void queryClient.invalidateQueries({
					queryKey: designSummariesProjectQueryKey(projectScope),
				});
				void invalidateSystemQueries();
			}
			hasConnectedRef.current = true;
			// A (re)connected stream is a new presence on the server; the tab
			// reports its editor context again.
			editorChannelReady.emit();
		};
		const handleChange = (message: MessageEvent<string>) => {
			let event: TrickroomFileEvent;
			try {
				event = JSON.parse(message.data) as TrickroomFileEvent;
			} catch {
				return;
			}

			coalescer.push(event);
		};

		const handleFocus = (message: MessageEvent<string>) => {
			const request = parseEditorFocusEvent(message.data);
			if (request) {
				editorFocusRequests.emit(request);
			}
		};

		source.addEventListener("ready", handleReady);
		source.addEventListener("change", handleChange as EventListener);
		source.addEventListener("focus", handleFocus as EventListener);
		return () => {
			source.removeEventListener("ready", handleReady);
			source.removeEventListener("change", handleChange as EventListener);
			source.removeEventListener("focus", handleFocus as EventListener);
			source.close();
			coalescer.dispose();
		};
	}, [enabled, projectScope, queryClient]);
}
