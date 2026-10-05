import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	parseInstallBrowserArgs,
	resolvePlaywrightCore,
	saveScreenshotExecutablePath,
} from "./install-browser.js";

describe("install-browser", () => {
	const homes = [];

	afterEach(async () => {
		await Promise.all(
			homes.splice(0).map((home) => rm(home, { recursive: true, force: true })),
		);
	});

	const createHome = async () => {
		const home = await mkdtemp(path.join(os.tmpdir(), "trickroom-browser-"));
		homes.push(home);
		return home;
	};

	it("parses options", () => {
		expect(parseInstallBrowserArgs([])).toEqual({
			withDeps: false,
			executablePath: null,
			help: false,
		});
		expect(
			parseInstallBrowserArgs(["--with-deps", "--executable-path", "/bin/x"]),
		).toMatchObject({ withDeps: true, executablePath: "/bin/x" });
		expect(
			parseInstallBrowserArgs(["--executable-path=/bin/y"]).executablePath,
		).toBe("/bin/y");
		expect(() => parseInstallBrowserArgs(["--executable-path"])).toThrow(
			/needs a path/,
		);
		expect(() => parseInstallBrowserArgs(["--force"])).toThrow(/Unknown/);
	});

	it("saves the executable path and keeps other settings", async () => {
		const home = await createHome();
		const settingsPath = path.join(home, "settings.json");
		await writeFile(
			settingsPath,
			JSON.stringify({
				version: 1,
				mcp: { toolGroups: { registry: false } },
				server: { publicHost: "devbox.local" },
			}),
		);

		await saveScreenshotExecutablePath("/usr/bin/chromium", home);

		expect(JSON.parse(await readFile(settingsPath, "utf8"))).toEqual({
			version: 1,
			mcp: { toolGroups: { registry: false } },
			server: { publicHost: "devbox.local" },
			screenshot: { executablePath: "/usr/bin/chromium" },
		});
	});

	it("creates a valid settings file when none exists", async () => {
		const home = await createHome();
		await saveScreenshotExecutablePath("/usr/bin/chromium", home);
		const { readTrickroomSettings } = await import("../src/app-state/settings");
		const settings = await readTrickroomSettings(home);
		expect(settings.screenshot).toEqual({
			executablePath: "/usr/bin/chromium",
		});
		expect(settings.mcp.toolGroups).toBeDefined();
	});

	it("refuses to overwrite an unreadable settings file", async () => {
		const home = await createHome();
		await writeFile(path.join(home, "settings.json"), "{not json");
		await expect(
			saveScreenshotExecutablePath("/usr/bin/chromium", home),
		).rejects.toThrow(/Could not read/);
		expect(await readFile(path.join(home, "settings.json"), "utf8")).toBe(
			"{not json",
		);
	});

	it("finds playwright-core", () => {
		expect(resolvePlaywrightCore()).toMatch(/playwright-core$/);
	});
});
