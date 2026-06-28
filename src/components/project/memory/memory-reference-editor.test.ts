import { describe, expect, it } from "vitest";
import {
	buildMemoryBodySegments,
	detectActiveReferenceTrigger,
	filterReferenceTypes,
	formatMemoryReferenceToken,
	insertMemoryReferenceToken,
} from "./memory-reference-editor";

describe("detectActiveReferenceTrigger", () => {
	it("detects an unfinished type picker after {{", () => {
		const body = "See {{";
		const trigger = detectActiveReferenceTrigger(body, body.length);
		expect(trigger).toEqual({
			kind: "types",
			start: 4,
			end: 6,
			filter: "",
		});
	});

	it("detects a target query after a typed reference prefix", () => {
		const body = "Link {{design:1111";
		const trigger = detectActiveReferenceTrigger(body, body.length);
		expect(trigger).toEqual({
			kind: "targets",
			type: "design",
			query: "1111",
			start: 5,
			end: body.length,
		});
	});

	it("returns null outside an active token", () => {
		expect(detectActiveReferenceTrigger("plain text", 5)).toBeNull();
	});
});

describe("filterReferenceTypes", () => {
	it("filters types by label", () => {
		expect(filterReferenceTypes("des")).toEqual(["design"]);
	});
});

describe("insertMemoryReferenceToken", () => {
	it("replaces the active trigger span with a canonical token", () => {
		const body = "See {{design:abc";
		const trigger = detectActiveReferenceTrigger(body, body.length);
		expect(trigger).not.toBeNull();
		const { nextBody, nextCursor } = insertMemoryReferenceToken(
			body,
			trigger as NonNullable<typeof trigger>,
			formatMemoryReferenceToken("design", "uuid-1"),
		);
		expect(nextBody).toBe("See {{design:uuid-1}}");
		expect(nextCursor).toBe(nextBody.length);
	});
});

describe("buildMemoryBodySegments", () => {
	it("interleaves text and resolved references", () => {
		const body = "A {{design:x}} B";
		const token = "{{design:x}}";
		const start = body.indexOf(token);
		const end = start + token.length;
		const segments = buildMemoryBodySegments(body, [
			{
				type: "design",
				id: "x",
				raw: token,
				start,
				end,
				status: "valid",
				label: "Home",
			},
		]);
		expect(segments).toEqual([
			{ kind: "text", text: "A " },
			{
				kind: "reference",
				reference: expect.objectContaining({ label: "Home" }),
			},
			{ kind: "text", text: " B" },
		]);
	});
});
