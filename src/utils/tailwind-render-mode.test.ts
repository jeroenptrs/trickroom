import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
	resolveStageDoc,
	stripBrowserRuntimeScript,
	TAILWIND_RENDER_MODE,
} from "./tailwind-render-mode";

const shellHtml = readFileSync(
	path.join(
		path.dirname(fileURLToPath(import.meta.url)),
		"../iframe/shell.html",
	),
	"utf8",
);

describe("tailwind render mode", () => {
	it("defaults to the compiled engine when the flag is unset", () => {
		// Tests run without VITE_TAILWIND_RENDER_MODE / window override.
		expect(TAILWIND_RENDER_MODE).toBe("compiled");
	});

	it("stripBrowserRuntimeScript removes the runtime script from the shell", () => {
		expect(shellHtml).toContain("/tailwind/index.global.js");
		const stripped = stripBrowserRuntimeScript(shellHtml);
		expect(stripped).not.toContain("/tailwind/index.global.js");
		// Everything else stays.
		expect(stripped).toContain('id="trickroom-viewport"');
	});

	it("resolveStageDoc strips the browser runtime script by default (compiled mode)", () => {
		const resolved = resolveStageDoc(shellHtml);
		expect(resolved).not.toContain("/tailwind/index.global.js");
		expect(resolved).toContain('id="trickroom-viewport"');
	});

	it("resolveStageDoc enables the reveal-on-ready gate in compiled mode", () => {
		// Shell carries the gate rule; compiled mode opts the <html> in.
		expect(shellHtml).toContain("data-trickroom-await-styles");
		expect(shellHtml).not.toContain("<html data-trickroom-await-styles");
		const resolved = resolveStageDoc(shellHtml);
		expect(resolved).toContain("<html data-trickroom-await-styles");
	});

	it("scopes library root fit-content to canvas stage mode only", () => {
		expect(shellHtml).toContain(
			'html[data-trickroom-stage-mode="canvas"]',
		);
		expect(shellHtml).toMatch(
			/html\[data-trickroom-stage-mode="canvas"\][\s\S]*fit-content/,
		);
		expect(shellHtml).not.toContain(
			".frame-content > main > [data-trickroom-library]",
		);
	});
});
