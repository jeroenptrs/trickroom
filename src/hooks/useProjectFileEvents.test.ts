import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	designFileQueryKey,
	designSummariesProjectQueryKey,
} from "../queries/design-file";
import {
	createFileEventCoalescer,
	invalidateTrickroomFileEvent,
	type TrickroomFileEvent,
} from "./useProjectFileEvents";

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
		const designKey = designFileQueryKey("home", "loc_1");
		const otherDesignKey = designFileQueryKey("other", "loc_1");
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

describe("design events at a revision the browser already has", () => {
	const otherRevision = `sha256:${"b".repeat(64)}` as const;

	it("skips the design refetch but still refreshes summaries and usage", async () => {
		const queryClient = new QueryClient();
		const designKey = designFileQueryKey("home", "loc_1");
		const summariesKey = designSummariesProjectQueryKey("loc_1");
		const usageKey = ["trickroom-system-components-usage", "sys_1", "loc_1"];
		queryClient.setQueryData(designKey, { design: {}, revision });
		seed(queryClient, summariesKey);
		seed(queryClient, usageKey);

		await invalidateTrickroomFileEvent(
			queryClient,
			{ file: "designs/home.json", operation: "changed", revision },
			"loc_1",
		);

		expect(isInvalidated(queryClient, designKey)).toBe(false);
		expect(isInvalidated(queryClient, summariesKey)).toBe(true);
		expect(isInvalidated(queryClient, usageKey)).toBe(true);
	});

	it("refetches when the event carries a different revision", async () => {
		const queryClient = new QueryClient();
		const designKey = designFileQueryKey("home", "loc_1");
		queryClient.setQueryData(designKey, { design: {}, revision });

		await invalidateTrickroomFileEvent(
			queryClient,
			{
				file: "designs/home.json",
				operation: "changed",
				revision: otherRevision,
			},
			"loc_1",
		);

		expect(isInvalidated(queryClient, designKey)).toBe(true);
	});

	it("refetches deleted designs", async () => {
		const queryClient = new QueryClient();
		const designKey = designFileQueryKey("home", "loc_1");
		queryClient.setQueryData(designKey, { design: {}, revision });

		await invalidateTrickroomFileEvent(
			queryClient,
			{ file: "designs/home.json", operation: "deleted", revision: null },
			"loc_1",
		);

		expect(isInvalidated(queryClient, designKey)).toBe(true);
	});
});

describe("file event coalescing", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	const changed = (file: string, n: number): TrickroomFileEvent => ({
		file,
		operation: "changed",
		revision: `sha256:${String(n).repeat(64)}`,
	});

	it("flushes a burst for one file once, with the latest event", () => {
		vi.useFakeTimers();
		const flushed: TrickroomFileEvent[] = [];
		const coalescer = createFileEventCoalescer((event) => flushed.push(event), {
			delayMs: 50,
			maxWaitMs: 250,
		});

		coalescer.push(changed("designs/home.json", 1));
		vi.advanceTimersByTime(20);
		coalescer.push(changed("designs/home.json", 2));
		vi.advanceTimersByTime(20);
		coalescer.push(changed("designs/home.json", 3));
		expect(flushed).toEqual([]);

		vi.advanceTimersByTime(50);
		expect(flushed).toEqual([changed("designs/home.json", 3)]);
	});

	it("keeps files apart and groups system files", () => {
		vi.useFakeTimers();
		const flushed: TrickroomFileEvent[] = [];
		const coalescer = createFileEventCoalescer((event) => flushed.push(event));

		coalescer.push(changed("designs/home.json", 1));
		coalescer.push(changed("designs/other.json", 2));
		coalescer.push(changed("systems/core/tokens.json", 3));
		coalescer.push(changed("systems/core/icons.json", 4));
		vi.runAllTimers();

		expect(flushed.map((event) => event.file)).toEqual([
			"designs/home.json",
			"designs/other.json",
			"systems/core/icons.json",
		]);
	});

	it("flushes a continuous stream no later than the max wait", () => {
		vi.useFakeTimers();
		const flushed: TrickroomFileEvent[] = [];
		const coalescer = createFileEventCoalescer((event) => flushed.push(event), {
			delayMs: 50,
			maxWaitMs: 120,
		});

		for (let n = 1; n <= 5; n += 1) {
			coalescer.push(changed("designs/home.json", n));
			vi.advanceTimersByTime(30);
		}

		expect(flushed).toEqual([changed("designs/home.json", 4)]);
	});

	it("drops pending events on dispose", () => {
		vi.useFakeTimers();
		const flushed: TrickroomFileEvent[] = [];
		const coalescer = createFileEventCoalescer((event) => flushed.push(event));

		coalescer.push(changed("designs/home.json", 1));
		coalescer.dispose();
		vi.runAllTimers();

		expect(flushed).toEqual([]);
	});
});
