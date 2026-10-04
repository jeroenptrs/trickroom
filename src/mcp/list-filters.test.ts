import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { registerAsset } from "../utils/asset-manifest-service";
import { writeDesignSystemManifest } from "../utils/design-system-store";
import { syncIconManifest } from "../utils/icon-manifest-service";
import {
	createTrickroomMcpProjectFixture,
	createTrickroomMcpTestClient,
	type TrickroomMcpClientSession,
	type TrickroomMcpProjectFixture,
	toolPayload,
	trickroomMcpTestDesign,
	trickroomMcpTestDesignUuid,
} from "./test-support";

const svg =
	'<svg viewBox="0 0 24 24" fill="none"><path d="M4 12h16" stroke="currentColor" stroke-width="2"/></svg>';
const png = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
	"base64",
);

describe("bounded MCP catalog lists", () => {
	const fixtures: TrickroomMcpProjectFixture[] = [];
	const sessions: TrickroomMcpClientSession[] = [];

	afterEach(async () => {
		await Promise.all(sessions.splice(0).map((session) => session.close()));
		await Promise.all(fixtures.splice(0).map((fixture) => fixture.cleanup()));
	});

	const createSession = async () => {
		const fixture = await createTrickroomMcpProjectFixture({
			designs: { [trickroomMcpTestDesignUuid]: trickroomMcpTestDesign },
			tokenSnapshots: [
				{
					systemName: "Core",
					cssPath: "src/index.css",
					tokens: {
						"brand-500": "#2563eb",
						"brand-600": "#1d4ed8",
						"accent-500": "#f97316",
					},
					overrides: ["brand-500", "brand-600", "accent-500"],
					reviewRequired: false,
				},
			],
		});
		fixtures.push(fixture);
		const session = await createTrickroomMcpTestClient(
			await fixture.readMcpContext(),
		);
		sessions.push(session);
		return { fixture, session };
	};

	it("filters and caps system icons and assets while reporting totals", async () => {
		const { fixture, session } = await createSession();
		const iconsDir = path.join(fixture.projectRoot, "src", "icons");
		await mkdir(iconsDir, { recursive: true });
		for (const name of ["arrow-left", "arrow-right", "search"]) {
			await writeFile(path.join(iconsDir, `${name}.svg`), svg);
		}
		await writeDesignSystemManifest(fixture.projectRoot, "Core", {
			iconFolderPaths: ["src/icons"],
		});
		await syncIconManifest(fixture.projectRoot, "Core");
		const assetsDir = path.join(fixture.projectRoot, "src", "assets");
		await mkdir(assetsDir, { recursive: true });
		for (const name of ["hero", "avatar"]) {
			await writeFile(path.join(assetsDir, `${name}.png`), png);
			await registerAsset(fixture.projectRoot, "Core", {
				name,
				sourcePath: `src/assets/${name}.png`,
			});
		}

		const all = await session.client.callTool({
			name: "listSystemIcons",
			arguments: { systemName: "Core" },
		});
		expect(toolPayload(all)).toMatchObject({
			totalCount: 3,
			matchedCount: 3,
			returnedCount: 3,
			truncated: false,
		});

		const arrows = await session.client.callTool({
			name: "listSystemIcons",
			arguments: { systemName: "Core", query: "arrow", limit: 1 },
		});
		expect(toolPayload(arrows)).toMatchObject({
			totalCount: 3,
			matchedCount: 2,
			returnedCount: 1,
			truncated: true,
			next: { offset: 1 },
			icons: [{ id: "src/arrow-left" }],
		});

		const nextArrows = await session.client.callTool({
			name: "listSystemIcons",
			arguments: { systemName: "Core", query: "arrow", limit: 1, offset: 1 },
		});
		expect(toolPayload(nextArrows)).toMatchObject({
			matchedCount: 2,
			returnedCount: 1,
			offset: 1,
			truncated: false,
			icons: [{ id: "src/arrow-right" }],
		});
		expect(toolPayload(nextArrows)).not.toHaveProperty("next");

		const assets = await session.client.callTool({
			name: "listSystemAssets",
			arguments: { systemName: "Core", query: "hero" },
		});
		expect(toolPayload(assets)).toMatchObject({
			totalCount: 2,
			matchedCount: 1,
			assets: [expect.objectContaining({ name: "hero" })],
		});
	});

	it("filters design tokens by domain, query, and limit", async () => {
		const { session } = await createSession();

		const all = await session.client.callTool({
			name: "listDesignTokens",
			arguments: { designFileId: trickroomMcpTestDesignUuid },
		});
		const allContent = toolPayload(all) as {
			totalCount: number;
			returnedCount: number;
			tokens: Record<string, Record<string, unknown>>;
		};
		expect(allContent.totalCount).toBe(allContent.returnedCount);
		expect(
			Object.values(allContent.tokens).reduce(
				(count, domainTokens) => count + Object.keys(domainTokens).length,
				0,
			),
		).toBe(allContent.returnedCount);

		const brand = await session.client.callTool({
			name: "listDesignTokens",
			arguments: {
				designFileId: trickroomMcpTestDesignUuid,
				domain: "color",
				query: "brand",
				limit: 1,
			},
		});
		const brandContent = toolPayload(brand) as {
			matchedCount: number;
			returnedCount: number;
			truncated: boolean;
			tokens: Record<string, Record<string, unknown>>;
			domains: Record<string, unknown>;
		};
		expect(brandContent).toMatchObject({
			matchedCount: 2,
			returnedCount: 1,
			truncated: true,
			next: { offset: 1 },
		});
		expect(Object.keys(brandContent.tokens)).toEqual(["color"]);
		expect(Object.keys(brandContent.tokens.color)[0]).toContain("brand");
		expect(Object.keys(brandContent.domains)).toEqual(["color"]);

		const unknownDomain = await session.client.callTool({
			name: "listDesignTokens",
			arguments: { designFileId: trickroomMcpTestDesignUuid, domain: "colour" },
		});
		expect(unknownDomain.isError).toBe(true);
		expect(toolPayload(unknownDomain)).toMatchObject({
			code: "UNKNOWN_TOKEN_DOMAIN",
			suggestions: ["color"],
		});
	});
});
