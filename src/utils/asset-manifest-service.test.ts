import {
	mkdir,
	mkdtemp,
	readFile,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	type AssetManifestError,
	readAssetManifest,
	registerAsset,
	resolveAssetSourceFilePath,
} from "./asset-manifest-service";
import { resolveDesignSystemAssetsPath } from "./design-system-store";

const tinyPng = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
	"base64",
);

describe("asset manifest service", () => {
	let projectRoot: string;

	beforeEach(async () => {
		projectRoot = await mkdtemp(
			path.join(process.cwd(), ".tmp-trickroom-assets-"),
		);
	});

	afterEach(async () => {
		await rm(projectRoot, { force: true, recursive: true });
	});

	it("registers project-relative raster assets under the system manifest", async () => {
		const imagePath = path.join(projectRoot, "src", "assets", "hero.png");
		await mkdir(path.dirname(imagePath), { recursive: true });
		await writeFile(imagePath, tinyPng);

		const result = await registerAsset(projectRoot, "Core", {
			name: "Hero Shot",
			sourcePath: "src/assets/hero.png",
			alt: "Product interface",
			now: "2026-05-15T00:00:00.000Z",
		});

		expect(result.assetId).toBe("ast_hero-shot");
		expect(result.asset).toMatchObject({
			name: "Hero Shot",
			kind: "image",
			sourcePath: "src/assets/hero.png",
			mimeType: "image/png",
			width: 1,
			height: 1,
			alt: "Product interface",
		});
		await expect(
			readFile(resolveDesignSystemAssetsPath(projectRoot, "Core"), "utf8"),
		).resolves.toContain("ast_hero-shot");
	});

	it("accepts missing files without blocking manifest registration", async () => {
		const result = await registerAsset(projectRoot, "Core", {
			assetId: "ast_missing",
			name: "Missing",
			sourcePath: "src/assets/missing.webp",
		});

		expect(result.asset).toMatchObject({
			sourcePath: "src/assets/missing.webp",
			mimeType: "image/webp",
		});
		expect(result.asset.width).toBeUndefined();
	});

	it("rejects source paths outside the project root", async () => {
		await expect(
			registerAsset(projectRoot, "Core", {
				name: "Outside",
				sourcePath: "../outside.png",
			}),
		).rejects.toMatchObject({
			code: "INVALID_ASSET_PATH",
		} satisfies Partial<AssetManifestError>);
	});

	it("rejects unsupported file types", async () => {
		await expect(
			registerAsset(projectRoot, "Core", {
				name: "Vector",
				sourcePath: "src/assets/icon.svg",
			}),
		).rejects.toMatchObject({
			code: "UNSUPPORTED_ASSET_TYPE",
		} satisfies Partial<AssetManifestError>);
	});

	it("rejects malicious paths when reading an existing manifest", async () => {
		const manifestPath = resolveDesignSystemAssetsPath(projectRoot, "Core");
		await mkdir(path.dirname(manifestPath), { recursive: true });
		await writeFile(
			manifestPath,
			JSON.stringify({
				version: 1,
				metadata: {
					systemName: "Core",
					updatedAt: "2026-05-15T00:00:00.000Z",
				},
				assets: {
					ast_bad: {
						name: "Bad",
						kind: "image",
						sourcePath: "../secret.png",
						mimeType: "image/png",
						createdAt: "2026-05-15T00:00:00.000Z",
						updatedAt: "2026-05-15T00:00:00.000Z",
					},
				},
			}),
			"utf8",
		);

		await expect(readAssetManifest(projectRoot, "Core")).rejects.toMatchObject({
			code: "INVALID_ASSET_PATH",
		} satisfies Partial<AssetManifestError>);
	});

	it("rejects duplicate normalized asset IDs in hand-edited manifests", async () => {
		const manifestPath = resolveDesignSystemAssetsPath(projectRoot, "Core");
		await mkdir(path.dirname(manifestPath), { recursive: true });
		await writeFile(
			manifestPath,
			JSON.stringify({
				version: 1,
				metadata: {
					systemName: "Core",
					updatedAt: "2026-05-15T00:00:00.000Z",
				},
				assets: {
					AST_HERO: {
						name: "Hero",
						kind: "image",
						sourcePath: "src/assets/hero.png",
						mimeType: "image/png",
						createdAt: "2026-05-15T00:00:00.000Z",
						updatedAt: "2026-05-15T00:00:00.000Z",
					},
					ast_hero: {
						name: "Hero Duplicate",
						kind: "image",
						sourcePath: "src/assets/hero-duplicate.png",
						mimeType: "image/png",
						createdAt: "2026-05-15T00:00:00.000Z",
						updatedAt: "2026-05-15T00:00:00.000Z",
					},
				},
			}),
			"utf8",
		);

		await expect(readAssetManifest(projectRoot, "Core")).rejects.toMatchObject({
			code: "INVALID_ASSET_MANIFEST",
		} satisfies Partial<AssetManifestError>);
	});

	it("rejects asset files that resolve outside the project through symlinks", async () => {
		const outsideRoot = await mkdtemp(
			path.join(process.cwd(), ".tmp-trickroom-assets-outside-"),
		);
		try {
			const outsideImagePath = path.join(outsideRoot, "secret.png");
			await writeFile(outsideImagePath, tinyPng);
			const linkPath = path.join(projectRoot, "src", "assets", "linked.png");
			await mkdir(path.dirname(linkPath), { recursive: true });
			await symlink(outsideImagePath, linkPath);
			await expect(
				registerAsset(projectRoot, "Core", {
					assetId: "ast_linked",
					name: "Linked",
					sourcePath: "src/assets/linked.png",
				}),
			).rejects.toMatchObject({
				code: "INVALID_ASSET_PATH",
			} satisfies Partial<AssetManifestError>);
		} finally {
			await rm(outsideRoot, { force: true, recursive: true });
		}
	});

	it("resolves asset file paths inside the project root", async () => {
		const result = await registerAsset(projectRoot, "Core", {
			name: "Hero",
			sourcePath: "src/assets/hero.jpg",
		});

		expect(resolveAssetSourceFilePath(projectRoot, result.asset)).toBe(
			path.join(projectRoot, "src", "assets", "hero.jpg"),
		);
	});
});
