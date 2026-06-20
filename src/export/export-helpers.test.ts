import { describe, expect, it } from "vitest";
import type { DesignEntity } from "../stores/design-store";
import type { Node } from "../types";
import {
	findBoardIdForEntity,
	parseContentDispositionFilename,
	selectExportBoard,
	toExportBoards,
} from "./client";
import {
	contentDispositionAttachment,
	dedupeFilename,
	makeHtmlFilename,
	makeZipFilename,
	sanitizeFilenameSegment,
} from "./filenames";

describe("filenames", () => {
	it("strips illegal characters but keeps spaces", () => {
		expect(sanitizeFilenameSegment("My/Project: v2")).toBe("My-Project- v2");
		expect(sanitizeFilenameSegment("   ")).toBe("untitled");
	});

	it("builds html and zip names with the epoch", () => {
		expect(makeHtmlFilename("Proj", "Design", "Board", 1_700_000_000)).toBe(
			"Proj — Design — Board — 1700000000.html",
		);
		expect(makeZipFilename("Proj", "Design", 1_700_000_000)).toBe(
			"Proj — Design — 1700000000.zip",
		);
	});

	it("dedupes colliding zip entries", () => {
		const taken = new Set<string>();
		expect(dedupeFilename("a.html", taken)).toBe("a.html");
		expect(dedupeFilename("a.html", taken)).toBe("a (2).html");
		expect(dedupeFilename("a.html", taken)).toBe("a (3).html");
	});

	it("emits a UTF-8 content-disposition with an ASCII fallback", () => {
		const cd = contentDispositionAttachment("Proj — D.html");
		expect(cd).toContain("filename*=UTF-8''");
		expect(cd).toContain('filename="Proj _ D.html"');
	});
});

describe("client helpers", () => {
	const boards = [
		{ id: "b1", props: { "data-trickroom-name": "Home" }, children: [] },
		{ id: "b2", props: {}, children: [] },
	] as unknown as Node[];

	it("names boards, falling back to Untitled", () => {
		expect(toExportBoards(boards).map((board) => board.name)).toEqual([
			"Home",
			"Untitled",
		]);
	});

	it("selects a board by id", () => {
		expect(selectExportBoard(boards, "b2")).toHaveLength(1);
		expect(selectExportBoard(boards, "missing")).toEqual([]);
		expect(selectExportBoard(boards, null)).toEqual([]);
	});

	it("walks up to the root board of a nested entity", () => {
		const entities = {
			root: { parentId: null },
			mid: { parentId: "root" },
			leaf: { parentId: "mid" },
		} as unknown as Record<string, DesignEntity>;
		expect(findBoardIdForEntity(entities, "leaf")).toBe("root");
		expect(findBoardIdForEntity(entities, "root")).toBe("root");
		expect(findBoardIdForEntity(entities, null)).toBeNull();
		expect(findBoardIdForEntity(entities, "ghost")).toBeNull();
	});

	it("parses a content-disposition filename (prefers UTF-8)", () => {
		expect(
			parseContentDispositionFilename(
				"attachment; filename=\"a.html\"; filename*=UTF-8''P%20%E2%80%94%20D.html",
			),
		).toBe("P — D.html");
		expect(
			parseContentDispositionFilename('attachment; filename="a.html"'),
		).toBe("a.html");
		expect(parseContentDispositionFilename(null)).toBeNull();
	});
});
