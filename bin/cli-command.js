export const resolveTrickroomCommand = (argv = process.argv) => {
	const command = argv[2];

	if (command === "mcp") {
		return { command: "mcp", argv };
	}

	if (command === "serve") {
		return {
			command: "serve",
			argv: [...argv.slice(0, 2), ...argv.slice(3)],
		};
	}

	if (command === "install-browser") {
		return { command: "install-browser", args: argv.slice(3) };
	}

	if (command === "migrate") {
		return { command: "migrate", args: argv.slice(3) };
	}

	if (command === undefined || command.startsWith("--")) {
		return { command: "serve", argv };
	}

	throw new Error(
		`Unknown command "${command}". Use "trickroom serve [project]", "trickroom mcp", "trickroom migrate [project]" or "trickroom install-browser".`,
	);
};
