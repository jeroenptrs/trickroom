import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { build } from "vite";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { upsertProjectLocation } from "../app-state/project-registry";
import {
	createTrickroomMcpProjectFixture,
	createTrickroomMcpStdioTestClient,
	type TrickroomMcpProjectFixture,
	trickroomMcpTestDesignUuid,
} from "./test-support";

type ToolCallPayload = Record<string, unknown>;

const expectedReadToolNames = [
	"trickroom_project_info",
	"listDesignFiles",
	"readDesignFile",
	"readElement",
	"readSubtree",
	"validateDesignFile",
	"listRegistries",
	"listRegistryComponents",
	"describeRegistryComponent",
	"getDesignSystemForDesignFile",
	"getSystemComponentAuthoringContract",
	"listDesignTokens",
] as const;

const expectedMutationToolNames = [
	"addSystemIconFolder",
	"removeSystemIconFolder",
	"addSystemAsset",
	"removeSystemAsset",
	"refreshSystemAssetMetadata",
	"createDesignFile",
	"renameDesignFile",
	"addElement",
	"updateElementProps",
	"updateRecipeControl",
	"updateElementText",
	"moveElement",
	"deleteElement",
] as const;

const expectedPromptNames = [
	"edit_design_file",
	"add_component_to_design",
	"refactor_design_structure",
	"explain_design_file",
	"validate_design_changes",
	"create_design_file_from_brief",
	"add_media_or_icon",
	"reuse_design_subtree",
] as const;

const getStringEnv = (overrides: Record<string, string>) => ({
	...Object.fromEntries(
		Object.entries(process.env).filter(
			(entry): entry is [string, string] => typeof entry[1] === "string",
		),
	),
	...overrides,
});

const getToolsByName = async (client: Client) => {
	const listToolsResult = await client.listTools();
	return new Map(listToolsResult.tools.map((tool) => [tool.name, tool]));
};

const requireTool = (toolsByName: Map<string, Tool>, name: string) => {
	const tool = toolsByName.get(name);
	expect(tool, `Expected MCP tool "${name}" to be discovered`).toBeDefined();
	return tool as Tool;
};

const expectInputProperties = (tool: Tool, propertyNames: string[]) => {
	const properties = tool.inputSchema.properties;
	expect(
		properties,
		`Expected "${tool.name}" to publish input schema properties`,
	).toBeDefined();

	for (const propertyName of propertyNames) {
		expect(
			properties,
			`Expected "${tool.name}" input schema to include "${propertyName}"`,
		).toHaveProperty(propertyName);
	}
};

const expectReadOnlyAnnotations = (tool: Tool) => {
	expect(tool.annotations, `Expected "${tool.name}" annotations`).toMatchObject(
		{
			readOnlyHint: true,
			openWorldHint: false,
		},
	);
};

const expectWriteAnnotations = (
	tool: Tool,
	options: { destructiveHint: boolean },
) => {
	expect(tool.annotations, `Expected "${tool.name}" annotations`).toMatchObject(
		{
			openWorldHint: false,
			idempotentHint: false,
			destructiveHint: options.destructiveHint,
		},
	);
	expect(tool.annotations?.readOnlyHint).not.toBe(true);
};

const requireStructuredPayload = async (
	client: Client,
	name: string,
	args: Record<string, unknown>,
): Promise<ToolCallPayload> => {
	const result = await client.callTool({
		name,
		arguments: args,
	});

	expect(result.isError, `Expected "${name}" call to succeed`).not.toBe(true);
	expect(result.structuredContent).toEqual(expect.any(Object));

	const textContent = result.content.find((content) => content.type === "text");
	expect(
		textContent,
		`Expected "${name}" to return text JSON content`,
	).toBeDefined();

	if (textContent?.type === "text") {
		let parsedTextContent: unknown;
		try {
			parsedTextContent = JSON.parse(textContent.text);
		} catch {
			parsedTextContent = undefined;
		}
		if (parsedTextContent === undefined) {
			expect(textContent.text.trim().length).toBeGreaterThan(0);
		} else {
			expect(parsedTextContent).toEqual(result.structuredContent);
		}
	}

	return result.structuredContent as ToolCallPayload;
};

const findRevision = (payload: unknown): string | null => {
	if (payload === null || typeof payload !== "object") {
		return null;
	}

	if (
		"revision" in payload &&
		typeof (payload as { revision?: unknown }).revision === "string"
	) {
		return (payload as { revision: string }).revision;
	}
	if (
		"newRevision" in payload &&
		typeof (payload as { newRevision?: unknown }).newRevision === "string"
	) {
		return (payload as { newRevision: string }).newRevision;
	}

	for (const value of Object.values(payload)) {
		const revision = findRevision(value);
		if (revision) {
			return revision;
		}
	}

	return null;
};

const expectRevisionMismatch = async (
	client: Client,
	args: Record<string, unknown>,
) => {
	try {
		const result = await client.callTool({
			name: "updateElementText",
			arguments: args,
		});

		expect(result.isError).toBe(true);
		expect(JSON.stringify(result)).toMatch(/REVISION_MISMATCH|revision/i);
	} catch (error) {
		expect(error instanceof Error ? error.message : String(error)).toMatch(
			/REVISION_MISMATCH|revision/i,
		);
	}
};

describe("trickroom MCP inspector-compatible stdio smoke", () => {
	const fixtures: TrickroomMcpProjectFixture[] = [];
	const trickroomHomes: string[] = [];

	beforeAll(async () => {
		await build({
			configFile: path.join(process.cwd(), "vite.mcp.config.ts"),
			logLevel: "silent",
		});
	}, 30_000);

	afterEach(async () => {
		await Promise.all([
			...fixtures.splice(0).map((fixture) => fixture.cleanup()),
			...trickroomHomes
				.splice(0)
				.map((home) => rm(home, { force: true, recursive: true })),
		]);
	});

	const createFixture = async () => {
		const fixture = await createTrickroomMcpProjectFixture();
		fixtures.push(fixture);
		return fixture;
	};

	const createStdioSession = async (fixture: TrickroomMcpProjectFixture) => {
		const trickroomHome = await mkdtemp(
			path.join(process.cwd(), ".tmp-trickroom-mcp-home-"),
		);
		trickroomHomes.push(trickroomHome);
		const projectId = fixture.config.projectId;
		if (!projectId) {
			throw new Error("Fixture project is missing a projectId.");
		}
		await upsertProjectLocation({
			trickroomHome,
			projectId,
			root: fixture.projectRoot,
			name: fixture.config.name,
		});

		return createTrickroomMcpStdioTestClient({
			command: process.execPath,
			args: [path.join(process.cwd(), "bin", "trickroom-mcp.js")],
			cwd: fixture.projectRoot,
			env: getStringEnv({
				TRICKROOM_HOME: trickroomHome,
				NO_COLOR: "1",
				FORCE_COLOR: "0",
			}),
			stderr: "pipe",
		});
	};

	it("starts over stdio and exposes the v1 tool and prompt contract", async () => {
		const fixture = await createFixture();
		const session = await createStdioSession(fixture);

		try {
			expect(session.client.getServerVersion()).toMatchObject({
				name: "trickroom",
				version: "0.1.0",
			});
			expect(session.client.getServerCapabilities()).toMatchObject({
				tools: expect.any(Object),
			});
			expect(session.client.getInstructions()).toMatch(/Trickroom MCP/);

			const toolsByName = await getToolsByName(session.client);

			for (const name of expectedReadToolNames) {
				expectReadOnlyAnnotations(requireTool(toolsByName, name));
			}
			expect(toolsByName.get("getSelectedProject")?.annotations).toMatchObject({
				readOnlyHint: true,
				openWorldHint: false,
			});
			expect(toolsByName.get("getActiveProject")?.annotations).toMatchObject({
				readOnlyHint: true,
				openWorldHint: false,
			});
			expect(toolsByName.get("resolveProject")?.annotations).toMatchObject({
				readOnlyHint: true,
				openWorldHint: false,
			});
			expect(toolsByName.get("registerProject")?.annotations).toMatchObject({
				readOnlyHint: false,
				openWorldHint: false,
				idempotentHint: true,
			});
			expect(toolsByName.get("selectProject")?.annotations).toMatchObject({
				readOnlyHint: false,
				openWorldHint: false,
				idempotentHint: true,
			});
			expect(toolsByName.get("openProject")?.annotations).toMatchObject({
				readOnlyHint: false,
				openWorldHint: false,
				idempotentHint: true,
			});

			for (const name of expectedMutationToolNames) {
				expectWriteAnnotations(requireTool(toolsByName, name), {
					destructiveHint: ![
						"addSystemIconFolder",
						"addSystemAsset",
						"refreshSystemAssetMetadata",
						"addElement",
						"createDesignFile",
					].includes(name),
				});
			}

			expectInputProperties(requireTool(toolsByName, "readDesignFile"), [
				"designFileId",
			]);
			expectInputProperties(requireTool(toolsByName, "readElement"), [
				"designFileId",
				"elementId",
			]);
			expectInputProperties(requireTool(toolsByName, "addElement"), [
				"designFileId",
				"expectedRevision",
				"parentId",
				"library",
				"component",
				"props",
			]);
			expectInputProperties(requireTool(toolsByName, "createDesignFile"), [
				"name",
				"systemName",
				"designFileId",
			]);
			expectInputProperties(requireTool(toolsByName, "addSystemAsset"), [
				"systemName",
				"name",
				"sourcePath",
			]);
			expectInputProperties(requireTool(toolsByName, "addSystemIconFolder"), [
				"systemName",
				"folderPath",
			]);
			expectInputProperties(requireTool(toolsByName, "renameDesignFile"), [
				"designFileId",
				"expectedRevision",
				"name",
			]);
			expectInputProperties(requireTool(toolsByName, "updateElementText"), [
				"designFileId",
				"expectedRevision",
				"elementId",
				"text",
			]);

			if (session.client.getServerCapabilities()?.prompts) {
				const prompts = await session.client.listPrompts();
				const promptNames = prompts.prompts.map((prompt) => prompt.name);

				expect(promptNames).toEqual(
					expect.arrayContaining(expectedPromptNames),
				);
			}
		} finally {
			await session.close();
		}
	});

	it("rejects positional arguments for the MCP CLI entrypoint", async () => {
		const result = spawnSync(
			process.execPath,
			[
				path.join(process.cwd(), "bin", "trickroom-mcp.js"),
				path.join(process.cwd(), "does-not-exist"),
			],
			{
				encoding: "utf8",
			},
		);

		expect(result.status).toBe(1);
		const stderr = result.stderr?.toString() ?? "";
		expect(stderr).toContain("does not accept positional arguments");
		expect(stderr).toContain("registerProject");
		expect(stderr).toContain("selectProject");
	});

	it("performs representative read and write calls through stdio", async () => {
		const fixture = await createFixture();
		const session = await createStdioSession(fixture);

		try {
			const resources = await session.client.listResources();
			const fixtureResource = resources.resources.find((resource) =>
				resource.uri.includes(trickroomMcpTestDesignUuid),
			);
			expect(fixtureResource).toBeDefined();
			expect(fixtureResource).toMatchObject({
				mimeType: "application/json",
			});

			const designFiles = await requireStructuredPayload(
				session.client,
				"listDesignFiles",
				{},
			);
			expect(JSON.stringify(designFiles)).toContain(trickroomMcpTestDesignUuid);

			const designFile = await requireStructuredPayload(
				session.client,
				"readDesignFile",
				{
					designFileId: trickroomMcpTestDesignUuid,
				},
			);
			const initialRevision = findRevision(designFile);

			expect(initialRevision).toMatch(/^sha256:[a-f0-9]{64}$/);
			expect(JSON.stringify(designFile).length).toBeLessThan(6000);
			expect(designFile).not.toHaveProperty("boards.0.children");

			const element = await requireStructuredPayload(
				session.client,
				"readElement",
				{
					designFileId: trickroomMcpTestDesignUuid,
					elementId: "title",
				},
			);
			expect(JSON.stringify(element)).toContain("Harness fixture");

			const subtree = await requireStructuredPayload(
				session.client,
				"readSubtree",
				{
					designFileId: trickroomMcpTestDesignUuid,
					elementId: "board",
				},
			);
			expect(JSON.stringify(subtree)).toContain("title");

			const validation = await requireStructuredPayload(
				session.client,
				"validateDesignFile",
				{
					designFileId: trickroomMcpTestDesignUuid,
				},
			);
			expect(JSON.stringify(validation)).toMatch(/valid|ok|success/i);

			const createdDesignFileId = "30000000-0000-4000-8000-000000000003";
			const createResult = await requireStructuredPayload(
				session.client,
				"createDesignFile",
				{
					designFileId: createdDesignFileId,
					name: "Smoke Exploration",
					systemName: null,
				},
			);
			expect(findRevision(createResult)).toMatch(/^sha256:[a-f0-9]{64}$/);
			const createdDesign = await fixture.designFileService.readDesignFile(
				fixture.designFileService.getFileForUuid(createdDesignFileId),
			);
			expect(createdDesign.design.name).toBe("Smoke Exploration");
			expect(createdDesign.design.boards).toEqual([]);

			const addResult = await requireStructuredPayload(
				session.client,
				"addElement",
				{
					designFileId: trickroomMcpTestDesignUuid,
					expectedRevision: initialRevision,
					parentId: "board",
					index: 1,
					library: "trickroom",
					component: "text",
					text: "Smoke copy",
					props: {
						"data-trickroom-name": "Smoke Text From Props",
						className: "text-brand-500",
					},
				},
			);
			expect(findRevision(addResult)).toMatch(/^sha256:[a-f0-9]{64}$/);

			const afterAdd = await fixture.designFileService.readDesignFile(
				fixture.designFileService.getFileForUuid(trickroomMcpTestDesignUuid),
			);
			expect(JSON.stringify(afterAdd.design)).toContain("Smoke copy");
			expect(JSON.stringify(afterAdd.design)).toContain(
				"Smoke Text From Props",
			);
			expect(JSON.stringify(afterAdd.design)).toContain("text-brand-500");

			await expectRevisionMismatch(session.client, {
				designFileId: trickroomMcpTestDesignUuid,
				expectedRevision: initialRevision,
				elementId: "title",
				text: "Stale edit",
			});

			const afterMismatch = await fixture.designFileService.readDesignFile(
				fixture.designFileService.getFileForUuid(trickroomMcpTestDesignUuid),
			);
			expect(JSON.stringify(afterMismatch.design)).toContain("Harness fixture");
			expect(JSON.stringify(afterMismatch.design)).not.toContain("Stale edit");
		} finally {
			await session.close();
		}
	});
});
