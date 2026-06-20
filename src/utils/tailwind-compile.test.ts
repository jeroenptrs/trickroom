import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { compileTailwindCss } from "./tailwind-design-system";

const tempDirs: string[] = [];

async function createFixture(css: string) {
	const dir = await mkdtemp(path.join(process.cwd(), ".tmp-tw-compile-"));
	tempDirs.push(dir);
	await mkdir(path.join(dir, "src"), { recursive: true });
	await writeFile(path.join(dir, "src", "index.css"), css, "utf8");
	return dir;
}

afterEach(async () => {
	await Promise.all(
		tempDirs.splice(0).map((d) => rm(d, { force: true, recursive: true })),
	);
});

const SYSTEM_CSS = [
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

describe("compileTailwindCss", () => {
	it("emits a full stylesheet: preflight + theme vars + only the used utilities", async () => {
		const projectRoot = await createFixture(SYSTEM_CSS);
		const css = await compileTailwindCss({
			projectRoot,
			cssPath: "src/index.css",
			candidates: ["flex", "bg-brand", "text-interaction-sm"],
		});

		// Preflight (base layer).
		expect(css).toContain("box-sizing");
		// Theme :root variables, custom + built-in.
		expect(css).toContain("--color-brand");
		// Used utilities, built-in + custom.
		expect(css).toContain("display: flex");
		expect(css).toContain(".bg-brand");
		expect(css).toContain(".text-interaction-sm");
		// Unused utilities are not emitted.
		expect(css).not.toContain(".grid{");
	});

	it("prepends `@import tailwindcss` for a theme-fragment cssPath that lacks it", async () => {
		// Mirrors a system whose registered cssPath is a theme fragment imported
		// after tailwindcss elsewhere (e.g. deltablue's themes/v2.css). Compiled
		// standalone it must still get preflight + built-in utilities.
		const projectRoot = await createFixture(
			[
				"@theme { --color-brand: oklch(0.6 0.2 280); }",
				"@utility card { @apply font-bold; }",
				"",
			].join("\n"),
		);
		const css = await compileTailwindCss({
			projectRoot,
			cssPath: "src/index.css",
			candidates: ["flex", "bg-brand", "card"],
		});

		expect(css).toContain("box-sizing"); // preflight present despite no @import
		expect(css).toContain("display: flex"); // built-in utility
		expect(css).toContain("--color-brand"); // custom theme var
		expect(css).toContain(".card"); // custom utility
	});

	it("applies appended themeOverrides so live token edits win", async () => {
		const projectRoot = await createFixture(SYSTEM_CSS);
		const base = await compileTailwindCss({
			projectRoot,
			cssPath: "src/index.css",
			candidates: ["bg-brand"],
		});
		const overridden = await compileTailwindCss({
			projectRoot,
			cssPath: "src/index.css",
			candidates: ["bg-brand"],
			themeOverrides: "@theme { --color-brand: oklch(0.5 0.1 30); }",
		});

		expect(base).toContain("oklch(0.6 0.2 280)");
		expect(overridden).toContain("oklch(0.5 0.1 30)");
		expect(overridden).not.toContain("oklch(0.6 0.2 280)");
	});

	it("reuses the compiled stylesheet across calls (mtime cache) for new candidates", async () => {
		const projectRoot = await createFixture(SYSTEM_CSS);
		const first = await compileTailwindCss({
			projectRoot,
			cssPath: "src/index.css",
			candidates: ["flex"],
		});
		const second = await compileTailwindCss({
			projectRoot,
			cssPath: "src/index.css",
			candidates: ["grid"],
		});

		expect(first).toContain(".flex");
		expect(first).not.toContain(".grid{");
		expect(second).toContain(".grid");
		expect(second).not.toContain(".flex{");
	});
});
