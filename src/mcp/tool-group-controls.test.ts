import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { writeTrickroomSettings } from "../app-state/settings";
import {
	createTrickroomMcpProjectFixture,
	createTrickroomMcpTestClient,
	type TrickroomMcpClientSession,
	type TrickroomMcpProjectFixture,
} from "./test-support";
import { MCP_TOOL_NAMES } from "./tool-groups";

describe("MCP tool group controls", () => {
	const fixtures: TrickroomMcpProjectFixture[] = [];
	const sessions: TrickroomMcpClientSession[] = [];
	const tempHomes: string[] = [];

	afterEach(async () => {
		await Promise.all(sessions.splice(0).map((session) => session.close()));
		await Promise.all(fixtures.splice(0).map((fixture) => fixture.cleanup()));
		await Promise.all(tempHomes.splice(0).map((home) => rm(home, { force: true, recursive: true })));
	});

	it("maps every registered MCP tool to a group", () => {
		expect(MCP_TOOL_NAMES.length).toBe(66);
	});

	it("hides disabled tool groups from listTools", async () => {
		const trickroomHome = await mkdtemp(
			path.join(os.tmpdir(), "trickroom-mcp-settings-home-"),
		);
		tempHomes.push(trickroomHome);
		await mkdir(trickroomHome, { recursive: true });
		await writeTrickroomSettings(
			{
				version: 1,
				mcp: {
					toolGroups: {
						projects: true,
						designRead: true,
						designWrite: false,
						designValidation: true,
						registry: true,
						designSystems: true,
						systemComponents: true,
					},
				},
			},
			trickroomHome,
		);

		const fixture = await createTrickroomMcpProjectFixture();
		fixtures.push(fixture);
		const context = {
			...(await fixture.readMcpContext()),
			trickroomHome,
		};
		const session = await createTrickroomMcpTestClient(context);
		sessions.push(session);

		const listToolsResult = await session.client.listTools();
		const toolNames = listToolsResult.tools.map((tool) => tool.name);
		expect(toolNames).toContain("readDesignFile");
		expect(toolNames).not.toContain("addElement");
		expect(toolNames).not.toContain("deleteElement");
	});
});
