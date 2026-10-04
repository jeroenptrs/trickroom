import { spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import path from "node:path";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { build } from "vite";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { upsertProjectLocation } from "../app-state/project-registry";
import {
	createTrickroomMcpProjectFixture,
	createTrickroomMcpStdioTestClient,
	type TrickroomMcpProjectFixture,
	toolPayload,
	trickroomMcpTestDesignUuid,
} from "./test-support";

type ToolCallPayload = Record<string, unknown>;

const expectedReadToolNames = [
	"project_list",
	"design_list",
	"design_read",
	"design_validate",
	"listRegistries",
	"listRegistryComponents",
	"describeRegistryComponent",
	"getSystemComponentAuthoringContract",
	"system_read",
] as const;

const expectedMutationToolNames = [
	"system_update",
	"design_create",
	"design_apply",
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
	options: { destructiveHint: boolean; openWorldHint?: boolean },
) => {
	expect(tool.annotations, `Expected "${tool.name}" annotations`).toMatchObject(
		{
			openWorldHint: options.openWorldHint ?? false,
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
	expect(toolPayload(result)).toEqual(expect.any(Object));

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
			expect(parsedTextContent).toEqual(toolPayload(result));
		}
	}

	return toolPayload(result) as ToolCallPayload;
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
		const { designFileId, expectedRevision, ...parameters } = args;
		const result = await client.callTool({
			name: "design_apply",
			arguments: {
				designFileId,
				expectedRevision,
				operations: [{ operation: "updateElementText", parameters }],
			},
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

	// Build into a throwaway copy of bin/ + dist/ so the test never rewrites
	// dist/mcp-stdio.js, which live MCP sessions load from this checkout. The
	// directory stays inside the repo so external runtime deps resolve from
	// node_modules.
	let buildRoot = "";

	beforeAll(async () => {
		buildRoot = await mkdtemp(
			path.join(process.cwd(), ".tmp-trickroom-mcp-build-"),
		);
		const binSource = path.join(process.cwd(), "bin");
		const binTarget = path.join(buildRoot, "bin");
		await mkdir(binTarget);
		for (const entry of await readdir(binSource)) {
			if (entry.endsWith(".js") && !entry.endsWith(".test.js")) {
				await copyFile(
					path.join(binSource, entry),
					path.join(binTarget, entry),
				);
			}
		}
		await build({
			configFile: path.join(process.cwd(), "vite.mcp.config.ts"),
			logLevel: "silent",
			build: { outDir: path.join(buildRoot, "dist") },
		});
	}, 30_000);

	afterAll(async () => {
		if (buildRoot) {
			await rm(buildRoot, { force: true, recursive: true });
		}
	});

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
			args: [path.join(buildRoot, "bin", "trickroom.js"), "mcp"],
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
			expect(toolsByName.get("project_select")?.annotations).toMatchObject({
				readOnlyHint: false,
				openWorldHint: false,
				idempotentHint: true,
			});
			expect(toolsByName.get("design_screenshot")?.annotations).toMatchObject({
				readOnlyHint: true,
				openWorldHint: true,
			});

			for (const name of expectedMutationToolNames) {
				expectWriteAnnotations(requireTool(toolsByName, name), {
					openWorldHint: false,
					destructiveHint: name !== "design_create",
				});
			}

			expectInputProperties(requireTool(toolsByName, "design_read"), [
				"designFileId",
				"boardId",
				"elementId",
			]);
			expectInputProperties(requireTool(toolsByName, "design_apply"), [
				"designFileId",
				"expectedRevision",
				"operations",
			]);
			expectInputProperties(requireTool(toolsByName, "design_create"), [
				"name",
				"systemName",
				"designFileId",
			]);
			expect(toolsByName.get("design_export")?.annotations).toMatchObject({
				readOnlyHint: false,
				destructiveHint: false,
				idempotentHint: true,
				openWorldHint: true,
			});
			expectInputProperties(requireTool(toolsByName, "design_export"), [
				"designFileId",
				"destinationDir",
				"format",
			]);
			expectInputProperties(requireTool(toolsByName, "design_screenshot"), [
				"designFileId",
				"boardId",
				"elementId",
				"component",
			]);
			expectInputProperties(requireTool(toolsByName, "system_update"), [
				"action",
				"systemName",
				"name",
				"sourcePath",
				"folderPath",
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
				path.join(process.cwd(), "bin", "trickroom.js"),
				"mcp",
				path.join(process.cwd(), "does-not-exist"),
			],
			{
				encoding: "utf8",
			},
		);

		expect(result.status).toBe(1);
		const stderr = result.stderr?.toString() ?? "";
		expect(stderr).toContain("does not accept positional arguments");
		expect(stderr).toContain("project_select");
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
				"design_list",
				{},
			);
			expect(JSON.stringify(designFiles)).toContain(trickroomMcpTestDesignUuid);

			const designFile = await requireStructuredPayload(
				session.client,
				"design_read",
				{
					designFileId: trickroomMcpTestDesignUuid,
				},
			);
			const initialRevision = findRevision(designFile);

			expect(initialRevision).toEqual(expect.any(String));
			expect(JSON.stringify(designFile).length).toBeLessThan(6000);
			expect(designFile).not.toHaveProperty("boards.0.children");

			const element = await requireStructuredPayload(
				session.client,
				"design_read",
				{
					designFileId: trickroomMcpTestDesignUuid,
					elementId: "title",
					depth: 0,
				},
			);
			expect(JSON.stringify(element)).toContain("Harness fixture");

			const subtree = await requireStructuredPayload(
				session.client,
				"design_read",
				{
					designFileId: trickroomMcpTestDesignUuid,
					elementId: "board",
				},
			);
			expect(JSON.stringify(subtree)).toContain("title");

			const validation = await requireStructuredPayload(
				session.client,
				"design_validate",
				{
					designFileId: trickroomMcpTestDesignUuid,
				},
			);
			expect(JSON.stringify(validation)).toMatch(/valid|ok|success/i);

			const createdDesignFileId = "30000000-0000-4000-8000-000000000003";
			const createResult = await requireStructuredPayload(
				session.client,
				"design_create",
				{
					designFileId: createdDesignFileId,
					name: "Smoke Exploration",
					systemName: null,
				},
			);
			expect(findRevision(createResult)).toEqual(expect.any(String));
			const createdDesign = await fixture.designFileService.readDesignFile(
				fixture.designFileService.getFileForUuid(createdDesignFileId),
			);
			expect(createdDesign.design.name).toBe("Smoke Exploration");
			expect(createdDesign.design.boards).toEqual([]);

			const addResult = await requireStructuredPayload(
				session.client,
				"design_apply",
				{
					designFileId: trickroomMcpTestDesignUuid,
					expectedRevision: initialRevision,
					operations: [
						{
							operation: "addElement",
							parameters: {
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
						},
					],
				},
			);
			expect(findRevision(addResult)).toEqual(expect.any(String));

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
