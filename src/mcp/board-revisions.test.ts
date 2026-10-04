import { writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
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

const designFileId = "10000000-0000-4000-8000-0000000000b1";
const sourceDesignFileId = "10000000-0000-4000-8000-0000000000b2";

const text = (id: string, value: string): Node => ({
	id,
	props: {
		"data-trickroom-name": id,
		"data-trickroom-library": "trickroom",
		"data-trickroom-component": "text",
		"data-trickroom-role": "text",
	},
	children: value,
});

const board = (id: string, name: string, children: Node[]): Node => ({
	id,
	props: {
		"data-trickroom-name": name,
		"data-trickroom-library": "trickroom",
		"data-trickroom-component": "container",
		"data-trickroom-role": "branch",
	},
	children,
});

const twoBoards = (name: string): TrickroomDesign => ({
	name,
	systemName: "Core",
	boards: [
		board("board-a", "Board A", [text("a-title", "A")]),
		board("board-b", "Board B", [text("b-title", "B")]),
	],
});

const fixtures: TrickroomMcpProjectFixture[] = [];
const sessions: TrickroomMcpClientSession[] = [];

afterEach(async () => {
	await Promise.all(sessions.splice(0).map((session) => session.close()));
	await Promise.all(fixtures.splice(0).map((fixture) => fixture.cleanup()));
});

const setup = async () => {
	const fixture = await createTrickroomMcpProjectFixture({
		designs: {
			[designFileId]: twoBoards("Target"),
			[sourceDesignFileId]: twoBoards("Source"),
		},
	});
	fixtures.push(fixture);
	const connect = async () => {
		const session = await createTrickroomMcpTestClient(
			await fixture.readMcpContext(),
		);
		sessions.push(session);
		return session.client;
	};
	return { fixture, agent: await connect(), otherWriter: await connect() };
};

const readRevision = async (
	client: Awaited<ReturnType<typeof setup>>["agent"],
	id = designFileId,
) =>
	toolPayload(
		await client.callTool({
			name: TOOL.designRead,
			arguments: { designFileId: id, depth: 0 },
		}),
	).designFile.revision as string;

const renameText = (elementId: string, value: string) => ({
	operation: "updateElementText",
	parameters: { elementId, text: value },
});

describe("board-level revisions through MCP", () => {
	it("applies a batch to an unchanged board with an older revision and keeps the other writer's board", async () => {
		const { fixture, agent, otherWriter } = await setup();
		const heldRevision = await readRevision(agent);

		const other = toolPayload(
			await applyOperation(otherWriter, "updateElementText", {
				designFileId,
				expectedRevision: heldRevision,
				elementId: "b-title",
				text: "B by the other writer",
			}),
		);
		expect(other.status).toBe("success");

		const result = await agent.callTool({
			name: TOOL.designApply,
			arguments: {
				designFileId,
				expectedRevision: heldRevision,
				operations: [
					renameText("a-title", "A by the agent"),
					{
						operation: "updateElementProps",
						parameters: { elementId: "board-a", name: "Board A renamed" },
					},
				],
			},
		});
		const payload = toolPayload(result);
		expect(result.isError).toBeUndefined();
		expect(payload.status).toBe("success");
		expect(payload.newRevision).not.toBe(other.newRevision);

		const stored = await fixture.designFileService.readDesignFile(designFileId);
		expect(stored.revision).toBe(payload.newRevision);
		const [boardA, boardB] = stored.design.boards as [Node, Node];
		expect((boardA.children as Node[])[0]?.children).toBe("A by the agent");
		expect((boardB.children as Node[])[0]?.children).toBe(
			"B by the other writer",
		);
	});

	it("names the stale board and recovers by re-reading only that board", async () => {
		const { agent, otherWriter } = await setup();
		const heldRevision = await readRevision(agent);
		const other = toolPayload(
			await applyOperation(otherWriter, "updateElementText", {
				designFileId,
				expectedRevision: heldRevision,
				elementId: "b-title",
				text: "B by the other writer",
			}),
		);

		const refused = await applyOperation(agent, "updateElementText", {
			designFileId,
			expectedRevision: heldRevision,
			elementId: "b-title",
			text: "B by the agent",
		});
		const mismatch = toolPayload(refused);
		expect(refused.isError).toBe(true);
		expect(mismatch).toMatchObject({
			status: "REVISION_MISMATCH",
			designFileId,
			currentRevision: other.newRevision,
			expectedRevision: heldRevision,
			staleBoards: [{ id: "board-b", name: "Board B" }],
			next: [
				{ tool: TOOL.designRead, args: { designFileId, boardId: "board-b" } },
			],
		});
		expect(mismatch.message).toContain('board "Board B"');

		// Recovery: read the stale board, retry with that read's revision.
		const [nextRead] = mismatch.next as [
			{ tool: string; args: Record<string, unknown> },
		];
		const boardRead = toolPayload(
			await agent.callTool({ name: nextRead.tool, arguments: nextRead.args }),
		);
		expect(boardRead.designFile.revision).toBe(other.newRevision);
		expect(boardRead.tree[0].children[0].text).toBe("B by the other writer");

		const retried = toolPayload(
			await applyOperation(agent, "updateElementText", {
				designFileId,
				expectedRevision: boardRead.designFile.revision,
				elementId: "b-title",
				text: "B by the agent",
			}),
		);
		expect(retried.status).toBe("success");
	});

	it("reports a step that fails on a board another writer changed as a mismatch on that board", async () => {
		const { agent, otherWriter } = await setup();
		const heldRevision = await readRevision(agent);
		await applyOperation(otherWriter, "deleteElement", {
			designFileId,
			expectedRevision: heldRevision,
			elementId: "b-title",
		});

		const result = await applyOperation(agent, "updateElementText", {
			designFileId,
			expectedRevision: heldRevision,
			elementId: "b-title",
			text: "gone",
		});
		expect(result.isError).toBe(true);
		expect(toolPayload(result)).toMatchObject({
			status: "REVISION_MISMATCH",
			staleBoards: [{ id: "board-b", name: "Board B" }],
		});
	});

	it("dry-runs with an older revision the way the write would decide", async () => {
		const { agent, otherWriter } = await setup();
		const heldRevision = await readRevision(agent);
		await applyOperation(otherWriter, "updateElementText", {
			designFileId,
			expectedRevision: heldRevision,
			elementId: "b-title",
			text: "B by the other writer",
		});

		const onUnchangedBoard = toolPayload(
			await agent.callTool({
				name: TOOL.designValidate,
				arguments: {
					designFileId,
					expectedRevision: heldRevision,
					operations: [renameText("a-title", "A")],
				},
			}),
		);
		expect(onUnchangedBoard).toMatchObject({ status: "success", valid: true });

		const onChangedBoard = toolPayload(
			await agent.callTool({
				name: TOOL.designValidate,
				arguments: {
					designFileId,
					expectedRevision: heldRevision,
					operations: [renameText("b-title", "B")],
				},
			}),
		);
		expect(onChangedBoard).toMatchObject({
			status: "REVISION_MISMATCH",
			valid: false,
			staleBoards: [{ id: "board-b", name: "Board B" }],
			next: [{ args: { boardId: "board-b" } }],
		});
	});

	it("checks a cross-design copy source only on the board it copies from", async () => {
		const { agent, otherWriter } = await setup();
		const targetRevision = await readRevision(agent);
		const heldSourceRevision = await readRevision(agent, sourceDesignFileId);
		await applyOperation(otherWriter, "updateElementText", {
			designFileId: sourceDesignFileId,
			expectedRevision: heldSourceRevision,
			elementId: "b-title",
			text: "Source B changed",
		});

		const copy = (sourceElementId: string, expectedRevision: string) =>
			applyOperation(agent, "copySubtree", {
				designFileId,
				expectedRevision,
				sourceDesignFileId,
				sourceExpectedRevision: heldSourceRevision,
				sourceElementId,
				parentId: "board-a",
				index: 0,
			});

		const fromUnchangedBoard = toolPayload(
			await copy("a-title", targetRevision),
		);
		expect(fromUnchangedBoard.status).toBe("success");

		const fromChangedBoard = await copy(
			"b-title",
			fromUnchangedBoard.newRevision,
		);
		expect(fromChangedBoard.isError).toBe(true);
		expect(toolPayload(fromChangedBoard)).toMatchObject({
			code: "SOURCE_REVISION_MISMATCH",
			staleSourceBoard: { id: "board-b", name: "Board B" },
			next: {
				tool: TOOL.designRead,
				args: { designFileId: sourceDesignFileId, boardId: "board-b" },
			},
		});
	});

	it("diagnoses only the boards a batch touches", async () => {
		const { fixture, agent } = await setup();
		const brokenIcon: Node = {
			id: "b-icon",
			props: {
				"data-trickroom-name": "Icon",
				"data-trickroom-library": "trickroom",
				"data-trickroom-component": "icon",
				"data-trickroom-role": "leaf",
				"data-trickroom-icon-id": "missing-icon",
			},
			children: [],
		};
		const design = twoBoards("Target");
		(design.boards[1]?.children as Node[]).push(brokenIcon);
		await fixture.writeDesign(designFileId, design);
		const revision = await readRevision(agent);

		// Board B's existing error neither blocks nor is re-reported by a
		// batch on board A.
		const onBoardA = toolPayload(
			await agent.callTool({
				name: TOOL.designApply,
				arguments: {
					designFileId,
					expectedRevision: revision,
					operations: [renameText("a-title", "A")],
				},
			}),
		);
		expect(onBoardA).toMatchObject({ status: "success", issues: [] });
		expect(onBoardA).not.toHaveProperty("preExistingErrorCount");

		// The touched board is still diagnosed.
		const withTypo = toolPayload(
			await agent.callTool({
				name: TOOL.designApply,
				arguments: {
					designFileId,
					expectedRevision: onBoardA.newRevision,
					operations: [
						{
							operation: "updateElementProps",
							parameters: { elementId: "a-title", className: "itmes-center" },
						},
					],
				},
			}),
		);
		expect(withTypo).toMatchObject({
			status: "success",
			warnings: [{ code: "UNKNOWN_TAILWIND_UTILITY", elementIds: ["a-title"] }],
		});

		// A batch on board B counts that board's existing error.
		const onBoardB = toolPayload(
			await agent.callTool({
				name: TOOL.designApply,
				arguments: {
					designFileId,
					expectedRevision: withTypo.newRevision,
					operations: [renameText("b-title", "B")],
				},
			}),
		);
		expect(onBoardB).toMatchObject({
			status: "success",
			preExistingErrorCount: 1,
		});

		// design_validate still checks the whole design.
		const validated = toolPayload(
			await agent.callTool({
				name: TOOL.designValidate,
				arguments: { designFileId },
			}),
		);
		expect(validated.summary.codes).toMatchObject({ UNKNOWN_ICON_ID: 1 });
	});

	it("lists board revisions and storage warnings", async () => {
		const { fixture, agent } = await setup();
		// An older single-file copy next to the folder (for example after a merge).
		await writeFile(
			path.join(fixture.designFileService.designsDir, `${designFileId}.json`),
			JSON.stringify(twoBoards("Legacy copy")),
		);

		const listed = toolPayload(
			await agent.callTool({ name: TOOL.designList, arguments: {} }),
		);
		const entry = (
			listed.designFiles as Array<Record<string, unknown> & { id: string }>
		).find((designFile) => designFile.id === designFileId);
		expect(entry).toMatchObject({
			boards: [
				{ id: "board-a", name: "Board A", revision: expect.any(String) },
				{ id: "board-b", name: "Board B", revision: expect.any(String) },
			],
			warnings: [{ code: "LEGACY_DESIGN_FILE_PRESENT" }],
		});

		const boardRead = toolPayload(
			await agent.callTool({
				name: TOOL.designRead,
				arguments: { designFileId, boardId: "board-b" },
			}),
		);
		expect(boardRead.board).toMatchObject({
			id: "board-b",
			revision: (entry?.boards as Array<{ revision: string }>)[1]?.revision,
		});
		expect(boardRead.designFile.revision).toBe(entry?.revision);
	});
});
