import { describe, expect, it } from "vitest";
import type {
	AnnotationActor,
	AnnotationChangeRecord,
	AnnotationEntry,
	AnnotationTarget,
} from "../services/annotations.types";
import { buildAnnotationMemoryNote } from "./annotation-memory";

const human: AnnotationActor = { role: "human" };
const agent: AnnotationActor = { role: "agent", sessionId: "s1" };
const at = "2026-10-14T10:00:00.000Z";

let counter = 0;
const base = () => {
	counter += 1;
	return { id: `e${counter}`, at, by: human };
};

const remark = (body: string): AnnotationEntry => ({
	...base(),
	kind: "remark",
	body,
});
const reply = (body: string): AnnotationEntry => ({
	...base(),
	by: agent,
	kind: "reply",
	body,
});
const changeRecord = (summary: string): AnnotationChangeRecord => ({
	revisionBefore: "r1",
	revisionAfter: "r2",
	boards: ["b1"],
	layerIds: ["l1"],
	operations: [],
	summary,
});
const change = (summary: string, body?: string): AnnotationEntry => ({
	...base(),
	by: agent,
	kind: "change",
	body,
	change: changeRecord(summary),
});
const resolution = (summary?: string): AnnotationEntry => ({
	...base(),
	kind: "resolution",
	summary,
});

const layer: AnnotationTarget = {
	kind: "layer",
	designId: "d1",
	boardId: "b1",
	elementId: "l1",
};

const note = (
	entries: AnnotationEntry[],
	target: AnnotationTarget = layer,
	targetName?: string,
) => buildAnnotationMemoryNote({ entries, target }, targetName);

describe("buildAnnotationMemoryNote", () => {
	it("joins the remark, the final reply and the target reference", () => {
		const result = note(
			[remark("Make it bigger"), reply("Done, 24px now")],
			layer,
			"Hero title",
		);
		expect(result.title).toBe("Make it bigger");
		expect(result.body).toBe(
			"Make it bigger\n\nDone, 24px now\n\nOn Hero title {{layer:d1/l1}}",
		);
	});

	it("omits the name when none is given", () => {
		expect(note([remark("Fix")]).body).toBe("Fix\n\nOn {{layer:d1/l1}}");
	});

	it("uses the last reply", () => {
		const result = note([remark("Fix"), reply("first"), reply("second")]);
		expect(result.body).toContain("second");
		expect(result.body).not.toContain("first");
	});

	it("uses a change body, or its summary without one", () => {
		expect(note([remark("Fix"), change("Set padding", "Padded it")]).body).toBe(
			"Fix\n\nPadded it\n\nOn {{layer:d1/l1}}",
		);
		expect(note([remark("Fix"), change("Set padding")]).body).toBe(
			"Fix\n\nSet padding\n\nOn {{layer:d1/l1}}",
		);
	});

	it("uses a resolution summary and skips an empty one", () => {
		expect(note([remark("Fix"), resolution("Shipped")]).body).toContain(
			"Shipped",
		);
		const kept = note([remark("Fix"), reply("Done"), resolution()]);
		expect(kept.body).toBe("Fix\n\nDone\n\nOn {{layer:d1/l1}}");
	});

	it("counts a later human remark as the final reply", () => {
		const result = note([
			remark("Fix"),
			reply("Done"),
			remark("Still too small"),
		]);
		expect(result.body).toBe("Fix\n\nStill too small\n\nOn {{layer:d1/l1}}");
	});

	it("ignores entries that carry no text", () => {
		const dismissal: AnnotationEntry = {
			...base(),
			kind: "dismissal",
			reason: "nope",
		};
		const result = note([remark("Fix"), reply("Done"), dismissal]);
		expect(result.body).toContain("Done");
		expect(result.body).not.toContain("nope");
	});

	it("does not repeat a final reply equal to the remark", () => {
		const result = note([remark("Same"), reply("Same")]);
		expect(result.body).toBe("Same\n\nOn {{layer:d1/l1}}");
	});

	it("takes the first line as title, truncated to 60 characters", () => {
		expect(note([remark("Short\nsecond line")]).title).toBe("Short");
		const long = "x".repeat(80);
		const { title } = note([remark(long)]);
		expect(title).toBe(`${"x".repeat(59)}…`);
		expect(title).toHaveLength(60);
		expect(note([remark("y".repeat(60))]).title).toBe("y".repeat(60));
	});

	it("has no title without a remark", () => {
		const result = note([]);
		expect(result.title).toBeUndefined();
		expect(result.body).toBe("On {{layer:d1/l1}}");
	});

	it("references boards and designs", () => {
		expect(
			note([remark("A")], { kind: "board", designId: "d1", boardId: "b1" })
				.body,
		).toBe("A\n\nOn {{board:d1/b1}}");
		expect(note([remark("A")], { kind: "design", designId: "d1" }).body).toBe(
			"A\n\nOn {{design:d1}}",
		);
	});
});
