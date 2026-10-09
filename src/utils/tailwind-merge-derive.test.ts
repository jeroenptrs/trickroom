import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
	createTailwindMerge,
	type DefaultClassGroupIds,
	getDefaultConfig,
	twMerge,
} from "tailwind-merge";
import { afterEach, describe, expect, it } from "vitest";
import { loadTailwindDesignSystem } from "./tailwind-design-system";
import { createTailwindIntrospection } from "./tailwind-introspection";
import { createTwMerge } from "./tailwind-merge-config";
import {
	deriveTwMergeConfig,
	loadDerivedTwMerge,
	TW_MERGE_GROUP_PROBES,
} from "./tailwind-merge-derive";

const dirs: string[] = [];
afterEach(async () => {
	await Promise.all(
		dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
	);
});

const writeCss = async (css: string) => {
	const dir = await mkdtemp(path.join(os.tmpdir(), "trickroom-tw-merge-"));
	dirs.push(dir);
	await writeFile(path.join(dir, "theme.css"), css);
	return { projectRoot: dir, cssPath: "theme.css" };
};

const derive = async (css: string) => {
	const { designSystem, cssSource } = await loadTailwindDesignSystem(
		await writeCss(css),
	);
	return deriveTwMergeConfig(
		createTailwindIntrospection(designSystem, cssSource),
	);
};

/** Shaped like a real design system: colour scales, label sizes, a spacing scale. */
const THEME_CSS = [
	"@custom-variant dark (&:where(.dark, .dark *));",
	"@theme {",
	"\t--color-*: initial;",
	"\t--color-royal-2: oklch(98% 0.01 263);",
	"\t--color-royal-9: oklch(54% 0.22 263);",
	"\t--color-royal-10: oklch(49% 0.2 263);",
	"\t--color-royaldark-9: oklch(54% 0.22 263);",
	"\t--text-2xs: 0.6875rem;",
	"\t--text-2xs--line-height: 1.27;",
	"\t--text-shadow-glow: 0 0 2px red;",
	"\t--font-display: Inter, sans-serif;",
	"\t--font-weight-heavy: 850;",
	"\t--spacing-pad-xs: 0.25rem;",
	"\t--shadow-elevation-sm: 0 1px 2px black;",
	"\t--db-label-sm: 0.875rem;",
	"\t--db-label-sm--line-height: 1.28;",
	"\t--db-label-lg: 1.125rem;",
	"}",
	"@utility text-label-* {",
	"\t--label--text-size: --value(--db-label-*);",
	"\t--label--line-height: --value(--db-label-*--line-height);",
	"\tfont-size: var(--label--text-size);",
	"\tline-height: var(--label--line-height, 1.25);",
	"\tfont-weight: 500;",
	"\tletter-spacing: normal;",
	"}",
	"@utility bg-royal-ui {",
	"\t@apply bg-royal-2 hover:bg-royal-9 dark:bg-royaldark-9;",
	"}",
	"@utility text-royal-dim {",
	"\t@apply text-royal-9 dark:text-royaldark-9;",
	"}",
	"@utility divide-royal-dim {",
	"\t@apply divide-royal-9 dark:divide-royaldark-9;",
	"}",
	"@utility card-padding {",
	"\tpadding: 1rem;",
	"}",
	"@utility btn-primary {",
	"\t@apply bg-royal-9 text-royal-2 px-[2px];",
	"}",
	"@utility glow {",
	"\t--glow: 1;",
	"}",
	"",
].join("\n");

describe("deriveTwMergeConfig", () => {
	it("maps theme namespaces to tailwind-merge theme keys", async () => {
		const { config } = await derive(THEME_CSS);
		expect(config.extend.theme).toEqual({
			color: ["royal-2", "royal-9", "royal-10", "royaldark-9"],
			font: ["display"],
			"font-weight": ["heavy"],
			shadow: ["elevation-sm"],
			spacing: ["pad-xs"],
			text: ["2xs"],
			"text-shadow": ["glow"],
		});
	});

	it("classifies custom utilities by the CSS Tailwind generates for them", async () => {
		const { config, unclassified } = await derive(THEME_CSS);
		expect(config.extend.classGroups).toEqual({
			"bg-color": ["bg-royal-ui"],
			"divide-color": ["divide-royal-dim"],
			"font-size": ["text-label-lg", "text-label-sm"],
			p: ["card-padding"],
			"text-color": ["text-royal-dim"],
		});
		expect(unclassified).toEqual([
			{
				utility: "btn-primary",
				properties: ["background-color", "color", "padding-inline"],
			},
			{ utility: "glow", properties: [] },
		]);
	});

	it("keeps a size and a colour on the same text-* root, which stock tailwind-merge drops", async () => {
		const { config } = await derive(THEME_CSS);
		const merge = createTwMerge(config);
		expect(twMerge("text-label-sm text-royal-9")).toBe("text-royal-9");
		expect(merge("text-label-sm text-royal-9")).toBe(
			"text-label-sm text-royal-9",
		);
		expect(merge("text-label-sm text-label-lg")).toBe("text-label-lg");
		expect(merge("text-sm text-label-lg")).toBe("text-label-lg");
		expect(merge("leading-6 text-label-sm")).toBe("text-label-sm");
		expect(merge("p-pad-xs p-4")).toBe("p-4");
		expect(merge("shadow-elevation-sm shadow-royal-9")).toBe(
			"shadow-elevation-sm shadow-royal-9",
		);
		expect(merge("bg-royal-ui bg-royal-9")).toBe("bg-royal-9");
		expect(merge("btn-primary bg-royal-9")).toBe("btn-primary bg-royal-9");
	});

	it("is a plain serialisable object with stable ordering", async () => {
		const derived = await derive(THEME_CSS);
		expect(JSON.parse(JSON.stringify(derived))).toEqual(derived);
		const reordered = await derive(
			THEME_CSS.replace(
				"\t--color-royal-2: oklch(98% 0.01 263);\n",
				"",
			).replace(
				"\t--color-royaldark-9: oklch(54% 0.22 263);\n",
				"\t--color-royaldark-9: oklch(54% 0.22 263);\n\t--color-royal-2: oklch(98% 0.01 263);\n",
			),
		);
		expect(JSON.stringify(reordered)).toBe(JSON.stringify(derived));
	});

	it("derives an empty extension for a system without tokens or utilities", async () => {
		expect(await derive("@theme { --color-*: initial; }\n")).toEqual({
			config: { extend: { theme: {}, classGroups: {} } },
			unclassified: [],
		});
	});

	it("loads through the cached design system, once per compiled system", async () => {
		const options = await writeCss(THEME_CSS);
		const first = await loadDerivedTwMerge(options);
		expect(first.config.extend.classGroups["font-size"]).toContain(
			"text-label-sm",
		);
		expect(await loadDerivedTwMerge(options)).toBe(first);
	});
});

describe("TW_MERGE_GROUP_PROBES", () => {
	it("each probe is a member of its class group in tailwind-merge", () => {
		// Without conflicts, a later class removes an earlier one only when
		// both are in the same group.
		const sameGroup = createTailwindMerge(() => ({
			...getDefaultConfig(),
			conflictingClassGroups: {},
			conflictingClassGroupModifiers: {},
		}));
		const groups = getDefaultConfig().classGroups;
		for (const { group, candidate } of TW_MERGE_GROUP_PROBES) {
			expect(groups[group as DefaultClassGroupIds]).toBeDefined();
			const marker = createTailwindMerge(() => {
				const config = getDefaultConfig();
				return {
					...config,
					conflictingClassGroups: {},
					conflictingClassGroupModifiers: {},
					classGroups: {
						...config.classGroups,
						[group]: [...config.classGroups[group], "probe-marker"],
					},
				};
			});
			expect(marker(`${candidate} probe-marker`), group).toBe("probe-marker");
			expect(sameGroup(`${candidate} ${candidate}`)).toBe(candidate);
		}
	});
});
