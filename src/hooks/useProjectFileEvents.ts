import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import {
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
		await Promise.all([
			queryClient.invalidateQueries({
				queryKey: designSummariesProjectQueryKey(projectScope),
			}),
			queryClient.invalidateQueries({
				queryKey: designFileQueryKey(file, projectScope),
			}),
			invalidatePrefixes(queryClient, designUsageQueryPrefixes),
		]);
		return;
	}

	if (event.file.startsWith("systems/")) {
		await invalidatePrefixes(queryClient, systemQueryPrefixes);
	}
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

			void invalidateTrickroomFileEvent(queryClient, event, projectScope);
		};

		source.addEventListener("ready", handleReady);
		source.addEventListener("change", handleChange as EventListener);
		return () => {
			source.removeEventListener("ready", handleReady);
			source.removeEventListener("change", handleChange as EventListener);
			source.close();
		};
	}, [enabled, projectScope, queryClient]);
}
