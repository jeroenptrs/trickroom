import { mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	expandVariantNames,
	getCachedTailwindClassCatalog,
	inspectTailwindClasses,
} from "./tailwind-class-catalog";

const tempProjectRoots: string[] = [];

async function createFixtureProject(css: string) {
	const projectRoot = await mkdtemp(
		path.join(process.cwd(), ".tmp-tailwind-class-catalog-"),
	);
	tempProjectRoots.push(projectRoot);
	await writeFile(path.join(projectRoot, "theme.css"), css, "utf8");
	return projectRoot;
}

afterEach(async () => {
	await Promise.all(
		tempProjectRoots
			.splice(0)
			.map((root) => rm(root, { recursive: true, force: true })),
	);
});

describe("expandVariantNames", () => {
	it("expands valued variants with and without a dash", () => {
		expect(
			expandVariantNames([
				{ name: "hover", values: [], isArbitrary: false, hasDash: true },
				{
					name: "group",
					values: ["hover", "focus"],
					isArbitrary: true,
					hasDash: true,
				},
				{ name: "@", values: ["md"], isArbitrary: true, hasDash: false },
			] as never),
		).toEqual(["hover", "group-hover", "group-focus", "@md"]);
	});
});

describe("getCachedTailwindClassCatalog", () => {
	it("lists project theme utilities and variants from a theme fragment", async () => {
		// No `@import "tailwindcss"`: the loader adds it, as the canvas compile does.
		const projectRoot = await createFixtureProject(
			"@theme { --color-brand: #0ea5e9; }\n",
		);
		const { catalog, designSystem } = await getCachedTailwindClassCatalog({
			projectRoot,
			cssPath: "theme.css",
			themeOverrides: "@theme { --color-accent: #f00; }",
		});

		expect(catalog.classes).toContain("bg-brand");
		expect(catalog.classes).toContain("text-accent");
		expect(catalog.classes).toContain("p-4");
		expect(catalog.variants).toEqual(
			expect.arrayContaining(["hover", "md", "dark", "group-hover"]),
		);

		const results = inspectTailwindClasses(designSystem, catalog, [
			"md:hover:bg-brand/50",
			"bg-[#123456]",
			"bg-brnd",
			"totally-made-up",
		]);
		expect(results[0]).toEqual({
			candidate: "md:hover:bg-brand/50",
			supported: true,
		});
		expect(results[1].supported).toBe(true);
		expect(results[2].supported).toBe(false);
		expect(results[2].suggestions).toContain("bg-brand");
		expect(results[3]).toMatchObject({ supported: false });
	});

	it("reuses the loaded design system until the CSS changes", async () => {
		const projectRoot = await createFixtureProject(
			'@import "tailwindcss";\n@theme { --color-one: #111; }\n',
		);
		const first = await getCachedTailwindClassCatalog({
			projectRoot,
			cssPath: "theme.css",
		});
		const second = await getCachedTailwindClassCatalog({
			projectRoot,
			cssPath: "theme.css",
		});
		expect(second).toBe(first);

		await new Promise((resolve) => setTimeout(resolve, 20));
		await writeFile(
			path.join(projectRoot, "theme.css"),
			'@import "tailwindcss";\n@theme { --color-two: #222; }\n',
			"utf8",
		);
		const third = await getCachedTailwindClassCatalog({
			projectRoot,
			cssPath: "theme.css",
		});
		expect(third).not.toBe(first);
		expect(third.catalog.classes).toContain("bg-two");
		expect(third.catalog.classes).not.toContain("bg-one");
	});

	it("falls back to baseline Tailwind without a system", async () => {
		const projectRoot = await createFixtureProject("");
		const { catalog } = await getCachedTailwindClassCatalog({
			projectRoot,
			cssPath: null,
		});
		expect(catalog.classes).toContain("bg-red-500");
	});
});
