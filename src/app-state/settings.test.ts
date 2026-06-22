import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	createDefaultTrickroomSettings,
	readTrickroomSettings,
	updateMcpToolGroupSettings,
	writeTrickroomSettings,
} from "./settings";

describe("trickroom app settings", () => {
	const tempHomes: string[] = [];

	afterEach(async () => {
		await Promise.all(tempHomes.splice(0).map((home) => rm(home, { force: true, recursive: true })));
	});

	const createHome = async () => {
		const trickroomHome = await mkdtemp(
			path.join(process.cwd(), ".tmp-trickroom-settings-home-"),
		);
		await mkdir(trickroomHome, { recursive: true });
		tempHomes.push(trickroomHome);
		return trickroomHome;
	};

	it("returns defaults when settings.json is missing", async () => {
		const trickroomHome = await createHome();
		const settings = await readTrickroomSettings(trickroomHome);

		expect(settings).toEqual(createDefaultTrickroomSettings());
	});

	it("persists MCP tool group toggles", async () => {
		const trickroomHome = await createHome();
		const updated = await updateMcpToolGroupSettings(
			{ designWrite: false, registry: false },
			trickroomHome,
		);

		expect(updated.mcp.toolGroups.designWrite).toBe(false);
		expect(updated.mcp.toolGroups.registry).toBe(false);
		expect(updated.mcp.toolGroups.designRead).toBe(true);

		const reread = await readTrickroomSettings(trickroomHome);
		expect(reread).toEqual(updated);
	});

	it("fills missing groups when reading partial settings files", async () => {
		const trickroomHome = await createHome();
		await writeTrickroomSettings(
			{
				version: 1,
				mcp: {
					toolGroups: {
						projects: true,
						designRead: false,
						designWrite: true,
						designValidation: true,
						registry: true,
						designSystems: true,
						systemComponents: true,
					},
				},
			},
			trickroomHome,
		);

		const settings = await readTrickroomSettings(trickroomHome);
		expect(settings.mcp.toolGroups.designRead).toBe(false);
		expect(settings.mcp.toolGroups.designWrite).toBe(true);
	});
});
