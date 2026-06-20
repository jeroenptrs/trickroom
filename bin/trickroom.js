#!/usr/bin/env node
import { spawn } from "node:child_process";
import { changeProjectRoot } from "./project-root.js";

const silent = process.argv.includes("--silent");
const argv = silent
	? process.argv.filter((arg, index) => index < 2 || arg !== "--silent")
	: process.argv;

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

changeProjectRoot(argv);

const runtime = await import("../dist/index.js");

if (!silent && typeof runtime.serverPort === "number") {
	openBrowser(`http://localhost:${runtime.serverPort}`);
}
