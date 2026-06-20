import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureDesignSystemManifest, writeDesignSystemManifest } from "./design-system-store.ts";
import { readFontManifest } from "./font-manifest-service.ts";
import {
	mergeInferredFontsIntoManifest,
	syncFontsFromSystemStylesheet,
} from "./font-manifest-sync.ts";
import { inferFontSourcesFromSystemStylesheet } from "./font-source-inference.ts";

async function linkNodeModulesForTest(projectRoot: string) {
	const source = path.join(process.cwd(), "node_modules");
	const target = path.join(projectRoot, "node_modules");

	if (process.platform === "win32") {
		await cp(source, target, { recursive: true });
		return;
	}

	try {
		await symlink(source, target);
	} catch {
		await cp(source, target, { recursive: true });
	}
}

describe("font manifest sync", () => {
	let projectRoot: string;

	beforeEach(async () => {
		projectRoot = await mkdtemp(
			path.join(process.cwd(), ".tmp-trickroom-font-manifest-sync-"),
		);
		await mkdir(path.join(projectRoot, "src"), { recursive: true });
		await writeFile(
			path.join(projectRoot, "src", "index.css"),
			await readFile(path.join(process.cwd(), "src", "index.css"), "utf8"),
		);
		await linkNodeModulesForTest(projectRoot);
		const manifest = await ensureDesignSystemManifest(projectRoot, "Core");
		await writeDesignSystemManifest(projectRoot, "Core", {
			...manifest,
			cssPath: "src/index.css",
		});
	});

	afterEach(async () => {
		await rm(projectRoot, { force: true, recursive: true });
	});

	it("merges inferred fonts without overwriting existing faces", async () => {
		const inference = await inferFontSourcesFromSystemStylesheet(
			projectRoot,
			"src/index.css",
		);
		expect(inference.candidates.length).toBeGreaterThan(0);

		const first = await mergeInferredFontsIntoManifest(
			projectRoot,
			"Core",
			inference.candidates.slice(0, 1),
		);
		expect(first.addedFontIds).toHaveLength(1);

		const second = await mergeInferredFontsIntoManifest(
			projectRoot,
			"Core",
			inference.candidates,
		);
		expect(
			second.updatedFontIds.length + second.skippedFontIds.length,
		).toBeGreaterThan(0);

		const manifest = await readFontManifest(projectRoot, "Core");
		expect(Object.keys(manifest.fonts).length).toBe(inference.candidates.length);
	});

	it("skips sync when onlyWhenEmpty is set and fonts already exist", async () => {
		const inference = await inferFontSourcesFromSystemStylesheet(
			projectRoot,
			"src/index.css",
		);
		await mergeInferredFontsIntoManifest(projectRoot, "Core", inference.candidates);

		const skipped = await syncFontsFromSystemStylesheet(projectRoot, "Core", {
			onlyWhenEmpty: true,
		});
		expect(skipped.addedFontIds).toHaveLength(0);
		expect(skipped.updatedFontIds).toHaveLength(0);
	});

	it("syncs from stylesheet when manifest is empty", async () => {
		const sync = await syncFontsFromSystemStylesheet(projectRoot, "Core", {
			onlyWhenEmpty: true,
		});
		expect(sync.addedFontIds.length).toBeGreaterThanOrEqual(2);
		const manifest = await readFontManifest(projectRoot, "Core");
		expect(Object.keys(manifest.fonts).length).toBeGreaterThanOrEqual(2);
	});
});
