import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { defaultTailwindColorTokens } from "./default-tailwind-tokens";
import {
	canUseGlobalColorReset,
	computeColorOverrides,
	diffTailwindColorTokensAgainstDefaults,
	extractTailwindColorTokens,
} from "./tailwind-color-tokens";
import { loadTailwindDesignSystem } from "./tailwind-design-system";

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
		tempProjectRoots
			.splice(0)
			.map((projectRoot) => rm(projectRoot, { force: true, recursive: true })),
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
			black: "#000",
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

describe("computeColorOverrides", () => {
	it("returns an empty array for empty removed input", () => {
		expect(computeColorOverrides([])).toEqual([]);
	});

	it("emits a single exact override for a single removed token", () => {
		const removed = [
			{ name: "red-50", defaultValue: "#fff", domain: "color" as const },
		];
		expect(computeColorOverrides(removed)).toEqual(["--color-red-50"]);
	});

	it("emits a family wildcard when an entire shade family is removed", () => {
		const defaults = {
			"brand-50": "#111",
			"brand-100": "#222",
			"other-50": "#333",
		};
		const removed = [
			{ name: "brand-50", defaultValue: "#111", domain: "color" as const },
			{ name: "brand-100", defaultValue: "#222", domain: "color" as const },
		];
		expect(computeColorOverrides(removed, defaults)).toEqual([
			"--color-brand-*",
		]);
	});

	it("collapses to a single global wildcard when all defaults are removed", () => {
		const defaults = {
			"red-50": "#111",
			black: "#000",
		};
		const removed = [
			{ name: "red-50", defaultValue: "#111", domain: "color" as const },
			{ name: "black", defaultValue: "#000", domain: "color" as const },
		];
		expect(computeColorOverrides(removed, defaults)).toEqual(["--color-*"]);
	});

	it("handles mixed full-family and partial-family removals", () => {
		const defaults = {
			"red-50": "#111",
			"red-100": "#222",
			"blue-50": "#333",
			"blue-100": "#444",
		};
		const removed = [
			{ name: "red-50", defaultValue: "#111", domain: "color" as const },
			{ name: "red-100", defaultValue: "#222", domain: "color" as const },
			{ name: "blue-50", defaultValue: "#333", domain: "color" as const },
		];
		expect(computeColorOverrides(removed, defaults)).toEqual([
			"--color-blue-50",
			"--color-red-*",
		]);
	});

	it("emits exact overrides for single-token defaults like black and white", () => {
		const removed = [
			{ name: "black", defaultValue: "#000", domain: "color" as const },
			{ name: "white", defaultValue: "#fff", domain: "color" as const },
		];
		// Using real defaults here to ensure black/white are treated as single-token families
		const overrides = computeColorOverrides(removed);
		expect(overrides).toContain("--color-black");
		expect(overrides).toContain("--color-white");
		// Ensure they are not collapsed into a wildcard unless everything is removed
		expect(overrides).not.toContain("--color-black-*");
	});

	it("conservatively emits exact overrides for removed tokens absent from defaults", () => {
		const removed = [
			{ name: "custom-token", defaultValue: "#123", domain: "color" as const },
		];
		expect(computeColorOverrides(removed, {})).toEqual([
			"--color-custom-token",
		]);
	});

	it("returns deterministic sorted output", () => {
		const defaults = {
			"z-50": "#111",
			"z-100": "#112",
			"a-50": "#222",
			"a-100": "#223",
			"m-50": "#333",
		};
		const removed = [
			{ name: "z-50", defaultValue: "#111", domain: "color" as const },
			{ name: "a-50", defaultValue: "#222", domain: "color" as const },
		];
		expect(computeColorOverrides(removed, defaults)).toEqual([
			"--color-a-50",
			"--color-z-50",
		]);
	});
});

describe("canUseGlobalColorReset", () => {
	it("allows a global reset only when every known default color is removed", () => {
		const defaults = {
			"red-50": "#111",
			black: "#000",
		};
		const removed = [
			{ name: "red-50", defaultValue: "#111", domain: "color" as const },
			{ name: "black", defaultValue: "#000", domain: "color" as const },
		];

		expect(canUseGlobalColorReset(removed, defaults)).toBe(true);
	});

	it("rejects partial removals because a global reset would remove kept defaults", () => {
		const defaults = {
			"red-50": "#111",
			"blue-50": "#222",
		};
		const removed = [
			{ name: "red-50", defaultValue: "#111", domain: "color" as const },
		];

		expect(canUseGlobalColorReset(removed, defaults)).toBe(false);
	});

	it("rejects mixed known and unknown removals", () => {
		const defaults = {
			"red-50": "#111",
		};
		const removed = [
			{ name: "red-50", defaultValue: "#111", domain: "color" as const },
			{ name: "brand-50", defaultValue: "#333", domain: "color" as const },
		];

		expect(canUseGlobalColorReset(removed, defaults)).toBe(false);
	});
});
