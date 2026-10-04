import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

export const INSTALL_BROWSER_USAGE = `Usage: trickroom install-browser [--with-deps]
       trickroom install-browser --executable-path <path>

Without options, downloads Playwright's Chromium for MCP screenshots.
--with-deps            Also install the system libraries Chromium needs (Linux, may need sudo).
--executable-path <p>  Use an installed Chrome/Chromium instead: saves it as
                       screenshot.executablePath in the Trickroom settings file.`;

export const parseInstallBrowserArgs = (args) => {
	const options = { withDeps: false, executablePath: null, help: false };
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (arg === "--help" || arg === "-h") {
			options.help = true;
		} else if (arg === "--with-deps") {
			options.withDeps = true;
		} else if (arg === "--executable-path") {
			const value = args[index + 1];
			if (!value || value.startsWith("--")) {
				throw new Error("--executable-path needs a path.");
			}
			options.executablePath = value;
			index += 1;
		} else if (arg.startsWith("--executable-path=")) {
			options.executablePath = arg.slice("--executable-path=".length);
			if (!options.executablePath) {
				throw new Error("--executable-path needs a path.");
			}
		} else {
			throw new Error(`Unknown option "${arg}".\n${INSTALL_BROWSER_USAGE}`);
		}
	}
	return options;
};

const resolveTrickroomHome = (env = process.env) =>
	env.TRICKROOM_HOME?.trim()
		? path.resolve(env.TRICKROOM_HOME)
		: path.join(os.homedir(), ".trickroom");

/**
 * Sets screenshot.executablePath in settings.json and keeps every other key.
 * Refuses to rewrite a file it cannot parse rather than replace it.
 */
export const saveScreenshotExecutablePath = async (
	executablePath,
	trickroomHome = resolveTrickroomHome(),
) => {
	const settingsPath = path.join(trickroomHome, "settings.json");
	let settings = { version: 1, mcp: { toolGroups: {} } };
	try {
		settings = JSON.parse(await readFile(settingsPath, "utf8"));
	} catch (error) {
		if (error?.code !== "ENOENT") {
			throw new Error(
				`Could not read ${settingsPath}; fix or remove it, then retry.`,
			);
		}
	}
	if (typeof settings !== "object" || settings === null) {
		throw new Error(`${settingsPath} is not a settings object.`);
	}
	const next = {
		...settings,
		screenshot: { ...settings.screenshot, executablePath },
	};
	await mkdir(trickroomHome, { recursive: true });
	const tempPath = `${settingsPath}.${process.pid}.tmp`;
	await writeFile(tempPath, `${JSON.stringify(next, null, "\t")}\n`);
	await rename(tempPath, settingsPath);
	return settingsPath;
};

/** playwright-core from the project first, then from Trickroom's own install. */
export const resolvePlaywrightCore = (cwd = process.cwd()) => {
	for (const base of [path.join(cwd, "package.json"), import.meta.url]) {
		try {
			const packageJson = createRequire(base).resolve(
				"playwright-core/package.json",
			);
			return path.dirname(packageJson);
		} catch {
			// Try the next location.
		}
	}
	return null;
};

const run = (command, args) =>
	new Promise((resolve) => {
		const child = spawn(command, args, { stdio: "inherit" });
		child.on("error", () => resolve(1));
		child.on("exit", (code) => resolve(code ?? 1));
	});

export const runInstallBrowser = async (args) => {
	let options;
	try {
		options = parseInstallBrowserArgs(args);
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		return 1;
	}
	if (options.help) {
		console.log(INSTALL_BROWSER_USAGE);
		return 0;
	}

	if (options.executablePath) {
		const executablePath = path.resolve(options.executablePath);
		if (!existsSync(executablePath)) {
			console.error(`No file at "${executablePath}".`);
			return 1;
		}
		try {
			const settingsPath = await saveScreenshotExecutablePath(executablePath);
			console.log(
				`Saved screenshot.executablePath = ${executablePath} in ${settingsPath}. MCP screenshots use it from the next capture.`,
			);
			return 0;
		} catch (error) {
			console.error(error instanceof Error ? error.message : String(error));
			return 1;
		}
	}

	const playwrightDir = resolvePlaywrightCore();
	if (!playwrightDir) {
		console.error(
			"playwright-core is not installed. Add it to the project (for example `npm install -D playwright-core`), then run `npx trickroom install-browser` again.",
		);
		return 1;
	}
	const code = await run(process.execPath, [
		path.join(playwrightDir, "cli.js"),
		"install",
		...(options.withDeps ? ["--with-deps"] : []),
		"chromium",
	]);
	if (code !== 0) {
		console.error(
			"Chromium download failed. If Chrome or Chromium is already installed, run `npx trickroom install-browser --executable-path <path>` instead.",
		);
		return code;
	}
	console.log("Chromium is installed; MCP screenshots will find it.");
	return 0;
};
