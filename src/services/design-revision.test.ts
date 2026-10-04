import { describe, expect, it } from "vitest";
import type { Node, TrickroomDesign } from "../types";
import {
	calculateBoardRevision,
	calculateDesignRevision,
	decodeDesignRevision,
	getDesignRevisionParts,
	hashBoardId,
	stableStringify,
} from "./design-revision";

const board = (id: string, name: string): Node => ({
	id,
	props: {
		"data-trickroom-name": name,
		"data-trickroom-library": "trickroom",
		"data-trickroom-component": "container",
		"data-trickroom-role": "branch",
	},
	children: [],
});

const design: TrickroomDesign = {
	name: "Design",
	systemId: "sys_1",
	boards: [board("a", "A"), board("b", "B")],
};

describe("design revisions", () => {
	it("encodes the manifest and every board, in order", () => {
		const parts = getDesignRevisionParts(design);
		const decoded = decodeDesignRevision(calculateDesignRevision(design));

		expect(decoded).toEqual({
			manifest: parts.manifest,
			boards: [
				{ idHash: hashBoardId("a"), revision: parts.boards[0]?.revision },
				{ idHash: hashBoardId("b"), revision: parts.boards[1]?.revision },
			],
		});
	});

	it("changes only the revision of the board that changed", () => {
		const before = getDesignRevisionParts(design);
		const after = getDesignRevisionParts({
			...design,
			boards: [board("a", "A"), board("b", "B2")],
		});

		expect(after.manifest).toBe(before.manifest);
		expect(after.boards[0]).toEqual(before.boards[0]);
		expect(after.boards[1]?.revision).not.toBe(before.boards[1]?.revision);
	});

	it("does not depend on key order or the storage version", () => {
		const reordered = {
			boards: design.boards.map(({ children, props, id }) => ({
				children,
				props,
				id,
			})),
			systemId: "sys_1",
			version: 2,
			name: "Design",
		} as unknown as TrickroomDesign;

		expect(calculateDesignRevision(reordered)).toBe(
			calculateDesignRevision(design),
		);
		expect(stableStringify({ b: 1, a: [{ d: 1, c: 2 }] })).toBe(
			'{"a":[{"c":2,"d":1}],"b":1}',
		);
	});

	it("changes when the board order changes", () => {
		expect(
			calculateDesignRevision({
				...design,
				boards: [...design.boards].reverse(),
			}),
		).not.toBe(calculateDesignRevision(design));
		expect(calculateBoardRevision(board("a", "A"))).toMatch(/^[0-9a-f]{16}$/);
	});

	it("does not decode anything else", () => {
		for (const revision of [
			"",
			"sha256:abc",
			"r2.",
			"r2.!!!",
			"r2.AAAA",
			`${calculateDesignRevision(design)}A`,
		]) {
			expect(decodeDesignRevision(revision)).toBeNull();
		}
	});
});
