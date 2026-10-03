import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { McpToolGroupSettings } from "../mcp/tool-groups";
import {
	createDefaultTrickroomSettings,
	getTrickroomSettingsPath,
	readTrickroomSettings,
	TrickroomSettingsError,
	updateMcpToolGroupSettings,
	writeTrickroomSettings,
} from "./settings";

describe("trickroom app settings", () => {
	const tempHomes: string[] = [];

	afterEach(async () => {
		await Promise.all(
			tempHomes
				.splice(0)
				.map((home) => rm(home, { force: true, recursive: true })),
		);
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
					} as McpToolGroupSettings,
				},
			},
			trickroomHome,
		);

		const settings = await readTrickroomSettings(trickroomHome);
		expect(settings.mcp.toolGroups.designRead).toBe(false);
		expect(settings.mcp.toolGroups.designWrite).toBe(true);
	});

	const writeRawSettings = (trickroomHome: string, value: unknown) =>
		writeFile(getTrickroomSettingsPath(trickroomHome), JSON.stringify(value));

	it("reads settings files without a server section", async () => {
		const trickroomHome = await createHome();
		await writeRawSettings(trickroomHome, createDefaultTrickroomSettings());

		const settings = await readTrickroomSettings(trickroomHome);
		expect(settings).toEqual(createDefaultTrickroomSettings());
		expect(settings).not.toHaveProperty("server");
	});

	it("reads server.publicHost", async () => {
		const trickroomHome = await createHome();
		await writeRawSettings(trickroomHome, {
			...createDefaultTrickroomSettings(),
			server: { publicHost: "devbox.local" },
		});

		const settings = await readTrickroomSettings(trickroomHome);
		expect(settings.server).toEqual({ publicHost: "devbox.local" });
	});

	it.each([
		["a string", "devbox.local"],
		["a non-string publicHost", { publicHost: 42 }],
		["a non-string publicUrl", { publicUrl: ["https://devbox.example"] }],
		["an unknown key", { publicHost: "devbox.local", port: 8080 }],
	])("rejects a server section with %s", async (_label, server) => {
		const trickroomHome = await createHome();
		await writeRawSettings(trickroomHome, {
			...createDefaultTrickroomSettings(),
			server,
		});

		const read = readTrickroomSettings(trickroomHome);
		await expect(read).rejects.toBeInstanceOf(TrickroomSettingsError);
		await expect(read).rejects.toThrow(/settings at .* are invalid/);
	});

	it("reads and preserves server.publicUrl alongside publicHost", async () => {
		const trickroomHome = await createHome();
		const server = {
			publicHost: "devbox.local",
			publicUrl: "https://devbox.example",
		};
		await writeRawSettings(trickroomHome, {
			...createDefaultTrickroomSettings(),
			server,
		});

		expect((await readTrickroomSettings(trickroomHome)).server).toEqual(server);
		await updateMcpToolGroupSettings({ designWrite: false }, trickroomHome);
		const onDisk = JSON.parse(
			await readFile(getTrickroomSettingsPath(trickroomHome), "utf8"),
		);
		expect(onDisk.server).toEqual(server);
	});

	it("preserves server.publicHost when toggling MCP tool groups", async () => {
		const trickroomHome = await createHome();
		await writeRawSettings(trickroomHome, {
			...createDefaultTrickroomSettings(),
			server: { publicHost: "devbox.local" },
		});

		const updated = await updateMcpToolGroupSettings(
			{ registry: false },
			trickroomHome,
		);
		expect(updated.server).toEqual({ publicHost: "devbox.local" });
		expect(updated.mcp.toolGroups.registry).toBe(false);

		const onDisk = JSON.parse(
			await readFile(getTrickroomSettingsPath(trickroomHome), "utf8"),
		);
		expect(onDisk.server).toEqual({ publicHost: "devbox.local" });
	});
});
