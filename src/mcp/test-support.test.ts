import { readFile } from "node:fs/promises";
import path from "node:path";
import {
	type CallToolResult,
	CallToolResultSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { afterEach, describe, expect, it } from "vitest";
import { readDomainTokens } from "../utils/tailwind-token-store";
import {
	createTrickroomMcpProjectFixture,
	createTrickroomMcpTestClient,
	type TrickroomMcpProjectFixture,
	trickroomMcpTestDesignUuid,
} from "./test-support";

describe("trickroom MCP test support", () => {
	const fixtures: TrickroomMcpProjectFixture[] = [];

	afterEach(async () => {
		await Promise.all(fixtures.splice(0).map((fixture) => fixture.cleanup()));
	});

	const createFixture = async () => {
		const fixture = await createTrickroomMcpProjectFixture();
		fixtures.push(fixture);
		return fixture;
	};

	it("creates MCP-enabled project, system, design, and token snapshot fixtures", async () => {
		const fixture = await createFixture();

		await expect(
			readFile(fixture.configPath, "utf8").then(JSON.parse),
		).resolves.toMatchObject({
			name: "Harness Project",
			mcp: {
				enabled: true,
			},
			systems: {
				Core: "src/index.css",
			},
		});
		await expect(
			readFile(path.join(fixture.projectRoot, "src", "index.css"), "utf8"),
		).resolves.toContain("--color-brand-500");
		await expect(
			fixture.designFileService.listDesignSummaries(),
		).resolves.toEqual([
			expect.objectContaining({
				uuid: trickroomMcpTestDesignUuid,
				name: "Harness Design",
				systemName: "Core",
				revision: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
			}),
		]);

		const tokenSnapshot = await readDomainTokens(fixture.projectRoot, "Core");

		expect(tokenSnapshot).toMatchObject({
			metadata: {
				cssPath: "src/index.css",
				tailwindBaselineVersion: "test-baseline",
				reviewRequired: false,
			},
			domains: {
				color: {
					tokens: {
						"brand-500": "#2563eb",
					},
					overrides: ["brand-500"],
				},
			},
		});
	});

	it("connects an SDK client to the current MCP server shape", async () => {
		const fixture = await createFixture();
		const context = await fixture.readMcpContext();
		const session = await createTrickroomMcpTestClient(context);

		try {
			const tools = await session.client.listTools();

			expect(tools.tools).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						name: "trickroom_project_info",
						title: "Project Info",
						annotations: expect.objectContaining({
							readOnlyHint: true,
							openWorldHint: false,
						}),
					}),
				]),
			);

			const result = (await session.client.callTool(
				{
					name: "trickroom_project_info",
					arguments: {},
				},
				CallToolResultSchema,
			)) as CallToolResult;
			const textContent = result.content.find(
				(content) => content.type === "text",
			);

			expect(textContent).toBeDefined();
			expect(JSON.parse(textContent?.text ?? "{}")).toMatchObject({
				projectName: "Harness Project",
				projectRoot: fixture.projectRoot,
				configPath: fixture.configPath,
				mcpEnabled: true,
				configuredSystems: [
					expect.objectContaining({
						systemId: expect.stringMatching(/^sys_/),
						systemName: "Core",
						cssPath: "src/index.css",
					}),
				],
			});
		} finally {
			await session.close();
		}
	});
});
