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
	TwMergeGroupError,
	type TwMergeGroups,
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
	"\t--color-pale-2: oklch(98% 0 0);",
	"\t--color-pale-9: oklch(50% 0 0);",
	"\t--text-2xs: 0.6875rem;",
	"\t--text-2xs--line-height: 1.27;",
	"\t--text-shadow-glow: 0 0 2px red;",
	"\t--font-display: Inter, sans-serif;",
	"\t--font-weight-heavy: 850;",
	"\t--spacing-pad-xs: 0.25rem;",
	"\t--shadow-elevation-sm: 0 1px 2px black;",
	"\t--db-label-sm: 0.875rem;",
	"\t--db-label-lg: 1.125rem;",
	"}",
	"@utility text-label-* {",
	"\tfont-size: --value(--db-label-*);",
	"\tline-height: 1.25;",
	"\tfont-weight: 500;",
	"\tletter-spacing: normal;",
	"}",
	"@utility bg-royal-ui {",
	"\t@apply bg-royal-2 hover:bg-royal-9 dark:bg-royaldark-9;",
	"}",
	"@utility bg-pale-ui {",
	"\t@apply bg-pale-2 hover:bg-pale-9 dark:bg-pale-9;",
	"}",
	"@utility divide-royal-dim {",
	"\t@apply divide-royal-9 dark:divide-royaldark-9;",
	"}",
	"@utility card-padding {",
	"\tpadding: 1rem;",
	"}",
	"@utility text-ink {",
	"\tcolor: var(--color-royal-9);",
	"}",
	"",
].join("\n");

const mergeWith = async (css: string) =>
	createTwMerge((await derive(css)).config);

describe("deriveTwMergeConfig", () => {
	it("maps theme namespaces to tailwind-merge theme keys", async () => {
		const { config } = await derive(THEME_CSS);
		expect(config.extend.theme).toEqual({
			color: [
				"pale-2",
				"pale-9",
				"royal-2",
				"royal-9",
				"royal-10",
				"royaldark-9",
			],
			font: ["display"],
			"font-weight": ["heavy"],
			shadow: ["elevation-sm"],
			spacing: ["pad-xs"],
			text: ["2xs"],
			"text-shadow": ["glow"],
		});
	});

	it("puts a utility in a stock group only when it sets exactly what the group sets, and protects the others", async () => {
		const { config } = await derive(THEME_CSS);
		expect(config.extend.classGroups).toEqual({
			"@utility bg-pale-ui": ["bg-pale-ui", "bg-royal-ui"],
			"@utility divide-royal-dim": ["divide-royal-dim"],
			"@utility text-label-*": ["text-label-lg", "text-label-sm"],
			p: ["card-padding"],
			"text-color": ["text-ink"],
		});
		expect(config.extend.conflictingClassGroups).toEqual({
			"@utility bg-pale-ui": ["bg-color"],
			"@utility divide-royal-dim": ["divide-color"],
			// Not leading: text-2xs reads the --tw-leading a leading-* class
			// sets, and text-label-* does not set it.
			"@utility text-label-*": ["font-size", "font-weight", "tracking"],
		});
		expect(config).not.toHaveProperty("prefix");
	});

	it("keeps a size and a colour on the same text-* root, which stock tailwind-merge drops", async () => {
		const merge = await mergeWith(THEME_CSS);
		expect(twMerge("text-label-sm text-royal-9")).toBe("text-royal-9");
		expect(merge("text-label-sm text-royal-9")).toBe(
			"text-label-sm text-royal-9",
		);
		expect(merge("text-label-sm text-label-lg")).toBe("text-label-lg");
		expect(merge("p-pad-xs p-4")).toBe("p-4");
		expect(merge("shadow-elevation-sm shadow-royal-9")).toBe(
			"shadow-elevation-sm shadow-royal-9",
		);
		expect(merge("card-padding p-4")).toBe("p-4");
		expect(merge("text-ink text-royal-9")).toBe("text-royal-9");
	});

	it("never lets a stock class remove a typography bundle, while a later bundle replaces what it covers", async () => {
		const merge = await mergeWith(
			"@utility label { font-size: 1rem; font-weight: 600; letter-spacing: 1px; line-height: 2; }\n",
		);
		expect(merge("label text-[16px]")).toBe("label text-[16px]");
		expect(merge("label font-bold")).toBe("label font-bold");
		expect(merge("text-[16px] leading-6 font-bold tracking-wide label")).toBe(
			"label",
		);
		const merged = await mergeWith(THEME_CSS);
		expect(merged("text-label-sm text-sm")).toBe("text-label-sm text-sm");
		expect(merged("text-sm text-label-sm")).toBe("text-label-sm");
	});

	it("conflicts with a stock group only when it overrides every sampled member, theme sub-keys and modifiers included", async () => {
		const css = [
			"@theme {",
			"\t--spacing: 0.25rem;",
			"\t--text-sm: 0.875rem;",
			"\t--text-sm--line-height: 1.25rem;",
			"\t--color-red-500: red;",
			"}",
			"@utility big-ink { font-size: 20px; color: red; }",
			"@utility huge { font-size: 3rem; }",
			"",
		].join("\n");
		const { config } = await derive(css);
		// text-sm also sets line-height, text-[1px] does not: neither joins
		// nor removes the font-size group.
		expect(config.extend.classGroups).toEqual({
			"@utility big-ink": ["big-ink"],
			"@utility huge": ["huge"],
		});
		expect(config.extend.conflictingClassGroups).toEqual({
			"@utility big-ink": ["@utility huge", "text-color"],
		});
		const merge = createTwMerge(config);
		expect(merge("text-sm big-ink")).toBe("text-sm big-ink");
		expect(merge("text-sm/8 big-ink")).toBe("text-sm/8 big-ink");
		expect(merge("text-[16px] huge")).toBe("text-[16px] huge");
		expect(merge("text-red-500 big-ink")).toBe("big-ink");
	});

	it("keeps a --tw-* variable that the later class or any listed class reads", async () => {
		const merge = await mergeWith(
			[
				"@theme { --spacing: 0.25rem; }",
				"@utility label { font-size: 20px; line-height: var(--tw-leading, 2); }",
				"@utility heading { font-size: 20px; line-height: 2; }",
				"",
			].join("\n"),
		);
		// label reads the --tw-leading leading-8 sets, so neither it nor any
		// other class may drop it.
		expect(merge("leading-8 label")).toBe("leading-8 label");
		expect(merge("leading-8 heading")).toBe("leading-8 heading");

		const unread = await mergeWith(
			[
				"@theme { --spacing: 0.25rem; }",
				"@utility heading { font-size: 20px; line-height: 2; }",
				"",
			].join("\n"),
		);
		// Nothing reads --tw-leading here: heading overrides all leading-8 does.
		expect(unread("leading-8 heading")).toBe("heading");

		const read = await mergeWith(
			[
				"@theme { --spacing: 0.25rem; --text-sm: 0.875rem; --text-sm--line-height: 1.25rem; }",
				"@utility heading { font-size: 20px; line-height: 2; }",
				"",
			].join("\n"),
		);
		// text-sm reads --tw-leading: a later heading must not drop it.
		expect(read("leading-8 heading")).toBe("leading-8 heading");
	});

	it("protects utilities with declarations under pseudo-classes, variants or at-rules", async () => {
		const merge = await mergeWith(
			"@utility hover-paint { &:hover { background-color: blue; } }\n@utility wide-paint { @media (width >= 40rem) { background-color: blue; } }\n",
		);
		expect(merge("hover-paint bg-[red]")).toBe("hover-paint bg-[red]");
		expect(merge("bg-[red] hover-paint")).toBe("bg-[red] hover-paint");
		expect(merge("wide-paint bg-[red]")).toBe("wide-paint bg-[red]");

		// bg-royal-ui also sets the background on hover and in dark mode.
		const merged = await mergeWith(THEME_CSS);
		expect(merged("bg-royal-ui bg-royal-9")).toBe("bg-royal-ui bg-royal-9");
		expect(merged("bg-royal-9 bg-royal-ui")).toBe("bg-royal-ui");
		expect(merged("bg-royal-ui bg-pale-ui")).toBe("bg-pale-ui");
		expect(merged("divide-royal-dim divide-royal-9")).toBe(
			"divide-royal-dim divide-royal-9",
		);
	});

	it("protects utilities that set more than one stock group, instead of leaving them to stock validators", async () => {
		const merge = await mergeWith(
			"@utility bg-panel { background-color: blue; padding: 20px; }\n",
		);
		expect(twMerge("bg-panel bg-[red]")).toBe("bg-[red]");
		expect(merge("bg-panel bg-[red]")).toBe("bg-panel bg-[red]");
		expect(merge("p-4 bg-[red] bg-panel")).toBe("bg-panel");
	});

	it("protects !important declarations and custom properties other than Tailwind's --tw-* plumbing", async () => {
		const { config } = await derive(
			[
				"@utility bg-loud { background-color: blue !important; }",
				"@utility bg-gap { background-color: blue; --panel-gap: 4px; }",
				"@utility leading-roomy { line-height: 2; --tw-leading: 2; }",
				"",
			].join("\n"),
		);
		expect(config.extend.classGroups).toEqual({
			"@utility bg-gap": ["bg-gap"],
			"@utility bg-loud": ["bg-loud"],
			leading: ["leading-roomy"],
		});
		// A later bg-gap does not remove an earlier !important bg-loud.
		expect(config.extend.conflictingClassGroups).toEqual({
			"@utility bg-gap": ["bg-color"],
			"@utility bg-loud": ["bg-color"],
		});
		const merge = createTwMerge(config);
		expect(merge("bg-loud bg-[red]")).toBe("bg-loud bg-[red]");
		expect(merge("bg-gap bg-[red]")).toBe("bg-gap bg-[red]");
		expect(merge("bg-loud bg-gap")).toBe("bg-loud bg-gap");
	});

	it("compiles candidates with the design system's prefix and carries it into the config", async () => {
		const { config } = await derive(
			"@theme prefix(tw) { --color-brand: red; --db-label-sm: 1rem; }\n@utility text-label-* { font-size: --value(--db-label-*); line-height: 1.2; }\n",
		);
		expect(config).toEqual({
			prefix: "tw",
			extend: {
				theme: { color: ["brand"] },
				classGroups: { "@utility text-label-*": ["text-label-sm"] },
				conflictingClassGroups: {
					"@utility text-label-*": ["font-size", "leading"],
				},
			},
		});
		const merge = createTwMerge(config);
		expect(merge("tw:text-label-sm tw:text-brand")).toBe(
			"tw:text-label-sm tw:text-brand",
		);
		expect(merge("tw:text-sm tw:text-label-sm")).toBe("tw:text-label-sm");
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
			config: {
				extend: { theme: {}, classGroups: {}, conflictingClassGroups: {} },
			},
		});
	});

	it("loads through the cached design system, once per compiled system", async () => {
		const options = await writeCss(THEME_CSS);
		const first = await loadDerivedTwMerge(options);
		expect(first.config.extend.classGroups["@utility text-label-*"]).toContain(
			"text-label-sm",
		);
		expect(await loadDerivedTwMerge(options)).toBe(first);
	});
});

const FAMILIES_CSS = [
	"@theme {",
	"\t--db-label-sm: 0.875rem;",
	"\t--db-title-lg: 1.5rem;",
	"\t--db-caption-sm: 0.75rem;",
	"\t--color-royal-9: oklch(54% 0.22 263);",
	"}",
	"@utility text-label-* {",
	"\t--label--size: --value(--db-label-*);",
	"\tfont-size: var(--label--size);",
	"\tline-height: 1.25;",
	"\tfont-weight: 500;",
	"\tletter-spacing: normal;",
	"}",
	"@utility text-title-* {",
	"\t--title--size: --value(--db-title-*);",
	"\tfont-size: var(--title--size);",
	"\tline-height: 1.1;",
	"\tfont-weight: 600;",
	"\tletter-spacing: -0.02em;",
	"}",
	"@utility text-caption-* {",
	"\t--caption--size: --value(--db-caption-*);",
	"\tfont-size: var(--caption--size);",
	"\tline-height: 1.2;",
	"\tfont-weight: 400;",
	"\tletter-spacing: normal;",
	"}",
	"",
].join("\n");

const deriveWithGroups = async (css: string, mergeGroups: TwMergeGroups) => {
	const { designSystem, cssSource } = await loadTailwindDesignSystem(
		await writeCss(css),
	);
	return deriveTwMergeConfig(
		createTailwindIntrospection(designSystem, cssSource),
		{ mergeGroups },
	);
};

describe("deriveTwMergeConfig with merge groups", () => {
	it("keeps families with their own private properties apart without a merge group", async () => {
		const merge = createTwMerge((await derive(FAMILIES_CSS)).config);
		expect(merge("text-label-sm text-title-lg")).toBe(
			"text-label-sm text-title-lg",
		);
	});

	it("puts a merge group's members in one class group, so the last one wins", async () => {
		const { config } = await deriveWithGroups(FAMILIES_CSS, {
			typography: ["text-title-*", "text-label-*"],
		});
		expect(config.extend.classGroups).toEqual({
			"@utility text-caption-*": ["text-caption-sm"],
			"mergeGroups.typography": ["text-label-sm", "text-title-lg"],
		});
		// The group overrides what every member sets, its private properties
		// aside; caption sets --caption--size, which no member overrides.
		expect(config.extend.conflictingClassGroups).toEqual({
			"@utility text-caption-*": [
				"font-size",
				"font-weight",
				"leading",
				"mergeGroups.typography",
				"tracking",
			],
			"mergeGroups.typography": [
				"font-size",
				"font-weight",
				"leading",
				"tracking",
			],
		});
		const merge = createTwMerge(config);
		expect(merge("text-label-sm text-title-lg")).toBe("text-title-lg");
		expect(merge("text-title-lg text-label-sm")).toBe("text-label-sm");
		expect(merge("text-label-sm text-royal-9")).toBe(
			"text-label-sm text-royal-9",
		);
		expect(
			merge("text-[13px] leading-6 font-bold tracking-wide text-title-lg"),
		).toBe("text-title-lg");
		expect(merge("text-title-lg text-[13px]")).toBe(
			"text-title-lg text-[13px]",
		);
		// A non-member stays protected: a member never removes it.
		expect(merge("text-caption-sm text-title-lg")).toBe(
			"text-caption-sm text-title-lg",
		);
	});

	it("rejects a pattern that matches no utility and a utility in two groups", async () => {
		await expect(
			deriveWithGroups(FAMILIES_CSS, {
				typography: ["text-title-*", "text-headline-*"],
			}),
		).rejects.toThrow(
			'codegen.twMerge.mergeGroups.typography: "text-headline-*" matches no custom utility of the design system.',
		);
		const error = await deriveWithGroups(FAMILIES_CSS, {
			body: ["text-label-*"],
			typography: ["text-*"],
		}).catch((caught: unknown) => caught);
		expect(error).toBeInstanceOf(TwMergeGroupError);
		expect((error as TwMergeGroupError).issues).toEqual([
			'"text-label-sm" is in mergeGroups "body" and "typography"; a utility may belong to at most one merge group.',
		]);
	});

	it("caches per set of merge groups", async () => {
		const options = await writeCss(FAMILIES_CSS);
		const plain = await loadDerivedTwMerge(options);
		const grouped = await loadDerivedTwMerge(options, {
			typography: ["text-title-*", "text-label-*"],
		});
		expect(grouped).not.toBe(plain);
		expect(
			await loadDerivedTwMerge(options, {
				typography: ["text-title-*", "text-label-*"],
			}),
		).toBe(grouped);
		expect(await loadDerivedTwMerge(options)).toBe(plain);
	});
});

describe("TW_MERGE_GROUP_PROBES", () => {
	it("every sampled stock candidate is a member of its class group in tailwind-merge", () => {
		// Without conflicts, a later class removes an earlier one only when
		// both are in the same group.
		const sameGroup = createTailwindMerge(() => ({
			...getDefaultConfig(),
			conflictingClassGroups: {},
			conflictingClassGroupModifiers: {},
		}));
		const groups = getDefaultConfig().classGroups;
		for (const { group, candidates } of TW_MERGE_GROUP_PROBES) {
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
			for (const candidate of candidates) {
				expect(marker(`${candidate} probe-marker`), candidate).toBe(
					"probe-marker",
				);
				expect(sameGroup(`${candidate} ${candidate}`)).toBe(candidate);
			}
		}
	});
});
