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
import { MCP_TOOL_GROUPS, MCP_TOOL_NAMES } from "./tool-groups";

describe("MCP tool group controls", () => {
	const fixtures: TrickroomMcpProjectFixture[] = [];
	const sessions: TrickroomMcpClientSession[] = [];
	const tempHomes: string[] = [];

	afterEach(async () => {
		await Promise.all(sessions.splice(0).map((session) => session.close()));
		await Promise.all(fixtures.splice(0).map((fixture) => fixture.cleanup()));
		await Promise.all(
			tempHomes
				.splice(0)
				.map((home) => rm(home, { force: true, recursive: true })),
		);
	});

	it("registers exactly the tools listed in the tool groups", async () => {
		const fixture = await createTrickroomMcpProjectFixture();
		fixtures.push(fixture);
		const session = await createTrickroomMcpTestClient(
			await fixture.readMcpContext(),
		);
		sessions.push(session);

		const listToolsResult = await session.client.listTools();
		const registered = listToolsResult.tools.map((tool) => tool.name).sort();
		expect(registered).toEqual([...MCP_TOOL_NAMES].sort());
	});

	it("assigns every tool to exactly one group", () => {
		const seen = new Set<string>();
		const duplicates: string[] = [];
		for (const group of MCP_TOOL_GROUPS) {
			for (const tool of group.tools) {
				if (seen.has(tool)) {
					duplicates.push(tool);
				}
				seen.add(tool);
			}
		}
		expect(duplicates).toEqual([]);
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
						memory: true,
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
		expect(toolNames).toContain("design_read");
		expect(toolNames).not.toContain("design_apply");
	});
});
