#!/usr/bin/env node
import { spawn } from "node:child_process";
import { resolveTrickroomCommand } from "./cli-command.js";
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

const runServer = async (argv) => {
	let serverOptions;
	try {
		serverOptions = configureServerOptions(argv);
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
		return;
	}

	setInitialProjectRoot(serverOptions.argv);
	process.env.TRICKROOM_CLI_MANAGED_OUTPUT = "1";

	const runtime = await import("../dist/index.js");
	let ready;
	if (runtime.serverReady && typeof runtime.serverReady.then === "function") {
		ready = await runtime.serverReady;
	}

	if (!ready) {
		const port =
			typeof runtime.serverPort === "number"
				? runtime.serverPort
				: serverOptions.port;
		const url =
			typeof runtime.serverUrl === "string"
				? runtime.serverUrl
				: `http://${serverOptions.host}:${port}/`;
		ready = {
			type: "trickroom:server-ready",
			version: 1,
			host: serverOptions.host,
			port,
			url,
			token: serverOptions.token,
			authenticated: serverOptions.sessionAuthEnabled,
		};
	}

	process.stdout.write(`${JSON.stringify(ready)}\n`);

	if (!serverOptions.silent) {
		const displayUrl = new URL(ready.url);
		displayUrl.search = "";
		process.stderr.write(
			`Trickroom ready at ${displayUrl.toString()}${ready.authenticated ? " (session auth enabled)" : ""}\n`,
		);
	}

	if (!serverOptions.noOpen) {
		openBrowser(ready.url);
	}
};

let command;
try {
	command = resolveTrickroomCommand(process.argv);
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
}

if (command?.command === "mcp") {
	await runMcp();
} else if (command?.command === "serve") {
	await runServer(command.argv);
}
