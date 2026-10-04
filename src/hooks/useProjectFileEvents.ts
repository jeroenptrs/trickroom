import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import {
	type DesignFileSnapshot,
	designFileQueryKey,
	designSummariesProjectQueryKey,
} from "../queries/design-file";
import type { ProjectQueryScope } from "../queries/project-scope";

export type TrickroomFileEvent = {
	file: string;
	revision: `sha256:${string}` | null;
	operation: "changed" | "deleted";
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
	if (event.file.startsWith("designs/")) {
		const file = event.file.slice("designs/".length);
		if (file.endsWith(".memory.json")) {
			await invalidatePrefixes(queryClient, memoryQueryPrefixes);
			return;
		}
		const designKey = designFileQueryKey(file, projectScope);
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
			alreadyHasRevision
				? undefined
				: queryClient.invalidateQueries({ queryKey: designKey }),
			invalidatePrefixes(queryClient, designUsageQueryPrefixes),
		]);
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
 * Collapses a burst of file events into one flush per key, carrying the latest
 * event. A flush happens once events for a key go quiet for `delayMs`, and at
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
				event,
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

		const source = new EventSource("/api/trickroom/events");
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

		source.addEventListener("ready", handleReady);
		source.addEventListener("change", handleChange as EventListener);
		return () => {
			source.removeEventListener("ready", handleReady);
			source.removeEventListener("change", handleChange as EventListener);
			source.close();
			coalescer.dispose();
		};
	}, [enabled, projectScope, queryClient]);
}
