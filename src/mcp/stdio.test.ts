import { mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { Writable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import {
	readMcpEnabledProjectContext,
	TrickroomProjectConfigError,
} from "../project";
import { createTrickroomMcpServer } from "./server";
import { runTrickroomMcpStdioServer } from "./stdio";

describe("trickroom MCP project gating", () => {
	const tempProjectRoots: string[] = [];

	afterEach(async () => {
		await Promise.all(
			tempProjectRoots.splice(0).map((projectRoot) =>
				rm(projectRoot, { force: true, recursive: true }),
			),
		);
	});

	const createProjectRoot = async () => {
		const projectRoot = await mkdtemp(
			path.join(process.cwd(), ".tmp-trickroom-mcp-test-"),
		);
		tempProjectRoots.push(projectRoot);
		return projectRoot;
	};

	it("rejects MCP startup when the project config is missing", async () => {
		const projectRoot = await createProjectRoot();

		await expect(readMcpEnabledProjectContext(projectRoot)).rejects.toMatchObject(
			{
				code: "CONFIG_NOT_FOUND",
			} satisfies Partial<TrickroomProjectConfigError>,
		);
	});

	it("rejects MCP startup when the project config is invalid", async () => {
		const projectRoot = await createProjectRoot();
		await writeFile(
			path.join(projectRoot, "trickroom.config.json"),
			JSON.stringify({ name: "Project", mcp: { enabled: "yes" } }),
			"utf8",
		);

		await expect(readMcpEnabledProjectContext(projectRoot)).rejects.toMatchObject(
			{
				code: "INVALID_CONFIG",
			} satisfies Partial<TrickroomProjectConfigError>,
		);
	});

	it("rejects MCP startup when the project config does not enable MCP", async () => {
		const projectRoot = await createProjectRoot();
		await writeFile(
			path.join(projectRoot, "trickroom.config.json"),
			JSON.stringify({ name: "Project" }),
			"utf8",
		);

		await expect(readMcpEnabledProjectContext(projectRoot)).rejects.toMatchObject(
			{
				code: "MCP_DISABLED",
			} satisfies Partial<TrickroomProjectConfigError>,
		);
	});

	it("creates the MCP server when the project enables MCP", async () => {
		const projectRoot = await createProjectRoot();
		await writeFile(
			path.join(projectRoot, "trickroom.config.json"),
			JSON.stringify({
				name: "Project",
				systems: {
					Core: "src/index.css",
				},
				mcp: {
					enabled: true,
				},
			}),
			"utf8",
		);

		const context = await readMcpEnabledProjectContext(projectRoot);
		const server = createTrickroomMcpServer(context);

		expect(server).toBeDefined();
	});

	it("prints a clear stderr message and exits non-zero when MCP is disabled", async () => {
		const projectRoot = await createProjectRoot();
		await writeFile(
			path.join(projectRoot, "trickroom.config.json"),
			JSON.stringify({ name: "Project", mcp: { enabled: false } }),
			"utf8",
		);

		const previousProjectDir = process.env.TRICKROOM_PROJECT_DIR;
		process.env.TRICKROOM_PROJECT_DIR = projectRoot;

		const chunks: string[] = [];
		const stderr = new Writable({
			write(chunk, _encoding, callback) {
				chunks.push(String(chunk));
				callback();
			},
		});

		try {
			await expect(runTrickroomMcpStdioServer({ stderr })).resolves.toBe(1);
		} finally {
			if (previousProjectDir === undefined) {
				delete process.env.TRICKROOM_PROJECT_DIR;
			} else {
				process.env.TRICKROOM_PROJECT_DIR = previousProjectDir;
			}
		}

		expect(chunks.join("")).toContain('Set "mcp.enabled" to true');
	});
});
