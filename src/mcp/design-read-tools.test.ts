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
		).toHaveProperty("responseFormat");
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
		expect(listResult.structuredContent).toMatchObject({
			designFiles: [
				{
					id: designFileId,
					file: `${designFileId}.json`,
					name: "Readable Design",
					systemName: "Core",
					boardsCount: 2,
					layersCount: 3,
					modifiedAt: expect.any(String),
					revision: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
				},
				{
					id: secondDesignFileId,
					file: `${secondDesignFileId}.json`,
					name: "Second Design",
					systemName: null,
					boardsCount: 2,
					layersCount: 3,
					modifiedAt: expect.any(String),
					revision: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
				},
			],
		});

		const readResult = await client.callTool({
			name: "readDesignFile",
			arguments: {
				designFileId,
			},
		});
		expect(readResult.structuredContent).toMatchObject({
			designFile: {
				id: designFileId,
				file: `${designFileId}.json`,
				name: "Readable Design",
				systemName: "Core",
				revision: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
			},
			designSystem: {
				systemName: "Core",
				configured: true,
				cssPath: "src/index.css",
			},
			rootElementIds: ["board-a", "board-b"],
			boards: [
				{
					id: "board-a",
					name: "Board A",
					childCount: 2,
					descendantCount: 3,
				},
				{
					id: "board-b",
					name: "Board B",
					childCount: 0,
					descendantCount: 0,
				},
			],
			counts: {
				boardsCount: 2,
				layersCount: 3,
				elementCount: 5,
				textLeavesCount: 2,
			},
			read: {
				depth: 2,
				maxNodes: 100,
				truncated: false,
				returnedNodeCount: 5,
				omittedNodeCount: 0,
			},
			elementTree: [
				{
					id: "board-a",
					name: "Board A",
					component: "container",
					childIds: ["title", "cta"],
					children: [
						{
							id: "title",
							role: "text",
							textPreview: "Launch ready",
							textLength: 12,
						},
						{
							id: "cta",
							childIds: ["cta-label"],
						},
					],
				},
				{
					id: "board-b",
					childIds: [],
				},
			],
		});
		expect(readResult.content[0]).toMatchObject({
			type: "text",
		});
		const readText = (readResult.content[0] as { text: string }).text;
		expect(() => JSON.parse(readText)).not.toThrow();
		expect(JSON.parse(readText)).toMatchObject({
			designFile: {
				id: designFileId,
			},
			read: {
				returnedNodeCount: 5,
			},
		});

		const summaryReadResult = await client.callTool({
			name: "readDesignFile",
			arguments: {
				designFileId,
				responseFormat: "summary",
			},
		});
		expect(summaryReadResult.content[0]).toMatchObject({
			type: "text",
			text: expect.stringContaining("Returned 5 nodes"),
		});
	});

	it("reads full elements with parent and sibling context", async () => {
		const { client } = await createSession();

		const readResult = await client.callTool({
			name: "readElement",
			arguments: {
				designFileId,
				elementId: "cta",
			},
		});

		expect(readResult.structuredContent).toMatchObject({
			designFile: {
				id: designFileId,
			},
			element: {
				id: "cta",
				props: {
					"data-trickroom-name": "CTA",
					"data-trickroom-component": "container",
				},
				text: null,
				childIds: ["cta-label"],
			},
			context: {
				parentId: "board-a",
				root: false,
				index: 1,
				rootIndex: null,
				siblingIds: ["title", "cta"],
				previousSiblingId: "title",
				nextSiblingId: null,
			},
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
				maxNodes: 100,
				truncated: true,
				returnedNodeCount: 3,
				omittedNodeCount: 1,
			},
		});

		const subtreeRead = await client.callTool({
			name: "readSubtree",
			arguments: {
				designFileId: deepDesignFileId,
				elementId: "deep-board",
			},
		});
		expect(subtreeRead.structuredContent).toMatchObject({
			depth: 2,
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
			depth: null,
			read: {
				depth: null,
				maxNodes: null,
				truncated: false,
				returnedNodeCount: 4,
				omittedNodeCount: 0,
			},
		});
	});

	it("reads detailed subtrees with an optional depth cap", async () => {
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
			elementId: "board-a",
			depth: 1,
			context: {
				parentId: null,
				root: true,
				rootIndex: 0,
				nextSiblingId: "board-b",
			},
			subtree: {
				id: "board-a",
				childIds: ["title", "cta"],
				truncated: true,
				children: [
					{
						id: "title",
						text: "Launch ready",
						children: "Launch ready",
						truncated: false,
					},
					{
						id: "cta",
						childIds: ["cta-label"],
						children: [],
						truncated: true,
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

			const readContent = readResult.structuredContent as {
				subtree: {
					children: Array<{
						id: string;
						children?: Array<{
							id: string;
							recipe?: {
								slotName: string | null;
								path: string;
								state: string;
							};
						}>;
						recipe?: {
							recipeId: string;
							instanceId: string;
							rootElementId: string | null;
							path: string;
							slotName: string | null;
							state: string;
						};
					}>;
				};
			};

			const validRoot = readContent.subtree.children.find(
				(node) => node.id === recipeMetadataReadFixture.nodeIds.valid.root,
			);
			const invalidRoot = readContent.subtree.children.find(
				(node) => node.id === recipeMetadataReadFixture.nodeIds.invalid.root,
			);
			const unknownRoot = readContent.subtree.children.find(
				(node) => node.id === recipeMetadataReadFixture.nodeIds.unknown.root,
			);
			const staleRoot = readContent.subtree.children.find(
				(node) => node.id === recipeMetadataReadFixture.nodeIds.stale.root,
			);

			expect(validRoot).toMatchObject({
				id: recipeMetadataReadFixture.nodeIds.valid.root,
				recipe: {
					recipeId: "base-ui/avatar.default",
					instanceId: recipeMetadataReadFixture.nodeIds.valid.instanceId,
					rootElementId: recipeMetadataReadFixture.nodeIds.valid.root,
					path: "root",
					slotName: null,
					state: "attached-valid",
				},
			});
			expect(invalidRoot).toMatchObject({
				id: recipeMetadataReadFixture.nodeIds.invalid.root,
				recipe: {
					recipeId: "base-ui/avatar.default",
					instanceId: recipeMetadataReadFixture.nodeIds.invalid.instanceId,
					rootElementId: null,
					path: "root",
					slotName: null,
					state: "invalid-known",
				},
			});
			expect(unknownRoot).toMatchObject({
				id: recipeMetadataReadFixture.nodeIds.unknown.root,
				recipe: {
					recipeId: "base-ui/does-not-exist",
					instanceId: recipeMetadataReadFixture.nodeIds.unknown.instanceId,
					rootElementId: recipeMetadataReadFixture.nodeIds.unknown.root,
					path: "root",
					slotName: null,
					state: "unknown-recipe",
				},
			});
			expect(staleRoot).toMatchObject({
				id: recipeMetadataReadFixture.nodeIds.stale.root,
				recipe: {
					recipeId: "base-ui/avatar.default",
					instanceId: recipeMetadataReadFixture.nodeIds.stale.instanceId,
					rootElementId: recipeMetadataReadFixture.nodeIds.stale.root,
					path: "root",
					slotName: null,
					state: "attached-stale",
					currentVersion: "1",
					matchedTemplateVersion: "0.9",
				},
			});

			const findNodeById = (
				nodes: ReadonlyArray<{
					id: string;
					children?: ReadonlyArray<{
						id: string;
						children?: Array<{ id: string }>;
					}>;
				}>,
				targetId: string,
			): { recipe?: { slotName: string | null; path: string } } | null => {
				for (const node of nodes) {
					if (node.id === targetId) {
						return node;
					}
					if (node.children) {
						const found = findNodeById(node.children, targetId);
						if (found) {
							return found;
						}
					}
				}
				return null;
			};

			const validFallback = findNodeById(
				readContent.subtree.children,
				recipeMetadataReadFixture.nodeIds.valid.fallback,
			);
			expect(validFallback).toMatchObject({
				recipe: {
					slotName: "fallback",
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
					elementsById: Record<
						string,
						{
							recipe?: {
								state: string;
								rootElementId: string | null;
							};
						}
					>;
				};
			};
			const validElement =
				graphContent.graph.elementsById[
					recipeMetadataReadFixture.nodeIds.valid.root
				];
			const invalidElement =
				graphContent.graph.elementsById[
					recipeMetadataReadFixture.nodeIds.invalid.root
				];
			const unknownElement =
				graphContent.graph.elementsById[
					recipeMetadataReadFixture.nodeIds.unknown.root
				];
			const staleElement =
				graphContent.graph.elementsById[
					recipeMetadataReadFixture.nodeIds.stale.root
				];

			expect(validElement.recipe).toMatchObject({
				state: "attached-valid",
				rootElementId: recipeMetadataReadFixture.nodeIds.valid.root,
			});
			expect(invalidElement.recipe).toMatchObject({
				state: "invalid-known",
				rootElementId: null,
			});
			expect(unknownElement.recipe).toMatchObject({
				state: "unknown-recipe",
				rootElementId: recipeMetadataReadFixture.nodeIds.unknown.root,
			});
			expect(staleElement.recipe).toMatchObject({
				state: "attached-stale",
				rootElementId: recipeMetadataReadFixture.nodeIds.stale.root,
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
				revision: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
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
});
