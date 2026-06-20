import { mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { readMcpEnabledProjectContext } from "../project";
import { createTrickroomMcpServer } from "./server";

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

describe("trickroom MCP workflow prompts", () => {
	const createProjectRoot = async () => {
		const projectRoot = await mkdtemp(
			path.join(process.cwd(), ".tmp-trickroom-prompts-test-"),
		);
		await writeFile(
			path.join(projectRoot, "trickroom.config.json"),
			JSON.stringify({
				name: "Project",
				mcp: { enabled: true },
			}),
			"utf8",
		);
		return projectRoot;
	};

	const createClient = async (projectRoot: string) => {
		const context = await readMcpEnabledProjectContext(projectRoot);
		const server = createTrickroomMcpServer(context);
		const client = new Client(
			{ name: "test-client", version: "0.0.0" },
			{ capabilities: { prompts: {} } },
		);
		const [clientTransport, serverTransport] =
			InMemoryTransport.createLinkedPair();
		await Promise.all([
			server.connect(serverTransport),
			client.connect(clientTransport),
		]);
		return { client, server, projectRoot };
	};

	it("registers all workflow prompts", async () => {
		const projectRoot = await createProjectRoot();
		const { client, server } = await createClient(projectRoot);
		try {
			const prompts = await client.listPrompts();
			const names = prompts.prompts.map((p) => p.name);
			for (const name of expectedPromptNames) {
				expect(names).toContain(name);
			}
		} finally {
			await server.close();
			await rm(projectRoot, { force: true, recursive: true });
		}
	});

	it("returns tool-driven instructions for edit_design_file", async () => {
		const projectRoot = await createProjectRoot();
		const { client, server } = await createClient(projectRoot);
		const designFileId = "00000000-0000-0000-0000-000000000000";
		try {
			const prompt = await client.getPrompt({
				name: "edit_design_file",
				arguments: { designFileId },
			});
			const text = prompt.messages[0].content.text;
			expect(text).toContain("listDesignFiles");
			expect(text).toContain("getDesignAuthoringContract");
			expect(text).toContain("readDesignGraph");
			expect(text).toContain("addRecipe");
			expect(text).toContain("addSubtree");
			expect(text).toContain("validateOperation");
			expect(text).toContain("validateSubtree");
			expect(text).toContain("listSystemAssets");
			expect(text).toContain("validateDesignFile");
			expect(text).toContain("REVISION_MISMATCH");
			expect(text).toContain("expectedRevision");
			expect(text).toContain("newRevision");
			expect(text).toContain("revision chaining");
			expect(text).toContain(designFileId);
		} finally {
			await server.close();
			await rm(projectRoot, { force: true, recursive: true });
		}
	});

	it("returns registry-content instructions for add_component_to_design", async () => {
		const projectRoot = await createProjectRoot();
		const { client, server } = await createClient(projectRoot);
		const designFileId = "00000000-0000-0000-0000-000000000000";
		try {
			const prompt = await client.getPrompt({
				name: "add_component_to_design",
				arguments: { designFileId, parentId: "some-parent" },
			});
			const text = prompt.messages[0].content.text;
			expect(text).toContain("addElement");
			expect(text).toContain("addRecipe");
			expect(text).toContain("addSubtree");
			expect(text).toContain("copySubtree");
			expect(text).toContain("getDesignAuthoringContract");
			expect(text).toContain("validateOperation");
			expect(text).toContain("listSystemAssets");
			expect(text).toContain("readDesignGraph");
			expect(text).toContain("some-parent");
			expect(text).toContain("getSelectedProject");
			expect(text).toContain("listProjects");
			expect(text).toContain("selectProject");
			expect(text).toContain("locationId");

			const rootPrompt = await client.getPrompt({
				name: "add_component_to_design",
				arguments: { designFileId },
			});
			expect(rootPrompt.messages[0].content.text).toContain("'parentId': null");
			expect(rootPrompt.messages[0].content.text).toContain("at the root");
		} finally {
			await server.close();
			await rm(projectRoot, { force: true, recursive: true });
		}
	});

	it("returns graph-first refactor instructions", async () => {
		const projectRoot = await createProjectRoot();
		const { client, server } = await createClient(projectRoot);
		try {
			const prompt = await client.getPrompt({
				name: "refactor_design_structure",
				arguments: { designFileId: "00000000-0000-0000-0000-000000000000" },
			});
			const text = prompt.messages[0].content.text;
			expect(text).toContain("readDesignGraph");
			expect(text).toContain("copySubtree");
			expect(text).toContain("extractSubtree");
			expect(text).toContain("detachRecipeInstance");
			expect(text).toContain("updateRecipeInstance");
			expect(text).toContain("updateRecipeControl");
			expect(text).toContain("validateOperation");
			expect(text).toContain("validateOperationPlan");
			expect(text).toContain("applyDesignOperations");
			expect(text).toContain("newRevision");
			expect(text).toContain("readSubtree");
		} finally {
			await server.close();
			await rm(projectRoot, { force: true, recursive: true });
		}
	});

	it("returns expanded read-only discovery instructions for explain_design_file", async () => {
		const projectRoot = await createProjectRoot();
		const { client, server } = await createClient(projectRoot);
		try {
			const prompt = await client.getPrompt({
				name: "explain_design_file",
				arguments: { designFileId: "00000000-0000-0000-0000-000000000000" },
			});
			const text = prompt.messages[0].content.text;
			expect(text).toContain("readDesignGraph");
			expect(text).toContain("getDesignAuthoringContract");
			expect(text).toContain("listRegistries");
			expect(text).toContain("registry component/recipe lists");
			expect(text).toContain("findAssetUsage");
			expect(text).toContain("findIconUsage");
			expect(text).toContain("listDesignTokens");
			expect(text).toContain("validateDesignFile");
			expect(text).toContain("does not return rendered previews");
		} finally {
			await server.close();
			await rm(projectRoot, { force: true, recursive: true });
		}
	});

	it("returns categorized validation instructions for validate_design_changes", async () => {
		const projectRoot = await createProjectRoot();
		const { client, server } = await createClient(projectRoot);
		try {
			const prompt = await client.getPrompt({
				name: "validate_design_changes",
				arguments: { designFileId: "00000000-0000-0000-0000-000000000000" },
			});
			const text = prompt.messages[0].content.text;
			expect(text).toContain("validateDesignFile");
			expect(text).toContain("structural, registry, recipe, token, asset, and icon");
			expect(text).toContain("readDesignGraph");
			expect(text).toContain("validateOperation");
			expect(text).toContain("do not perform any unnecessary mutations");
			expect(text).toContain("Do not claim visual");
		} finally {
			await server.close();
			await rm(projectRoot, { force: true, recursive: true });
		}
	});

	it("returns brief-to-design instructions for create_design_file_from_brief", async () => {
		const projectRoot = await createProjectRoot();
		const { client, server } = await createClient(projectRoot);
		try {
			const prompt = await client.getPrompt({
				name: "create_design_file_from_brief",
				arguments: {
					brief: "Landing page hero with CTA",
					systemName: "default",
				},
			});
			const text = prompt.messages[0].content.text;
			expect(text).toContain("Landing page hero with CTA");
			expect(text).toContain("createDesignFile");
			expect(text).toContain("getDesignSystemForDesignFile");
			expect(text).toContain("Only when a configured system is linked");
			expect(text).toContain("getDesignAuthoringContract");
			expect(text).toContain("addRecipe");
			expect(text).toContain("validateSubtree");
			expect(text).toContain("validateDesignFile");
			expect(text).toContain("does not return rendered previews");
		} finally {
			await server.close();
			await rm(projectRoot, { force: true, recursive: true });
		}
	});

	it("returns media and icon workflow instructions for add_media_or_icon", async () => {
		const projectRoot = await createProjectRoot();
		const { client, server } = await createClient(projectRoot);
		try {
			const prompt = await client.getPrompt({
				name: "add_media_or_icon",
				arguments: {
					designFileId: "00000000-0000-0000-0000-000000000000",
					systemName: "brand",
				},
			});
			const text = prompt.messages[0].content.text;
			expect(text).toContain("listSystemAssets");
			expect(text).toContain("listSystemIcons");
			expect(text).toContain("addSystemAsset");
			expect(text).toContain("findAssetUsage");
			expect(text).toContain("does not return raw image or SVG bytes");
		} finally {
			await server.close();
			await rm(projectRoot, { force: true, recursive: true });
		}
	});

	it("returns copy and extract instructions for reuse_design_subtree", async () => {
		const projectRoot = await createProjectRoot();
		const { client, server } = await createClient(projectRoot);
		try {
			const prompt = await client.getPrompt({
				name: "reuse_design_subtree",
				arguments: {
					sourceDesignFileId: "00000000-0000-0000-0000-000000000000",
					sourceElementId: "el-source",
					targetDesignFileId: "ffffffff-ffff-ffff-ffff-ffffffffffff",
					targetParentId: "el-target-parent",
				},
			});
			const text = prompt.messages[0].content.text;
			expect(text).toContain("readDesignGraph");
			expect(text).toContain("validateCopySubtree");
			expect(text).toContain("sourceExpectedRevision");
			expect(text).toContain("copySubtree");
			expect(text).toContain("extractSubtree");
			expect(text).toContain("el-source");
			expect(text).toContain("el-target-parent");
		} finally {
			await server.close();
			await rm(projectRoot, { force: true, recursive: true });
		}
	});
});
