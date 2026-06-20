import type { Writable } from "node:stream";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
	readMcpEnabledProjectContext,
	TrickroomProjectConfigError,
} from "../project";
import { createTrickroomMcpServer } from "./server";

export type StartTrickroomMcpStdioServerOptions = {
	stderr?: Writable;
};

export const createTrickroomMcpStdioTransport = () =>
	new StdioServerTransport(process.stdin, process.stdout);

export const startTrickroomMcpStdioServer = async () => {
	const context = await readMcpEnabledProjectContext();
	const server = createTrickroomMcpServer(context);
	const transport = createTrickroomMcpStdioTransport();

	await server.connect(transport);

	return {
		context,
		server,
		transport,
	};
};

export const runTrickroomMcpStdioServer = async (
	options: StartTrickroomMcpStdioServerOptions = {},
) => {
	const stderr = options.stderr ?? process.stderr;

	try {
		await startTrickroomMcpStdioServer();
	} catch (error) {
		if (error instanceof TrickroomProjectConfigError) {
			stderr.write(`${error.message}\n`);
			return 1;
		}

		throw error;
	}

	return 0;
};

export const main = async () => {
	try {
		process.exitCode = await runTrickroomMcpStdioServer();
	} catch (error) {
		const message =
			error instanceof Error ? error.stack ?? error.message : String(error);
		process.stderr.write(`${message}\n`);
		process.exitCode = 1;
	}
};
