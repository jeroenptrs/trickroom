import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildExportFontCss, inlineCssFontUrls } from "./fonts";

describe("buildExportFontCss", () => {
	it("returns empty when there is no system", async () => {
		expect(await buildExportFontCss(process.cwd(), null)).toEqual({
			stylesheetLinks: [],
			fontFaceCss: "",
		});
	});

	it("inlines the system's manifest fonts as data URIs (no hardcoded CDN)", async () => {
		// The repo's trickroom system registers IBM Plex as project woff2 files.
		const result = await buildExportFontCss(process.cwd(), "trickroom");
		expect(result.fontFaceCss).toContain("@font-face");
		expect(result.fontFaceCss).toContain("IBM Plex");
		expect(result.fontFaceCss).toContain("data:font/woff2;base64,");
		expect(result.stylesheetLinks).toEqual([]);
	});
});

describe("inlineCssFontUrls", () => {
	it("inlines local font url()s and leaves remote/data urls alone", async () => {
		const dir = await mkdtemp(path.join(tmpdir(), "tr-fonts-"));
		try {
			await writeFile(path.join(dir, "x.woff2"), Buffer.from([1, 2, 3, 4]));
			const css = [
				'@font-face{font-family:"X";src:url(./x.woff2) format("woff2")}',
				'@font-face{font-family:"Y";src:url("https://cdn.example/y.woff2")}',
				'@font-face{font-family:"Z";src:url(data:font/woff2;base64,AAA)}',
			].join("\n");

			const out = await inlineCssFontUrls(css, dir, dir);

			expect(out).toContain("data:font/woff2;base64,AQIDBA==");
			expect(out).not.toContain("url(./x.woff2)");
			expect(out).toContain("https://cdn.example/y.woff2");
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it("finds fonts referenced relative to an @import-ed file in another dir", async () => {
		// Mirrors the DeltaBlue layout: cssPath is in design-system/tailwind/themes,
		// but the @font-face's `./geist-sans/...` is relative to design-system/fonts.
		const dir = await mkdtemp(path.join(tmpdir(), "tr-fonts2-"));
		try {
			const fontsDir = path.join(dir, "ds", "fonts", "geist-sans");
			await mkdir(fontsDir, { recursive: true });
			await writeFile(path.join(fontsDir, "g.woff2"), Buffer.from([9, 9, 9]));
			const cssDir = path.join(dir, "ds", "tailwind", "themes");
			const css =
				'@font-face{font-family:"G";src:url(./geist-sans/g.woff2) format("woff2")}';

			const out = await inlineCssFontUrls(css, cssDir, dir);

			expect(out).toContain("data:font/woff2;base64,");
			expect(out).not.toContain("url(./geist-sans/g.woff2)");
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it("returns css unchanged when there are no local font urls", async () => {
		const css = ".a{color:red}";
		expect(await inlineCssFontUrls(css, "/nope", "/nope")).toBe(css);
	});
});
