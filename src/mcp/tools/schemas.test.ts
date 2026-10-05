import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
	designFileIdSchema,
	expectedRevisionSchema,
	isDesignFileId,
} from "./schemas";

const designFileId = "4f1c2b8e-9d3a-4c6b-8e2f-1a2b3c4d5e6f";

describe("shared MCP id and revision schemas", () => {
	it("publishes design file ids as a plain described string", () => {
		expect(z.toJSONSchema(designFileIdSchema)).toEqual({
			$schema: expect.any(String),
			type: "string",
			description: "Design file UUID.",
		});
	});

	it("still rejects ids that are not design file UUIDs", () => {
		expect(isDesignFileId(designFileId)).toBe(true);
		expect(designFileIdSchema.safeParse(designFileId).success).toBe(true);

		const result = designFileIdSchema.safeParse("Landing page");
		expect(result.success).toBe(false);
		expect(result.error?.issues[0]?.message).toBe(
			"expected a design file UUID from design_list",
		);
	});

	it("treats revisions as opaque non-empty strings", () => {
		expect(z.toJSONSchema(expectedRevisionSchema)).toEqual({
			$schema: expect.any(String),
			type: "string",
			minLength: 1,
			description: "Pass back the revision from your last read.",
		});
		expect(expectedRevisionSchema.safeParse("sha256:abc").success).toBe(true);
		expect(
			expectedRevisionSchema.safeParse("v2:manifest.abc|board-1.def").success,
		).toBe(true);
		expect(expectedRevisionSchema.safeParse("").success).toBe(false);
	});
});
