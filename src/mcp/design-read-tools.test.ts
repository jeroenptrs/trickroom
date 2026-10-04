import { writeFile } from "node:fs/promises";
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

		for (const name of [
			"listDesignFiles",
			"readDesignFile",
			"readElement",
			"readSubtree",
			"validateDesignFile",
		]) {
			expect(toolsByName.get(name)?.annotations).toMatchObject({
				readOnlyHint: true,
				openWorldHint: false,
			});
		}

		expect(
			toolsByName.get("readDesignFile")?.inputSchema.properties,
		).toHaveProperty("designFileId");
		expect(
			toolsByName.get("readDesignFile")?.inputSchema.properties,
		).toHaveProperty("maxNodes");
		expect(
			toolsByName.get("readDesignFile")?.inputSchema.properties,
		).toHaveProperty("boardId");
		expect(
			toolsByName.get("readDesignFile")?.inputSchema.properties,
		).not.toHaveProperty("responseFormat");
		expect(
			toolsByName.get("readElement")?.inputSchema.properties,
		).toHaveProperty("elementId");
		expect(
			toolsByName.get("readSubtree")?.inputSchema.properties,
		).toHaveProperty("depth");
		expect(
			toolsByName.get("readSubtree")?.inputSchema.properties,
		).toHaveProperty("maxNodes");
	});

	it("lists design file UUID handles and reads compact file trees", async () => {
		const { client } = await createSession();

		const listResult = await client.callTool({
			name: "listDesignFiles",
			arguments: {},
		});
		const { systems } = listResult.structuredContent as {
			systems: Record<string, string>;
		};
		const coreSystemId = Object.keys(systems).find(
			(systemId) => systems[systemId] === "Core",
		);
		expect(coreSystemId).toEqual(expect.stringMatching(/^sys_/));
		expect(listResult.structuredContent).toMatchObject({
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
			listResult.structuredContent as {
				designFiles: Array<Record<string, unknown>>;
			}
		).designFiles[0];
		expect(listedDesign).not.toHaveProperty("file");
		expect(listedDesign).not.toHaveProperty("systemName");

		const readResult = await client.callTool({
			name: "readDesignFile",
			arguments: {
				designFileId,
			},
		});
		expect(readResult.structuredContent).toEqual({
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
		expect(JSON.parse(readText)).toEqual(readResult.structuredContent);

		const boardRead = await client.callTool({
			name: "readDesignFile",
			arguments: { designFileId, boardId: "board-b" },
		});
		expect(boardRead.structuredContent).toMatchObject({
			boards: [{ id: "board-a" }, { id: "board-b" }],
			tree: [{ id: "board-b" }],
			read: { returnedNodeCount: 1 },
		});

		const missingBoard = await client.callTool({
			name: "readDesignFile",
			arguments: { designFileId, boardId: "cta" },
		});
		expect(missingBoard.isError).toBe(true);
		expect(missingBoard.structuredContent).toMatchObject({
			code: "BOARD_NOT_FOUND",
			message: expect.stringContaining("use readSubtree"),
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
			name: "listDesignFiles",
			arguments: {},
		});
		const ids = (
			listResult.structuredContent as { designFiles: Array<{ id: string }> }
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
			name: "readSubtree",
			arguments: { designFileId, elementId: "board" },
		});
		const subtree = (
			read.structuredContent as { subtree: Record<string, unknown> }
		).subtree;
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

		for (const name of ["readDesignFile", "readSubtree", "readElement"]) {
			const result = await client.callTool({
				name,
				arguments: { designFileId: missingId, elementId: "board-a" },
			});
			expect(result.isError).toBe(true);
			expect(result.structuredContent).toMatchObject({
				code: "DESIGN_NOT_FOUND",
				availableDesigns: expect.arrayContaining([
					{ id: designFileId, name: "Readable Design" },
				]),
			});
			expect(JSON.stringify(result.structuredContent)).not.toContain("ENOENT");
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
			name: "readDesignFile",
			arguments: { designFileId },
		});
		const tree = (
			read.structuredContent as {
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
			name: "readSubtree",
			arguments: { designFileId, elementId: "board-a" },
		});
		const subtree = (
			compactSubtree.structuredContent as { subtree: Record<string, unknown> }
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
			name: "readElement",
			arguments: {
				designFileId,
				elementId: "cta",
			},
		});

		expect(readResult.structuredContent).toEqual({
			project: expect.any(Object),
			designFile: {
				id: designFileId,
				name: "Readable Design",
				revision: expect.any(String),
			},
			element: {
				id: "cta",
				name: "CTA",
				component: "container",
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
			name: "readElement",
			arguments: { designFileId, elementId: "board-b", detail: "full" },
		});
		expect(fullResult.structuredContent).toMatchObject({
			element: {
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
			name: "readDesignFile",
			arguments: {
				designFileId: deepDesignFileId,
			},
		});
		expect(designRead.structuredContent).toMatchObject({
			read: {
				depth: 2,
				maxNodes: 50,
				truncated: true,
				returnedNodeCount: 3,
				omittedNodeCount: 1,
				next: {
					tool: "readSubtree",
					args: { designFileId: deepDesignFileId, elementId: "level-2" },
				},
			},
			tree: [{ id: "deep-board", children: [{ children: [{ more: 1 }] }] }],
		});

		const subtreeRead = await client.callTool({
			name: "readSubtree",
			arguments: {
				designFileId: deepDesignFileId,
				elementId: "deep-board",
				depth: 2,
			},
		});
		expect(subtreeRead.structuredContent).toMatchObject({
			read: {
				depth: 2,
				maxNodes: 100,
				truncated: true,
				returnedNodeCount: 3,
				omittedNodeCount: 1,
			},
		});

		const unboundedSubtreeRead = await client.callTool({
			name: "readSubtree",
			arguments: {
				designFileId: deepDesignFileId,
				elementId: "deep-board",
				allowLarge: true,
			},
		});
		expect(unboundedSubtreeRead.structuredContent).toMatchObject({
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
			name: "readSubtree",
			arguments: {
				designFileId,
				elementId: "board-a",
				depth: 1,
			},
		});

		expect(readResult.structuredContent).toMatchObject({
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
			name: "readSubtree",
			arguments: { designFileId, elementId: "cta", detail: "full" },
		});
		expect(fullRead.structuredContent).toMatchObject({
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
				name: "readSubtree",
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
			const readContent = readResult.structuredContent as {
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
				name: "readDesignGraph",
				arguments: {
					designFileId: recipeMetadataReadFixture.designFileId,
				},
			});

			const graphContent = graphResult.structuredContent as {
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
			name: "validateDesignFile",
			arguments: {
				designFileId: invalidDesignFileId,
			},
		});

		expect(validateResult.structuredContent).toMatchObject({
			designFile: {
				id: invalidDesignFileId,
				name: "Needs Validation",
				systemName: "Missing System",
				revision: expect.any(String),
			},
			valid: false,
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
		expect(validateResult.structuredContent).toMatchObject({
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
			name: "listDesignFiles",
			arguments: {},
		});
		expect(listResult.structuredContent).toMatchObject({
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
			listResult.structuredContent as {
				designFiles: Array<{ id: string; diagnostic?: unknown }>;
			}
		).designFiles;
		expect(
			listed.find((designFile) => designFile.id === designFileId),
		).not.toHaveProperty("diagnostic");

		const validateResult = await client.callTool({
			name: "validateDesignFile",
			arguments: { designFileId: futureDesignFileId },
		});
		expect(validateResult.structuredContent).toMatchObject({
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
});
