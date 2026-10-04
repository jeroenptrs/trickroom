import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type {
	EditorContextResult,
	EditorFocusInput,
	EditorFocusResult,
} from "../services/editor-channel";
import type { EditorClientContext } from "../services/editor-channel.types";
import {
	createTrickroomMcpProjectFixture,
	createTrickroomMcpTestClient,
	type TrickroomMcpClientSession,
	type TrickroomMcpProjectFixture,
	toolPayload,
	trickroomMcpTestDesignUuid,
} from "./test-support";

const server = {
	pid: 1,
	url: "http://127.0.0.1:1/",
	projectId: null,
	projectRoot: null,
	startedAt: "2026-10-04T00:00:00.000Z",
};

const tab = (
	overrides: Partial<EditorClientContext> = {},
): EditorClientContext => ({
	clientId: "tab-a",
	projectId: "proj",
	designFileId: trickroomMcpTestDesignUuid,
	activeBoardId: "board",
	selectedId: "title",
	stageMode: "responsive",
	responsiveWidth: 390,
	visible: true,
	focusedAt: "2026-10-04T10:00:00.000Z",
	reportedAt: "2026-10-04T10:00:00.000Z",
	ageMs: 1200,
	...overrides,
});

describe("editor tools", () => {
	const fixtures: TrickroomMcpProjectFixture[] = [];
	const sessions: TrickroomMcpClientSession[] = [];
	const homes: string[] = [];

	afterEach(async () => {
		await Promise.all(sessions.splice(0).map((session) => session.close()));
		await Promise.all(fixtures.splice(0).map((fixture) => fixture.cleanup()));
		await Promise.all(
			homes.splice(0).map((home) => rm(home, { recursive: true, force: true })),
		);
	});

	const open = async (channel: {
		context?: (projectId: string) => EditorContextResult;
		focus?: (input: EditorFocusInput) => EditorFocusResult;
	}) => {
		const fixture = await createTrickroomMcpProjectFixture();
		fixtures.push(fixture);
		const focusRequests: EditorFocusInput[] = [];
		const session = await createTrickroomMcpTestClient(
			await fixture.readMcpContext(),
			{
				serverOptions: {
					editorChannel: {
						getEditorContext: async (projectId) =>
							channel.context?.(projectId) ?? {
								status: "no_server",
								message: "none",
								server: null,
								otherProjects: [],
							},
						requestEditorFocus: async (input) => {
							focusRequests.push(input);
							return (
								channel.focus?.(input) ?? {
									status: "no_server",
									message: "none",
									server: null,
									clientId: null,
									outcome: null,
								}
							);
						},
					},
				},
			},
		);
		sessions.push(session);
		const call = async (name: string, args: Record<string, unknown> = {}) => {
			const result = await session.client.callTool({ name, arguments: args });
			return { isError: result.isError, payload: toolPayload(result) };
		};
		return { fixture, call, focusRequests };
	};

	it("resolves the human's selection to a compact node with its placement", async () => {
		const { call } = await open({
			context: () => ({
				status: "ok",
				server,
				clients: [tab(), tab({ clientId: "tab-b" })],
				focused: tab(),
			}),
		});

		const { isError, payload } = await call("editor_context");
		expect(isError).toBeFalsy();
		expect(payload).toEqual({
			status: "ok",
			project: expect.any(Object),
			design: {
				id: trickroomMcpTestDesignUuid,
				name: "Harness Design",
				revision: expect.any(String),
			},
			board: { id: "board", name: "Board" },
			selected: {
				id: "title",
				name: "Title",
				component: "text",
				text: "Harness fixture",
				parentId: "board",
				boardId: "board",
				index: 0,
				siblingCount: 1,
			},
			stageMode: "responsive",
			responsiveWidth: 390,
			visible: true,
			ageMs: 1200,
			otherTabs: 1,
		});
	});

	it("reports a selection the design no longer has", async () => {
		const { call } = await open({
			context: () => ({
				status: "ok",
				server,
				clients: [tab({ selectedId: "gone", stageMode: "canvas" })],
				focused: tab({ selectedId: "gone", stageMode: "canvas" }),
			}),
		});
		const { payload } = await call("editor_context");
		expect(payload.selected).toEqual({ id: "gone", missing: true });
		expect(payload).not.toHaveProperty("responsiveWidth");
	});

	it("answers unavailable editors with a status and what to ask the human", async () => {
		for (const status of [
			"no_server",
			"no_browser",
			"browser_on_other_project",
			"stale",
		] as const) {
			const { call } = await open({
				context: () => ({
					status,
					message: "transport detail",
					server: null,
					otherProjects: [{ projectId: "proj_other", projectRoot: null }],
				}),
			});
			const { isError, payload } = await call("editor_context");
			expect(isError, status).toBeFalsy();
			expect(payload.status).toBe(status);
			expect(payload.message).toMatch(/human|again/u);
			expect(payload.message).not.toContain("\n");
		}
	});

	it("points the editor at a layer, inferring its board", async () => {
		const { call, focusRequests } = await open({
			focus: () => ({
				status: "ok",
				message: null,
				server,
				clientId: "tab-a",
				outcome: "revealed",
			}),
		});

		const { payload } = await call("editor_focus", {
			designFileId: trickroomMcpTestDesignUuid,
			elementId: "title",
		});
		expect(payload).toMatchObject({
			status: "ok",
			outcome: "revealed",
			boardId: "board",
			elementId: "title",
		});
		expect(focusRequests).toEqual([
			{
				projectId: expect.any(String),
				designFileId: trickroomMcpTestDesignUuid,
				boardId: "board",
				elementId: "title",
			},
		]);

		const typo = await call("editor_focus", {
			designFileId: trickroomMcpTestDesignUuid,
			elementId: "titel",
		});
		expect(typo).toMatchObject({
			isError: true,
			payload: { code: "ELEMENT_NOT_FOUND" },
		});
		const badBoard = await call("editor_focus", {
			designFileId: trickroomMcpTestDesignUuid,
			boardId: "nope",
		});
		expect(badBoard).toMatchObject({
			isError: true,
			payload: { code: "BOARD_NOT_FOUND" },
		});
		expect(focusRequests).toHaveLength(1);
	});

	it("passes a dirty editor's refusal through as a normal result", async () => {
		const { call } = await open({
			focus: () => ({
				status: "blocked_dirty",
				message: "dirty",
				server,
				clientId: "tab-a",
				outcome: null,
			}),
		});
		const result = await call("editor_focus", {
			designFileId: trickroomMcpTestDesignUuid,
		});
		expect(result.isError).toBeFalsy();
		expect(result.payload).toMatchObject({
			status: "blocked_dirty",
			message: expect.stringContaining("unsaved changes"),
		});
	});

	it("reports no_server against a real, empty Trickroom home", async () => {
		const home = await mkdtemp(
			path.join(process.cwd(), ".tmp-trickroom-mcp-editor-home-"),
		);
		homes.push(home);
		const fixture = await createTrickroomMcpProjectFixture();
		fixtures.push(fixture);
		const session = await createTrickroomMcpTestClient({
			...(await fixture.readMcpContext()),
			trickroomHome: home,
		});
		sessions.push(session);

		for (const [name, args] of [
			["editor_context", {}],
			["editor_focus", { designFileId: trickroomMcpTestDesignUuid }],
		] as const) {
			const result = await session.client.callTool({ name, arguments: args });
			expect(result.isError, name).toBeFalsy();
			expect(toolPayload(result), name).toMatchObject({ status: "no_server" });
		}
	});
});
