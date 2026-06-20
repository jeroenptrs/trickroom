/**
 * Browser-feasibility spike (scratchpad #117, step 4).
 *
 * Question: can `__unstable__loadDesignSystem` — the keeper engine — run in the
 * design iframe instead of `@tailwindcss/browser`?
 *
 * The pessimistic v2 review note said the loader "uses node:fs/createRequire/fs
 * imports". That is true of *Trickroom's* loader (`tailwind-design-system.ts`),
 * NOT of the tailwindcss core. This spike isolates the two: it drives
 * `__unstable__loadDesignSystem` with a PURE in-memory `loadStylesheet` (a
 * `Map`, no `node:fs`, no `createRequire`) — exactly the resolver shape a browser
 * bundle would supply via `fetch`/inlined strings.
 *
 * If this passes, the core API is browser-bundleable and the remaining work is
 * (a) a browser stylesheet/module resolver and (b) emitting base/theme/preflight
 * + utilities CSS into the iframe (candidatesToCss alone does NOT do this — see
 * the parity test below).
 *
 * Findings are mirrored into the scratchpad. This file is a spike: it documents
 * and measures, it is not a production code path.
 */

import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { __unstable__loadDesignSystem } from "tailwindcss";
import { describe, expect, it } from "vitest";

// Read the package CSS exactly once, at setup, to simulate the "bundle" step a
// browser build would perform (Vite inlining `tailwindcss/index.css`, or a
// fetch of a served asset). The DS call path below never touches fs again.
const requireFromHere = createRequire(import.meta.url);
async function readPackageCss(specifier: string): Promise<string> {
	return readFile(requireFromHere.resolve(specifier), "utf8");
}

/**
 * A browser-shaped resolver: resolves only from an in-memory map. No fs, no
 * module resolution. Mirrors what `@tailwindcss/browser` does internally
 * (it ships its own `loadStylesheet` and throws if none is provided).
 */
function createInMemoryStylesheetLoader(files: Map<string, string>) {
	return async (id: string, base: string) => {
		const content = files.get(id);
		if (content === undefined) {
			throw new Error(
				`in-memory loader: no stylesheet for "${id}" (base ${base})`,
			);
		}
		return { path: id, base, content };
	};
}

describe("browser spike: __unstable__loadDesignSystem with a pure in-memory resolver", () => {
	it("loads the core DS with no fs/createRequire in the call path", async () => {
		const indexCss = await readPackageCss("tailwindcss/index.css");
		const files = new Map<string, string>([["tailwindcss", indexCss]]);

		const css = [
			'@import "tailwindcss";',
			"@theme {",
			"  --color-brand: oklch(0.6 0.2 280);",
			"  --db-interaction-sm: 0.875rem;",
			"}",
			"@utility text-interaction-* {",
			"  font-size: --value(--db-interaction-*);",
			"}",
			"",
		].join("\n");

		const ds = await __unstable__loadDesignSystem(css, {
			base: "/",
			loadStylesheet: createInMemoryStylesheetLoader(files),
		});

		// Theme parity: custom + built-in theme entries resolve.
		const entries = new Map(ds.theme.entries());
		expect(entries.get("--color-brand")?.value).toBe("oklch(0.6 0.2 280)");
		expect(entries.has("--color-red-500")).toBe(true);

		// Utility recognition parity: built-in + custom @utility both known.
		expect(Array.from(ds.parseCandidate("bg-brand")).length).toBeGreaterThan(0);
		expect(
			Array.from(ds.parseCandidate("text-interaction-sm")).length,
		).toBeGreaterThan(0);

		// Utility CSS emission works for both.
		const [brandCss] = ds.candidatesToCss(["bg-brand"]);
		expect(brandCss).toContain("--color-brand");
		const [interactionCss] = ds.candidatesToCss(["text-interaction-sm"]);
		expect(interactionCss).toContain("font-size");
	});

	it("PARITY GAP: candidatesToCss emits only utility rules — no base/preflight/theme vars", async () => {
		const indexCss = await readPackageCss("tailwindcss/index.css");
		const files = new Map<string, string>([["tailwindcss", indexCss]]);
		const ds = await __unstable__loadDesignSystem('@import "tailwindcss";', {
			base: "/",
			loadStylesheet: createInMemoryStylesheetLoader(files),
		});

		const [flexCss] = ds.candidatesToCss(["flex"]);
		// It DOES emit the utility...
		expect(flexCss).toContain("display: flex");
		// ...but it does NOT carry preflight (`box-sizing: border-box`) nor the
		// `:root`/`@theme` variable declarations. Replacing @tailwindcss/browser
		// therefore requires separately emitting preflight + theme `:root` vars,
		// which is what `compile()` (not loadDesignSystem) produces.
		expect(flexCss).not.toContain("box-sizing");
		expect(flexCss ?? "").not.toContain(":root");
	});

	it("perf: measures load + getClassList + candidatesToCss on a realistic class set", async () => {
		const indexCss = await readPackageCss("tailwindcss/index.css");
		const files = new Map<string, string>([["tailwindcss", indexCss]]);

		const loadStart = performance.now();
		const ds = await __unstable__loadDesignSystem('@import "tailwindcss";', {
			base: "/",
			loadStylesheet: createInMemoryStylesheetLoader(files),
		});
		const loadMs = performance.now() - loadStart;

		const classListStart = performance.now();
		const classList = ds.getClassList();
		const classListMs = performance.now() - classListStart;

		// A realistic design might reference a few hundred distinct utilities.
		const sample = [
			"flex",
			"grid",
			"hidden",
			"p-4",
			"px-2",
			"mt-8",
			"gap-2",
			"text-sm",
			"text-lg",
			"font-bold",
			"bg-blue-500",
			"bg-red-100",
			"text-white",
			"rounded-lg",
			"shadow-md",
			"border",
			"border-gray-200",
			"hover:bg-blue-600",
			"md:flex",
			"dark:bg-gray-900",
			"items-center",
			"justify-between",
			"w-full",
			"h-screen",
			"absolute",
			"relative",
			"z-10",
			"opacity-50",
			"transition",
			"duration-150",
		];
		const candidates = Array.from(
			{ length: 300 },
			(_, i) => sample[i % sample.length],
		);

		const cssStart = performance.now();
		const css = ds.candidatesToCss(candidates);
		const cssMs = performance.now() - cssStart;

		console.log(
			`[browser-spike perf] load=${loadMs.toFixed(1)}ms ` +
				`getClassList(${classList.length} entries)=${classListMs.toFixed(1)}ms ` +
				`candidatesToCss(${candidates.length})=${cssMs.toFixed(1)}ms`,
		);

		expect(css.length).toBe(candidates.length);
		// Sanity guardrails (generous; these are not SLAs, just regression smoke).
		expect(loadMs).toBeLessThan(5000);
	});
});
