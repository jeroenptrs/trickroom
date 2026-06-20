import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";
import { readMcpEnabledProjectContext } from "../project";
import type { TrickroomDesign } from "../types";
import { storeDomainTokens } from "../utils/tailwind-token-store";
import { createTrickroomMcpServer } from "./server";

const validDesign = {
	name: "Landing Page",
	systemName: "Core",
	boards: [
		{
			id: "root",
			props: {
				"data-trickroom-name": "Root",
				"data-trickroom-library": "trickroom",
				"data-trickroom-component": "container",
			},
			children: [
				{
					id: "title",
					props: {
						"data-trickroom-name": "Title",
						"data-trickroom-library": "trickroom",
						"data-trickroom-component": "text",
						"data-trickroom-role": "text",
					},
					children: "Hello",
				},
			],
		},
	],
} satisfies TrickroomDesign;

describe("trickroom MCP discovery tools", () => {
	const tempProjectRoots: string[] = [];

	afterEach(async () => {
		await Promise.all(
			tempProjectRoots.splice(0).map((projectRoot) =>
				rm(projectRoot, { force: true, recursive: true }),
			),
		);
	});

	const createProjectRoot = async () => {
		const projectRoot = await mkdtemp(
			path.join(process.cwd(), ".tmp-trickroom-mcp-server-test-"),
		);
		tempProjectRoots.push(projectRoot);
		await writeFile(
			path.join(projectRoot, "trickroom.config.json"),
			JSON.stringify({
				name: "Project",
				systems: {
					Core: "src/index.css",
				},
				mcp: {
					enabled: true,
				},
			}),
			"utf8",
		);
		return projectRoot;
	};

	const writeDesignFixture = async (
		projectRoot: string,
		designFileId: string,
		design: TrickroomDesign = validDesign,
	) => {
		const designDir = path.join(projectRoot, ".trickroom", "designs");
		await mkdir(designDir, { recursive: true });
		await writeFile(
			path.join(designDir, `${designFileId}.json`),
			`${JSON.stringify(design, null, "\t")}\n`,
			"utf8",
		);
	};

	const createClient = async (projectRoot: string) => {
		const context = await readMcpEnabledProjectContext(projectRoot);
		const server = createTrickroomMcpServer(context);
		const client = new Client(
			{
				name: "trickroom-test-client",
				version: "0.0.0",
			},
			{
				capabilities: {},
			},
		);
		const [clientTransport, serverTransport] =
			InMemoryTransport.createLinkedPair();

		await Promise.all([
			server.connect(serverTransport),
			client.connect(clientTransport),
		]);

		return {
			client,
			close: async () => {
				await client.close();
				await server.close();
			},
		};
	};

	it("advertises discovery tools with read-only closed-world annotations and input schemas", async () => {
		const projectRoot = await createProjectRoot();
		const { client, close } = await createClient(projectRoot);

		try {
			const listToolsResult = await client.listTools();
			const toolsByName = new Map(
				listToolsResult.tools.map((tool) => [tool.name, tool]),
			);

			for (const name of [
				"listRegistries",
				"listRegistryComponents",
				"describeRegistryComponent",
				"getDesignSystemForDesignFile",
				"listDesignTokens",
			]) {
				expect(toolsByName.get(name)?.annotations).toMatchObject({
					readOnlyHint: true,
					openWorldHint: false,
				});
			}

			expect(
				toolsByName.get("describeRegistryComponent")?.inputSchema.properties,
			).toHaveProperty("library");
			expect(
				toolsByName.get("describeRegistryComponent")?.inputSchema.properties,
			).toHaveProperty("component");
			expect(
				toolsByName.get("getDesignSystemForDesignFile")?.inputSchema.properties,
			).toHaveProperty("designFileId");
		} finally {
			await close();
		}
	});

	it("lists and describes built-in registry components", async () => {
		const projectRoot = await createProjectRoot();
		const { client, close } = await createClient(projectRoot);

		try {
			const listRegistriesResult = await client.callTool({
				name: "listRegistries",
				arguments: {},
			});
			expect(listRegistriesResult.structuredContent).toMatchObject({
				registries: [
					{
						library: "trickroom",
						builtIn: true,
						readOnly: true,
						componentCount: 2,
						components: ["container", "text"],
					},
				],
			});

			const componentsResult = await client.callTool({
				name: "listRegistryComponents",
				arguments: {
					library: "trickroom",
				},
			});
			expect(componentsResult.structuredContent).toMatchObject({
				registries: [
					{
						library: "trickroom",
						components: [
							{
								component: "container",
								role: "default",
								allowedChildren: {
									kind: "nodes",
								},
							},
							{
								component: "text",
								role: "text",
								allowedChildren: {
									kind: "none",
								},
							},
						],
					},
				],
			});

			const describeResult = await client.callTool({
				name: "describeRegistryComponent",
				arguments: {
					library: "trickroom",
					component: "text",
				},
			});
			expect(describeResult.structuredContent).toMatchObject({
				library: "trickroom",
				component: "text",
				role: "text",
				allowedChildren: {
					kind: "none",
					serializedChildren: "string",
				},
				defaults: {
					props: {
						"data-trickroom-library": "trickroom",
						"data-trickroom-component": "text",
						"data-trickroom-role": "text",
					},
					children: "",
				},
			});
		} finally {
			await close();
		}
	});

	it("resolves the design file system and lists stored tokens with sync metadata", async () => {
		const projectRoot = await createProjectRoot();
		await writeDesignFixture(projectRoot, "design-1");
		await storeDomainTokens({
			projectRoot,
			systemName: "Core",
			cssPath: "src/index.css",
			tailwindBaselineVersion: "test-baseline",
			tokens: {
				"brand-500": "#123456",
				"accent-primary": "#abcdef",
			},
			overrides: ["brand-500"],
			baselineDiff: {
				added: [
					{
						name: "brand-500",
						value: "#123456",
						domain: "color",
					},
				],
				overridden: [],
				removed: [],
			},
			reviewRequired: true,
			syncedAt: "2026-05-05T08:00:00.000Z",
		});
		const { client, close } = await createClient(projectRoot);

		try {
			const systemResult = await client.callTool({
				name: "getDesignSystemForDesignFile",
				arguments: {
					designFileId: "design-1",
				},
			});
			expect(systemResult.structuredContent).toMatchObject({
				designFile: {
					id: "design-1",
					name: "Landing Page",
					systemName: "Core",
				},
				designSystem: {
					systemName: "Core",
					configured: true,
					cssPath: "src/index.css",
					tokenStorage: {
						available: true,
						syncedAt: "2026-05-05T08:00:00.000Z",
						reviewRequired: true,
					},
				},
			});

			const tokensResult = await client.callTool({
				name: "listDesignTokens",
				arguments: {
					designFileId: "design-1",
				},
			});
			expect(tokensResult.structuredContent).toMatchObject({
				storageStatus: "stored",
				tokens: [
					{
						domain: "color",
						category: "accent",
						name: "accent-primary",
						value: "#abcdef",
						overrideConfirmed: false,
						syncedAt: "2026-05-05T08:00:00.000Z",
						reviewRequired: true,
					},
					{
						domain: "color",
						category: "brand",
						name: "brand-500",
						value: "#123456",
						overrideConfirmed: true,
						syncedAt: "2026-05-05T08:00:00.000Z",
						reviewRequired: true,
					},
				],
				domains: {
					color: {
						tokenCount: 2,
						overrides: ["brand-500"],
					},
				},
			});
		} finally {
			await close();
		}
	});
});
