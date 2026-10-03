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

	it("applies the default width to boards the renderer marks, not by class name", () => {
		// Artboards decides from the board's resolved classes (see board-sizing).
		expect(shellHtml).not.toMatch(/\[class[\^*]=/);
		expect(shellHtml).toMatch(
			/\[data-trickroom-board-default-width\]\s*\{\s*min-width: var\(--trickroom-canvas-board-default-width\);/,
		);
	});

	it("gives boards with an open overlay a default height", () => {
		expect(
			shellHtml.match(/--trickroom-canvas-board-default-height:/g),
		).toHaveLength(1);
		const overlayHeightRule = (mode: string) =>
			shellHtml.match(
				new RegExp(
					`\\[data-trickroom-board-default-height="${mode}"\\]:has\\(\\s*> \\[data-trickroom-board-portal\\] > \\*\\s*\\)\\s*\\{([^}]*)\\}`,
				),
			)?.[1];
		expect(overlayHeightRule("canvas")).toContain(
			"min-height: var(--trickroom-canvas-board-default-height);",
		);
		expect(overlayHeightRule("viewport")).toContain("min-height: 100vh;");
	});

	it("makes each board the containing block for its fixed overlays", () => {
		expect(shellHtml).toMatch(
			/\.frame-content > main > \[data-trickroom-root-id\]\s*\{\s*contain: layout;/,
		);
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
