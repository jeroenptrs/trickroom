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
		expect(all.structuredContent).toMatchObject({
			totalCount: 3,
			matchedCount: 3,
			returnedCount: 3,
			truncated: false,
		});

		const arrows = await session.client.callTool({
			name: "listSystemIcons",
			arguments: { systemName: "Core", query: "arrow", limit: 1 },
		});
		expect(arrows.structuredContent).toMatchObject({
			totalCount: 3,
			matchedCount: 2,
			returnedCount: 1,
			truncated: true,
		});
		expect(
			(arrows.structuredContent as { icons: unknown[] }).icons,
		).toHaveLength(1);

		const assets = await session.client.callTool({
			name: "listSystemAssets",
			arguments: { systemName: "Core", query: "hero" },
		});
		expect(assets.structuredContent).toMatchObject({
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
		const allContent = all.structuredContent as {
			totalCount: number;
			tokens: unknown[];
		};
		expect(allContent.totalCount).toBe(allContent.tokens.length);

		const brand = await session.client.callTool({
			name: "listDesignTokens",
			arguments: {
				designFileId: trickroomMcpTestDesignUuid,
				domain: "color",
				query: "brand",
				limit: 1,
			},
		});
		const brandContent = brand.structuredContent as {
			matchedCount: number;
			returnedCount: number;
			truncated: boolean;
			tokens: Array<{ name: string; domain: string }>;
			domains: Record<string, unknown>;
		};
		expect(brandContent).toMatchObject({
			matchedCount: 2,
			returnedCount: 1,
			truncated: true,
		});
		expect(brandContent.tokens[0]).toMatchObject({ domain: "color" });
		expect(brandContent.tokens[0].name).toContain("brand");
		expect(Object.keys(brandContent.domains)).toEqual(["color"]);

		const unknownDomain = await session.client.callTool({
			name: "listDesignTokens",
			arguments: { designFileId: trickroomMcpTestDesignUuid, domain: "colour" },
		});
		expect(unknownDomain.isError).toBe(true);
		expect(unknownDomain.structuredContent).toMatchObject({
			code: "UNKNOWN_TOKEN_DOMAIN",
			suggestions: ["color"],
		});
	});
});
