import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import {
	designFileQueryKey,
	designSummariesProjectQueryKey,
} from "../queries/design-file";
import { invalidateTrickroomFileEvent } from "./useProjectFileEvents";

const revision = `sha256:${"a".repeat(64)}` as const;

const seed = (queryClient: QueryClient, queryKey: readonly unknown[]) => {
	queryClient.setQueryData(queryKey, { seeded: true });
};

const isInvalidated = (
	queryClient: QueryClient,
	queryKey: readonly unknown[],
) => queryClient.getQueryState(queryKey)?.isInvalidated ?? false;

describe("live project query invalidation", () => {
	it("invalidates the changed design, summaries, and design usage", async () => {
		const queryClient = new QueryClient();
		const designKey = designFileQueryKey("home.json", "loc_1");
		const otherDesignKey = designFileQueryKey("other.json", "loc_1");
		const summariesKey = designSummariesProjectQueryKey("loc_1");
		const usageKey = ["trickroom-system-components-usage", "sys_1", "loc_1"];
		for (const key of [designKey, otherDesignKey, summariesKey, usageKey]) {
			seed(queryClient, key);
		}

		await invalidateTrickroomFileEvent(
			queryClient,
			{ file: "designs/home.json", operation: "changed", revision },
			"loc_1",
		);

		expect(isInvalidated(queryClient, designKey)).toBe(true);
		expect(isInvalidated(queryClient, summariesKey)).toBe(true);
		expect(isInvalidated(queryClient, usageKey)).toBe(true);
		expect(isInvalidated(queryClient, otherDesignKey)).toBe(false);
	});

	it("invalidates all system-backed query families", async () => {
		const queryClient = new QueryClient();
		const keys = [
			["trickroom-systems", "loc_1"],
			["trickroom-tailwind-tokens", "sys_1", "loc_1"],
			["trickroom-system-icons", "sys_1", "loc_1"],
			["trickroom-system-icon-svg", "sys_1", "search", "loc_1"],
			["trickroom-system-components", "sys_1", "loc_1"],
		];
		for (const key of keys) seed(queryClient, key);

		await invalidateTrickroomFileEvent(queryClient, {
			file: "systems/core/components.json",
			operation: "changed",
			revision,
		});

		for (const key of keys) {
			expect(isInvalidated(queryClient, key)).toBe(true);
		}
	});

	it("routes design memory changes to memory queries only", async () => {
		const queryClient = new QueryClient();
		const memoryKey = ["trickroom-memory", "design", "home", "loc_1"];
		const designKey = designFileQueryKey("home.memory.json", "loc_1");
		seed(queryClient, memoryKey);
		seed(queryClient, designKey);

		await invalidateTrickroomFileEvent(queryClient, {
			file: "designs/home.memory.json",
			operation: "changed",
			revision,
		});

		expect(isInvalidated(queryClient, memoryKey)).toBe(true);
		expect(isInvalidated(queryClient, designKey)).toBe(false);
	});
});
