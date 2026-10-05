import { describe, expect, it } from "vitest";
import type { Node } from "../types";
import {
	mergeBoard,
	mergeBoardOrder,
	mergeIdLists,
	mergeManifest,
} from "./design-merge";

const node = (
	id: string,
	children: Node[] | string = [],
	props: Record<string, unknown> = {},
): Node => ({
	id,
	props: {
		"data-trickroom-name": id,
		"data-trickroom-library": "trickroom",
		"data-trickroom-component":
			typeof children === "string" ? "text" : "container",
		"data-trickroom-role": typeof children === "string" ? "text" : "branch",
		...props,
	} as Node["props"],
	children,
});

const board = (...children: Node[]) => node("board", children);

describe("mergeBoard", () => {
	const base = board(node("a", "A"), node("b", "B"), node("box", [node("c")]));

	it("takes each side's change to different layers", () => {
		const local = board(
			node("a", "A local"),
			node("b", "B"),
			node("box", [node("c")]),
		);
		const theirs = board(
			node("a", "A"),
			node("b", "B theirs"),
			node("box", [node("c")]),
		);

		const result = mergeBoard(base, local, theirs);

		expect(result).toEqual({
			status: "merged",
			board: board(
				node("a", "A local"),
				node("b", "B theirs"),
				node("box", [node("c")]),
			),
		});
	});

	it("merges different props of the same layer", () => {
		const local = board(
			node("a", "A", { className: "p-2" }),
			node("b", "B"),
			node("box", [node("c")]),
		);
		const theirs = board(
			node("a", "A", { "data-trickroom-name": "Renamed" }),
			node("b", "B"),
			node("box", [node("c")]),
		);

		const result = mergeBoard(base, local, theirs);

		expect(result.status).toBe("merged");
		expect(result.status === "merged" && result.board.children[0]).toEqual(
			node("a", "A", { className: "p-2", "data-trickroom-name": "Renamed" }),
		);
	});

	it("reports a layer whose same prop changed on both sides", () => {
		const local = board(
			node("a", "A", { className: "p-2" }),
			node("b", "B"),
			node("box", [node("c")]),
		);
		const theirs = board(
			node("a", "A", { className: "p-4" }),
			node("b", "B"),
			node("box", [node("c")]),
		);

		expect(mergeBoard(base, local, theirs)).toEqual({
			status: "conflict",
			nodeIds: ["a"],
		});
	});

	it("keeps layers both sides inserted into the same parent", () => {
		const local = board(
			node("a", "A"),
			node("b", "B"),
			node("box", [node("c"), node("mine")]),
		);
		const theirs = board(
			node("a", "A"),
			node("b", "B"),
			node("box", [node("theirs"), node("c")]),
		);

		const result = mergeBoard(base, local, theirs);

		expect(result.status).toBe("merged");
		expect(
			result.status === "merged" &&
				((result.board.children as Node[])[2]?.children as Node[]).map(
					(child) => child.id,
				),
		).toEqual(["theirs", "c", "mine"]);
	});

	it("applies a deletion on one side when the other side left the layer alone", () => {
		const local = board(node("a", "A edited"), node("b", "B"), node("box", []));
		const theirs = board(node("a", "A"), node("box", [node("c")]));

		expect(mergeBoard(base, local, theirs)).toEqual({
			status: "merged",
			board: board(node("a", "A edited"), node("box", [])),
		});
	});

	it("reports a layer deleted on one side and changed on the other", () => {
		const local = board(node("a", "A"), node("box", [node("c")]));
		const theirs = board(
			node("a", "A"),
			node("b", "B theirs"),
			node("box", [node("c")]),
		);

		expect(mergeBoard(base, local, theirs)).toEqual({
			status: "conflict",
			nodeIds: ["b"],
		});
	});

	it("reports a layer moved to two different places", () => {
		const local = board(
			node("b", "B"),
			node("box", [node("c"), node("a", "A")]),
		);
		const theirs = board(node("box", [node("c")]), node("b", [node("a", "A")]));

		const result = mergeBoard(
			base,
			local,
			// `b` cannot hold `a` as text, so put both under containers.
			{
				...theirs,
				children: [node("box", [node("c")]), node("b2", [node("a", "A")])],
			},
		);

		expect(result.status).toBe("conflict");
	});

	it("refuses ids another board already uses", () => {
		const local = base;
		const theirs = board(
			node("a", "A"),
			node("b", "B"),
			node("box", [node("c"), node("elsewhere")]),
		);

		expect(
			mergeBoard(
				base,
				{ ...local, children: [...(local.children as Node[])] },
				theirs,
			).status,
		).toBe("merged");
		const edited = board(
			node("a", "A!"),
			node("b", "B"),
			node("box", [node("c")]),
		);
		expect(
			mergeBoard(base, edited, theirs, (id) => id === "elsewhere").status,
		).toBe("conflict");
	});
});

describe("mergeIdLists", () => {
	it("combines removals and insertions", () => {
		expect(
			mergeIdLists(["a", "b", "c"], ["a", "c", "x"], ["y", "a", "b", "c"]),
		).toEqual(["y", "a", "c", "x"]);
	});

	it("refuses a reorder when the other side also changed the list", () => {
		expect(mergeIdLists(["a", "b"], ["b", "a"], ["a", "b", "c"])).toBeNull();
	});
});

describe("mergeBoardOrder", () => {
	const present = (ids: string[]) => new Set(ids);

	it("follows the disk order when only the disk reordered", () => {
		expect(
			mergeBoardOrder({
				base: ["a", "b", "c"],
				local: ["a", "b", "c", "new"],
				disk: ["c", "a", "b"],
				present: present(["a", "b", "c", "new"]),
			}),
		).toEqual({ order: ["c", "new", "a", "b"], conflict: false });
	});

	it("keeps the local order and slots in boards added on disk", () => {
		expect(
			mergeBoardOrder({
				base: ["a", "b", "c"],
				local: ["b", "a", "c"],
				disk: ["a", "x", "b", "c"],
				present: present(["a", "b", "c", "x"]),
			}),
		).toEqual({ order: ["b", "a", "x", "c"], conflict: false });
	});

	it("reports two different reorders", () => {
		expect(
			mergeBoardOrder({
				base: ["a", "b", "c"],
				local: ["b", "a", "c"],
				disk: ["a", "c", "b"],
				present: present(["a", "b", "c"]),
			}).conflict,
		).toBe(true);
	});
});

describe("mergeManifest", () => {
	it("merges field by field and reports fields changed on both sides", () => {
		expect(
			mergeManifest(
				{ name: "Base", systemId: "sys_a" },
				{ name: "Mine", systemId: "sys_a" },
				{ name: "Base", systemId: "sys_b", systemName: "B" },
			),
		).toEqual({
			manifest: { name: "Mine", systemId: "sys_b", systemName: "B" },
			conflicts: [],
		});
		expect(
			mergeManifest({ name: "Base" }, { name: "Mine" }, { name: "Theirs" })
				.conflicts,
		).toEqual(["name"]);
	});
});
