#!/usr/bin/env node
import { spawn } from "node:child_process";
import { setInitialProjectRoot } from "./project-root.js";
import { configureServerOptions } from "./server-options.js";

const silent = process.argv.includes("--silent");
const rawArgv = silent
	? process.argv.filter((arg, index) => index < 2 || arg !== "--silent")
	: process.argv;
let serverOptions;
try {
	serverOptions = configureServerOptions(rawArgv);
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
}

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

setInitialProjectRoot(serverOptions.argv);

const runtime = await import("../dist/index.js");
if (runtime.serverReady && typeof runtime.serverReady.then === "function") {
	await runtime.serverReady;
}

if (serverOptions.sessionAuthEnabled && typeof runtime.serverUrl === "string") {
	console.log(`Shared URL: ${runtime.serverUrl}`);
}

if (!silent) {
	if (typeof runtime.serverUrl === "string") {
		openBrowser(runtime.serverUrl);
	} else if (typeof runtime.serverPort === "number") {
		openBrowser(`http://localhost:${runtime.serverPort}`);
	}
}
