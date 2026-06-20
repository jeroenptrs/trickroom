import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	extractGoogleStylesheetUrls,
	inferFontSourcesFromCss,
	inferFontSourcesFromSystemStylesheet,
} from "./font-source-inference.ts";

describe("font source inference", () => {
	let projectRoot: string;

	beforeEach(async () => {
		projectRoot = await mkdtemp(
			path.join(process.cwd(), ".tmp-trickroom-font-source-inference-"),
		);
	});

	afterEach(async () => {
		await rm(projectRoot, { force: true, recursive: true });
	});

	it("infers Google Fonts stylesheet candidates from imports and raw URLs", () => {
		const css = [
			'@import url("https://fonts.googleapis.com/css2?family=Roboto:wght@400;700&display=swap");',
			"/* also */ https://fonts.googleapis.com/css2?family=Inter:wght@400&display=swap",
		].join("\n");

		expect(extractGoogleStylesheetUrls(css).sort()).toEqual(
			[
				"https://fonts.googleapis.com/css2?family=Roboto:wght@400;700&display=swap",
				"https://fonts.googleapis.com/css2?family=Inter:wght@400&display=swap",
			].sort(),
		);

		const result = inferFontSourcesFromCss(css);
		expect(result.candidates).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					family: "Roboto",
					faces: [
						expect.objectContaining({
							sources: [
								expect.objectContaining({
									kind: "remoteStylesheet",
									url: "https://fonts.googleapis.com/css2?family=Roboto:wght@400;700&display=swap",
								}),
							],
						}),
					],
				}),
				expect.objectContaining({ family: "Inter" }),
			]),
		);
	});

	it("keeps distinct Google stylesheet URLs that share a common prefix", () => {
		const css = [
			'@import url("https://fonts.googleapis.com/css2?family=Roboto:wght@400&display=swap");',
			'@import url("https://fonts.googleapis.com/css2?family=Roboto+Mono:wght@400&display=swap");',
		].join("\n");

		expect(extractGoogleStylesheetUrls(css).sort()).toEqual(
			[
				"https://fonts.googleapis.com/css2?family=Roboto:wght@400&display=swap",
				"https://fonts.googleapis.com/css2?family=Roboto+Mono:wght@400&display=swap",
			].sort(),
		);

		const result = inferFontSourcesFromCss(css);
		expect(result.candidates.map((candidate) => candidate.family).sort()).toEqual(
			["Roboto", "Roboto Mono"],
		);
	});

	it("infers multiple Google families from repeated family params", () => {
		const css =
			'@import url("https://fonts.googleapis.com/css2?family=Roboto:wght@400&family=Inter:wght@400&display=swap");';

		const result = inferFontSourcesFromCss(css);
		expect(result.candidates.map((candidate) => candidate.family).sort()).toEqual(
			["Inter", "Roboto"],
		);
	});

	it("infers simple @font-face rules with remote and project-relative sources", async () => {
		const stylesheetBase = path.join(projectRoot, "src");
		await mkdir(path.join(stylesheetBase, "fonts"), { recursive: true });
		await writeFile(
			path.join(stylesheetBase, "fonts", "brand.woff2"),
			Buffer.from("d09GMgABAAAAAA", "base64"),
		);

		const css = [
			"@font-face {",
			'  font-family: "Brand Sans";',
			"  font-style: normal;",
			"  font-weight: 700;",
			"  font-display: swap;",
			'  src: url("https://cdn.example.com/brand.woff2") format("woff2"),',
			'       url("./fonts/brand.woff2") format("woff2");',
			"}",
		].join("\n");

		const result = inferFontSourcesFromCss(css, {
			projectRoot,
			stylesheetBase,
		});

		expect(result.candidates).toEqual([
			expect.objectContaining({
				family: "Brand Sans",
				faces: [
					expect.objectContaining({
						style: "normal",
						weight: "700",
						display: "swap",
						sources: [
							expect.objectContaining({
								kind: "remoteFile",
								url: "https://cdn.example.com/brand.woff2",
								format: "woff2",
							}),
							expect.objectContaining({
								kind: "projectFile",
								path: "src/fonts/brand.woff2",
								format: "woff2",
							}),
						],
					}),
				],
			}),
		]);
	});

	it("strips query strings when resolving local font URLs", async () => {
		const stylesheetBase = path.join(projectRoot, "src");
		await mkdir(path.join(stylesheetBase, "fonts"), { recursive: true });
		await writeFile(
			path.join(stylesheetBase, "fonts", "brand.woff2"),
			Buffer.from("d09GMgABAAAAAA", "base64"),
		);

		const css = [
			"@font-face {",
			'  font-family: "Brand Sans";',
			"  font-style: normal;",
			"  font-weight: 700;",
			'  src: url("./fonts/brand.woff2?v=1") format("woff2");',
			"}",
		].join("\n");

		const result = inferFontSourcesFromCss(css, {
			projectRoot,
			stylesheetBase,
		});

		expect(result.candidates[0]?.faces[0]?.sources).toEqual([
			expect.objectContaining({
				kind: "projectFile",
				path: "src/fonts/brand.woff2",
				format: "woff2",
			}),
		]);
	});

	it("skips ambiguous @font-face values instead of guessing", () => {
		const result = inferFontSourcesFromCss(
			[
				"@font-face {",
				'  font-family: "Opaque";',
				'  src: url("data:font/woff2;base64,AAAA");',
				"}",
				"@font-face {",
				'  font-family: "Outside";',
				'  src: url("/etc/passwd.woff2");',
				"}",
			].join("\n"),
			{ projectRoot, stylesheetBase: projectRoot },
		);

		expect(result.candidates).toHaveLength(0);
		expect(result.diagnostics.map((entry) => entry.code)).toEqual(
			expect.arrayContaining(["SKIPPED_AMBIGUOUS_SRC", "SKIPPED_FONT_FACE"]),
		);
	});

	it("does not expand @fontsource imports from CSS text alone", () => {
		const result = inferFontSourcesFromCss(
			'@import "@fontsource/ibm-plex-sans/latin-400.css";',
		);

		expect(result.candidates).toHaveLength(0);
		expect(result.diagnostics).toHaveLength(0);
	});

	it("reports bare @fontsource package imports as unsupported", () => {
		const result = inferFontSourcesFromCss('@import "@fontsource/ibm-plex-sans";');

		expect(result.candidates).toHaveLength(0);
		expect(result.diagnostics).toEqual([
			expect.objectContaining({
				code: "FONTSOURCE_UNSUPPORTED",
				message: expect.stringContaining("explicit CSS subpath"),
			}),
		]);
	});

	it("resolves explicit @fontsource CSS imports from the project stylesheet", async () => {
		const result = await inferFontSourcesFromSystemStylesheet(
			process.cwd(),
			"src/index.css",
		);

		expect(result.candidates.map((candidate) => candidate.family).sort()).toEqual(
			["IBM Plex Mono", "IBM Plex Sans"],
		);

		const sans = result.candidates.find(
			(candidate) => candidate.family === "IBM Plex Sans",
		);
		expect(sans?.faces.map((face) => face.weight).sort()).toEqual([
			"400",
			"500",
			"600",
			"700",
		]);
		expect(
			sans?.faces.every((face) =>
				face.sources.every(
					(source) =>
						source.kind === "projectFile" &&
						source.path.startsWith("node_modules/@fontsource/ibm-plex-sans/"),
				),
			),
		).toBe(true);
	});
});
