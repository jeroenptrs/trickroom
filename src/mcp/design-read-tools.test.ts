import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { expandRegistryRecipe } from "../recipes/expansion";
import { installAvatarLegacyPreviousTemplate } from "../recipes/legacy-avatar-template";
import {
	recipeIdProp,
	recipePathProp,
	recipeRootProp,
} from "../recipes/markers";
import type { Node as DesignNode, TrickroomDesign } from "../types";
import {
	createTrickroomMcpProjectFixture,
	createTrickroomMcpTestClient,
	type TrickroomMcpClientSession,
	type TrickroomMcpProjectFixture,
	toolPayload,
} from "./test-support";

const designFileId = "10000000-0000-4000-8000-000000000061";
const secondDesignFileId = "10000000-0000-4000-8000-000000000062";
const invalidDesignFileId = "10000000-0000-4000-8000-000000000063";
const futureDesignFileId = "10000000-0000-4000-8000-000000000064";

const readableDesign = {
	name: "Readable Design",
	systemName: "Core",
	boards: [
		{
			id: "board-a",
			props: {
				"data-trickroom-name": "Board A",
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
					children: "Launch ready",
				},
				{
					id: "cta",
					props: {
						"data-trickroom-name": "CTA",
						"data-trickroom-library": "trickroom",
						"data-trickroom-component": "container",
					},
					children: [
						{
							id: "cta-label",
							props: {
								"data-trickroom-name": "CTA Label",
								"data-trickroom-library": "trickroom",
								"data-trickroom-component": "text",
								"data-trickroom-role": "text",
							},
							children: "Start",
						},
					],
				},
			],
		},
		{
			id: "board-b",
			props: {
				"data-trickroom-name": "Board B",
				"data-trickroom-library": "trickroom",
				"data-trickroom-component": "container",
			},
			children: [],
		},
	],
} satisfies TrickroomDesign;

const unconfiguredSystemDesign = {
	...readableDesign,
	name: "Needs Validation",
	systemName: "Missing System",
	boards: [
		{
			...readableDesign.boards[0],
			children: [
				readableDesign.boards[0].children[0],
				{
					...readableDesign.boards[0].children[1],
					id: "title",
				},
			],
		},
	],
} satisfies TrickroomDesign;

const createRecipeIdFactory = (prefix: string) => {
	let index = 0;
	return () => `${prefix}-${++index}`;
};

const setRecipeId = (node: DesignNode, recipeId: string) => {
	if (Object.hasOwn(node.props, recipeIdProp)) {
		node.props[recipeIdProp] = recipeId;
	}
	if (Array.isArray(node.children)) {
		for (const child of node.children) {
			setRecipeId(child, recipeId);
		}
	}
};

const withAvatarLegacyPreviousTemplate = async <T>(
	fn: () => Promise<T> | T,
) => {
	const restoreAvatarLegacyPreviousTemplate =
		installAvatarLegacyPreviousTemplate();
	try {
		return await fn();
	} finally {
		restoreAvatarLegacyPreviousTemplate();
	}
};

const recipeMetadataReadFixture = (() => {
	const valid = expandRegistryRecipe("base-ui", "avatar.default", {
		createElementId: createRecipeIdFactory("read-valid"),
		createRecipeInstanceId: () => "recipe-instance-valid",
	});

	const invalid = expandRegistryRecipe("base-ui", "avatar.default", {
		createElementId: createRecipeIdFactory("read-invalid"),
		createRecipeInstanceId: () => "recipe-instance-invalid",
	});
	delete (invalid.root.props as { [key: string]: unknown })[recipeRootProp];

	const unknown = expandRegistryRecipe("base-ui", "avatar.default", {
		createElementId: createRecipeIdFactory("read-unknown"),
		createRecipeInstanceId: () => "recipe-instance-unknown",
	});
	setRecipeId(unknown.root, "base-ui/does-not-exist");

	const stale = expandRegistryRecipe("base-ui", "avatar.default", {
		createElementId: createRecipeIdFactory("read-stale"),
		createRecipeInstanceId: () => "recipe-instance-stale",
	});
	const staleFallback = (stale.root.children as DesignNode[])[1];
	staleFallback.props[recipePathProp] = "legacy-fallback";
	stale.root.children = [staleFallback];

	return {
		designFileId: "10000000-0000-4000-8000-000000000064",
		design: {
			name: "Recipe Metadata Design",
			systemName: "Core",
			boards: [
				{
					id: "recipe-metadata-board",
					props: {
						"data-trickroom-name": "Recipe Metadata Board",
						"data-trickroom-library": "trickroom",
						"data-trickroom-component": "container",
					},
					children: [valid.root, invalid.root, unknown.root, stale.root],
				},
			],
		} satisfies TrickroomDesign,
		nodeIds: {
			valid: {
				instanceId: "recipe-instance-valid",
				root: valid.root.id,
				fallback: valid.elementIdsByPath.fallback,
			},
			invalid: {
				instanceId: "recipe-instance-invalid",
				root: invalid.root.id,
				fallback: invalid.elementIdsByPath.fallback,
			},
			unknown: {
				instanceId: "recipe-instance-unknown",
				root: unknown.root.id,
				fallback: unknown.elementIdsByPath.fallback,
			},
			stale: {
				instanceId: "recipe-instance-stale",
				root: stale.root.id,
				fallback: stale.elementIdsByPath.fallback,
			},
		},
	};
})();

describe("trickroom MCP design read tools", () => {
	const fixtures: TrickroomMcpProjectFixture[] = [];
	const sessions: TrickroomMcpClientSession[] = [];

	afterEach(async () => {
		await Promise.all(sessions.splice(0).map((session) => session.close()));
		await Promise.all(fixtures.splice(0).map((fixture) => fixture.cleanup()));
	});

	const createSession = async (
		designs: Record<string, TrickroomDesign> = {
			[designFileId]: readableDesign,
			[secondDesignFileId]: {
				...readableDesign,
				name: "Second Design",
				systemName: null,
			},
		},
	) => {
		const fixture = await createTrickroomMcpProjectFixture({ designs });
		fixtures.push(fixture);
		const session = await createTrickroomMcpTestClient(
			await fixture.readMcpContext(),
		);
		sessions.push(session);
		return session;
	};

	it("advertises design read tools with read-only closed-world annotations and schemas", async () => {
		const { client } = await createSession();

		const listToolsResult = await client.listTools();
		const toolsByName = new Map(
			listToolsResult.tools.map((tool) => [tool.name, tool]),
		);

		for (const name of ["design_list", "design_read", "design_validate"]) {
			expect(toolsByName.get(name)?.annotations).toMatchObject({
				readOnlyHint: true,
				openWorldHint: false,
			});
		}

		expect(
			Object.keys(toolsByName.get("design_read")?.inputSchema.properties ?? {}),
		).toEqual([
			"designFileId",
			"boardId",
			"elementId",
			"view",
			"depth",
			"maxNodes",
			"allowLarge",
			"detail",
			"project",
		]);
		expect(toolsByName.get("design_read")?.inputSchema.required).toEqual([
			"designFileId",
		]);
	});

	it("lists design file UUID handles and reads compact file trees", async () => {
		const { client } = await createSession();

		const listResult = await client.callTool({
			name: "design_list",
			arguments: {},
		});
		const { systems } = toolPayload(listResult) as {
			systems: Record<string, { name: string }>;
		};
		const coreSystemId = Object.keys(systems).find(
			(systemId) => systems[systemId].name === "Core",
		);
		expect(systems[coreSystemId ?? ""]).toEqual({
			name: "Core",
			cssPath: "src/index.css",
			tokens: { syncedAt: "2026-01-01T00:00:00.000Z" },
		});
		expect(coreSystemId).toEqual(expect.stringMatching(/^sys_/));
		expect(toolPayload(listResult)).toMatchObject({
			designFiles: [
				{
					id: designFileId,
					name: "Readable Design",
					systemId: coreSystemId,
					layersCount: 3,
					modifiedAt: expect.any(String),
					revision: expect.any(String),
					boards: [
						{ id: "board-a", name: "Board A" },
						{ id: "board-b", name: "Board B" },
					],
				},
				{
					id: secondDesignFileId,
					name: "Second Design",
					systemId: null,
					layersCount: 3,
					modifiedAt: expect.any(String),
					revision: expect.any(String),
				},
			],
		});
		const listedDesign = (
			toolPayload(listResult) as {
				designFiles: Array<Record<string, unknown>>;
			}
		).designFiles[0];
		expect(listedDesign).not.toHaveProperty("file");
		expect(listedDesign).not.toHaveProperty("systemName");

		const readResult = await client.callTool({
			name: "design_read",
			arguments: {
				designFileId,
			},
		});
		expect(toolPayload(readResult)).toEqual({
			project: expect.any(Object),
			designFile: {
				id: designFileId,
				name: "Readable Design",
				systemId: coreSystemId,
				systemName: "Core",
				revision: expect.any(String),
			},
			elementCount: 5,
			boards: [
				{ id: "board-a", name: "Board A", elementCount: 4 },
				{ id: "board-b", name: "Board B", elementCount: 1 },
			],
			read: {
				depth: 2,
				maxNodes: 50,
				truncated: false,
				returnedNodeCount: 5,
				omittedNodeCount: 0,
			},
			tree: [
				{
					id: "board-a",
					name: "Board A",
					component: "container",
					children: [
						{
							id: "title",
							name: "Title",
							component: "text",
							text: "Launch ready",
						},
						{
							id: "cta",
							name: "CTA",
							component: "container",
							children: [
								{
									id: "cta-label",
									name: "CTA Label",
									component: "text",
									text: "Start",
								},
							],
						},
					],
				},
				{ id: "board-b", name: "Board B", component: "container" },
			],
		});
		const readText = (readResult.content as Array<{ text: string }>)[0].text;
		expect(JSON.parse(readText)).toEqual(toolPayload(readResult));

		const boardRead = await client.callTool({
			name: "design_read",
			arguments: { designFileId, boardId: "board-b" },
		});
		expect(toolPayload(boardRead)).toMatchObject({
			boards: [{ id: "board-a" }, { id: "board-b" }],
			tree: [{ id: "board-b" }],
			read: { returnedNodeCount: 1 },
		});

		const missingBoard = await client.callTool({
			name: "design_read",
			arguments: { designFileId, boardId: "cta" },
		});
		expect(missingBoard.isError).toBe(true);
		expect(toolPayload(missingBoard)).toMatchObject({
			code: "BOARD_NOT_FOUND",
			message: expect.stringContaining("read it with design_read elementId"),
			availableBoards: [
				{ id: "board-a", name: "Board A" },
				{ id: "board-b", name: "Board B" },
			],
		});
	});

	it("keeps design memory sidecars out of listDesignFiles", async () => {
		const { client } = await createSession();
		const fixture = fixtures[fixtures.length - 1];
		await writeFile(
			path.join(
				fixture.projectRoot,
				".trickroom",
				"designs",
				`${designFileId}.memory.json`,
			),
			JSON.stringify({ version: 1, notes: [] }),
		);

		const listResult = await client.callTool({
			name: "design_list",
			arguments: {},
		});
		const ids = (
			toolPayload(listResult) as { designFiles: Array<{ id: string }> }
		).designFiles.map((designFile) => designFile.id);
		expect(ids).toEqual([designFileId, secondDesignFileId]);
	});

	it("collapses instance markers and registry defaults in compact nodes", async () => {
		const instanceDesign = {
			name: "Instance Design",
			systemName: "Core",
			boards: [
				{
					id: "board",
					props: {
						"data-trickroom-name": "Container",
						"data-trickroom-library": "trickroom",
						"data-trickroom-component": "container",
						"data-trickroom-system-component-system-id": "sys_core",
						"data-trickroom-system-component-id": "cmp_card",
						"data-trickroom-system-component-instance": "instance-1",
						"data-trickroom-system-component-version": "2",
						"data-trickroom-system-component-path": "root",
						"data-trickroom-system-component-root": "true",
						"data-trickroom-system-component-variant-values": '{"size":"lg"}',
						"data-trickroom-system-component-overrides": "{}",
						"data-trickroom-system-component-template-hash": "sha256:a",
						"data-trickroom-system-component-variant-schema-hash": "sha256:b",
					},
					children: [
						{
							id: "body",
							props: {
								"data-trickroom-name": "Body",
								"data-trickroom-library": "trickroom",
								"data-trickroom-component": "container",
								"data-trickroom-system-component-system-id": "sys_core",
								"data-trickroom-system-component-id": "cmp_card",
								"data-trickroom-system-component-instance": "instance-1",
								"data-trickroom-system-component-version": "2",
								"data-trickroom-system-component-path": "body",
								"data-trickroom-system-component-slot": "body",
							},
							children: [],
						},
						{
							id: "separator",
							props: {
								"data-trickroom-name": "Separator",
								"data-trickroom-library": "base-ui",
								"data-trickroom-component": "separator",
								orientation: "vertical",
								"aria-label": "Divider",
							},
							children: [],
						},
					],
				},
			],
		} satisfies TrickroomDesign;
		const { client } = await createSession({ [designFileId]: instanceDesign });

		const read = await client.callTool({
			name: "design_read",
			arguments: { designFileId, elementId: "board" },
		});
		const subtree = (toolPayload(read) as { subtree: Record<string, unknown> })
			.subtree;
		expect(subtree).toEqual({
			id: "board",
			component: "container",
			systemComponent: { id: "cmp_card", variants: { size: "lg" } },
			children: [
				{ id: "body", name: "Body", component: "container", slot: "body" },
				{
					id: "separator",
					component: "base-ui/separator",
					props: { orientation: "vertical", "aria-label": "Divider" },
				},
			],
		});
	});

	it("returns DESIGN_NOT_FOUND with the available designs for an unknown id", async () => {
		const { client } = await createSession();
		const missingId = "10000000-0000-4000-8000-0000000000ff";

		for (const args of [{}, { elementId: "board-a" }, { view: "outline" }]) {
			const result = await client.callTool({
				name: "design_read",
				arguments: { designFileId: missingId, ...args },
			});
			expect(result.isError).toBe(true);
			expect(toolPayload(result)).toMatchObject({
				code: "DESIGN_NOT_FOUND",
				availableDesigns: expect.arrayContaining([
					{ id: designFileId, name: "Readable Design" },
				]),
			});
			expect(JSON.stringify(toolPayload(result))).not.toContain("ENOENT");
		}
	});

	it("includes className in compact trees and compact subtree reads", async () => {
		const styledDesign = {
			...readableDesign,
			boards: [
				{
					...readableDesign.boards[0],
					props: {
						...readableDesign.boards[0].props,
						className: "flex flex-col gap-4",
					},
					children: [
						{
							...readableDesign.boards[0].children[0],
							props: {
								...readableDesign.boards[0].children[0].props,
								className: "text-lg",
							},
						},
						readableDesign.boards[0].children[1],
					],
				},
				readableDesign.boards[1],
			],
		} satisfies TrickroomDesign;
		const { client } = await createSession({ [designFileId]: styledDesign });

		const read = await client.callTool({
			name: "design_read",
			arguments: { designFileId },
		});
		const tree = (
			toolPayload(read) as {
				tree: Array<Record<string, unknown>>;
			}
		).tree;
		expect(tree[0]).toMatchObject({
			id: "board-a",
			className: "flex flex-col gap-4",
			children: [
				{ id: "title", className: "text-lg" },
				expect.not.objectContaining({ className: expect.anything() }),
			],
		});

		const compactSubtree = await client.callTool({
			name: "design_read",
			arguments: { designFileId, elementId: "board-a" },
		});
		const subtree = (
			toolPayload(compactSubtree) as { subtree: Record<string, unknown> }
		).subtree;
		expect(subtree).toMatchObject({
			id: "board-a",
			className: "flex flex-col gap-4",
			children: [
				{ id: "title", className: "text-lg", text: "Launch ready" },
				{ id: "cta" },
			],
		});
		expect(subtree).not.toHaveProperty("props");
	});

	it("reads compact elements with placement context and full props on request", async () => {
		const { client } = await createSession();

		const readResult = await client.callTool({
			name: "design_read",
			arguments: {
				depth: 0,
				designFileId,
				elementId: "cta",
			},
		});

		expect(toolPayload(readResult)).toEqual({
			project: expect.any(Object),
			designFile: {
				id: designFileId,
				name: "Readable Design",
				revision: expect.any(String),
			},
			subtree: {
				id: "cta",
				name: "CTA",
				component: "container",
				more: 1,
				childIds: ["cta-label"],
			},
			context: {
				parentId: "board-a",
				boardId: "board-a",
				index: 1,
				siblingCount: 2,
			},
		});

		const fullResult = await client.callTool({
			name: "design_read",
			arguments: {
				depth: 0,
				designFileId,
				elementId: "board-b",
				detail: "full",
			},
		});
		expect(toolPayload(fullResult)).toMatchObject({
			subtree: {
				id: "board-b",
				props: {
					"data-trickroom-name": "Board B",
					"data-trickroom-library": "trickroom",
					"data-trickroom-component": "container",
				},
			},
			context: { parentId: null, index: 1, siblingCount: 2 },
		});
	});

	it("bounds design and subtree reads by default", async () => {
		const deepDesignFileId = "10000000-0000-4000-8000-000000000065";
		const { client } = await createSession({
			[deepDesignFileId]: {
				name: "Deep Design",
				systemName: "Core",
				boards: [
					{
						id: "deep-board",
						props: {
							"data-trickroom-name": "Deep Board",
							"data-trickroom-library": "trickroom",
							"data-trickroom-component": "container",
						},
						children: [
							{
								id: "level-1",
								props: {
									"data-trickroom-name": "Level 1",
									"data-trickroom-library": "trickroom",
									"data-trickroom-component": "container",
								},
								children: [
									{
										id: "level-2",
										props: {
											"data-trickroom-name": "Level 2",
											"data-trickroom-library": "trickroom",
											"data-trickroom-component": "container",
										},
										children: [
											{
												id: "level-3",
												props: {
													"data-trickroom-name": "Level 3",
													"data-trickroom-library": "trickroom",
													"data-trickroom-component": "text",
													"data-trickroom-role": "text",
												},
												children: "Hidden by default",
											},
										],
									},
								],
							},
						],
					},
				],
			},
		});

		const designRead = await client.callTool({
			name: "design_read",
			arguments: {
				designFileId: deepDesignFileId,
			},
		});
		expect(toolPayload(designRead)).toMatchObject({
			read: {
				depth: 2,
				maxNodes: 50,
				truncated: true,
				returnedNodeCount: 3,
				omittedNodeCount: 1,
				next: {
					tool: "design_read",
					args: { designFileId: deepDesignFileId, elementId: "level-2" },
				},
			},
			tree: [{ id: "deep-board", children: [{ children: [{ more: 1 }] }] }],
		});

		const subtreeRead = await client.callTool({
			name: "design_read",
			arguments: {
				designFileId: deepDesignFileId,
				elementId: "deep-board",
				depth: 2,
			},
		});
		expect(toolPayload(subtreeRead)).toMatchObject({
			read: {
				depth: 2,
				maxNodes: 100,
				truncated: true,
				returnedNodeCount: 3,
				omittedNodeCount: 1,
			},
		});

		const unboundedSubtreeRead = await client.callTool({
			name: "design_read",
			arguments: {
				designFileId: deepDesignFileId,
				elementId: "deep-board",
				allowLarge: true,
			},
		});
		expect(toolPayload(unboundedSubtreeRead)).toMatchObject({
			read: {
				depth: null,
				maxNodes: null,
				truncated: false,
				returnedNodeCount: 4,
				omittedNodeCount: 0,
			},
		});
	});

	it("reads subtrees with an optional depth cap and full detail", async () => {
		const { client } = await createSession();

		const readResult = await client.callTool({
			name: "design_read",
			arguments: {
				designFileId,
				elementId: "board-a",
				depth: 1,
			},
		});

		expect(toolPayload(readResult)).toMatchObject({
			read: { depth: 1, returnedNodeCount: 3, omittedNodeCount: 1 },
			context: {
				parentId: null,
				index: 0,
				siblingCount: 2,
			},
			subtree: {
				id: "board-a",
				children: [
					{ id: "title", text: "Launch ready" },
					{ id: "cta", more: 1 },
				],
			},
		});

		const fullRead = await client.callTool({
			name: "design_read",
			arguments: { designFileId, elementId: "cta", detail: "full" },
		});
		expect(toolPayload(fullRead)).toMatchObject({
			subtree: {
				id: "cta",
				props: { "data-trickroom-name": "CTA" },
				children: [
					{
						id: "cta-label",
						props: { "data-trickroom-role": "text" },
						text: "Start",
					},
				],
			},
		});
	});

	it("adds recipe metadata summaries to subtree reads", async () => {
		await withAvatarLegacyPreviousTemplate(async () => {
			const { client } = await createSession({
				[recipeMetadataReadFixture.designFileId]:
					recipeMetadataReadFixture.design,
			});

			const readResult = await client.callTool({
				name: "design_read",
				arguments: {
					designFileId: recipeMetadataReadFixture.designFileId,
					elementId: "recipe-metadata-board",
					depth: 2,
				},
			});

			type ReadNode = {
				id: string;
				slot?: string;
				recipe?: Record<string, unknown>;
				children?: ReadNode[];
			};
			const readContent = toolPayload(readResult) as {
				subtree: { children: ReadNode[] };
			};
			const findNodeById = (
				nodes: readonly ReadNode[],
				targetId: string,
			): ReadNode | null => {
				for (const node of nodes) {
					if (node.id === targetId) {
						return node;
					}
					const found = findNodeById(node.children ?? [], targetId);
					if (found) {
						return found;
					}
				}
				return null;
			};
			const { nodeIds } = recipeMetadataReadFixture;
			const nodes = readContent.subtree.children;

			expect(findNodeById(nodes, nodeIds.valid.root)?.recipe).toEqual({
				id: "base-ui/avatar.default",
				instanceId: nodeIds.valid.instanceId,
			});
			expect(findNodeById(nodes, nodeIds.invalid.root)?.recipe).toEqual({
				id: "base-ui/avatar.default",
				instanceId: nodeIds.invalid.instanceId,
				state: "invalid-known",
			});
			expect(findNodeById(nodes, nodeIds.unknown.root)?.recipe).toEqual({
				id: "base-ui/does-not-exist",
				instanceId: nodeIds.unknown.instanceId,
				state: "unknown-recipe",
			});
			expect(findNodeById(nodes, nodeIds.stale.root)?.recipe).toEqual({
				id: "base-ui/avatar.default",
				instanceId: nodeIds.stale.instanceId,
				state: "attached-stale",
				currentVersion: "1",
				matchedTemplateVersion: "0.9",
			});
			expect(findNodeById(nodes, nodeIds.valid.fallback)).toMatchObject({
				slot: "fallback",
				recipe: {
					instanceId: nodeIds.valid.instanceId,
					path: "fallback",
				},
			});
		});
	});

	it("adds recipe metadata summaries to design graph reads", async () => {
		await withAvatarLegacyPreviousTemplate(async () => {
			const { client } = await createSession({
				[recipeMetadataReadFixture.designFileId]:
					recipeMetadataReadFixture.design,
			});

			const graphResult = await client.callTool({
				name: "design_read",
				arguments: {
					view: "outline",
					designFileId: recipeMetadataReadFixture.designFileId,
				},
			});

			const graphContent = toolPayload(graphResult) as {
				graph: {
					elementsById: Record<string, { recipe?: Record<string, unknown> }>;
				};
			};
			const { nodeIds } = recipeMetadataReadFixture;
			const recipeOf = (elementId: string) =>
				graphContent.graph.elementsById[elementId]?.recipe;

			expect(recipeOf(nodeIds.valid.root)).toEqual({
				id: "base-ui/avatar.default",
				instanceId: nodeIds.valid.instanceId,
			});
			expect(recipeOf(nodeIds.invalid.root)).toMatchObject({
				state: "invalid-known",
			});
			expect(recipeOf(nodeIds.unknown.root)).toMatchObject({
				state: "unknown-recipe",
			});
			expect(recipeOf(nodeIds.stale.root)).toMatchObject({
				state: "attached-stale",
				currentVersion: "1",
				matchedTemplateVersion: "0.9",
			});
		});
	});

	it("validates existing design files without mutation", async () => {
		const { client } = await createSession({
			[invalidDesignFileId]: unconfiguredSystemDesign,
		});

		const validateResult = await client.callTool({
			name: "design_validate",
			arguments: {
				designFileId: invalidDesignFileId,
				response: "full",
			},
		});

		expect(toolPayload(validateResult)).toMatchObject({
			designFileId: invalidDesignFileId,
			revision: expect.any(String),
			valid: false,
			summary: {
				codes: expect.objectContaining({
					UNKNOWN_DESIGN_SYSTEM: 1,
					DUPLICATE_ELEMENT_ID: expect.any(Number),
				}),
			},
			designSystem: {
				systemName: "Missing System",
				configured: false,
			},
			rootElementIds: ["board-a"],
			registryReferences: [
				{
					library: "trickroom",
					component: "container",
					count: 2,
				},
				{
					library: "trickroom",
					component: "text",
					count: 2,
				},
			],
		});
		expect(toolPayload(validateResult)).toMatchObject({
			issues: expect.arrayContaining([
				expect.objectContaining({
					code: "UNKNOWN_DESIGN_SYSTEM",
					path: "systemName",
				}),
				expect.objectContaining({
					code: "DUPLICATE_ELEMENT_ID",
					elementId: "title",
				}),
			]),
		});
	});

	it("reports designs from a newer Trickroom version in list and validate", async () => {
		const { client } = await createSession();
		const fixture = fixtures.at(-1);
		if (!fixture) throw new Error("Missing fixture.");
		await writeFile(
			path.join(
				fixture.projectRoot,
				".trickroom",
				"designs",
				`${futureDesignFileId}.json`,
			),
			JSON.stringify({ ...readableDesign, name: "Future", version: 999 }),
			"utf8",
		);

		const listResult = await client.callTool({
			name: "design_list",
			arguments: {},
		});
		expect(toolPayload(listResult)).toMatchObject({
			designFiles: expect.arrayContaining([
				expect.objectContaining({
					id: futureDesignFileId,
					diagnostic: expect.objectContaining({
						code: "UNSUPPORTED_DESIGN_VERSION",
						version: 999,
					}),
				}),
			]),
		});
		const listed = (
			toolPayload(listResult) as {
				designFiles: Array<{ id: string; diagnostic?: unknown }>;
			}
		).designFiles;
		expect(
			listed.find((designFile) => designFile.id === designFileId),
		).not.toHaveProperty("diagnostic");

		const validateResult = await client.callTool({
			name: "design_validate",
			arguments: { designFileId: futureDesignFileId },
		});
		expect(toolPayload(validateResult)).toMatchObject({
			valid: false,
			issues: [
				{
					severity: "error",
					code: "UNSUPPORTED_DESIGN_VERSION",
					message: expect.stringContaining("999"),
				},
			],
		});
	});

	it("counts memory notes per design and system, and hints at them on reads", async () => {
		const { client } = await createSession();
		for (const scope of [
			"project",
			`design:${designFileId}`,
			"system:Core",
			"system:Core",
		]) {
			const added = await client.callTool({
				name: "memory_write",
				arguments: {
					action: "add",
					scope,
					category: "intent",
					body: "Why this exists.",
				},
			});
			expect(added.isError).toBeFalsy();
		}

		const listed = toolPayload(
			await client.callTool({ name: "design_list", arguments: {} }),
		);
		expect(listed.memoryNotes).toBe(1);
		expect(listed.designFiles[0]).toMatchObject({
			id: designFileId,
			memoryNotes: 1,
		});
		expect(listed.designFiles[1]).not.toHaveProperty("memoryNotes");
		const [coreSystem] = Object.values(listed.systems);
		expect(coreSystem).toMatchObject({ name: "Core", memoryNotes: 2 });

		const read = toolPayload(
			await client.callTool({
				name: "design_read",
				arguments: { designFileId },
			}),
		);
		expect(read.memory).toMatchObject({ noteCount: 1 });
		expect(read.memoryHint).toContain("memory_read({ designFileId })");
	});

	it("reads one board's outline and rejects ambiguous targets", async () => {
		const { client } = await createSession();

		const outline = toolPayload(
			await client.callTool({
				name: "design_read",
				arguments: { designFileId, boardId: "board-b", view: "outline" },
			}),
		);
		expect(outline.graph.rootElementIds).toEqual(["board-b"]);

		const nested = await client.callTool({
			name: "design_read",
			arguments: { designFileId, boardId: "cta", view: "outline" },
		});
		expect(nested.isError).toBe(true);
		expect(toolPayload(nested)).toMatchObject({ code: "BOARD_NOT_FOUND" });

		const both = await client.callTool({
			name: "design_read",
			arguments: { designFileId, boardId: "board-a", elementId: "cta" },
		});
		expect(both.isError).toBe(true);
		expect(toolPayload(both)).toMatchObject({
			code: "INVALID_OPERATION_PARAMETERS",
		});
	});

	it("exports boards to HTML on disk and names unknown boards", async () => {
		const { client } = await createSession();
		const fixture = fixtures[fixtures.length - 1];

		const exported = await client.callTool({
			name: "design_export",
			arguments: {
				designFileId,
				destinationDir: "exports",
				boardIds: ["board-a"],
			},
		});
		expect(exported.isError).toBeFalsy();
		const payload = toolPayload(exported);
		expect(payload).toMatchObject({
			status: "success",
			designFile: { id: designFileId, name: "Readable Design" },
			destinationDir: path.join(fixture.projectRoot, "exports"),
		});
		expect(payload.artifacts).toHaveLength(1);
		const html = await readFile(payload.artifacts[0].path, "utf8");
		expect(html).toContain("Launch ready");

		const missing = await client.callTool({
			name: "design_export",
			arguments: { designFileId, destinationDir: "exports", boardIds: ["x"] },
		});
		expect(missing.isError).toBe(true);
		expect(toolPayload(missing)).toMatchObject({
			code: "NO_MATCHING_BOARDS",
			availableBoardIds: ["board-a", "board-b"],
		});
	});
});
