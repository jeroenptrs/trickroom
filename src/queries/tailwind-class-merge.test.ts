import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { invalidateTrickroomFileEvent } from "../hooks/useProjectFileEvents";
import { createClassMerge } from "../utils/class-merge";
import {
	type TailwindClassMergeResponse,
	tailwindClassMergeQueryOptions,
} from "./tailwind-class-merge";
import { getTailwindSourceRevision } from "./tailwind-sources";

const SYSTEM = "sys_core";

const respond = (body: TailwindClassMergeResponse) =>
	new Response(JSON.stringify(body), {
		status: 200,
		headers: { "content-type": "application/json" },
	});

const STOCK: TailwindClassMergeResponse = { systemId: SYSTEM, mode: "stock" };
const DERIVED: TailwindClassMergeResponse = {
	systemId: SYSTEM,
	mode: "derived",
	config: {
		extend: {
			theme: {},
			classGroups: { "@utility card": ["card", "panel"] },
			conflictingClassGroups: {},
		},
	},
};

afterEach(() => {
	vi.unstubAllGlobals();
});

/** A query observer stays subscribed, like the open design's useClassMerge. */
const mount = (queryClient: QueryClient, timeoutMs?: number) => {
	const observer = new QueryObserver(
		queryClient,
		tailwindClassMergeQueryOptions(SYSTEM, "loc_1", timeoutMs),
	);
	const unsubscribe = observer.subscribe(() => {});
	return { observer, unsubscribe };
};

describe("class merge settings in an open design", () => {
	it("follows codegen.twMerge in .trickroom/config.json while the design stays open", async () => {
		const fetch = vi
			.fn()
			.mockResolvedValueOnce(respond(STOCK))
			.mockResolvedValueOnce(respond(DERIVED));
		vi.stubGlobal("fetch", fetch);
		const queryClient = new QueryClient();
		const { observer, unsubscribe } = mount(queryClient);
		await vi.waitFor(() =>
			expect(observer.getCurrentResult().data).toEqual(STOCK),
		);
		expect(
			createClassMerge(observer.getCurrentResult().data)?.("card panel"),
		).toBe("card panel");

		// The config changed on disk: the server reports config.json.
		await invalidateTrickroomFileEvent(
			queryClient,
			{ file: "config.json", operation: "changed", revision: "sha256:1" },
			"loc_1",
		);

		await vi.waitFor(() =>
			expect(observer.getCurrentResult().data).toEqual(DERIVED),
		);
		expect(
			createClassMerge(observer.getCurrentResult().data)?.("card panel"),
		).toBe("panel");
		expect(fetch).toHaveBeenCalledTimes(2);
		unsubscribe();
	});

	it("refetches, and rebuilds compiled styles, when the system's CSS changes", async () => {
		const fetch = vi
			.fn()
			.mockResolvedValueOnce(respond(STOCK))
			.mockResolvedValueOnce(respond(DERIVED));
		vi.stubGlobal("fetch", fetch);
		const queryClient = new QueryClient();
		const { observer, unsubscribe } = mount(queryClient);
		await vi.waitFor(() =>
			expect(observer.getCurrentResult().data).toEqual(STOCK),
		);
		const revisionBefore = getTailwindSourceRevision();

		await invalidateTrickroomFileEvent(
			queryClient,
			{
				file: "styles/theme.css",
				kind: "tailwind-source",
				operation: "changed",
				revision: "sha256:2",
			},
			"loc_1",
		);

		await vi.waitFor(() =>
			expect(observer.getCurrentResult().data).toEqual(DERIVED),
		);
		expect(getTailwindSourceRevision()).toBe(revisionBefore + 1);
		unsubscribe();
	});

	it("settles as an error when the request hangs, so boards render unmerged", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(
				(_url: string, init: RequestInit) =>
					new Promise((_resolve, reject) => {
						init.signal?.addEventListener("abort", () =>
							reject(init.signal?.reason),
						);
					}),
			),
		);
		const queryClient = new QueryClient();
		const { observer, unsubscribe } = mount(queryClient, 50);

		await vi.waitFor(
			() => expect(observer.getCurrentResult().isError).toBe(true),
			{
				timeout: 2_000,
			},
		);
		expect(createClassMerge(observer.getCurrentResult().data)).toBeNull();
		unsubscribe();
	});
});
