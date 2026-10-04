import { afterEach, describe, expect, it, vi } from "vitest";
import type { Node, TrickroomDesign } from "../types";
import {
	applyOperation,
	createTrickroomMcpProjectFixture,
	createTrickroomMcpTestClient,
	type TrickroomMcpClientSession,
	type TrickroomMcpProjectFixture,
	toolPayload,
} from "./test-support";
import { TOOL } from "./tool-names";

// Lets a test run another writer between extraction's checks and its design
// write.
const hooks = vi.hoisted(() => ({
	beforeDesignWrite: null as null | (() => Promise<void>),
}));

vi.mock("./payloads/design-validation", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("./payloads/design-validation")>();
	return {
		...actual,
		applyDesignOperationsPayload: async (
			...args: Parameters<typeof actual.applyDesignOperationsPayload>
		) => {
			const hook = hooks.beforeDesignWrite;
			hooks.beforeDesignWrite = null;
			await hook?.();
			return actual.applyDesignOperationsPayload(...args);
		},
	};
});

const designFileId = "10000000-0000-4000-8000-0000000000c1";

const node = (
	id: string,
	name: string,
	component: "container" | "text",
	extra: Partial<Node> & { className?: string } = {},
): Node => ({
	id,
	props: {
		"data-trickroom-name": name,
		"data-trickroom-library": "trickroom",
		"data-trickroom-component": component,
		"data-trickroom-role": component === "text" ? "text" : "branch",
		...(extra.className ? { className: extra.className } : {}),
	},
	children: extra.children ?? (component === "text" ? name : []),
});

const design: TrickroomDesign = {
	name: "Pricing",
	systemName: "Core",
	boards: [
		node("board", "Board", "container", {
			children: [
				node("intro", "Intro", "text"),
				node("card", "Plan Card", "container", {
					className: "flex flex-col gap-2 p-4",
					children: [
						node("card-title", "Title", "text", { children: "Pro" }),
						node("card-price", "Price", "text", { children: "$12" }),
					],
				}),
			],
		}),
		node("other", "Other", "container", {
			children: [node("other-title", "Other title", "text")],
		}),
	],
};

let fixture: TrickroomMcpProjectFixture;
let session: TrickroomMcpClientSession;

afterEach(async () => {
	hooks.beforeDesignWrite = null;
	await session?.close();
	await fixture?.cleanup();
});

const open = async () => {
	fixture = await createTrickroomMcpProjectFixture({
		designs: { [designFileId]: design },
	});
	session = await createTrickroomMcpTestClient(await fixture.readMcpContext());
	const call = async (name: string, args: Record<string, unknown>) => {
		const result = await session.client.callTool({ name, arguments: args });
		return { result, payload: toolPayload(result) };
	};
	const manifestRevision = async () =>
		(await call(TOOL.componentRead, { systemName: "Core" })).payload
			.revision as string;
	const designRevision = async () =>
		(await call(TOOL.designRead, { designFileId, depth: 0 })).payload.designFile
			.revision as string;
	return { call, manifestRevision, designRevision };
};

/** Replaces placeholder strings anywhere in a guide example's arguments. */
const fill = (
	value: unknown,
	replacements: Record<string, string>,
): unknown => {
	if (typeof value === "string") {
		return replacements[value] ?? value;
	}
	if (Array.isArray(value)) {
		return value.map((entry) => fill(entry, replacements));
	}
	if (value && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value).map(([key, entry]) => [
				key,
				fill(entry, replacements),
			]),
		);
	}
	return value;
};

describe("component_draft_create from a design layer", () => {
	it("extracts a layer into a draft and leaves the design unchanged", async () => {
		const { call, manifestRevision, designRevision } = await open();
		const before = await designRevision();

		const { result, payload } = await call(TOOL.componentDraftCreate, {
			expectedRevision: await manifestRevision(),
			from: { designFileId, elementId: "card" },
		});
		expect(result.isError).toBeFalsy();
		expect(payload).toMatchObject({
			componentId: expect.stringMatching(/^cmp_/),
			extracted: { designFileId, elementId: "card", nodeCount: 3 },
		});
		expect(payload).not.toHaveProperty("replaced");
		expect(await designRevision()).toBe(before);

		const described = await call(TOOL.componentRead, {
			componentId: payload.componentId,
			source: "draft",
			include: ["template"],
		});
		expect(described.payload).toMatchObject({
			name: "Plan Card",
			draftState: "unpublished",
			root: {
				className: "flex flex-col gap-2 p-4",
				children: [
					{ path: "title", text: "Pro" },
					{ path: "price", text: "$12" },
				],
			},
		});
	});

	it("runs the guide's extract-and-replace example", async () => {
		const { call, manifestRevision, designRevision } = await open();
		const examples = (await call(TOOL.guide, { topic: "component-examples" }))
			.payload["component-examples"] as Array<{
			tool: string;
			arguments: Record<string, unknown> & { from?: unknown };
		}>;
		const example = examples.find((entry) => entry.arguments.from);
		expect(example?.tool).toBe(TOOL.componentDraftCreate);

		const { result, payload } = await call(
			example?.tool as string,
			fill(example?.arguments, {
				"<manifest revision from your last read or write>":
					await manifestRevision(),
				"<design id>": designFileId,
				"<layer id>": "card",
				"<design revision from your last read or write>":
					await designRevision(),
			}) as Record<string, unknown>,
		);
		expect(result.isError).toBeFalsy();
		expect(payload).toMatchObject({
			componentId: expect.stringMatching(/^cmp_/),
			publishedVersion: expect.any(String),
			replaced: {
				instanceRootId: expect.any(String),
				newRevision: expect.any(String),
				issues: [],
			},
		});

		const board = (
			await call(TOOL.designRead, { designFileId, elementId: "board" })
		).payload;
		expect(
			board.subtree.children.map((child: { id: string }) => child.id),
		).toEqual(["intro", payload.replaced.instanceRootId]);
		expect(board.subtree.children[1]).toMatchObject({
			systemComponent: { id: payload.componentId },
		});
	});

	it("checks everything it can before the first write", async () => {
		const { call, manifestRevision, designRevision } = await open();
		const revision = await manifestRevision();
		const heldDesignRevision = await designRevision();
		const extract = (from: Record<string, unknown>, extra = {}) =>
			call(TOOL.componentDraftCreate, {
				expectedRevision: revision,
				from: { designFileId, ...from },
				...extra,
			});

		const withoutRevision = await extract({ elementId: "card", replace: true });
		expect(withoutRevision.payload).toMatchObject({
			code: "INVALID_OPERATION_PARAMETERS",
		});

		const withDraft = await extract(
			{ elementId: "card" },
			{
				draft: {
					root: { path: "root", library: "trickroom", component: "container" },
				},
			},
		);
		expect(withDraft.payload).toMatchObject({
			code: "INVALID_OPERATION_PARAMETERS",
		});

		// Another writer changes the layer's board after the agent's read.
		await applyOperation(session.client, "updateElementText", {
			designFileId,
			expectedRevision: heldDesignRevision,
			elementId: "card-title",
			text: "Pro plus",
		});
		const stale = await extract({
			elementId: "card",
			replace: true,
			expectedRevision: heldDesignRevision,
		});
		expect(stale.result.isError).toBe(true);
		expect(stale.payload).toMatchObject({
			status: "REVISION_MISMATCH",
			staleBoards: [{ id: "board", name: "Board" }],
		});

		// A layer inside a recipe's locked structure cannot be replaced.
		const recipe = toolPayload(
			await applyOperation(session.client, "addRecipe", {
				designFileId,
				expectedRevision: await designRevision(),
				parentId: "other",
				index: 0,
				library: "base-ui",
				recipe: "dialog.default",
			}),
		);
		const slotHost = Object.values(
			recipe.created[0].slots as Record<string, string>,
		)[0];
		const locked = await extract({
			elementId: slotHost,
			replace: true,
			expectedRevision: recipe.newRevision,
		});
		expect(locked.result.isError).toBe(true);
		expect(locked.payload.message).toContain("cannot be replaced");

		// Nothing was written to the manifest.
		expect(await manifestRevision()).toBe(revision);
	});

	it("reports what was written when the design write loses a race", async () => {
		const { call, manifestRevision, designRevision } = await open();
		const heldDesignRevision = await designRevision();
		hooks.beforeDesignWrite = async () => {
			await applyOperation(session.client, "updateElementText", {
				designFileId,
				expectedRevision: heldDesignRevision,
				elementId: "card-price",
				text: "$15",
			});
		};

		const { result, payload } = await call(TOOL.componentDraftCreate, {
			expectedRevision: await manifestRevision(),
			from: {
				designFileId,
				elementId: "card",
				replace: true,
				expectedRevision: heldDesignRevision,
			},
		});
		expect(result.isError).toBe(true);
		expect(payload).toMatchObject({
			status: "REVISION_MISMATCH",
			staleBoards: [{ id: "board" }],
			partial: {
				componentId: expect.stringMatching(/^cmp_/),
				created: true,
				published: true,
				replaced: false,
				publishedVersion: expect.any(String),
			},
			next: {
				tool: TOOL.designApply,
				args: {
					designFileId,
					expectedRevision: payload.currentRevision,
					operations: [
						{ operation: "addSystemComponent" },
						{ operation: "deleteElement", parameters: { elementId: "card" } },
					],
				},
			},
		});
		expect(payload.message).toContain("created and published");

		// The component stays published; the design keeps the other writer's
		// change and the original layer.
		const listed = await call(TOOL.componentRead, { systemName: "Core" });
		expect(JSON.stringify(listed.payload)).toContain(
			payload.partial.componentId,
		);
		const card = (
			await call(TOOL.designRead, { designFileId, elementId: "card" })
		).payload;
		expect(card.subtree.children[1].text).toBe("$15");

		// The returned call finishes the job once the agent re-read the board.
		const finished = await call(payload.next.tool, payload.next.args);
		expect(finished.result.isError).toBeFalsy();
		expect(finished.payload.status).toBe("success");
	});
});
