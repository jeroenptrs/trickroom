import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const shellHtml = readFileSync(
	path.join(path.dirname(fileURLToPath(import.meta.url)), "shell.html"),
	"utf8",
);

function getCanvasRules() {
	return Array.from(
		shellHtml.matchAll(
			/html\[data-trickroom-stage-mode="canvas"\]([^{]*)\{([^}]*)\}/g,
		),
		([, selector, body]) => ({
			selector: (selector ?? "").replace(/\s+/g, " ").trim(),
			body: body ?? "",
		}),
	);
}

describe("stage shell canvas boards", () => {
	it("defines the default board width once", () => {
		expect(
			shellHtml.match(/--trickroom-canvas-board-default-width:/g),
		).toHaveLength(1);
		expect(shellHtml).toContain(
			"--trickroom-canvas-board-default-width: 1280px;",
		);
	});

	it("keeps canvas boards from shrinking to share the pane", () => {
		const boardRule = getCanvasRules().find(({ selector }) =>
			selector.endsWith("> [data-trickroom-library]"),
		);
		expect(boardRule?.body).toContain("flex-shrink: 0;");
	});

	it("only applies the default width to boards without a width utility", () => {
		const defaultWidthRule = getCanvasRules().find(({ body }) =>
			body.includes("min-width: var(--trickroom-canvas-board-default-width)"),
		);
		for (const utility of ["w-", "min-w-", "max-w-", "size-"]) {
			expect(defaultWidthRule?.selector).toContain(`[class^="${utility}"]`);
			expect(defaultWidthRule?.selector).toContain(`[class*=" ${utility}"]`);
			expect(defaultWidthRule?.selector).toContain(`[class*=":${utility}"]`);
		}
		expect(defaultWidthRule?.selector).toContain('[style*="width"]');
	});

	it("floors main at the default width so full-width boards stay desktop-sized", () => {
		const mainRule = getCanvasRules().find(({ selector }) =>
			selector.endsWith(".frame-content > main"),
		);
		expect(mainRule?.body).toContain(
			"min-width: max(100vw, var(--trickroom-canvas-board-default-width));",
		);
	});
});
