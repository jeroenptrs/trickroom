import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { TrickroomCodegenConfig, TrickroomConfig } from "../types";
import { createClassMerge, mergeComponentClasses } from "./class-merge";
import {
	resolveClassMergeSettings,
	resolveComponentClassMerge,
} from "./class-merge-settings";

const CORE = "sys_00000000-0000-4000-8000-0000000000c1";
const OTHER = "sys_00000000-0000-4000-8000-0000000000c2";

// Two families that set their own private properties, so only a merge group
// makes them interchangeable.
const CSS = [
	"@theme {",
	"\t--db-label-sm: 0.875rem;",
	"\t--db-title-lg: 1.5rem;",
	"\t--color-royal-9: oklch(54% 0.22 263);",
	"}",
	"@utility text-label-* {",
	"\t--label--size: --value(--db-label-*);",
	"\tfont-size: var(--label--size);",
	"\tline-height: 1.25;",
	"}",
	"@utility text-title-* {",
	"\t--title--size: --value(--db-title-*);",
	"\tfont-size: var(--title--size);",
	"\tline-height: 1.1;",
	"}",
	"",
].join("\n");

const roots: string[] = [];
afterEach(async () => {
	await Promise.all(
		roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
	);
});

const createProject = async (css = CSS) => {
	const root = await realpath(
		await mkdtemp(path.join(os.tmpdir(), "trickroom-class-merge-")),
	);
	roots.push(root);
	await writeFile(path.join(root, "theme.css"), css);
	for (const [key, systemId, name] of [
		["core", CORE, "Core"],
		["other", OTHER, "Other"],
	] as const) {
		const dir = path.join(root, ".trickroom", "systems", key);
		await mkdir(dir, { recursive: true });
		await writeFile(
			path.join(dir, "system.json"),
			JSON.stringify({
				version: 1,
				systemId,
				systemName: name,
				cssPath: "theme.css",
			}),
		);
	}
	return root;
};

const config = (codegen?: TrickroomCodegenConfig): TrickroomConfig => ({
	name: "Class Merge Test",
	defaultSystemId: CORE,
	...(codegen ? { codegen } : {}),
});

describe("resolveClassMergeSettings", () => {
	it("does not merge without a system or with one that does not resolve", async () => {
		const projectRoot = await createProject();
		expect(
			await resolveClassMergeSettings({
				projectRoot,
				config: config(),
				systemId: null,
			}),
		).toEqual({ mode: "none" });
		expect(
			await resolveClassMergeSettings({
				projectRoot,
				config: config(),
				systemId: "sys_missing",
			}),
		).toEqual({ mode: "none" });
	});

	it("merges with stock tailwind-merge unless codegen generates the config for the system", async () => {
		const projectRoot = await createProject();
		const settings = async (codegen?: TrickroomCodegenConfig) =>
			resolveClassMergeSettings({
				projectRoot,
				config: config(codegen),
				systemId: CORE,
			});
		expect(await settings()).toEqual({ mode: "stock" });
		expect(await settings({ version: 1, outDir: "src/ui" })).toEqual({
			mode: "stock",
		});
		// codegen.twMerge is on, for another system.
		expect(
			await settings({
				version: 1,
				outDir: "src/ui",
				system: OTHER,
				twMerge: {},
			}),
		).toEqual({ mode: "stock" });
	});

	it("merges with the derived config when codegen.twMerge generates it for the system", async () => {
		const projectRoot = await createProject();
		const settings = await resolveClassMergeSettings({
			projectRoot,
			config: config({ version: 1, outDir: "src/ui", twMerge: {} }),
			systemId: CORE,
		});
		expect(settings.mode).toBe("derived");
		const merge = createClassMerge(settings);
		if (!merge) throw new Error("derived settings must merge");
		expect(merge("text-label-sm text-royal-9")).toBe(
			"text-label-sm text-royal-9",
		);
		// Without a merge group the families keep each other.
		expect(merge("text-label-sm text-title-lg")).toBe(
			"text-label-sm text-title-lg",
		);
		expect(merge("flex hidden")).toBe("hidden");
	});

	it("merges a merge group's members, the last one winning", async () => {
		const projectRoot = await createProject();
		const settings = await resolveClassMergeSettings({
			projectRoot,
			config: config({
				version: 1,
				outDir: "src/ui",
				twMerge: {
					mergeGroups: { typography: ["text-label-*", "text-title-*"] },
				},
			}),
			systemId: CORE,
		});
		const merge = createClassMerge(settings);
		if (!merge) throw new Error("derived settings must merge");
		expect(merge("text-label-sm text-title-lg")).toBe("text-title-lg");
		expect(merge("text-title-lg text-label-sm")).toBe("text-label-sm");
		expect(merge("text-label-sm text-royal-9")).toBe(
			"text-label-sm text-royal-9",
		);
	});

	it("does not merge, and says why, when the config cannot be derived", async () => {
		const projectRoot = await createProject();
		const settings = await resolveClassMergeSettings({
			projectRoot,
			config: config({
				version: 1,
				outDir: "src/ui",
				twMerge: { mergeGroups: { typography: ["text-caption-*"] } },
			}),
			systemId: CORE,
		});
		expect(settings.mode).toBe("none");
		expect(settings.mode === "none" && settings.error).toMatch(
			/could not be derived/u,
		);
		expect(createClassMerge(settings)).toBeNull();
	});

	it("merges the override over the merged component classes, like the wrapper", async () => {
		const projectRoot = await createProject(
			"@utility headline {\n\tfont-size: 2rem;\n\tline-height: 2;\n}\n",
		);
		const merge = createClassMerge(
			await resolveClassMergeSettings({
				projectRoot,
				config: config({ version: 1, outDir: "src/ui", twMerge: {} }),
				systemId: CORE,
			}),
		);
		if (!merge) throw new Error("derived settings must merge");
		// tv() keeps text-sm/8 over leading-6; the wrapper's twMerge then
		// replaces text-sm/8 with headline.
		expect(
			mergeComponentClasses("leading-6 text-sm/8", "headline", merge),
		).toBe("headline");
		// One pass keeps leading-6: text-sm/8 removed it, and is removed itself.
		expect(merge("leading-6 text-sm/8 headline")).toBe("leading-6 headline");
	});

	it("adds the system's component class data when classes merge", async () => {
		const projectRoot = await createProject();
		expect(
			await resolveComponentClassMerge({
				projectRoot,
				config: config(),
				systemId: CORE,
			}),
		).toEqual({
			mode: "stock",
			components: { systemId: CORE, table: {} },
		});
		expect(
			await resolveComponentClassMerge({
				projectRoot,
				config: config(),
				systemId: null,
			}),
		).toEqual({ mode: "none" });
	});
});
