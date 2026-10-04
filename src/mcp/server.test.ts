import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ResourceListChangedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, describe, expect, it } from "vitest";
import { upsertProjectLocation } from "../app-state/project-registry";
import { readMcpEnabledProjectContext } from "../project";
import { expandRegistryRecipe } from "../recipes/expansion";
import { recipeIdProp, recipeInstanceProp } from "../recipes/markers";
import { createTrickroomApp } from "../server";
import { readStoredDesign } from "../test-utils/design-files";
import type { TrickroomDesign } from "../types";
import { storeDomainTokens } from "../utils/tailwind-token-store";
import { createTrickroomMcpServer } from "./server";
import { applyOperation, toolPayload } from "./test-support";

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
	let nextProjectIndex = 0;

	afterEach(async () => {
		await Promise.all(
			tempProjectRoots
				.splice(0)
				.map((projectRoot) =>
					rm(projectRoot, { force: true, recursive: true }),
				),
		);
	});

	const createProjectRoot = async (
		options: {
			name?: string;
			projectId?: string;
			mcp?: Record<string, unknown>;
		} = {},
	) => {
		const projectRoot = await mkdtemp(
			path.join(process.cwd(), ".tmp-trickroom-mcp-server-test-"),
		);
		tempProjectRoots.push(projectRoot);
		const projectIndex = nextProjectIndex++;
		await writeFile(
			path.join(projectRoot, "trickroom.config.json"),
			JSON.stringify({
				projectId: options.projectId ?? `proj_mcp_server_${projectIndex}`,
				name: options.name ?? "Project",
				systems: {
					Core: "src/index.css",
				},
				mcp: options.mcp ?? {
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

	const createAvatarRecipeDesign = (): TrickroomDesign => {
		const ids = ["avatar-root", "avatar-image", "avatar-fallback"];
		const expansion = expandRegistryRecipe("base-ui", "avatar.default", {
			createElementId: () => ids.shift() ?? "unexpected-id",
			createRecipeInstanceId: () => "recipe-instance-1",
		});

		return {
			name: "Recipe Design",
			systemName: "Core",
			boards: [expansion.root],
		};
	};

	const setRecipeId = (design: TrickroomDesign, recipeId: string) => {
		const visit = (node: TrickroomDesign["boards"][number]) => {
			if (node.props[recipeIdProp]) {
				node.props[recipeIdProp] = recipeId;
			}
			if (Array.isArray(node.children)) {
				for (const child of node.children) {
					visit(child);
				}
			}
		};

		for (const board of design.boards) {
			visit(board);
		}
	};

	const createClient = async (projectRoot: string) => {
		const context = await readMcpEnabledProjectContext(projectRoot);
		const trickroomHome = await mkdtemp(
			path.join(process.cwd(), ".tmp-trickroom-mcp-server-home-"),
		);
		tempProjectRoots.push(trickroomHome);
		const server = createTrickroomMcpServer(context, { trickroomHome });
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

	it("lists and reads design resources from an initial project context without a registry location", async () => {
		const projectRoot = await createProjectRoot({
			name: "Resource Project",
			projectId: "proj_resource_fallback",
		});
		await writeDesignFixture(
			projectRoot,
			"11111111-1111-4111-8111-111111111111",
		);
		const { client, close } = await createClient(projectRoot);

		try {
			const resources = await client.listResources();
			expect(resources.resources).toMatchObject([
				{
					uri: "trickroom://proj/proj_resource_fallback/design/landing-page--11111111-1111-4111-8111-111111111111",
					name: "design:proj_resource_fallback:landing-page--11111111-1111-4111-8111-111111111111",
					title: "Landing Page - Resource Project (proj_resource_fallback)",
					mimeType: "application/json",
				},
			]);

			const read = await client.readResource({
				uri: resources.resources[0].uri,
			});
			const content = read.contents[0];
			expect(
				"text" in content ? JSON.parse(content.text).designFile.name : null,
			).toBe("Landing Page");
		} finally {
			await close();
		}
	});

	it("keeps project-id resource URIs readable after a registry-backed active project switch", async () => {
		const trickroomHome = await mkdtemp(
			path.join(process.cwd(), ".tmp-trickroom-mcp-home-"),
		);
		tempProjectRoots.push(trickroomHome);
		const firstProjectRoot = await createProjectRoot({
			name: "First Resource Project",
			projectId: "proj_resource_first",
		});
		const secondProjectRoot = await createProjectRoot({
			name: "Second Resource Project",
			projectId: "proj_resource_second",
		});
		await writeDesignFixture(
			firstProjectRoot,
			"11111111-1111-4111-8111-111111111111",
			{ ...validDesign, name: "First Design" },
		);
		await writeDesignFixture(
			secondProjectRoot,
			"22222222-2222-4222-8222-222222222222",
			{ ...validDesign, name: "Second Design" },
		);
		const context = {
			...(await readMcpEnabledProjectContext(firstProjectRoot)),
			trickroomHome,
		};
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

		try {
			const initialResources = await client.listResources();
			expect(initialResources.resources[0]?.uri).toContain(
				"trickroom://proj/proj_resource_first/",
			);

			await upsertProjectLocation({
				trickroomHome,
				projectId: "proj_resource_second",
				root: secondProjectRoot,
				name: "Second Resource Project",
			});

			const read = await client.readResource({
				uri: initialResources.resources[0].uri,
			});
			const content = read.contents[0];
			expect(
				"text" in content ? JSON.parse(content.text).designFile.name : null,
			).toBe("First Design");

			const switchedResources = await client.listResources();
			expect(switchedResources.resources[0]?.uri).toContain(
				"design/first-design--11111111-1111-4111-8111-111111111111",
			);
		} finally {
			await client.close();
			await server.close();
		}
	});

	it("retargets project-scoped tools when project_select registers a path", async () => {
		const trickroomHome = await mkdtemp(
			path.join(process.cwd(), ".tmp-trickroom-mcp-home-"),
		);
		tempProjectRoots.push(trickroomHome);
		const firstProjectRoot = await createProjectRoot({
			name: "First Project",
			projectId: "proj_first",
		});
		const secondProjectRoot = await createProjectRoot({
			name: "Second Project",
			projectId: "proj_second",
		});
		await writeDesignFixture(
			firstProjectRoot,
			"11111111-1111-4111-8111-111111111111",
			{ ...validDesign, name: "First Design" },
		);
		await writeDesignFixture(
			secondProjectRoot,
			"22222222-2222-4222-8222-222222222222",
			{ ...validDesign, name: "Second Design" },
		);
		const context = {
			...(await readMcpEnabledProjectContext(firstProjectRoot)),
			trickroomHome,
		};
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

		try {
			const initialProject = await client.callTool({
				name: "project_list",
				arguments: {},
			});
			expect(toolPayload(initialProject)).toMatchObject({
				selected: {
					projectId: "proj_first",
					name: "First Project",
				},
			});

			const openResult = await client.callTool({
				name: "project_select",
				arguments: {
					path: secondProjectRoot,
				},
			});
			expect(toolPayload(openResult)).toMatchObject({
				selected: true,
				registered: true,
				project: {
					projectId: "proj_second",
					name: "Second Project",
					projectRoot: secondProjectRoot,
				},
				governance: { mode: "read-write" },
			});

			const activeProject = await client.callTool({
				name: "project_list",
				arguments: {},
			});
			expect(toolPayload(activeProject)).toMatchObject({
				selected: {
					projectId: "proj_second",
					name: "Second Project",
					projectRoot: secondProjectRoot,
				},
			});

			const designs = await client.callTool({
				name: "design_list",
				arguments: {},
			});
			expect(toolPayload(designs)).toMatchObject({
				project: {
					projectId: "proj_second",
				},
				designFiles: [
					{
						id: "22222222-2222-4222-8222-222222222222",
						name: "Second Design",
					},
				],
			});
		} finally {
			await client.close();
			await server.close();
		}
	});

	it("keeps project-scoped tools targeted when registry active changes outside MCP", async () => {
		const trickroomHome = await mkdtemp(
			path.join(process.cwd(), ".tmp-trickroom-mcp-home-"),
		);
		tempProjectRoots.push(trickroomHome);
		const firstProjectRoot = await createProjectRoot({
			name: "First Project",
			projectId: "proj_first",
		});
		const secondProjectRoot = await createProjectRoot({
			name: "Second Project",
			projectId: "proj_second",
		});
		await writeDesignFixture(
			firstProjectRoot,
			"11111111-1111-4111-8111-111111111111",
			{ ...validDesign, name: "First Design" },
		);
		await writeDesignFixture(
			secondProjectRoot,
			"22222222-2222-4222-8222-222222222222",
			{ ...validDesign, name: "Second Design" },
		);
		const context = {
			...(await readMcpEnabledProjectContext(firstProjectRoot)),
			trickroomHome,
		};
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

		try {
			await upsertProjectLocation({
				trickroomHome,
				projectId: "proj_second",
				root: secondProjectRoot,
				name: "Second Project",
			});

			const activeProject = await client.callTool({
				name: "project_list",
				arguments: {},
			});
			expect(toolPayload(activeProject)).toMatchObject({
				selected: {
					projectId: "proj_first",
					name: "First Project",
					projectRoot: firstProjectRoot,
				},
			});

			const designs = await client.callTool({
				name: "design_list",
				arguments: {},
			});
			expect(toolPayload(designs)).toMatchObject({
				project: {
					projectId: "proj_first",
				},
				designFiles: [
					{
						id: "11111111-1111-4111-8111-111111111111",
						name: "First Design",
					},
				],
			});
		} finally {
			await client.close();
			await server.close();
		}
	});

	it("keeps project-scoped tools targeted when the app opens another project", async () => {
		const trickroomHome = await mkdtemp(
			path.join(process.cwd(), ".tmp-trickroom-mcp-home-"),
		);
		tempProjectRoots.push(trickroomHome);
		const firstProjectRoot = await createProjectRoot({
			name: "MCP Selected Project",
			projectId: "proj_app_open_mcp",
		});
		const secondProjectRoot = await createProjectRoot({
			name: "App Opened Project",
			projectId: "proj_app_open_app",
		});
		await writeDesignFixture(
			firstProjectRoot,
			"11111111-1111-4111-8111-111111111111",
			{ ...validDesign, name: "MCP Selected Design" },
		);
		await writeDesignFixture(
			secondProjectRoot,
			"22222222-2222-4222-8222-222222222222",
			{ ...validDesign, name: "App Opened Design" },
		);
		const context = {
			...(await readMcpEnabledProjectContext(firstProjectRoot)),
			trickroomHome,
		};
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

		try {
			const app = createTrickroomApp({ trickroomHome });
			const openResponse = await app.request("/api/trickroom/projects/open", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ path: secondProjectRoot }),
			});
			expect(openResponse.status).toBe(200);

			const selectedProject = await client.callTool({
				name: "project_list",
				arguments: {},
			});
			expect(toolPayload(selectedProject)).toMatchObject({
				selected: {
					projectId: "proj_app_open_mcp",
					name: "MCP Selected Project",
					projectRoot: firstProjectRoot,
				},
			});

			const designs = await client.callTool({
				name: "design_list",
				arguments: {},
			});
			expect(toolPayload(designs)).toMatchObject({
				project: {
					projectId: "proj_app_open_mcp",
				},
				designFiles: [
					{
						id: "11111111-1111-4111-8111-111111111111",
						name: "MCP Selected Design",
					},
				],
			});
		} finally {
			await client.close();
			await server.close();
		}
	});

	it("lets project-scoped tools target registered locations explicitly", async () => {
		const trickroomHome = await mkdtemp(
			path.join(process.cwd(), ".tmp-trickroom-mcp-home-"),
		);
		tempProjectRoots.push(trickroomHome);
		const firstProjectRoot = await createProjectRoot({
			name: "Default Project",
			projectId: "proj_explicit_default",
		});
		const secondProjectRoot = await createProjectRoot({
			name: "Explicit Project",
			projectId: "proj_explicit_target",
			mcp: {
				enabled: true,
				mode: "read-only",
			},
		});
		await writeDesignFixture(
			firstProjectRoot,
			"11111111-1111-4111-8111-111111111111",
			{ ...validDesign, name: "Default Design" },
		);
		await writeDesignFixture(
			secondProjectRoot,
			"22222222-2222-4222-8222-222222222222",
			{ ...validDesign, name: "Explicit Design" },
		);
		const { location: firstLocation } = await upsertProjectLocation({
			trickroomHome,
			projectId: "proj_explicit_default",
			root: firstProjectRoot,
			name: "Default Project",
			markActive: false,
		});
		const { location: secondLocation } = await upsertProjectLocation({
			trickroomHome,
			projectId: "proj_explicit_target",
			root: secondProjectRoot,
			name: "Explicit Project",
			markActive: false,
		});
		const context = {
			...(await readMcpEnabledProjectContext(firstProjectRoot)),
			trickroomHome,
			locationId: firstLocation.locationId,
		};
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

		try {
			const defaultDesigns = await client.callTool({
				name: "design_list",
				arguments: {},
			});
			expect(toolPayload(defaultDesigns)).toMatchObject({
				project: {
					projectId: "proj_explicit_default",
					locationId: firstLocation.locationId,
				},
				designFiles: [
					{
						id: "11111111-1111-4111-8111-111111111111",
						name: "Default Design",
					},
				],
			});

			const explicitDesigns = await client.callTool({
				name: "design_list",
				arguments: {
					project: {
						locationId: secondLocation.locationId,
					},
				},
			});
			expect(toolPayload(explicitDesigns)).toMatchObject({
				project: {
					projectId: "proj_explicit_target",
					locationId: secondLocation.locationId,
				},
				governance: {
					mode: "read-only",
				},
				designFiles: [
					{
						id: "22222222-2222-4222-8222-222222222222",
						name: "Explicit Design",
					},
				],
			});

			const explicitRead = await client.callTool({
				name: "design_read",
				arguments: {
					project: {
						locationId: secondLocation.locationId,
					},
					designFileId: "22222222-2222-4222-8222-222222222222",
				},
			});
			const explicitRevision = (
				toolPayload(explicitRead) as {
					designFile: { revision: string };
				}
			).designFile.revision;

			const deniedMutation = await applyOperation(client, "addElement", {
				project: {
					locationId: secondLocation.locationId,
				},
				designFileId: "22222222-2222-4222-8222-222222222222",
				expectedRevision: explicitRevision,
				parentId: "root",
				index: 1,
				library: "trickroom",
				component: "text",
				name: "Denied Text",
			});
			expect(deniedMutation.isError).toBe(true);
			expect(toolPayload(deniedMutation)).toMatchObject({
				status: "POLICY_DENIED",
				code: "MCP_READ_ONLY",
				project: {
					projectId: "proj_explicit_target",
					locationId: secondLocation.locationId,
				},
				governance: {
					mode: "read-only",
				},
			});
		} finally {
			await client.close();
			await server.close();
		}
	});

	it("writes to the explicit registered location instead of the session default", async () => {
		const trickroomHome = await mkdtemp(
			path.join(process.cwd(), ".tmp-trickroom-mcp-home-"),
		);
		tempProjectRoots.push(trickroomHome);
		const firstProjectRoot = await createProjectRoot({
			name: "Default Write Project",
			projectId: "proj_write_default",
		});
		const secondProjectRoot = await createProjectRoot({
			name: "Explicit Write Project",
			projectId: "proj_write_explicit",
		});
		await writeDesignFixture(
			firstProjectRoot,
			"11111111-1111-4111-8111-111111111111",
			{ ...validDesign, name: "Default Write Design" },
		);
		await writeDesignFixture(
			secondProjectRoot,
			"22222222-2222-4222-8222-222222222222",
			{ ...validDesign, name: "Explicit Write Design" },
		);
		const { location: firstLocation } = await upsertProjectLocation({
			trickroomHome,
			projectId: "proj_write_default",
			root: firstProjectRoot,
			name: "Default Write Project",
			markActive: false,
		});
		const { location: secondLocation } = await upsertProjectLocation({
			trickroomHome,
			projectId: "proj_write_explicit",
			root: secondProjectRoot,
			name: "Explicit Write Project",
			markActive: false,
		});
		const context = {
			...(await readMcpEnabledProjectContext(firstProjectRoot)),
			trickroomHome,
			locationId: firstLocation.locationId,
		};
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

		try {
			const explicitRead = await client.callTool({
				name: "design_read",
				arguments: {
					project: {
						locationId: secondLocation.locationId,
					},
					designFileId: "22222222-2222-4222-8222-222222222222",
				},
			});
			const explicitRevision = (
				toolPayload(explicitRead) as {
					designFile: { revision: string };
				}
			).designFile.revision;

			const addResult = await applyOperation(client, "addElement", {
				project: {
					locationId: secondLocation.locationId,
				},
				designFileId: "22222222-2222-4222-8222-222222222222",
				expectedRevision: explicitRevision,
				parentId: "root",
				index: 1,
				library: "trickroom",
				component: "text",
				name: "Explicit Target Text",
			});
			expect(addResult.isError).not.toBe(true);
			expect(toolPayload(addResult)).toMatchObject({
				project: {
					projectId: "proj_write_explicit",
					locationId: secondLocation.locationId,
				},
			});

			const defaultDesign = await readStoredDesign(
				firstProjectRoot,
				"11111111-1111-4111-8111-111111111111",
			);
			const explicitDesign = await readStoredDesign(
				secondProjectRoot,
				"22222222-2222-4222-8222-222222222222",
			);

			expect(defaultDesign.boards[0].children).toHaveLength(1);
			expect(explicitDesign.boards[0].children).toHaveLength(2);
			expect(explicitDesign.boards[0].children?.[1]).toMatchObject({
				props: {
					"data-trickroom-name": "Explicit Target Text",
				},
			});
		} finally {
			await client.close();
			await server.close();
		}
	});

	it("lets project_select establish the project when the session starts empty", async () => {
		const trickroomHome = await mkdtemp(
			path.join(process.cwd(), ".tmp-trickroom-mcp-home-"),
		);
		tempProjectRoots.push(trickroomHome);
		const projectRoot = await createProjectRoot({
			name: "Opened Project",
			projectId: "proj_opened",
		});
		await writeDesignFixture(
			projectRoot,
			"33333333-3333-4333-8333-333333333333",
			{ ...validDesign, name: "Opened Design" },
		);
		const server = createTrickroomMcpServer(null, { trickroomHome });
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

		try {
			expect(
				toolPayload(
					await client.callTool({ name: "project_list", arguments: {} }),
				),
			).toMatchObject({
				selected: null,
				hint: expect.stringContaining("project_select"),
			});

			await client.callTool({
				name: "project_select",
				arguments: {
					path: projectRoot,
				},
			});

			const projects = await client.callTool({
				name: "project_list",
				arguments: {},
			});
			expect(toolPayload(projects)).toMatchObject({
				selected: { projectId: "proj_opened" },
				projects: [{ projectId: "proj_opened", selected: true }],
			});
			expect(toolPayload(projects).projects[0]).not.toHaveProperty("appActive");

			const designs = await client.callTool({
				name: "design_list",
				arguments: {},
			});
			expect(toolPayload(designs)).toMatchObject({
				project: {
					projectId: "proj_opened",
				},
				designFiles: [
					{
						id: "33333333-3333-4333-8333-333333333333",
						name: "Opened Design",
					},
				],
			});
		} finally {
			await client.close();
			await server.close();
		}
	});

	it("notifies resource-list changes when project_select registers a path", async () => {
		const trickroomHome = await mkdtemp(
			path.join(process.cwd(), ".tmp-trickroom-mcp-home-"),
		);
		tempProjectRoots.push(trickroomHome);
		const projectRoot = await createProjectRoot({
			name: "Opened Project",
			projectId: "proj_opened_notified",
		});
		await writeDesignFixture(
			projectRoot,
			"33333333-3333-4333-8333-333333333333",
			{ ...validDesign, name: "Opened Design" },
		);

		const server = createTrickroomMcpServer(null, { trickroomHome });
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

		const notifications: string[] = [];
		client.setNotificationHandler(ResourceListChangedNotificationSchema, () => {
			notifications.push("resource-list-changed");
		});

		await Promise.all([
			server.connect(serverTransport),
			client.connect(clientTransport),
		]);

		try {
			const openResult = await client.callTool({
				name: "project_select",
				arguments: {
					path: projectRoot,
				},
			});
			expect(toolPayload(openResult)).toMatchObject({
				registered: true,
				project: {
					projectId: "proj_opened_notified",
					name: "Opened Project",
					projectRoot,
				},
			});
			expect(notifications).toHaveLength(1);
		} finally {
			await client.close();
			await server.close();
		}
	});

	it("switches MCP session selection with project_select without mutating registry active project", async () => {
		const trickroomHome = await mkdtemp(
			path.join(process.cwd(), ".tmp-trickroom-mcp-home-"),
		);
		tempProjectRoots.push(trickroomHome);
		const firstProjectRoot = await createProjectRoot({
			name: "First Project",
			projectId: "proj_select_first",
		});
		const secondProjectRoot = await createProjectRoot({
			name: "Second Project",
			projectId: "proj_select_second",
		});
		await writeDesignFixture(
			firstProjectRoot,
			"11111111-1111-4111-8111-111111111111",
			{ ...validDesign, name: "First Design" },
		);
		await writeDesignFixture(
			secondProjectRoot,
			"22222222-2222-4222-8222-222222222222",
			{ ...validDesign, name: "Second Design" },
		);
		const { location: firstLocation } = await upsertProjectLocation({
			trickroomHome,
			projectId: "proj_select_first",
			root: firstProjectRoot,
			name: "First Project",
			markActive: true,
		});
		await upsertProjectLocation({
			trickroomHome,
			projectId: "proj_select_second",
			root: secondProjectRoot,
			name: "Second Project",
			markActive: false,
		});

		const context = {
			...(await readMcpEnabledProjectContext(firstProjectRoot)),
			trickroomHome,
		};
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

		try {
			const selectResult = await client.callTool({
				name: "project_select",
				arguments: {
					projectId: "proj_select_second",
				},
			});
			expect(toolPayload(selectResult)).toMatchObject({
				selected: true,
				project: {
					projectId: "proj_select_second",
					projectRoot: secondProjectRoot,
					name: "Second Project",
				},
			});

			const selectedProject = await client.callTool({
				name: "project_list",
				arguments: {},
			});
			expect(toolPayload(selectedProject)).toMatchObject({
				selected: {
					projectId: "proj_select_second",
					projectRoot: secondProjectRoot,
				},
			});

			const listProjectsResult = await client.callTool({
				name: "project_list",
				arguments: {},
			});
			const listed = toolPayload(listProjectsResult).projects as Array<{
				projectId: string;
				locationId: string;
				selected?: boolean;
				appActive?: boolean;
			}>;
			// The browser app's active project stays the first one.
			expect(
				listed.find((project) => project.projectId === "proj_select_first"),
			).toMatchObject({
				locationId: firstLocation.locationId,
				appActive: true,
			});
			expect(
				listed.find((project) => project.projectId === "proj_select_second"),
			).toMatchObject({ selected: true });
			expect(
				listed.find((project) => project.projectId === "proj_select_second"),
			).not.toHaveProperty("appActive");

			const designs = await client.callTool({
				name: "design_list",
				arguments: {},
			});
			expect(toolPayload(designs)).toMatchObject({
				project: {
					projectId: "proj_select_second",
				},
				designFiles: [
					{
						id: "22222222-2222-4222-8222-222222222222",
						name: "Second Design",
					},
				],
			});
		} finally {
			await client.close();
			await server.close();
		}
	});

	it("describes another registered project and validates project_select input", async () => {
		const trickroomHome = await mkdtemp(
			path.join(process.cwd(), ".tmp-trickroom-mcp-home-"),
		);
		tempProjectRoots.push(trickroomHome);
		const firstProjectRoot = await createProjectRoot({
			name: "First Project",
			projectId: "proj_info_first",
		});
		const secondProjectRoot = await createProjectRoot({
			name: "Second Project",
			projectId: "proj_info_second",
			mcp: { enabled: true, mode: "read-only" },
		});
		const disabledRoot = await createProjectRoot({
			name: "Disabled Project",
			projectId: "proj_info_disabled",
			mcp: { enabled: false },
		});
		const { location: secondLocation } = await upsertProjectLocation({
			trickroomHome,
			projectId: "proj_info_second",
			root: secondProjectRoot,
			name: "Second Project",
			markActive: false,
		});
		const server = createTrickroomMcpServer({
			...(await readMcpEnabledProjectContext(firstProjectRoot)),
			trickroomHome,
		});
		const client = new Client({ name: "test", version: "0.0.0" });
		const [clientTransport, serverTransport] =
			InMemoryTransport.createLinkedPair();
		await Promise.all([
			server.connect(serverTransport),
			client.connect(clientTransport),
		]);

		try {
			const described = toolPayload(
				await client.callTool({
					name: "project_list",
					arguments: { project: { locationId: secondLocation.locationId } },
				}),
			);
			expect(described).toMatchObject({
				selected: { projectId: "proj_info_first" },
				project: {
					projectId: "proj_info_second",
					projectRoot: secondProjectRoot,
				},
				governance: { mode: "read-only" },
				configuredSystems: [{ systemName: "Core" }],
			});

			const unknown = await client.callTool({
				name: "project_list",
				arguments: { project: { locationId: "loc_missing" } },
			});
			expect(unknown.isError).toBe(true);

			const both = await client.callTool({
				name: "project_select",
				arguments: {
					locationId: secondLocation.locationId,
					path: secondProjectRoot,
				},
			});
			expect(both.isError).toBe(true);
			expect(toolPayload(both)).toMatchObject({
				code: "INVALID_OPERATION_PARAMETERS",
			});

			const disabled = await client.callTool({
				name: "project_select",
				arguments: { path: disabledRoot },
			});
			expect(disabled.isError).toBe(true);
			expect(toolPayload(disabled)).toMatchObject({ code: "MCP_DISABLED" });

			// Neither failure changed the session's project.
			expect(
				toolPayload(
					await client.callTool({ name: "project_list", arguments: {} }),
				).selected,
			).toMatchObject({ projectId: "proj_info_first" });
		} finally {
			await client.close();
			await server.close();
		}
	});

	it("advertises discovery tools with read-only closed-world annotations and input schemas", async () => {
		const projectRoot = await createProjectRoot();
		const { client, close } = await createClient(projectRoot);

		try {
			const listToolsResult = await client.listTools();
			const toolsByName = new Map(
				listToolsResult.tools.map((tool) => [tool.name, tool]),
			);

			for (const name of [
				"guide",
				"system_read",
				"component_read",
				"memory_read",
			]) {
				expect(toolsByName.get(name)?.annotations).toMatchObject({
					readOnlyHint: true,
					openWorldHint: false,
				});
			}

			expect(
				Object.keys(toolsByName.get("guide")?.inputSchema.properties ?? {}),
			).toEqual([
				"topic",
				"designFileId",
				"systemName",
				"library",
				"name",
				"project",
			]);
			expect(toolsByName.get("system_read")?.inputSchema.required).toEqual([
				"view",
			]);
			expect(
				toolsByName.get("design_apply")?.inputSchema.properties,
			).toHaveProperty("operations");
		} finally {
			await close();
		}
	});

	it("describes built-in registry elements in the guide's registry topic", async () => {
		const projectRoot = await createProjectRoot();
		const { client, close } = await createClient(projectRoot);
		const registryTopic = async (args: Record<string, unknown>) =>
			toolPayload(
				await client.callTool({
					name: "guide",
					arguments: { topic: "registry", ...args },
				}),
			).registry;

		try {
			const index = await registryTopic({});
			expect(index.libraries).toEqual([
				expect.objectContaining({
					library: "base-ui",
					elementCount: expect.any(Number),
					families: expect.objectContaining({
						avatar: 3,
						menu: expect.any(Number),
						separator: 1,
					}),
				}),
				expect.objectContaining({ library: "trickroom" }),
			]);

			const trickroom = await registryTopic({ library: "trickroom" });
			expect(
				trickroom.elements.map(
					(element: { component: string; role: string }) => [
						element.component,
						element.role,
					],
				),
			).toEqual([
				["trickroom/asset", "leaf"],
				["trickroom/container", "branch"],
				["trickroom/icon", "leaf"],
				["trickroom/text", "text"],
			]);
			expect(trickroom.roles.text).toContain("updateElementText");

			const separatorClasses =
				"data-[orientation=vertical]:w-px data-[orientation=vertical]:self-stretch data-[orientation=horizontal]:h-px data-[orientation=horizontal]:w-full";
			for (const name of ["separator", "menu.separator"]) {
				const { elements } = await registryTopic({ library: "base-ui", name });
				expect(elements).toContainEqual(
					expect.objectContaining({
						component: `base-ui/${name}`,
						role: "leaf",
						baseClassName: separatorClasses,
					}),
				);
			}
			const [separator] = (
				await registryTopic({ library: "base-ui", name: "separator" })
			).elements;
			expect(separator.controls).toEqual([
				{
					prop: "orientation",
					type: "string",
					options: ["horizontal", "vertical"],
					default: "horizontal",
				},
			]);

			const [asset] = (
				await registryTopic({ library: "trickroom", name: "asset" })
			).elements;
			for (const prop of [
				"objectFit",
				"objectPosition",
				"loading",
				"decoding",
			]) {
				expect(asset.controls).toContainEqual(
					expect.objectContaining({ prop, deprecated: expect.any(String) }),
				);
			}
			expect(
				asset.controls.find(
					(control: { prop: string }) => control.prop === "alt",
				),
			).not.toHaveProperty("deprecated");
		} finally {
			await close();
		}
	});

	it("indexes and details built-in recipes in the guide's recipes topic", async () => {
		const projectRoot = await createProjectRoot();
		const { client, close } = await createClient(projectRoot);
		const recipesTopic = async (args: Record<string, unknown>) =>
			toolPayload(
				await client.callTool({
					name: "guide",
					arguments: { topic: "recipes", ...args },
				}),
			).recipes;

		try {
			const index = await recipesTopic({ library: "base-ui" });
			expect(index.recipes).toEqual(
				expect.arrayContaining([
					"base-ui/avatar.default: Avatar. slots: fallback",
					expect.stringMatching(
						/^base-ui\/menu\.default: Menu\. slots: trigger, items\. controls: .*align@positioner/u,
					),
				]),
			);

			const [avatar] = (await recipesTopic({ name: "avatar" })).recipes;
			expect(avatar).toMatchObject({
				recipe: "base-ui/avatar.default",
				label: "Avatar",
				template: {
					path: "root",
					component: "base-ui/avatar.root",
					children: [
						{ path: "image", component: "base-ui/avatar.image" },
						{
							path: "fallback",
							component: "base-ui/avatar.fallback",
							slot: "fallback",
						},
					],
				},
				slots: [{ name: "fallback", hostPath: "fallback" }],
			});
			// Marker props are Trickroom's; the guide never shows them.
			expect(JSON.stringify(avatar)).not.toContain(recipeInstanceProp);

			const [menu] = (await recipesTopic({ name: "menu" })).recipes;
			expect(menu).toMatchObject({
				recipe: "base-ui/menu.default",
				template: {
					path: "root",
					children: [
						{ path: "trigger", slot: "trigger" },
						{
							path: "portal",
							children: [
								{
									path: "positioner",
									children: [{ path: "popup", slot: "items" }],
								},
							],
						},
					],
				},
				slots: [
					{ name: "items", hostPath: "popup" },
					{ name: "trigger", hostPath: "trigger" },
				],
			});
			expect(
				menu.controls.map((control: { prop: string }) => control.prop).sort(),
			).toEqual([
				"align",
				"loopFocus",
				"modal",
				"openOnHover",
				"orientation",
				"side",
				"sideOffset",
			]);
		} finally {
			await close();
		}
	});

	it("reports recipe validation diagnostics without mutating design files", async () => {
		const projectRoot = await createProjectRoot();
		const validRecipeDesign = createAvatarRecipeDesign();
		const invalidRecipeDesign = createAvatarRecipeDesign();
		const unknownRecipeDesign = createAvatarRecipeDesign();
		const validDesignFileId = "33333333-3333-4333-8333-333333333333";
		const invalidDesignFileId = "44444444-4444-4444-8444-444444444444";
		const unknownDesignFileId = "55555555-5555-4555-8555-555555555555";

		const invalidRoot = invalidRecipeDesign.boards[0];
		if (Array.isArray(invalidRoot.children)) {
			invalidRoot.children = invalidRoot.children.filter(
				(child) => child.id !== "avatar-image",
			);
		}
		setRecipeId(unknownRecipeDesign, "base-ui/unknown.default");

		await writeDesignFixture(projectRoot, validDesignFileId, validRecipeDesign);
		await writeDesignFixture(
			projectRoot,
			invalidDesignFileId,
			invalidRecipeDesign,
		);
		await writeDesignFixture(
			projectRoot,
			unknownDesignFileId,
			unknownRecipeDesign,
		);

		const { client, close } = await createClient(projectRoot);
		try {
			const validResult = await client.callTool({
				name: "design_validate",
				arguments: { designFileId: validDesignFileId },
			});
			const validContent = toolPayload(validResult) as {
				valid: boolean;
				issues: Array<{ code: string }>;
			};
			expect(validContent.valid).toBe(true);
			expect(
				validContent.issues.filter((issue) =>
					[
						"UNKNOWN_RECIPE_ID",
						"MISSING_RECIPE_NODE",
						"RECIPE_NODE_CHILDREN_MISMATCH",
					].includes(issue.code),
				),
			).toEqual([]);

			const invalidResult = await client.callTool({
				name: "design_validate",
				arguments: { designFileId: invalidDesignFileId },
			});
			expect(toolPayload(invalidResult)).toMatchObject({
				valid: false,
				issues: expect.arrayContaining([
					expect.objectContaining({
						severity: "error",
						code: "MISSING_RECIPE_NODE",
						path: "recipeInstances.recipe-instance-1.image",
					}),
					expect.objectContaining({
						severity: "error",
						code: "RECIPE_NODE_CHILDREN_MISMATCH",
						elementId: "avatar-root",
					}),
				]),
			});

			const unknownResult = await client.callTool({
				name: "design_validate",
				arguments: { designFileId: unknownDesignFileId },
			});
			expect(toolPayload(unknownResult)).toMatchObject({
				valid: false,
				issues: expect.arrayContaining([
					expect.objectContaining({
						severity: "error",
						code: "UNKNOWN_RECIPE_ID",
						elementId: "avatar-root",
					}),
				]),
			});

			const persistedUnknown = JSON.parse(
				await readFile(
					path.join(
						projectRoot,
						".trickroom",
						"designs",
						`${unknownDesignFileId}.json`,
					),
					"utf8",
				),
			);
			expect(persistedUnknown).toEqual(unknownRecipeDesign);
		} finally {
			await close();
		}
	});

	it("resolves the design file system and lists stored tokens with sync metadata", async () => {
		const projectRoot = await createProjectRoot();
		await writeDesignFixture(
			projectRoot,
			"10000000-0000-4000-8000-0000000000d1",
		);
		await storeDomainTokens({
			projectRoot,
			systemName: "Core",
			cssPath: "src/index.css",
			tailwindBaselineVersion: "test-baseline",
			tokens: {
				"brand-500": "#123456",
				"accent-primary": "#abcdef",
			},
			overrides: ["brand-500", "--color-accent-*"],
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
			const listed = toolPayload(
				await client.callTool({ name: "design_list", arguments: {} }),
			);
			const [systemId] = Object.keys(listed.systems);
			expect(listed.designFiles).toMatchObject([
				{ id: "10000000-0000-4000-8000-0000000000d1", systemId },
			]);
			expect(listed.systems[systemId]).toEqual({
				name: "Core",
				cssPath: "src/index.css",
				tokens: { syncedAt: "2026-05-05T08:00:00.000Z", reviewRequired: true },
			});

			const tokensResult = await client.callTool({
				name: "system_read",
				arguments: {
					view: "tokens",
					designFileId: "10000000-0000-4000-8000-0000000000d1",
				},
			});
			expect(toolPayload(tokensResult)).toEqual({
				project: expect.any(Object),
				systemId: expect.stringMatching(/^sys_/),
				systemName: "Core",
				storageStatus: "stored",
				syncedAt: "2026-05-05T08:00:00.000Z",
				reviewRequired: true,
				domains: { color: 2 },
				totalCount: 2,
				matchedCount: 2,
				returnedCount: 2,
				truncated: false,
				tokens: {
					color: { "accent-primary": "#abcdef", "brand-500": "#123456" },
				},
			});
		} finally {
			await close();
		}
	});

	it("treats systemId null as disconnected even when legacy systemName remains", async () => {
		const projectRoot = await createProjectRoot();
		await writeDesignFixture(
			projectRoot,
			"10000000-0000-4000-8000-0000000000d1",
			{
				...validDesign,
				systemId: null,
				systemName: "Core",
			},
		);
		const { client, close } = await createClient(projectRoot);

		try {
			const listed = toolPayload(
				await client.callTool({ name: "design_list", arguments: {} }),
			);
			expect(listed.designFiles).toMatchObject([
				{ id: "10000000-0000-4000-8000-0000000000d1", systemId: null },
			]);

			const tokens = await client.callTool({
				name: "system_read",
				arguments: {
					view: "tokens",
					designFileId: "10000000-0000-4000-8000-0000000000d1",
				},
			});
			expect(tokens.isError).toBe(true);
			expect(toolPayload(tokens)).toMatchObject({
				code: "DESIGN_NOT_LINKED_TO_SYSTEM",
			});
		} finally {
			await close();
		}
	});
});
