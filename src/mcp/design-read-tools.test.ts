import { afterEach, describe, expect, it } from "vitest";
import type { TrickroomDesign } from "../types";
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
			toolsByName.get("readElement")?.inputSchema.properties,
		).toHaveProperty("elementId");
		expect(
			toolsByName.get("readSubtree")?.inputSchema.properties,
		).toHaveProperty("depth");
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
					revision: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
				},
				{
					id: secondDesignFileId,
					file: `${secondDesignFileId}.json`,
					name: "Second Design",
					systemName: null,
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
		expect(readResult.structuredContent).not.toHaveProperty("boards");
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
				truncated: false,
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
