#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const resolveProjectDir = () => {
	const envProjectDir = process.env.TRICKROOM_PROJECT_DIR;
	const argProjectDir = process.argv[2];
	const projectDir = argProjectDir || envProjectDir;

	if (!projectDir) {
		return null;
	}

	return path.resolve(process.cwd(), projectDir);
};

const changeProjectRoot = () => {
	const resolvedProjectDir = resolveProjectDir();
	if (!resolvedProjectDir) {
		return;
	}

	let stat;
	try {
		stat = fs.statSync(resolvedProjectDir);
	} catch {
		console.error(
			`Project directory "${resolvedProjectDir}" does not exist or is not accessible.`,
		);
		process.exit(1);
	}

	if (!stat.isDirectory()) {
		console.error(`Project directory "${resolvedProjectDir}" is not a directory.`);
		process.exit(1);
	}

	process.env.TRICKROOM_PROJECT_DIR = resolvedProjectDir;
	process.chdir(resolvedProjectDir);
};

const openBrowser = (url) => {
	try {
		if (process.platform === "darwin") {
			const child = spawn("open", [url], { detached: true, stdio: "ignore" });
			child.on("error", () => undefined);
			child.unref();
			return;
		}

		if (process.platform === "win32") {
			const child = spawn("cmd", ["/c", "start", "", url], {
				detached: true,
				stdio: "ignore",
				windowsHide: true,
			});
			child.on("error", () => undefined);
			child.unref();
			return;
		}

		const child = spawn("xdg-open", [url], { detached: true, stdio: "ignore" });
		child.on("error", () => undefined);
		child.unref();
	} catch {
		// Ignore browser launch failures to keep server startup resilient.
	}
};

changeProjectRoot();

const runtime = await import("../dist/index.js");

if (typeof runtime.serverPort === "number") {
	openBrowser(`http://localhost:${runtime.serverPort}`);
}
