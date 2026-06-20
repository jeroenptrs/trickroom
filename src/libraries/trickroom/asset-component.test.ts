import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDesignDiagnostics } from "../../mcp/diagnostics";
import type { TrickroomMcpServerContext } from "../../mcp/server";
import { applyAddElement } from "../../services/design-transform-service";
import type { TrickroomDesign } from "../../types";
import { writeAssetManifest } from "../../utils/asset-manifest-service";
import { assetIdProp } from "../../utils/resource-props";

describe("trickroom asset component", () => {
	let projectRoot: string;

	beforeEach(async () => {
		projectRoot = await mkdtemp(
			path.join(process.cwd(), ".tmp-trickroom-asset-component-"),
		);
	});

	afterEach(async () => {
		await rm(projectRoot, { force: true, recursive: true });
	});

	it("serializes as a leaf node with an asset id instance prop", () => {
		const design = {
			name: "Asset Design",
			systemName: "Core",
			boards: [],
		} satisfies TrickroomDesign;

		const result = applyAddElement(design, {
			parentId: null,
			index: 0,
			library: "trickroom",
			component: "asset",
			props: {
				[assetIdProp]: "ast_hero",
				alt: "Hero",
			},
		});

		expect(result.design.boards[0]).toMatchObject({
			props: {
				"data-trickroom-component": "asset",
				"data-trickroom-role": "leaf",
				[assetIdProp]: "ast_hero",
				alt: "Hero",
			},
			children: [],
		});
		expect(result.design.boards[0].props).not.toHaveProperty("objectFit");
		expect(result.design.boards[0].props).not.toHaveProperty("objectPosition");
		expect(result.design.boards[0].props).not.toHaveProperty("loading");
		expect(result.design.boards[0].props).not.toHaveProperty("decoding");
	});

	it("reports unknown asset ids against the linked system manifest", async () => {
		await writeAssetManifest(projectRoot, "Core", {
			version: 1,
			metadata: { updatedAt: "2026-05-15T00:00:00.000Z" },
			assets: {},
		});
		const context = {
			projectRoot,
			config: {
				name: "Asset Project",
				systems: { Core: "src/index.css" },
			},
		} as TrickroomMcpServerContext;
		const design = {
			name: "Asset Design",
			systemName: "Core",
			boards: [
				{
					id: "asset",
					props: {
						"data-trickroom-name": "Hero",
						"data-trickroom-library": "trickroom",
						"data-trickroom-component": "asset",
						"data-trickroom-role": "leaf",
						[assetIdProp]: "ast_missing",
					},
					children: [],
				},
			],
		} satisfies TrickroomDesign;

		const diagnostics = await getDesignDiagnostics(context, design);

		expect(diagnostics.issues).toContainEqual(
			expect.objectContaining({
				severity: "error",
				code: "UNKNOWN_ASSET_ID",
				elementId: "asset",
			}),
		);
	});

	it("accepts asset ids that exist in the linked system manifest", async () => {
		await writeAssetManifest(projectRoot, "Core", {
			version: 1,
			metadata: {
				systemName: "Core",
				updatedAt: "2026-05-15T00:00:00.000Z",
			},
			assets: {
				ast_hero: {
					name: "Hero",
					kind: "image",
					sourcePath: "src/assets/hero.png",
					mimeType: "image/png",
					createdAt: "2026-05-15T00:00:00.000Z",
					updatedAt: "2026-05-15T00:00:00.000Z",
				},
			},
		});
		const context = {
			projectRoot,
			config: {
				name: "Asset Project",
				systems: { Core: "src/index.css" },
			},
		} as TrickroomMcpServerContext;
		const design = {
			name: "Asset Design",
			systemName: "Core",
			boards: [
				{
					id: "asset",
					props: {
						"data-trickroom-name": "Hero",
						"data-trickroom-library": "trickroom",
						"data-trickroom-component": "asset",
						"data-trickroom-role": "leaf",
						[assetIdProp]: "ast_hero",
					},
					children: [],
				},
			],
		} satisfies TrickroomDesign;

		const diagnostics = await getDesignDiagnostics(context, design);

		expect(diagnostics.issues).not.toContainEqual(
			expect.objectContaining({ code: "UNKNOWN_ASSET_ID" }),
		);
	});

	it("still validates legacy image-behavior props for existing designs", async () => {
		await writeAssetManifest(projectRoot, "Core", {
			version: 1,
			metadata: {
				systemName: "Core",
				updatedAt: "2026-05-15T00:00:00.000Z",
			},
			assets: {
				ast_hero: {
					name: "Hero",
					kind: "image",
					sourcePath: "src/assets/hero.png",
					mimeType: "image/png",
					createdAt: "2026-05-15T00:00:00.000Z",
					updatedAt: "2026-05-15T00:00:00.000Z",
				},
			},
		});
		const context = {
			projectRoot,
			config: {
				name: "Asset Project",
				systems: { Core: "src/index.css" },
			},
		} as TrickroomMcpServerContext;
		const design = {
			name: "Asset Design",
			systemName: "Core",
			boards: [
				{
					id: "asset",
					props: {
						"data-trickroom-name": "Hero",
						"data-trickroom-library": "trickroom",
						"data-trickroom-component": "asset",
						"data-trickroom-role": "leaf",
						[assetIdProp]: "ast_hero",
						alt: "Hero",
						objectFit: "cover",
						objectPosition: "center",
						loading: "lazy",
						decoding: "async",
					},
					children: [],
				},
			],
		} satisfies TrickroomDesign;

		const diagnostics = await getDesignDiagnostics(context, design);

		expect(diagnostics.issues).not.toContainEqual(
			expect.objectContaining({ code: "INVALID_PROP_KEY" }),
		);
	});
});
