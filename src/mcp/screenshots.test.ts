import { readFile } from "node:fs/promises";
import path from "node:path";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, describe, expect, it } from "vitest";
import type { ScreenshotRequest } from "../screenshot/types";
import {
	createTrickroomMcpProjectFixture,
	createTrickroomMcpTestClient,
	type TrickroomMcpClientSession,
	type TrickroomMcpProjectFixture,
	trickroomMcpTestDesignUuid,
} from "./test-support";

describe("MCP screenshot tools", () => {
	const fixtures: TrickroomMcpProjectFixture[] = [];
	const sessions: TrickroomMcpClientSession[] = [];

	afterEach(async () => {
		await Promise.all(sessions.splice(0).map((session) => session.close()));
		await Promise.all(fixtures.splice(0).map((fixture) => fixture.cleanup()));
	});

	async function open(
		options: { readOnly?: boolean; auditLog?: boolean } = {},
	) {
		const fixture = await createTrickroomMcpProjectFixture({
			config: {
				mcp: {
					enabled: true,
					mode: options.readOnly ? "read-only" : "read-write",
					auditLog: options.auditLog,
				},
			},
		});
		fixtures.push(fixture);
		const requests: ScreenshotRequest[] = [];
		const session = await createTrickroomMcpTestClient(
			await fixture.readMcpContext(),
			{
				serverOptions: {
					screenshotCapture: async (_context, request) => {
						requests.push({ ...request });
						return {
							mimeType: "image/png",
							base64: Buffer.from("test-png").toString("base64"),
							bytes: 8,
							width: 320,
							height: 200,
							designFileId: request.designFileId,
							boardId: request.boardId ?? "board",
							...(request.nodeId ? { nodeId: request.nodeId } : {}),
							theme: request.theme ?? "light",
							...(request.outputPath
								? {
										path: path.resolve(fixture.projectRoot, request.outputPath),
									}
								: {}),
						};
					},
				},
			},
		);
		sessions.push(session);
		return { fixture, session, requests };
	}

	it("returns a board screenshot as an MCP image block", async () => {
		const { session, requests } = await open();
		const result = (await session.client.callTool(
			{
				name: "screenshotBoard",
				arguments: {
					designFileId: trickroomMcpTestDesignUuid,
					boardId: "board",
					viewport: "mobile",
					theme: "dark",
				},
			},
			CallToolResultSchema,
		)) as CallToolResult;

		expect(result.isError).not.toBe(true);
		expect(result.content).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					type: "image",
					mimeType: "image/png",
					data: Buffer.from("test-png").toString("base64"),
				}),
			]),
		);
		expect(requests).toMatchObject([
			{
				designFileId: trickroomMcpTestDesignUuid,
				boardId: "board",
				viewport: "mobile",
				theme: "dark",
			},
		]);
	});

	it("infers the containing board for a node crop", async () => {
		const { session, requests } = await open();
		const result = (await session.client.callTool(
			{
				name: "screenshotNode",
				arguments: {
					designFileId: trickroomMcpTestDesignUuid,
					nodeId: "title",
				},
			},
			CallToolResultSchema,
		)) as CallToolResult;

		expect(result.isError).not.toBe(true);
		expect(requests[0]).toMatchObject({ boardId: "board", nodeId: "title" });
	});

	it("allows inline capture in read-only mode but governs persisted output", async () => {
		const { fixture, session, requests } = await open({
			readOnly: true,
			auditLog: true,
		});
		const inline = (await session.client.callTool(
			{
				name: "screenshotBoard",
				arguments: {
					designFileId: trickroomMcpTestDesignUuid,
					boardId: "board",
				},
			},
			CallToolResultSchema,
		)) as CallToolResult;
		const persisted = (await session.client.callTool(
			{
				name: "screenshotBoard",
				arguments: {
					designFileId: trickroomMcpTestDesignUuid,
					boardId: "board",
					outputPath: "captures/board.png",
				},
			},
			CallToolResultSchema,
		)) as CallToolResult;

		expect(inline.isError).not.toBe(true);
		expect(persisted.isError).toBe(true);
		expect(requests).toHaveLength(1);
		const audit = await readFile(
			path.join(fixture.projectRoot, ".trickroom", "audit-log.jsonl"),
			"utf8",
		);
		const entries = audit
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line) as Record<string, unknown>);
		expect(entries).toMatchObject([
			{ toolName: "screenshotBoard", success: true },
			{
				toolName: "screenshotBoard",
				success: false,
				code: "MCP_READ_ONLY",
			},
		]);
	});
});
