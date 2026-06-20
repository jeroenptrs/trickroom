import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ResourceListChangedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, describe, expect, it } from "vitest";
import { upsertProjectLocation } from "../app-state/project-registry";
import { readMcpEnabledProjectContext } from "../project";
import { expandRegistryRecipe } from "../recipes/expansion";
import {
	recipeIdProp,
	recipeInstanceProp,
	recipePathProp,
	recipeRootProp,
	recipeSlotProp,
} from "../recipes/markers";
import { createTrickroomApp } from "../server";
import type { TrickroomDesign } from "../types";
import { assetIdProp } from "../utils/resource-props";
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

	it("retargets project-scoped tools when openProject is called", async () => {
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
				name: "getActiveProject",
				arguments: {},
			});
			expect(initialProject.structuredContent).toMatchObject({
				project: {
					projectId: "proj_first",
					name: "First Project",
				},
			});

			const openResult = await client.callTool({
				name: "openProject",
				arguments: {
					path: secondProjectRoot,
				},
			});
			expect(openResult.structuredContent).toMatchObject({
				active: true,
				selected: true,
				project: {
					projectId: "proj_second",
					name: "Second Project",
					projectRoot: secondProjectRoot,
				},
				migration: expect.stringContaining("registerProject"),
			});

			const activeProject = await client.callTool({
				name: "getActiveProject",
				arguments: {},
			});
			expect(activeProject.structuredContent).toMatchObject({
				project: {
					projectId: "proj_second",
					name: "Second Project",
					projectRoot: secondProjectRoot,
				},
			});

			const designs = await client.callTool({
				name: "listDesignFiles",
				arguments: {},
			});
			expect(designs.structuredContent).toMatchObject({
				project: {
					projectId: "proj_second",
					name: "Second Project",
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
				name: "getActiveProject",
				arguments: {},
			});
			expect(activeProject.structuredContent).toMatchObject({
				project: {
					projectId: "proj_first",
					name: "First Project",
					projectRoot: firstProjectRoot,
				},
			});

			const designs = await client.callTool({
				name: "listDesignFiles",
				arguments: {},
			});
			expect(designs.structuredContent).toMatchObject({
				project: {
					projectId: "proj_first",
					name: "First Project",
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
				name: "getSelectedProject",
				arguments: {},
			});
			expect(selectedProject.structuredContent).toMatchObject({
				project: {
					projectId: "proj_app_open_mcp",
					name: "MCP Selected Project",
					projectRoot: firstProjectRoot,
				},
			});

			const designs = await client.callTool({
				name: "listDesignFiles",
				arguments: {},
			});
			expect(designs.structuredContent).toMatchObject({
				project: {
					projectId: "proj_app_open_mcp",
					name: "MCP Selected Project",
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
				name: "listDesignFiles",
				arguments: {},
			});
			expect(defaultDesigns.structuredContent).toMatchObject({
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
				name: "listDesignFiles",
				arguments: {
					project: {
						locationId: secondLocation.locationId,
					},
				},
			});
			expect(explicitDesigns.structuredContent).toMatchObject({
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
				name: "readDesignFile",
				arguments: {
					project: {
						locationId: secondLocation.locationId,
					},
					designFileId: "22222222-2222-4222-8222-222222222222",
				},
			});
			const explicitRevision = (
				explicitRead.structuredContent as {
					designFile: { revision: string };
				}
			).designFile.revision;

			const deniedMutation = await client.callTool({
				name: "addElement",
				arguments: {
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
				},
			});
			expect(deniedMutation).toMatchObject({
				isError: true,
				structuredContent: {
					status: "POLICY_DENIED",
					code: "MCP_READ_ONLY",
					project: {
						projectId: "proj_explicit_target",
						locationId: secondLocation.locationId,
					},
					governance: {
						mode: "read-only",
					},
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
				name: "readDesignFile",
				arguments: {
					project: {
						locationId: secondLocation.locationId,
					},
					designFileId: "22222222-2222-4222-8222-222222222222",
				},
			});
			const explicitRevision = (
				explicitRead.structuredContent as {
					designFile: { revision: string };
				}
			).designFile.revision;

			const addResult = await client.callTool({
				name: "addElement",
				arguments: {
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
				},
			});
			expect(addResult.isError).not.toBe(true);
			expect(addResult.structuredContent).toMatchObject({
				project: {
					projectId: "proj_write_explicit",
					locationId: secondLocation.locationId,
				},
			});

			const defaultDesign = JSON.parse(
				await readFile(
					path.join(
						firstProjectRoot,
						".trickroom",
						"designs",
						"11111111-1111-4111-8111-111111111111.json",
					),
					"utf8",
				),
			) as TrickroomDesign;
			const explicitDesign = JSON.parse(
				await readFile(
					path.join(
						secondProjectRoot,
						".trickroom",
						"designs",
						"22222222-2222-4222-8222-222222222222.json",
					),
					"utf8",
				),
			) as TrickroomDesign;

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

	it("lets openProject establish the active project when the session starts empty", async () => {
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
			await expect(
				client.callTool({
					name: "getActiveProject",
					arguments: {},
				}),
			).resolves.toMatchObject({
				structuredContent: {
					project: null,
				},
			});

			await client.callTool({
				name: "openProject",
				arguments: {
					path: projectRoot,
				},
			});

			const projects = await client.callTool({
				name: "listProjects",
				arguments: {},
			});
			expect(projects.structuredContent).toMatchObject({
				activeProjectId: null,
				activeLocationId: null,
				projects: [
					{
						projectId: "proj_opened",
						active: false,
					},
				],
			});

			const designs = await client.callTool({
				name: "listDesignFiles",
				arguments: {},
			});
			expect(designs.structuredContent).toMatchObject({
				project: {
					projectId: "proj_opened",
					name: "Opened Project",
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

	it("notifies resource-list changes when openProject succeeds", async () => {
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
				capabilities: { resources: { listChanged: true } },
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
				name: "openProject",
				arguments: {
					path: projectRoot,
				},
			});
			expect(openResult.structuredContent).toMatchObject({
				active: true,
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

	it("notifies resource-list changes when registerProject succeeds", async () => {
		const trickroomHome = await mkdtemp(
			path.join(process.cwd(), ".tmp-trickroom-mcp-home-"),
		);
		tempProjectRoots.push(trickroomHome);
		const projectRoot = await createProjectRoot({
			name: "Registered Project",
			projectId: "proj_registered_notified",
		});
		await writeDesignFixture(
			projectRoot,
			"44444444-4444-4444-8444-444444444444",
			{ ...validDesign, name: "Registered Design" },
		);

		const server = createTrickroomMcpServer(null, { trickroomHome });
		const client = new Client(
			{
				name: "trickroom-test-client",
				version: "0.0.0",
			},
			{
				capabilities: { resources: { listChanged: true } },
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
			const registerResult = await client.callTool({
				name: "registerProject",
				arguments: {
					path: projectRoot,
				},
			});
			expect(registerResult.structuredContent).toMatchObject({
				selected: false,
				project: {
					projectId: "proj_registered_notified",
					name: "Registered Project",
					projectRoot,
				},
			});
			expect(notifications).toHaveLength(1);
		} finally {
			await client.close();
			await server.close();
		}
	});

	it("switches MCP session selection with selectProject without mutating registry active project", async () => {
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
				name: "selectProject",
				arguments: {
					projectId: "proj_select_second",
				},
			});
			expect(selectResult.structuredContent).toMatchObject({
				selected: true,
				project: {
					projectId: "proj_select_second",
					projectRoot: secondProjectRoot,
					name: "Second Project",
				},
			});

			const selectedProject = await client.callTool({
				name: "getSelectedProject",
				arguments: {},
			});
			expect(selectedProject.structuredContent).toMatchObject({
				project: {
					projectId: "proj_select_second",
					projectRoot: secondProjectRoot,
				},
			});

			const listProjectsResult = await client.callTool({
				name: "listProjects",
				arguments: {},
			});
			expect(listProjectsResult.structuredContent).toMatchObject({
				activeProjectId: "proj_select_first",
				activeLocationId: firstLocation.locationId,
			});
			expect(
				Array.isArray(
					(listProjectsResult.structuredContent as { projects: unknown[] })
						.projects,
				),
			).toBe(true);
			expect(
				(
					listProjectsResult.structuredContent as {
						projects: { projectId: string; active: boolean }[];
					}
				).projects.find((project) => project.projectId === "proj_select_second")
					?.active,
			).toBe(false);

			const designs = await client.callTool({
				name: "listDesignFiles",
				arguments: {},
			});
			expect(designs.structuredContent).toMatchObject({
				project: {
					projectId: "proj_select_second",
					name: "Second Project",
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

	it("keeps registerProject catalog-only and lets selectProject switch the MCP session", async () => {
		const trickroomHome = await mkdtemp(
			path.join(process.cwd(), ".tmp-trickroom-mcp-home-"),
		);
		tempProjectRoots.push(trickroomHome);
		const projectRoot = await createProjectRoot({
			name: "Catalog Project",
			projectId: "proj_catalog_only",
		});
		await writeDesignFixture(
			projectRoot,
			"33333333-3333-4333-8333-333333333333",
			{ ...validDesign, name: "Catalog Design" },
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
			const initialProject = await client.callTool({
				name: "getSelectedProject",
				arguments: {},
			});
			expect(initialProject.structuredContent).toMatchObject({ project: null });

			const registerResult = await client.callTool({
				name: "registerProject",
				arguments: {
					path: projectRoot,
				},
			});
			expect(registerResult.structuredContent).toMatchObject({
				selected: false,
				active: false,
				project: {
					projectId: "proj_catalog_only",
					projectRoot,
					name: "Catalog Project",
				},
			});

			const stillUnselected = await client.callTool({
				name: "getSelectedProject",
				arguments: {},
			});
			expect(stillUnselected.structuredContent).toMatchObject({
				project: null,
			});

			const selectResult = await client.callTool({
				name: "selectProject",
				arguments: {
					projectId: "proj_catalog_only",
				},
			});
			expect(selectResult.structuredContent).toMatchObject({
				selected: true,
				project: {
					projectId: "proj_catalog_only",
					projectRoot,
				},
			});

			const designs = await client.callTool({
				name: "listDesignFiles",
				arguments: {},
			});
			expect(designs.structuredContent).toMatchObject({
				project: {
					projectId: "proj_catalog_only",
					name: "Catalog Project",
				},
				designFiles: [
					{
						id: "33333333-3333-4333-8333-333333333333",
						name: "Catalog Design",
					},
				],
			});
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
				"listRegistries",
				"listRegistryComponents",
				"describeRegistryComponent",
				"listRegistryRecipes",
				"describeRegistryRecipe",
				"getDesignSystemForDesignFile",
				"listDesignTokens",
				"listSystemAssets",
				"describeAsset",
				"listSystemIcons",
				"describeIcon",
				"findAssetUsage",
				"findIconUsage",
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
				toolsByName.get("listRegistryRecipes")?.inputSchema.properties,
			).toHaveProperty("library");
			expect(
				toolsByName.get("describeRegistryRecipe")?.inputSchema.properties,
			).toHaveProperty("library");
			expect(
				toolsByName.get("describeRegistryRecipe")?.inputSchema.properties,
			).toHaveProperty("recipe");
			expect(
				toolsByName.get("getDesignSystemForDesignFile")?.inputSchema.properties,
			).toHaveProperty("designFileId");
			expect(
				toolsByName.get("addSystemComponent")?.inputSchema.properties,
			).toHaveProperty("unsetVariantAxes");
			expect(
				toolsByName.get("updateSystemComponentInstance")?.inputSchema
					.properties,
			).toHaveProperty("unsetVariantAxes");
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
				registries: expect.arrayContaining([
					expect.objectContaining({
						library: "base-ui",
						builtIn: true,
						readOnly: true,
						componentCount: expect.any(Number),
						components: expect.arrayContaining([
							"avatar.fallback",
							"avatar.image",
							"avatar.root",
							"menu.item",
							"menu.popup",
							"menu.portal",
							"menu.positioner",
							"menu.root",
							"menu.separator",
							"menu.trigger",
							"separator",
						]),
					}),
					expect.objectContaining({
						library: "trickroom",
						builtIn: true,
						readOnly: true,
						componentCount: 4,
						components: ["asset", "container", "icon", "text"],
					}),
				]),
			});

			const componentsResult = await client.callTool({
				name: "listRegistryComponents",
				arguments: {
					library: "trickroom",
				},
			});
			const trickroomRegistry = (
				componentsResult.structuredContent as {
					registries: { library: string; components: unknown[] }[];
				}
			).registries.find((registry) => registry.library === "trickroom");
			const trickroomComponentSummaries = trickroomRegistry?.components.map(
				(component) => {
					const summary = component as {
						component: string;
						role: string;
						allowedChildren: { kind: string };
					};
					return {
						component: summary.component,
						role: summary.role,
						allowedChildren: { kind: summary.allowedChildren.kind },
					};
				},
			);
			expect(trickroomComponentSummaries).toEqual([
				{
					component: "asset",
					role: "leaf",
					allowedChildren: { kind: "none" },
				},
				{
					component: "container",
					role: "branch",
					allowedChildren: { kind: "nodes" },
				},
				{
					component: "icon",
					role: "leaf",
					allowedChildren: { kind: "none" },
				},
				{
					component: "text",
					role: "text",
					allowedChildren: { kind: "none" },
				},
			]);

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
					children: "Text",
				},
			});

			const separatorResult = await client.callTool({
				name: "describeRegistryComponent",
				arguments: {
					library: "base-ui",
					component: "separator",
				},
			});
			expect(separatorResult.structuredContent).toMatchObject({
				library: "base-ui",
				component: "separator",
				role: "leaf",
				allowedChildren: {
					kind: "none",
					serializedChildren: "empty-array",
				},
				defaults: {
					baseClassName:
						"data-[orientation=vertical]:w-px data-[orientation=vertical]:self-stretch data-[orientation=horizontal]:h-px data-[orientation=horizontal]:w-full",
					props: {
						"data-trickroom-library": "base-ui",
						"data-trickroom-component": "separator",
						"data-trickroom-role": "leaf",
						orientation: "horizontal",
					},
					children: [],
				},
			});

			const menuSeparatorResult = await client.callTool({
				name: "describeRegistryComponent",
				arguments: {
					library: "base-ui",
					component: "menu.separator",
				},
			});
			expect(menuSeparatorResult.structuredContent).toMatchObject({
				library: "base-ui",
				component: "menu.separator",
				role: "leaf",
				allowedChildren: {
					kind: "none",
					serializedChildren: "empty-array",
				},
				defaults: {
					baseClassName:
						"data-[orientation=vertical]:w-px data-[orientation=vertical]:self-stretch data-[orientation=horizontal]:h-px data-[orientation=horizontal]:w-full",
					props: {
						"data-trickroom-library": "base-ui",
						"data-trickroom-component": "menu.separator",
						"data-trickroom-role": "leaf",
					},
					children: [],
				},
			});

			const assetDescribeResult = await client.callTool({
				name: "describeRegistryComponent",
				arguments: {
					library: "trickroom",
					component: "asset",
				},
			});
			const assetControls = (
				assetDescribeResult.structuredContent as {
					controls: Array<{
						prop: string;
						visibility: string | null;
						deprecationReason: string | null;
					}>;
				}
			).controls;
			expect(assetControls).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						prop: "objectFit",
						visibility: "deprecated",
						deprecationReason: expect.any(String),
					}),
					expect.objectContaining({
						prop: "objectPosition",
						visibility: "deprecated",
						deprecationReason: expect.any(String),
					}),
					expect.objectContaining({
						prop: "loading",
						visibility: "deprecated",
						deprecationReason: expect.any(String),
					}),
					expect.objectContaining({
						prop: "decoding",
						visibility: "deprecated",
						deprecationReason: expect.any(String),
					}),
				]),
			);
			expect(assetControls).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						prop: "alt",
						visibility: null,
					}),
				]),
			);
		} finally {
			await close();
		}
	});

	it("lists and describes built-in registry recipes", async () => {
		const projectRoot = await createProjectRoot();
		const { client, close } = await createClient(projectRoot);

		try {
			const recipesResult = await client.callTool({
				name: "listRegistryRecipes",
				arguments: {
					library: "base-ui",
				},
			});
			expect(recipesResult.structuredContent).toMatchObject({
				registries: expect.arrayContaining([
					expect.objectContaining({
						library: "base-ui",
						recipes: expect.arrayContaining([
							expect.objectContaining({
								library: "base-ui",
								recipe: "base-ui/avatar.default",
								label: "Avatar",
								version: 1,
								root: {
									library: "base-ui",
									component: "avatar.root",
									ref: "base-ui/avatar.root",
								},
								structure: {
									nodeCount: 3,
									paths: ["root", "image", "fallback"],
								},
								slots: [
									{
										name: "fallback",
										label: "Fallback",
										hostPath: "fallback",
									},
								],
							}),
							expect.objectContaining({
								library: "base-ui",
								recipe: "base-ui/menu.default",
								label: "Menu",
								version: 1,
								root: {
									library: "base-ui",
									component: "menu.root",
									ref: "base-ui/menu.root",
								},
								structure: {
									nodeCount: 5,
									paths: ["root", "trigger", "portal", "positioner", "popup"],
								},
								slots: [
									{
										name: "items",
										label: "Items",
										hostPath: "popup",
									},
									{
										name: "trigger",
										label: "Trigger",
										hostPath: "trigger",
									},
								],
							}),
						]),
					}),
				]),
			});

			const describeResult = await client.callTool({
				name: "describeRegistryRecipe",
				arguments: {
					library: "base-ui",
					recipe: "avatar.default",
				},
			});
			expect(describeResult.structuredContent).toMatchObject({
				library: "base-ui",
				recipe: "base-ui/avatar.default",
				localRecipe: "avatar.default",
				label: "Avatar",
				slots: [
					{
						name: "fallback",
						label: "Fallback",
						hostPath: "fallback",
					},
				],
				structure: {
					nodeCount: 3,
					root: {
						path: "root",
						library: "base-ui",
						component: "avatar.root",
						role: "branch",
						slot: null,
						children: [
							{
								path: "image",
								library: "base-ui",
								component: "avatar.image",
								role: "leaf",
								defaults: {
									props: {
										[assetIdProp]: "",
										alt: "",
									},
									content: {
										kind: "none",
										children: [],
									},
								},
								contract: {
									structuralNode: true,
									lockedByRecipe: true,
									slotHost: false,
									authoredChildrenAllowed: false,
								},
							},
							{
								path: "fallback",
								library: "base-ui",
								component: "avatar.fallback",
								role: "branch",
								slot: "fallback",
								contract: {
									structuralNode: true,
									lockedByRecipe: true,
									slotHost: true,
									authoredChildrenAllowed: true,
								},
							},
						],
					},
				},
				markerGuidance: {
					systemOwned: true,
					markerProps: [
						recipeIdProp,
						recipeInstanceProp,
						recipeRootProp,
						recipePathProp,
						recipeSlotProp,
					],
					writableSurface: {
						slots: ["fallback"],
						controls: [],
					},
				},
			});
			expect(JSON.stringify(describeResult.structuredContent)).toContain(
				"Do not pass recipe marker props to generic element mutation tools.",
			);
			expect(JSON.stringify(describeResult.structuredContent)).toContain(
				"defaultsOmitMarkers",
			);

			const menuDescribeResult = await client.callTool({
				name: "describeRegistryRecipe",
				arguments: {
					library: "base-ui",
					recipe: "menu.default",
				},
			});
			expect(menuDescribeResult.structuredContent).toMatchObject({
				library: "base-ui",
				recipe: "base-ui/menu.default",
				localRecipe: "menu.default",
				label: "Menu",
				slots: [
					{
						name: "items",
						label: "Items",
						hostPath: "popup",
					},
					{
						name: "trigger",
						label: "Trigger",
						hostPath: "trigger",
					},
				],
				structure: {
					nodeCount: 5,
					root: {
						path: "root",
						library: "base-ui",
						component: "menu.root",
						children: [
							{
								path: "trigger",
								component: "menu.trigger",
								slot: "trigger",
							},
							{
								path: "portal",
								component: "menu.portal",
								children: [
									{
										path: "positioner",
										component: "menu.positioner",
										children: [
											{
												path: "popup",
												component: "menu.popup",
												slot: "items",
											},
										],
									},
								],
							},
						],
					},
				},
				markerGuidance: {
					writableSurface: {
						slots: ["items", "trigger"],
						controls: [
							"align",
							"loopFocus",
							"modal",
							"openOnHover",
							"orientation",
							"side",
							"sideOffset",
						],
					},
				},
			});
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
				name: "validateDesignFile",
				arguments: { designFileId: validDesignFileId },
			});
			const validContent = validResult.structuredContent as {
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
				name: "validateDesignFile",
				arguments: { designFileId: invalidDesignFileId },
			});
			expect(invalidResult.structuredContent).toMatchObject({
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
				name: "validateDesignFile",
				arguments: { designFileId: unknownDesignFileId },
			});
			expect(unknownResult.structuredContent).toMatchObject({
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
						overrideConfirmed: true,
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
						overrides: ["--color-accent-*", "brand-500"],
					},
				},
			});
		} finally {
			await close();
		}
	});

	it("treats systemId null as disconnected even when legacy systemName remains", async () => {
		const projectRoot = await createProjectRoot();
		await writeDesignFixture(projectRoot, "design-1", {
			...validDesign,
			systemId: null,
			systemName: "Core",
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
					systemId: null,
					systemName: null,
				},
				designSystem: null,
			});
		} finally {
			await close();
		}
	});
});
