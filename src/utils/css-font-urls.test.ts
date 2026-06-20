import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { rewriteCssFontUrls } from "./css-font-urls";

describe("rewriteCssFontUrls", () => {
	it("rewrites local font url()s to served URLs (cross-dir @import layout)", async () => {
		const dir = await mkdtemp(path.join(tmpdir(), "tr-css-fonts-"));
		try {
			const fontsDir = path.join(dir, "ds", "fonts", "geist-sans");
			await mkdir(fontsDir, { recursive: true });
			await writeFile(path.join(fontsDir, "g.woff2"), Buffer.from([1]));
			const cssDir = path.join(dir, "ds", "tailwind", "themes");
			const css = '@font-face{src:url(./geist-sans/g.woff2) format("woff2")}';

			const out = await rewriteCssFontUrls(
				css,
				cssDir,
				dir,
				(rel) => `/served/${rel}`,
			);

			expect(out).toContain('url("/served/ds/fonts/geist-sans/g.woff2")');
			expect(out).not.toContain("./geist-sans/g.woff2");
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it("leaves remote and data urls untouched", async () => {
		const css =
			'@font-face{src:url("https://x.example/y.woff2")}\n.a{background:url(data:image/png;base64,AAA)}';
		expect(
			await rewriteCssFontUrls(
				css,
				"/nope",
				"/nope",
				(rel) => `/served/${rel}`,
			),
		).toBe(css);
	});
});
