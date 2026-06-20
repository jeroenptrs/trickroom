import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { classifyParsedClass, parseClassName } from "./tailwind-classname";
import { loadTailwindDesignSystem } from "./tailwind-design-system";
import {
	createTailwindIntrospection,
	extractCustomFunctionalUtilities,
} from "./tailwind-introspection";
import { extractTailwindCustomUtilities } from "./tailwind-token-domains";

const tempDirs: string[] = [];

async function createFixture(indexCssContent: string) {
	const dir = await mkdtemp(path.join(process.cwd(), ".tmp-tw-introspection-"));
	tempDirs.push(dir);
	await mkdir(path.join(dir, "src"), { recursive: true });
	await writeFile(path.join(dir, "src", "index.css"), indexCssContent, "utf8");
	return { projectRoot: dir, cssPath: "src/index.css" };
}

afterEach(async () => {
	await Promise.all(
		tempDirs.splice(0).map((d) => rm(d, { force: true, recursive: true })),
	);
});

describe("createTailwindIntrospection", () => {
	it("recognizes built-in candidates", async () => {
		const css = '@import "tailwindcss";\n';
		const { projectRoot, cssPath } = await createFixture(css);
		const { designSystem } = await loadTailwindDesignSystem({
			projectRoot,
			cssPath,
		});
		const intro = createTailwindIntrospection(designSystem, css);

		expect(intro.isKnownCandidate("flex")).toBe(true);
		expect(intro.isKnownCandidate("bg-blue-500")).toBe(true);
		expect(intro.isKnownCandidate("not-a-real-utility")).toBe(false);
	});

	it("recognizes custom @utility candidates", async () => {
		const css = [
			'@import "tailwindcss";',
			"@theme {",
			"  --db-interaction-sm: 0.875rem;",
			"  --db-interaction-lg: 1.25rem;",
			"}",
			"@utility text-interaction-* {",
			"  font-size: --value(--db-interaction-*);",
			"}",
			"",
		].join("\n");
		const { projectRoot, cssPath } = await createFixture(css);
		const { designSystem } = await loadTailwindDesignSystem({
			projectRoot,
			cssPath,
		});
		const intro = createTailwindIntrospection(designSystem, css);

		expect(intro.isKnownCandidate("text-interaction-sm")).toBe(true);
		expect(intro.isKnownCandidate("text-interaction-lg")).toBe(true);
		expect(intro.getFunctionalUtilityRoots()).toContain("text-interaction");
	});

	it("resolves custom namespace tokens", async () => {
		const css = [
			'@import "tailwindcss";',
			"@theme {",
			"  --db-interaction-sm: 0.875rem;",
			"  --db-interaction-lg: 1.25rem;",
			"}",
			"",
		].join("\n");
		const { projectRoot, cssPath } = await createFixture(css);
		const { designSystem } = await loadTailwindDesignSystem({
			projectRoot,
			cssPath,
		});
		const intro = createTailwindIntrospection(designSystem, css);

		const ns = intro.resolveNamespace("--db-interaction");
		expect(ns.get("sm")).toBe("0.875rem");
		expect(ns.get("lg")).toBe("1.25rem");
	});

	it("exposes theme entries via public theme.entries() API", async () => {
		const css = [
			'@import "tailwindcss";',
			"@theme {",
			"  --color-brand: oklch(0.6 0.2 280);",
			"}",
			"",
		].join("\n");
		const { projectRoot, cssPath } = await createFixture(css);
		const { designSystem } = await loadTailwindDesignSystem({
			projectRoot,
			cssPath,
		});
		const intro = createTailwindIntrospection(designSystem, css);

		const entries = [...intro.getThemeEntries()];
		const brandEntry = entries.find(([key]) => key === "--color-brand");
		expect(brandEntry).toBeDefined();
		expect(brandEntry?.[1].value).toBe("oklch(0.6 0.2 280)");
	});

	it("returns completions for a custom @utility root", async () => {
		const css = [
			'@import "tailwindcss";',
			"@theme {",
			"  --db-interaction-sm: 0.875rem;",
			"  --db-interaction-lg: 1.25rem;",
			"}",
			"@utility text-interaction-* {",
			"  font-size: --value(--db-interaction-*);",
			"}",
			"",
		].join("\n");
		const { projectRoot, cssPath } = await createFixture(css);
		const { designSystem } = await loadTailwindDesignSystem({
			projectRoot,
			cssPath,
		});
		const intro = createTailwindIntrospection(designSystem, css);

		const completions = intro.getCompletions("text-interaction");
		const allValues = completions.flatMap((g) => g.values.filter(Boolean));
		expect(allValues).toContain("sm");
		expect(allValues).toContain("lg");
	});

	it("reports custom @utility roots via getCustomFunctionalUtilities()", async () => {
		const css = [
			'@import "tailwindcss";',
			"@theme {",
			"  --db-interaction-sm: 0.875rem;",
			"}",
			"@utility text-interaction-* {",
			"  font-size: --value(--db-interaction-*);",
			"}",
			"",
		].join("\n");
		const { projectRoot, cssPath } = await createFixture(css);
		const { designSystem } = await loadTailwindDesignSystem({
			projectRoot,
			cssPath,
		});
		const intro = createTailwindIntrospection(designSystem, css);

		const customs = intro.getCustomFunctionalUtilities();
		expect(customs).toEqual([
			{
				root: "text-interaction",
				consumedNamespaces: ["--db-interaction"],
			},
		]);
	});

	it("discovers @utility blocks defined in @import-ed files via loaded.cssSource", async () => {
		// The custom @utility lives in an imported file, not the entry CSS, so it
		// is only visible if the loader accumulates imported stylesheet contents.
		const dir = await mkdtemp(
			path.join(process.cwd(), ".tmp-tw-introspection-"),
		);
		tempDirs.push(dir);
		await mkdir(path.join(dir, "src"), { recursive: true });
		await writeFile(
			path.join(dir, "src", "index.css"),
			['@import "tailwindcss";', '@import "./utilities.css";', ""].join("\n"),
			"utf8",
		);
		await writeFile(
			path.join(dir, "src", "utilities.css"),
			[
				"@theme {",
				"  --db-interaction-sm: 0.875rem;",
				"}",
				"@utility text-interaction-* {",
				"  font-size: --value(--db-interaction-*);",
				"}",
				"",
			].join("\n"),
			"utf8",
		);

		const { designSystem, cssSource } = await loadTailwindDesignSystem({
			projectRoot: dir,
			cssPath: "src/index.css",
		});
		const intro = createTailwindIntrospection(designSystem, cssSource);

		expect(intro.getCustomFunctionalUtilities()).toEqual([
			{ root: "text-interaction", consumedNamespaces: ["--db-interaction"] },
		]);
		expect(intro.isKnownCandidate("text-interaction-sm")).toBe(true);
	});

	it("golden: parseCandidate.raw preserves the original candidate string", async () => {
		// Establishes the contract we rely on: ParsedClass.raw is always the
		// original string byte-for-byte. Use it for round-tripping and slot keys
		// — never parseCandidate.variants, which is NOT in source order.
		const css = '@import "tailwindcss";\n';
		const { projectRoot, cssPath } = await createFixture(css);
		const { designSystem } = await loadTailwindDesignSystem({
			projectRoot,
			cssPath,
		});

		const raw = "md:hover:bg-blue-500";
		const candidates = Array.from(designSystem.parseCandidate(raw));
		expect(candidates.length).toBeGreaterThan(0);
		for (const candidate of candidates) {
			expect(candidate.raw).toBe(raw);
		}
	});

	it("golden: getClassList returns a large set of known class entries", async () => {
		// Documents that getClassList is theme-dependent; do not hardcode counts.
		const css = '@import "tailwindcss";\n';
		const { projectRoot, cssPath } = await createFixture(css);
		const { designSystem } = await loadTailwindDesignSystem({
			projectRoot,
			cssPath,
		});

		const classList = designSystem.getClassList();
		// With full @import "tailwindcss", there are >20,000 entries.
		expect(classList.length).toBeGreaterThan(10_000);
	});
});

describe("extractCustomFunctionalUtilities", () => {
	it("returns empty array when no @utility blocks", () => {
		expect(extractCustomFunctionalUtilities('@import "tailwindcss";')).toEqual(
			[],
		);
	});

	it("parses @utility wildcard root and consumed namespace", () => {
		const css = [
			"@utility text-interaction-* {",
			"  font-size: --value(--db-interaction-*);",
			"}",
		].join("\n");
		expect(extractCustomFunctionalUtilities(css)).toEqual([
			{
				root: "text-interaction",
				consumedNamespaces: ["--db-interaction"],
			},
		]);
	});

	it("parses static @utility (no wildcard) with no consumed namespaces", () => {
		const css = "@utility sr-only { position: absolute; }";
		expect(extractCustomFunctionalUtilities(css)).toEqual([
			{ root: "sr-only", consumedNamespaces: [] },
		]);
	});

	it("extracts multiple consumed namespaces from one @utility block", () => {
		const css = [
			"@utility multi-* {",
			"  font-size: --value(--scale-*);",
			"  line-height: --modifier(--leading-*);",
			"}",
		].join("\n");
		expect(extractCustomFunctionalUtilities(css)).toEqual([
			{
				root: "multi",
				consumedNamespaces: ["--leading", "--scale"],
			},
		]);
	});

	it("handles multiple @utility blocks", () => {
		const css = [
			"@utility text-interaction-* {",
			"  font-size: --value(--db-interaction-*);",
			"}",
			"@utility spacing-custom-* {",
			"  padding: --value(--custom-spacing-*);",
			"}",
		].join("\n");
		expect(extractCustomFunctionalUtilities(css)).toEqual([
			{
				root: "text-interaction",
				consumedNamespaces: ["--db-interaction"],
			},
			{
				root: "spacing-custom",
				consumedNamespaces: ["--custom-spacing"],
			},
		]);
	});

	it("handles --value without wildcard suffix", () => {
		const css = [
			"@utility my-util-* {",
			"  color: --value(--brand);",
			"}",
		].join("\n");
		expect(extractCustomFunctionalUtilities(css)).toEqual([
			{ root: "my-util", consumedNamespaces: ["--brand"] },
		]);
	});

	it("deduplicates consumed namespaces", () => {
		const css = [
			"@utility my-util-* {",
			"  font-size: --value(--scale-*);",
			"  gap: --value(--scale-*);",
			"}",
		].join("\n");
		expect(extractCustomFunctionalUtilities(css)).toEqual([
			{ root: "my-util", consumedNamespaces: ["--scale"] },
		]);
	});

	it("ignores @utility blocks inside CSS comments", () => {
		const css = [
			"/* @utility commented-* { font-size: --value(--ghost-*); } */",
			"@utility real-* {",
			"  font-size: --value(--scale-*);",
			"}",
		].join("\n");
		expect(extractCustomFunctionalUtilities(css)).toEqual([
			{ root: "real", consumedNamespaces: ["--scale"] },
		]);
	});

	it("does not let braces inside strings truncate the block body", () => {
		const css = [
			"@utility tricky-* {",
			'  content: "}";',
			"  font-size: --value(--scale-*);",
			"}",
		].join("\n");
		expect(extractCustomFunctionalUtilities(css)).toEqual([
			{ root: "tricky", consumedNamespaces: ["--scale"] },
		]);
	});

	it("does not treat a /* inside a string as a comment opener", () => {
		const css = [
			"@utility quoted-* {",
			'  content: "/*";',
			"  font-size: --value(--scale-*);",
			"}",
		].join("\n");
		expect(extractCustomFunctionalUtilities(css)).toEqual([
			{ root: "quoted", consumedNamespaces: ["--scale"] },
		]);
	});
});

describe("extractTailwindCustomUtilities (functional + static)", () => {
	const tempDirs: string[] = [];

	afterEach(async () => {
		await Promise.all(
			tempDirs.splice(0).map((d) => rm(d, { force: true, recursive: true })),
		);
	});

	async function loadIntrospectionFor(css: string) {
		const dir = await mkdtemp(path.join(process.cwd(), ".tmp-tw-custom-"));
		tempDirs.push(dir);
		await mkdir(path.join(dir, "src"), { recursive: true });
		await writeFile(path.join(dir, "src", "index.css"), css, "utf8");
		const { designSystem, cssSource } = await loadTailwindDesignSystem({
			projectRoot: dir,
			cssPath: "src/index.css",
		});
		return createTailwindIntrospection(designSystem, cssSource);
	}

	// `wobble` is used for the functional case so its root does not collide with
	// a built-in domain prefix (e.g. `text-*` is claimed by the color/style
	// domains first — the separate ambiguous-root concern).
	const css = [
		'@import "tailwindcss";',
		"@theme {",
		"  --wobble-sm: 1rem;",
		"}",
		// functional (wildcard, consumes a namespace)
		"@utility wobble-* {",
		"  width: --value(--wobble-*);",
		"}",
		// static (value-less, @apply built-ins) — the common real-world shape
		"@utility core-interaction-primary {",
		"  @apply font-semibold cursor-pointer;",
		"}",
		"",
	].join("\n");

	it("surfaces both functional and static custom utilities with their kind", async () => {
		const intro = await loadIntrospectionFor(css);
		const utilities = extractTailwindCustomUtilities(intro);

		const functional = utilities.find((u) => u.root === "wobble");
		const staticUtility = utilities.find(
			(u) => u.root === "core-interaction-primary",
		);

		expect(functional).toMatchObject({
			kind: "functional",
			consumedNamespaces: ["--wobble"],
		});
		expect(functional?.completionValues).toContain("sm");
		// `wobble-*` sets `width` → folds into the size domain.
		expect(functional?.domains).toEqual(["size"]);

		expect(staticUtility).toMatchObject({
			root: "core-interaction-primary",
			kind: "static",
			consumedNamespaces: [],
			completionValues: [],
		});
		// `@apply font-semibold cursor-pointer` → typography + interaction.
		expect(staticUtility?.domains).toEqual(["interaction", "typography"]);
	});

	it("classifies static (exact) and functional (prefix) custom utilities by kind", async () => {
		const intro = await loadIntrospectionFor(css);
		const utilities = extractTailwindCustomUtilities(intro);
		const sortRoots = (kind: "functional" | "static") =>
			utilities
				.filter((u) => u.kind === kind)
				.map((u) => u.root)
				.sort((a, b) => b.length - a.length || a.localeCompare(b));
		const context = {
			colorTokens: new Set<string>(),
			customFunctionalUtilityRoots: sortRoots("functional"),
			customStaticUtilityRoots: sortRoots("static"),
		};

		// Static utility: exact name is known.
		const staticIntent = classifyParsedClass(
			parseClassName("core-interaction-primary")[0],
			context,
		);
		expect(staticIntent.kind).toBe("custom-functional");
		if (staticIntent.kind === "custom-functional") {
			expect(staticIntent.property).toBe("core-interaction-primary");
			expect(staticIntent.value).toBeNull();
		}

		// Static utility: a stray value suffix must NOT prefix-match → unknown.
		expect(
			classifyParsedClass(
				parseClassName("core-interaction-primary-bogus")[0],
				context,
			).kind,
		).toBe("unknown");

		// Functional utility: value suffix matches by prefix.
		const functionalIntent = classifyParsedClass(
			parseClassName("wobble-sm")[0],
			context,
		);
		expect(functionalIntent.kind).toBe("custom-functional");
		if (functionalIntent.kind === "custom-functional") {
			expect(functionalIntent.property).toBe("wobble");
			expect(functionalIntent.value).toBe("sm");
		}
	});

	it("custom utilities win over built-in color/style heuristics on shared prefixes", async () => {
		// `text-brand-*` (functional) and `bg-brand-ghost` (static) share the
		// built-in `text-`/`bg-` color prefixes; without custom-functional running
		// first they would mis-classify as `color`.
		const collidingCss = [
			'@import "tailwindcss";',
			"@theme {",
			"  --brand-sm: 0.5rem;",
			"}",
			"@utility text-brand-* {",
			"  font-size: --value(--brand-*);",
			"}",
			"@utility bg-brand-ghost {",
			"  @apply opacity-50;",
			"}",
			"",
		].join("\n");
		const intro = await loadIntrospectionFor(collidingCss);
		const utilities = extractTailwindCustomUtilities(intro);
		const sortRoots = (kind: "functional" | "static") =>
			utilities
				.filter((u) => u.kind === kind)
				.map((u) => u.root)
				.sort((a, b) => b.length - a.length || a.localeCompare(b));
		const context = {
			colorTokens: new Set<string>(),
			customFunctionalUtilityRoots: sortRoots("functional"),
			customStaticUtilityRoots: sortRoots("static"),
		};

		const functional = classifyParsedClass(
			parseClassName("text-brand-sm")[0],
			context,
		);
		expect(functional.kind).toBe("custom-functional");
		if (functional.kind === "custom-functional") {
			expect(functional.property).toBe("text-brand");
		}

		const staticIntent = classifyParsedClass(
			parseClassName("bg-brand-ghost")[0],
			context,
		);
		expect(staticIntent.kind).toBe("custom-functional");
		if (staticIntent.kind === "custom-functional") {
			expect(staticIntent.property).toBe("bg-brand-ghost");
		}

		// A genuine built-in color is still classified as color (custom-functional
		// returns null for it).
		expect(
			classifyParsedClass(parseClassName("bg-blue-500")[0], context).kind,
		).toBe("color");
	});
});
