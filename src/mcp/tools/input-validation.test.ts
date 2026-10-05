import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
	createTrickroomMcpProjectFixture,
	createTrickroomMcpTestClient,
	type TrickroomMcpClientSession,
	type TrickroomMcpProjectFixture,
	trickroomMcpTestDesignUuid,
} from "../test-support";
import { formatToolInputIssues } from "./input-validation";
import { designFileIdSchema } from "./schemas";

const format = (schema: z.ZodType, args: unknown) => {
	const parsed = schema.safeParse(args);
	if (parsed.success) throw new Error("expected the arguments to be invalid");
	return formatToolInputIssues(schema, args, parsed.error.issues);
};

describe("formatToolInputIssues", () => {
	const schema = z.object({
		designFileId: designFileIdSchema,
		parentId: z.string().min(1).nullable(),
		index: z.number().int().min(0),
		mode: z.enum(["json", "summary"]).optional(),
		project: z
			.object({ locationId: z.string().optional() })
			.strict()
			.optional(),
		node: z
			.lazy(() =>
				z.union([
					z.object({ kind: z.literal("recipe"), recipe: z.string() }).strict(),
					z.object({ component: z.string(), name: z.string() }).strict(),
				]),
			)
			.optional(),
		scope: z.union([z.string(), z.object({ kind: z.string() })]).optional(),
	});

	it("names missing parameters with their expected type", () => {
		expect(
			format(schema, { designFileId: trickroomMcpTestDesignUuid, index: 0 }),
		).toEqual(["parentId: required string | null, missing."]);
	});

	it("reports the design file id format check with the received value", () => {
		expect(
			format(schema, { designFileId: "Landing", parentId: null, index: 0 }),
		).toEqual([
			'designFileId: expected a design file UUID from design_list, received string "Landing".',
		]);
	});

	it("lists enum values and suggests the nearest one", () => {
		expect(
			format(schema, {
				designFileId: trickroomMcpTestDesignUuid,
				parentId: null,
				index: "0",
				mode: "sumary",
			}),
		).toEqual([
			'index: expected number, received string "0".',
			'mode: expected one of "json" | "summary", received string "sumary". Did you mean "summary"?',
		]);
	});

	it("flags unknown parameters with the nearest valid name", () => {
		expect(
			format(schema, {
				designFileID: trickroomMcpTestDesignUuid,
				parentId: null,
				index: 0,
				project: { location: "x" },
			}),
		).toEqual([
			"designFileId: required string, missing.",
			'project.location: unknown parameter. Did you mean "locationId"?',
			'designFileID: unknown parameter. Did you mean "designFileId"?',
		]);
	});

	it("reports the closest union branch, or the accepted shapes", () => {
		expect(
			format(schema, {
				designFileId: trickroomMcpTestDesignUuid,
				parentId: null,
				index: 0,
				node: { componnt: "text", name: "Title" },
				scope: 5,
			}),
		).toEqual([
			"node.component: required string, missing.",
			'node.componnt: unknown parameter. Did you mean "component"?',
			"scope: received number 5; accepted shapes: string | {kind}.",
		]);
	});
});

describe("tool input validation errors over MCP", () => {
	let fixture: TrickroomMcpProjectFixture | undefined;
	let session: TrickroomMcpClientSession | undefined;

	afterEach(async () => {
		await session?.close();
		await fixture?.cleanup();
	});

	it("replaces the SDK's bare 'Invalid input' lines", async () => {
		fixture = await createTrickroomMcpProjectFixture();
		session = await createTrickroomMcpTestClient(
			await fixture.readMcpContext(),
		);

		const result = await session.client.callTool({
			name: "design_read",
			arguments: { designFileID: trickroomMcpTestDesignUuid, boardID: "board" },
		});

		expect(result.isError).toBe(true);
		expect(result.content).toEqual([
			{
				type: "text",
				text: [
					"MCP error -32602: Input validation error: Invalid arguments for tool design_read:",
					"- designFileId: required string, missing.",
					'- designFileID: unknown parameter. Did you mean "designFileId"?',
					'- boardID: unknown parameter. Did you mean "boardId"?',
				].join("\n"),
			},
		]);
	});

	it("leaves valid calls untouched", async () => {
		fixture = await createTrickroomMcpProjectFixture();
		session = await createTrickroomMcpTestClient(
			await fixture.readMcpContext(),
		);

		const result = await session.client.callTool({
			name: "design_read",
			arguments: { designFileId: trickroomMcpTestDesignUuid },
		});

		expect(result.isError).not.toBe(true);
	});
});
