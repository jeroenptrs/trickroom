import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { defaultTailwindColorTokens } from "./default-tailwind-tokens";
import { loadTailwindDesignSystem } from "./tailwind-design-system";
import {
	diffTailwindColorTokensAgainstDefaults,
	extractTailwindColorTokens,
} from "./tailwind-color-tokens";

const tempProjectRoots: string[] = [];

async function createFixtureProject(files: Record<string, string>) {
	const projectRoot = await mkdtemp(
		path.join(process.cwd(), ".tmp-tailwind-color-tokens-"),
	);
	tempProjectRoots.push(projectRoot);

	await Promise.all(
		Object.entries(files).map(async ([relativePath, contents]) => {
			const filePath = path.join(projectRoot, relativePath);
			await mkdir(path.dirname(filePath), { recursive: true });
			await writeFile(filePath, contents, "utf8");
		}),
	);

	return projectRoot;
}

afterEach(async () => {
	await Promise.all(
		tempProjectRoots.splice(0).map((projectRoot) =>
			rm(projectRoot, { force: true, recursive: true }),
		),
	);
});

describe("extractTailwindColorTokens", () => {
	it("extracts only the active color namespace and sorts token names deterministically", async () => {
		const projectRoot = await createFixtureProject({
			"src/index.css": [
				'@import "tailwindcss";',
				"@theme {",
				"  --color-*: initial;",
				"  --color-brand-500: #123456;",
				"  --color-brand-100: #abcdef;",
				"}",
				"",
			].join("\n"),
		});

		const { designSystem } = await loadTailwindDesignSystem({
			projectRoot,
			cssPath: "src/index.css",
		});

		expect(extractTailwindColorTokens(designSystem)).toEqual({
			"brand-100": "#abcdef",
			"brand-500": "#123456",
		});
	});
});

describe("diffTailwindColorTokensAgainstDefaults", () => {
	it("partitions extracted tokens against the Tailwind default baseline", () => {
		const diff = diffTailwindColorTokensAgainstDefaults({
			"brand-500": "#123456",
			"blue-50": defaultTailwindColorTokens["blue-50"],
			"blue-500": "oklch(10% 0.2 20)",
		});

		expect(diff.added).toEqual([
			{ name: "brand-500", value: "#123456", domain: "color" },
		]);
		expect(diff.unchanged).toEqual([
			{
				name: "blue-50",
				value: defaultTailwindColorTokens["blue-50"],
				defaultValue: defaultTailwindColorTokens["blue-50"],
				domain: "color",
			},
		]);
		expect(diff.overridden).toEqual([
			{
				name: "blue-500",
				value: "oklch(10% 0.2 20)",
				defaultValue: defaultTailwindColorTokens["blue-500"],
				domain: "color",
			},
		]);
		expect(diff.removed).toContainEqual({
			name: "blue-100",
			defaultValue: defaultTailwindColorTokens["blue-100"],
			domain: "color",
		});
		expect(diff.missingDefaultTokenNames).toContain("blue-100");
		expect(diff.missingDefaultTokenNames).toEqual(
			diff.removed.map((token) => token.name),
		);
	});

	it("treats equivalent values as unchanged after token normalization", () => {
		const diff = diffTailwindColorTokensAgainstDefaults({
			"blue-500": `  ${defaultTailwindColorTokens["blue-500"].replace(/\s+/g, "  ")}  `,
			"black": "#000",
		});

		expect(diff.overridden).toEqual([]);
		expect(diff.added).toEqual([]);
		expect(diff.unchanged).toEqual([
			expect.objectContaining({
				name: "black",
				defaultValue: defaultTailwindColorTokens.black,
			}),
			expect.objectContaining({
				name: "blue-500",
				defaultValue: defaultTailwindColorTokens["blue-500"],
			}),
		]);
	});
});
