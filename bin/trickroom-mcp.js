#!/usr/bin/env node
const positionalArgs = process.argv
	.slice(2)
	.filter((arg) => !arg.startsWith("--"));
if (positionalArgs.length > 0) {
	console.error(
		"trickroom-mcp does not accept positional arguments. Start it without positional arguments from the target project root, or use registerProject then selectProject for an explicit MCP session target.",
	);
	process.exit(1);
}

const runtime = await import("../dist/mcp-stdio.js");

await runtime.main();
