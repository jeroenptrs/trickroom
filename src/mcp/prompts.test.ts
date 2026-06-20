import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { readMcpEnabledProjectContext } from "../project";
import { createTrickroomMcpServer } from "./server";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";

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
		const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
		await Promise.all([
			server.connect(serverTransport),
			client.connect(clientTransport),
		]);
		return { client, server, projectRoot };
	};

	it("registers all five workflow prompts", async () => {
		const projectRoot = await createProjectRoot();
		const { client, server } = await createClient(projectRoot);
		try {
			const prompts = await client.listPrompts();
			const names = prompts.prompts.map((p) => p.name);
			expect(names).toContain("edit_design_file");
			expect(names).toContain("add_component_to_design");
			expect(names).toContain("refactor_design_structure");
			expect(names).toContain("explain_design_file");
			expect(names).toContain("validate_design_changes");
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
			expect(text).toContain("readDesignFile");
			expect(text).toContain("listDesignTokens");
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

	it("returns tool-driven instructions for add_component_to_design", async () => {
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
			expect(text).toContain("describeRegistryComponent");
			expect(text).toContain("REVISION_MISMATCH");
			expect(text).toContain("some-parent");

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

	it("returns instructions for multi-step refactor chaining revisions", async () => {
		const projectRoot = await createProjectRoot();
		const { client, server } = await createClient(projectRoot);
		try {
			const prompt = await client.getPrompt({
				name: "refactor_design_structure",
				arguments: { designFileId: "00000000-0000-0000-0000-000000000000" },
			});
			const text = prompt.messages[0].content.text;
			expect(text).toContain("newRevision");
			expect(text).toContain("readSubtree");
			expect(text).toContain("expectedRevision");
		} finally {
			await server.close();
			await rm(projectRoot, { force: true, recursive: true });
		}
	});

	it("returns read-only discovery instructions for explain_design_file", async () => {
		const projectRoot = await createProjectRoot();
		const { client, server } = await createClient(projectRoot);
		try {
			const prompt = await client.getPrompt({
				name: "explain_design_file",
				arguments: { designFileId: "00000000-0000-0000-0000-000000000000" },
			});
			const text = prompt.messages[0].content.text;
			expect(text).toContain("readDesignFile");
			expect(text).toContain("validateDesignFile");
			expect(text).toContain("registryReferences");
		} finally {
			await server.close();
			await rm(projectRoot, { force: true, recursive: true });
		}
	});

	it("returns validation and fix instructions for validate_design_changes", async () => {
		const projectRoot = await createProjectRoot();
		const { client, server } = await createClient(projectRoot);
		try {
			const prompt = await client.getPrompt({
				name: "validate_design_changes",
				arguments: { designFileId: "00000000-0000-0000-0000-000000000000" },
			});
			const text = prompt.messages[0].content.text;
			expect(text).toContain("validateDesignFile");
			expect(text).toContain("DUPLICATE_ELEMENT_ID");
			expect(text).toContain("readDesignFile");
			expect(text).toContain("expectedRevision");
			expect(text).toContain("REVISION_MISMATCH");
			expect(text).toContain("do not perform any unnecessary mutations");
		} finally {
			await server.close();
			await rm(projectRoot, { force: true, recursive: true });
		}
	});
});
