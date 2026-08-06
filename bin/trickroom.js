#!/usr/bin/env node
import { spawn } from "node:child_process";
import { setInitialProjectRoot } from "./project-root.js";
import { configureServerOptions } from "./server-options.js";

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

const runMcp = async () => {
	const positionalArgs = process.argv
		.slice(3)
		.filter((arg) => !arg.startsWith("--"));
	if (positionalArgs.length > 0) {
		console.error(
			"trickroom mcp does not accept positional arguments. Start it without positional arguments from the target project root, or use registerProject then selectProject for an explicit MCP session target.",
		);
		process.exitCode = 1;
		return;
	}

	const runtime = await import("../dist/mcp-stdio.js");
	await runtime.main();
};

const runServer = async () => {
	const silent = process.argv.includes("--silent");
	const rawArgv = silent
		? process.argv.filter((arg, index) => index < 2 || arg !== "--silent")
		: process.argv;
	let serverOptions;
	try {
		serverOptions = configureServerOptions(rawArgv);
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
		return;
	}

	setInitialProjectRoot(serverOptions.argv);

	const runtime = await import("../dist/index.js");
	if (runtime.serverReady && typeof runtime.serverReady.then === "function") {
		await runtime.serverReady;
	}

	if (
		serverOptions.sessionAuthEnabled &&
		typeof runtime.serverUrl === "string"
	) {
		console.log(`Shared URL: ${runtime.serverUrl}`);
	}

	if (!silent) {
		if (typeof runtime.serverUrl === "string") {
			openBrowser(runtime.serverUrl);
		} else if (typeof runtime.serverPort === "number") {
			openBrowser(`http://localhost:${runtime.serverPort}`);
		}
	}
};

if (process.argv[2] === "mcp") {
	await runMcp();
} else {
	await runServer();
}
