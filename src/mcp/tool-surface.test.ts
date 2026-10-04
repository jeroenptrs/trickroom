import { afterEach, describe, expect, it } from "vitest";
import {
	createTrickroomMcpProjectFixture,
	createTrickroomMcpTestClient,
	type TrickroomMcpClientSession,
	type TrickroomMcpProjectFixture,
} from "./test-support";
import { TOOL_NAMES } from "./tool-names";
import { ALWAYS_LOAD_META_KEY } from "./tools/annotations";

// Clients truncate tool descriptions and server instructions beyond this.
const CLIENT_TEXT_LIMIT = 2_048;

// R = read-only. W = writes: [destructive, idempotent, open world].
const EXPECTED_ANNOTATIONS: Record<
	string,
	"R" | "R open" | [boolean, boolean, boolean]
> = {
	project_list: "R",
	project_select: [false, true, false],
	guide: "R",
	design_list: "R",
	design_read: "R",
	design_apply: [true, false, false],
	design_validate: "R",
	design_create: [false, false, false],
	design_screenshot: "R open",
	design_export: [true, false, true],
	editor_context: "R",
	editor_focus: [false, true, false],
	memory_read: "R",
	memory_write: [true, false, false],
	system_read: "R",
	system_update: [true, false, false],
	component_read: "R",
	component_draft_create: [false, false, false],
	component_draft_update: [false, false, false],
	component_publish: [false, false, false],
	component_delete: [true, false, false],
	component_migrate: [false, false, false],
};

describe("MCP tool surface", () => {
	let fixture: TrickroomMcpProjectFixture | undefined;
	let session: TrickroomMcpClientSession | undefined;

	afterEach(async () => {
		await session?.close();
		await fixture?.cleanup();
	});

	const listTools = async () => {
		fixture = await createTrickroomMcpProjectFixture();
		session = await createTrickroomMcpTestClient(
			await fixture.readMcpContext(),
		);
		return (await session.client.listTools()).tools;
	};

	it("lists every tool once, in TOOL_NAMES order", async () => {
		const tools = await listTools();
		expect(tools.map((tool) => tool.name)).toEqual(TOOL_NAMES);
		expect(Object.keys(EXPECTED_ANNOTATIONS)).toEqual(TOOL_NAMES);
	});

	it("keeps descriptions and server instructions within client limits", async () => {
		const tools = await listTools();
		for (const tool of tools) {
			expect(tool.description?.length ?? 0, tool.name).toBeLessThanOrEqual(
				CLIENT_TEXT_LIMIT,
			);
			expect(tool.description?.length ?? 0, tool.name).toBeGreaterThan(100);
			expect(tool.title, tool.name).toEqual(expect.any(String));
		}
		const instructions = session?.client.getInstructions() ?? "";
		expect(instructions.length).toBeLessThanOrEqual(CLIENT_TEXT_LIMIT);
		for (const name of [
			"project_list",
			"memory_read",
			"guide",
			"design_apply",
		]) {
			expect(instructions).toContain(name);
		}
	});

	it("annotates every tool's read and write behaviour", async () => {
		const tools = await listTools();
		for (const tool of tools) {
			const expected = EXPECTED_ANNOTATIONS[tool.name];
			if (expected === "R" || expected === "R open") {
				expect(tool.annotations, tool.name).toEqual({
					readOnlyHint: true,
					openWorldHint: expected === "R open",
				});
			} else {
				const [destructiveHint, idempotentHint, openWorldHint] = expected;
				expect(tool.annotations, tool.name).toEqual({
					readOnlyHint: false,
					destructiveHint,
					idempotentHint,
					openWorldHint,
				});
			}
		}
	});

	it("loads the four entry tools up front and keeps them small", async () => {
		const tools = await listTools();
		const alwaysLoaded = tools.filter(
			(tool) => tool._meta?.[ALWAYS_LOAD_META_KEY] === true,
		);
		expect(alwaysLoaded.map((tool) => tool.name)).toEqual([
			"project_list",
			"guide",
			"design_read",
			"design_apply",
		]);
		const size = JSON.stringify(alwaysLoaded).length;
		expect(size).toBeLessThan(14_000);
	});
});
