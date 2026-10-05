import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	designStore,
	forceHydrateDesign,
	updateElementProps,
} from "../stores/design-store";
import type { Node } from "../types";
import { syncDesignParts } from "./useDesignLiveSync";

const board = (id: string, className = ""): Node => ({
	id,
	props: {
		"data-trickroom-name": id,
		"data-trickroom-library": "trickroom",
		"data-trickroom-component": "container",
		"data-trickroom-role": "branch",
		className,
	},
	children: [],
});

const parts = (revisions: Record<string, string>, manifest = "m1") => ({
	manifest,
	boards: Object.entries(revisions).map(([id, revision]) => ({ id, revision })),
});

describe("syncing the parts of a design that changed", () => {
	const requested: string[] = [];

	beforeEach(() => {
		requested.length = 0;
		forceHydrateDesign(
			{ name: "Live", boards: [board("a"), board("b"), board("c")] },
			"r2.one",
			parts({ a: "a-1", b: "b-1", c: "c-1" }),
		);
		vi.stubGlobal(
			"fetch",
			vi.fn(async (input: string) => {
				const url = new URL(input, "http://localhost");
				requested.push(
					`${url.pathname}?${url.searchParams.get("board") ?? ""}`,
				);
				if (url.pathname.endsWith("/design/board")) {
					const id = url.searchParams.get("board") as string;
					return Response.json({
						board: board(id, "agent"),
						revision: `${id}-2`,
					});
				}
				return Response.json({
					revision: "r2.two",
					manifest: { name: "Renamed" },
					manifestRevision: "m2",
					boards: [],
				});
			}),
		);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("fetches only the boards whose revision changed", async () => {
		updateElementProps("a", { className: "mine" });

		const change = await syncDesignParts(
			"design",
			"r2.two",
			parts({ a: "a-1", b: "b-2", c: "c-1" }),
		);

		expect(requested).toEqual(["/api/trickroom/design/board?b"]);
		expect(change?.boards).toEqual({ b: ["b"] });
		const state = designStore.get();
		expect(state.entitiesById.a?.props.className).toBe("mine");
		expect(state.entitiesById.b?.props.className).toBe("agent");
		expect(state.persistedRevision).toBe("r2.two");
	});

	it("fetches nothing for an order change and the manifest for a rename", async () => {
		await syncDesignParts(
			"design",
			"r2.two",
			parts({ c: "c-1", a: "a-1", b: "b-1" }),
		);
		expect(requested).toEqual([]);
		expect(designStore.get().rootIds).toEqual(["c", "a", "b"]);

		await syncDesignParts(
			"design",
			"r2.three",
			parts({ c: "c-1", a: "a-1", b: "b-1" }, "m2"),
		);
		expect(requested).toEqual(["/api/trickroom/design/manifest?"]);
		expect(designStore.get().name).toBe("Renamed");
	});
});
