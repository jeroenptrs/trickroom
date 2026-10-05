import { readFile } from "node:fs/promises";
import path from "node:path";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, describe, expect, it } from "vitest";
import {
	resolveScreenshotViewport,
	type ScreenshotRequest,
} from "../screenshot/types";
import type { TrickroomDesign } from "../types";
import {
	createTrickroomMcpProjectFixture,
	createTrickroomMcpTestClient,
	type TrickroomMcpClientSession,
	type TrickroomMcpProjectFixture,
	toolPayload,
	trickroomMcpTestDesign,
	trickroomMcpTestDesignUuid,
} from "./test-support";

/** Structured payload of a JSON tool result. */
const structured = (result: unknown) => toolPayload(result);

describe("MCP screenshot tools", () => {
	const fixtures: TrickroomMcpProjectFixture[] = [];
	const sessions: TrickroomMcpClientSession[] = [];

	afterEach(async () => {
		await Promise.all(sessions.splice(0).map((session) => session.close()));
		await Promise.all(fixtures.splice(0).map((fixture) => fixture.cleanup()));
	});

	async function open(
		options: {
			readOnly?: boolean;
			auditLog?: boolean;
			designs?: Record<string, TrickroomDesign>;
		} = {},
	) {
		const fixture = await createTrickroomMcpProjectFixture({
			config: {
				mcp: {
					enabled: true,
					mode: options.readOnly ? "read-only" : "read-write",
					auditLog: options.auditLog,
				},
			},
			...(options.designs ? { designs: options.designs } : {}),
		});
		fixtures.push(fixture);
		const requests: ScreenshotRequest[] = [];
		const session = await createTrickroomMcpTestClient(
			await fixture.readMcpContext(),
			{
				serverOptions: {
					screenshotCapture: async (_context, request) => {
						requests.push(structuredClone(request));
						const shots = request.shots ?? [
							{ viewport: request.viewport, theme: request.theme },
						];
						return {
							...(request.designFileId
								? { designFileId: request.designFileId }
								: {}),
							boardId: request.boardId ?? "component",
							...(request.nodeId ? { nodeId: request.nodeId } : {}),
							captures: shots.map((shot) => ({
								mimeType: "image/png" as const,
								base64: Buffer.from("test-png").toString("base64"),
								bytes: 8,
								width: 320,
								height: 200,
								viewport: resolveScreenshotViewport(shot.viewport),
								theme: shot.theme ?? "light",
								scale: request.scale ?? 1,
								...(request.outputPath
									? {
											path: path.resolve(
												fixture.projectRoot,
												request.outputPath,
											),
										}
									: {}),
							})),
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
				name: "design_screenshot",
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
				shots: [{ viewport: "mobile", theme: "dark" }],
				scale: 0.5,
			},
		]);
		// One short text block and the image: no JSON payload.
		expect(result.content.map((item) => item.type)).toEqual(["text", "image"]);
		expect(result.structuredContent).toBeUndefined();
		const text =
			result.content[0]?.type === "text" ? result.content[0].text : "";
		expect(text).toContain("Harness Design");
		expect(text).toContain("Board · mobile 390x844 · dark · 320x200px");
		expect(text).not.toContain("base64");
	});

	it("infers the containing board for a node crop", async () => {
		const { session, requests } = await open();
		const result = (await session.client.callTool(
			{
				name: "design_screenshot",
				arguments: {
					designFileId: trickroomMcpTestDesignUuid,
					elementId: "title",
				},
			},
			CallToolResultSchema,
		)) as CallToolResult;

		expect(result.isError).not.toBe(true);
		expect(requests[0]).toMatchObject({
			boardId: "board",
			nodeId: "title",
			scale: 1,
		});
	});

	it("allows inline capture in read-only mode but governs persisted output", async () => {
		const { fixture, session, requests } = await open({
			readOnly: true,
			auditLog: true,
		});
		const inline = (await session.client.callTool(
			{
				name: "design_screenshot",
				arguments: {
					designFileId: trickroomMcpTestDesignUuid,
					boardId: "board",
				},
			},
			CallToolResultSchema,
		)) as CallToolResult;
		const persisted = (await session.client.callTool(
			{
				name: "design_export",
				arguments: {
					designFileId: trickroomMcpTestDesignUuid,
					boardIds: ["board"],
					destinationDir: "captures",
					format: "png",
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
			{ toolName: "design_screenshot", operation: "capture", success: true },
			{
				toolName: "design_export",
				operation: "png",
				success: false,
				code: "MCP_READ_ONLY",
			},
		]);
	});
	const twoBoardDesignUuid = "00000000-0000-4000-8000-000000000002";
	const twoBoardDesign = {
		...trickroomMcpTestDesign,
		name: "Two boards",
		boards: [
			...trickroomMcpTestDesign.boards,
			{
				id: "second",
				props: {
					"data-trickroom-name": "Second board",
					"data-trickroom-library": "trickroom",
					"data-trickroom-component": "container",
				},
				children: [],
			},
		],
	} satisfies TrickroomDesign;

	const callScreenshot = async (
		session: TrickroomMcpClientSession,
		name: string,
		args: Record<string, unknown>,
	) =>
		(await session.client.callTool(
			{ name, arguments: args },
			CallToolResultSchema,
		)) as CallToolResult;

	it("captures several viewports and themes of a board in one request", async () => {
		const { session, requests } = await open();
		const result = await callScreenshot(session, "design_screenshot", {
			designFileId: trickroomMcpTestDesignUuid,
			boardId: "board",
			viewport: ["mobile", 1280],
			theme: ["light", "dark"],
			scale: 1,
		});

		expect(result.isError).not.toBe(true);
		expect(requests).toHaveLength(1);
		expect(requests[0]?.shots).toEqual([
			{ viewport: "mobile", theme: "light" },
			{ viewport: 1280, theme: "light" },
			{ viewport: "mobile", theme: "dark" },
			{ viewport: 1280, theme: "dark" },
		]);
		expect(result.content.map((item) => item.type)).toEqual([
			"text",
			...Array.from({ length: 4 }, () => ["text", "image"]).flat(),
		]);
		expect(result.content[1]).toMatchObject({
			type: "text",
			text: "[1] Board · mobile 390x844 · light · 320x200px",
		});
		expect(result.content[7]).toMatchObject({
			type: "text",
			text: "[4] Board · 1280x900 · dark · 320x200px",
		});
	});

	it('captures every board with boardId "all"', async () => {
		const { session, requests } = await open({
			designs: { [twoBoardDesignUuid]: twoBoardDesign },
		});
		const result = await callScreenshot(session, "design_screenshot", {
			designFileId: twoBoardDesignUuid,
			boardId: "all",
			viewport: 1024,
		});

		expect(result.isError).not.toBe(true);
		expect(requests.map((request) => request.boardId)).toEqual([
			"board",
			"second",
		]);
		expect(requests.every((request) => !request.outputPath)).toBe(true);
		expect(result.content.filter((item) => item.type === "image")).toHaveLength(
			2,
		);
	});

	it("exports board PNGs to disk through design_export", async () => {
		const { fixture, session, requests } = await open({
			designs: { [twoBoardDesignUuid]: twoBoardDesign },
		});
		const result = await callScreenshot(session, "design_export", {
			designFileId: twoBoardDesignUuid,
			destinationDir: "captures",
			format: "png",
			viewport: ["mobile", "desktop"],
		});

		expect(result.isError).not.toBe(true);
		expect(requests).toMatchObject([
			{
				boardId: "board",
				outputPath: "captures/Two-boards-Board.png",
				scale: 1,
				maxHeight: 8000,
				shots: [
					{ viewport: "mobile", theme: "light" },
					{ viewport: "desktop", theme: "light" },
				],
			},
			{ boardId: "second", outputPath: "captures/Two-boards-Second-board.png" },
		]);
		// An export answers with the written files, not images.
		expect(result.content.map((item) => item.type)).toEqual(["text"]);
		expect(toolPayload(result)).toMatchObject({
			status: "success",
			designFile: { id: twoBoardDesignUuid, name: "Two boards" },
			format: "png",
			files: [
				{
					boardId: "board",
					viewport: "mobile",
					theme: "light",
					path: path.resolve(
						fixture.projectRoot,
						"captures/Two-boards-Board.png",
					),
				},
				{ boardId: "board", viewport: "desktop" },
				{ boardId: "second", viewport: "mobile" },
				{ boardId: "second", viewport: "desktop" },
			],
		});
	});

	it("reports an unknown board in a list with the available boards", async () => {
		const { session, requests } = await open({
			designs: { [twoBoardDesignUuid]: twoBoardDesign },
		});
		const result = await callScreenshot(session, "design_screenshot", {
			designFileId: twoBoardDesignUuid,
			boardId: ["board", "missing"],
		});

		expect(result.isError).toBe(true);
		expect(requests).toHaveLength(0);
		expect(JSON.stringify(result.content)).toContain("BOARD_NOT_FOUND");
		expect(JSON.stringify(result.content)).toContain("second");
	});

	it("bounds the number of images per call", async () => {
		const { session, requests } = await open({
			designs: { [twoBoardDesignUuid]: twoBoardDesign },
		});
		const result = await callScreenshot(session, "design_screenshot", {
			designFileId: twoBoardDesignUuid,
			boardId: "all",
			viewport: ["mobile", "tablet", "desktop", 1280],
			theme: ["light", "dark"],
		});

		expect(result.isError).toBe(true);
		expect(JSON.stringify(result.content)).toContain("TOO_MANY_SCREENSHOTS");
		expect(requests).toHaveLength(0);
	});

	it("passes render warnings and crops through briefly", async () => {
		const fixture = await createTrickroomMcpProjectFixture();
		fixtures.push(fixture);
		const session = await createTrickroomMcpTestClient(
			await fixture.readMcpContext(),
			{
				serverOptions: {
					screenshotCapture: async () => ({
						boardId: "board",
						captures: [
							{
								mimeType: "image/png",
								base64: "cG5n",
								bytes: 3,
								width: 720,
								height: 900,
								viewport: { width: 1440, height: 900 },
								theme: "light",
								scale: 0.5,
								cropped: { cssHeight: 4200, capturedCssHeight: 1800 },
								warnings: [
									"OVERLAY_CLIPPED: an open overlay extends past the captured area, so part of it is not in the image.",
								],
							},
						],
					}),
				},
			},
		);
		sessions.push(session);
		const result = await callScreenshot(session, "design_screenshot", {
			designFileId: trickroomMcpTestDesignUuid,
			boardId: "board",
		});
		const text =
			result.content[0]?.type === "text" ? result.content[0].text : "";

		expect(text).toContain("cropped to top 1800 of 4200 CSS px");
		expect(text).toContain("Warnings: OVERLAY_CLIPPED");
		expect(text).toContain("pass maxHeight");
	});
	it("captures a system component by slug, with a variant matrix", async () => {
		const { session, requests } = await open();
		const listed = await session.client.callTool({
			name: "component_read",
			arguments: { systemName: "Core" },
		});
		const created = await session.client.callTool({
			name: "component_draft_create",
			arguments: {
				systemName: "Core",
				expectedRevision: structured(listed).revision,
				slug: "badge",
				name: "Badge",
				draft: {
					root: {
						path: "root",
						library: "trickroom",
						component: "text",
						text: "Badge",
					},
					variants: {
						axes: {
							tone: {
								label: "Tone",
								defaultValue: "neutral",
								values: { brand: {}, neutral: {} },
							},
						},
					},
				},
			},
		});
		expect(created.isError).not.toBe(true);

		const result = await callScreenshot(session, "design_screenshot", {
			component: { componentId: "badge", matrix: "tone", systemName: "Core" },
			theme: ["light", "dark"],
		});
		expect(result.isError).not.toBe(true);
		expect(requests).toEqual([
			expect.objectContaining({
				component: {
					systemId: String(structured(listed).systemId),
					componentId: String(structured(created).componentId),
					source: "draft",
					rows: "tone",
				},
				scale: 1,
				shots: [{ theme: "light" }, { theme: "dark" }],
			}),
		]);
		expect(requests[0]?.designFileId).toBeUndefined();
		expect(result.content[1]).toMatchObject({
			type: "text",
			text: expect.stringContaining("[1] Badge (draft) · tone matrix"),
		});

		const unknownValue = await callScreenshot(session, "design_screenshot", {
			component: { componentId: "badge", variants: { tone: "loud" } },
		});
		expect(unknownValue.isError).toBe(true);
		expect(JSON.stringify(unknownValue.content)).toContain(
			"UNKNOWN_VARIANT_VALUE",
		);
		const unknownComponent = await callScreenshot(
			session,
			"design_screenshot",
			{
				component: { componentId: "badg" },
			},
		);
		const unknownText =
			unknownComponent.content[0]?.type === "text"
				? unknownComponent.content[0].text
				: "{}";
		expect(JSON.parse(unknownText)).toMatchObject({
			code: "UNKNOWN_COMPONENT",
			suggestions: ["badge"],
		});
		expect(requests).toHaveLength(1);
	});

	it("needs a board or a component", async () => {
		const { session } = await open();
		const result = await callScreenshot(session, "design_screenshot", {
			designFileId: trickroomMcpTestDesignUuid,
		});
		expect(result.isError).toBe(true);
		expect(JSON.stringify(result.content)).toContain("boardId");
	});
});
