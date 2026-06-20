import {
	mkdir,
	mkdtemp,
	readFile,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	type FontManifestError,
	importManagedFontFile,
	readFontManifest,
	registerFont,
	validateCssDeclarationValue,
	validateFontDisplayValue,
	validateRemoteUrl,
	writeFontManifest,
} from "./font-manifest-service";
import {
	ensureDesignSystemManifest,
	resolveDesignSystemDir,
	resolveDesignSystemFontsPath,
} from "./design-system-store";

const tinyWoff2 = Buffer.from("d09GMgABAAAAAA", "base64");

describe("font manifest service", () => {
	let projectRoot: string;

	beforeEach(async () => {
		projectRoot = await mkdtemp(
			path.join(process.cwd(), ".tmp-trickroom-fonts-"),
		);
	});

	afterEach(async () => {
		await rm(projectRoot, { force: true, recursive: true });
	});

	it("registers fonts with remote, project, and managed sources", async () => {
		const fontPath = path.join(projectRoot, "src", "fonts", "brand.woff2");
		await mkdir(path.dirname(fontPath), { recursive: true });
		await writeFile(fontPath, tinyWoff2);

		const result = await registerFont(projectRoot, "Core", {
			fontId: "brand",
			name: "Brand",
			family: "Brand Sans",
			faces: [
				{
					style: "normal",
					weight: "400",
					display: "swap",
					sources: [
						{
							kind: "remoteStylesheet",
							url: "https://fonts.googleapis.com/css2?family=Brand+Sans",
						},
						{
							kind: "remoteFile",
							url: "https://cdn.example.com/brand.woff2",
							format: "woff2",
						},
						{
							kind: "projectFile",
							path: "src/fonts/brand.woff2",
						},
						{
							kind: "managedFile",
							path: "fonts/brand/brand.woff2",
						},
					],
				},
			],
			now: "2026-05-25T00:00:00.000Z",
		});

		expect(result.fontId).toBe("brand");
		expect(result.font.faces[0]?.sources).toHaveLength(4);
		await expect(
			readFile(resolveDesignSystemFontsPath(projectRoot, "Core"), "utf8"),
		).resolves.toContain("brand");
	});

	it("rejects unsafe remote URLs", () => {
		expect(() => validateRemoteUrl("javascript:alert(1)")).toThrowError(
			expect.objectContaining({
				code: "INVALID_REMOTE_URL",
			} satisfies Partial<FontManifestError>),
		);
	});

	it("returns canonical remote URLs from validateRemoteUrl", () => {
		expect(
			validateRemoteUrl("https://fonts.googleapis.com/css2?family=Inter"),
		).toBe("https://fonts.googleapis.com/css2?family=Inter");
	});

	it("rejects unsafe CSS declaration values and invalid font-display", () => {
		expect(() => validateCssDeclarationValue("400;", "weight")).toThrowError(
			expect.objectContaining({
				code: "INVALID_FONT_MANIFEST",
			} satisfies Partial<FontManifestError>),
		);
		expect(() => validateFontDisplayValue("bogus", "display")).toThrowError(
			expect.objectContaining({
				code: "INVALID_FONT_MANIFEST",
			} satisfies Partial<FontManifestError>),
		);
	});

	it("rejects invalid remoteFile format and malformed manifest faces", async () => {
		await expect(
			registerFont(projectRoot, "Core", {
				name: "Bad format",
				family: "Bad format",
				faces: [
					{
						style: "normal",
						weight: "400",
						sources: [
							{
								kind: "remoteFile",
								url: "https://cdn.example.com/font.woff2",
								format: "svg" as never,
							},
						],
					},
				],
			}),
		).rejects.toMatchObject({
			code: "UNSUPPORTED_FONT_TYPE",
		} satisfies Partial<FontManifestError>);

		await expect(
			writeFontManifest(projectRoot, "Core", {
				version: 1,
				metadata: { updatedAt: "2026-05-25T00:00:00.000Z" },
				fonts: {
					"broken-face": {
						name: "Broken",
						family: "Broken",
						faces: [null as never],
						createdAt: "2026-05-25T00:00:00.000Z",
						updatedAt: "2026-05-25T00:00:00.000Z",
					},
					"broken-source": {
						name: "Broken",
						family: "Broken",
						faces: [
							{
								style: "normal",
								weight: "400",
								sources: [null as never],
							},
						],
						createdAt: "2026-05-25T00:00:00.000Z",
						updatedAt: "2026-05-25T00:00:00.000Z",
					},
				},
			}),
		).rejects.toMatchObject({
			code: "INVALID_FONT_MANIFEST",
		} satisfies Partial<FontManifestError>);
	});

	it("rejects project paths outside the project root", async () => {
		await expect(
			registerFont(projectRoot, "Core", {
				name: "Outside",
				family: "Outside",
				faces: [
					{
						style: "normal",
						weight: "400",
						sources: [
							{
								kind: "projectFile",
								path: "../outside.woff2",
							},
						],
					},
				],
			}),
		).rejects.toMatchObject({
			code: "INVALID_FONT_PATH",
		} satisfies Partial<FontManifestError>);
	});

	it("rejects managed imports when the source file has no supported extension", async () => {
		const badSource = path.join(projectRoot, "not-a-font.txt");
		await writeFile(badSource, "nope");

		await expect(
			importManagedFontFile(projectRoot, "Core", {
				absoluteSourcePath: badSource,
				targetRelativePath: "fonts/imported/not-a-font.woff2",
			}),
		).rejects.toMatchObject({
			code: "UNSUPPORTED_FONT_TYPE",
		} satisfies Partial<FontManifestError>);
	});

	it("rejects managed imports with mismatched extensions and existing targets", async () => {
		const outsideDir = await mkdtemp(
			path.join(projectRoot, ".tmp-outside-font-mismatch-"),
		);
		const outsideFont = path.join(outsideDir, "picked.woff2");
		await writeFile(outsideFont, tinyWoff2);

		await expect(
			importManagedFontFile(projectRoot, "Core", {
				absoluteSourcePath: outsideFont,
				targetRelativePath: "fonts/imported/picked.woff",
			}),
		).rejects.toMatchObject({
			code: "UNSUPPORTED_FONT_TYPE",
		} satisfies Partial<FontManifestError>);

		await importManagedFontFile(projectRoot, "Core", {
			absoluteSourcePath: outsideFont,
			targetRelativePath: "fonts/imported/picked.woff2",
		});

		await expect(
			importManagedFontFile(projectRoot, "Core", {
				absoluteSourcePath: outsideFont,
				targetRelativePath: "fonts/imported/picked.woff2",
			}),
		).rejects.toMatchObject({
			code: "INVALID_FONT_PATH",
		} satisfies Partial<FontManifestError>);

		await rm(outsideDir, { force: true, recursive: true });
	});

	it("rejects managed import destinations that are symlinks", async () => {
		const outsideDir = await mkdtemp(
			path.join(projectRoot, ".tmp-outside-font-symlink-"),
		);
		const outsideFont = path.join(outsideDir, "escape.woff2");
		await writeFile(outsideFont, tinyWoff2);

		await ensureDesignSystemManifest(projectRoot, "Core");
		const systemDir = resolveDesignSystemDir(projectRoot, "Core");
		const symlinkTarget = path.join(systemDir, "fonts", "imported", "escape.woff2");
		await mkdir(path.dirname(symlinkTarget), { recursive: true });
		await symlink(outsideFont, symlinkTarget);

		await expect(
			importManagedFontFile(projectRoot, "Core", {
				absoluteSourcePath: outsideFont,
				targetRelativePath: "fonts/imported/escape.woff2",
			}),
		).rejects.toMatchObject({
			code: "INVALID_FONT_PATH",
		} satisfies Partial<FontManifestError>);

		await rm(outsideDir, { force: true, recursive: true });
	});

	it("imports managed font files into the system fonts directory", async () => {
		const outsideDir = await mkdtemp(
			path.join(projectRoot, ".tmp-outside-font-"),
		);
		const outsideFont = path.join(outsideDir, "picked.woff2");
		await writeFile(outsideFont, tinyWoff2);

		const imported = await importManagedFontFile(projectRoot, "Core", {
			absoluteSourcePath: outsideFont,
			targetRelativePath: "fonts/imported/picked.woff2",
		});

		expect(imported.managedPath).toBe("fonts/imported/picked.woff2");
		const manifest = await readFontManifest(projectRoot, "Core");
		expect(manifest.metadata.updatedAt).toBeDefined();
		await rm(outsideDir, { force: true, recursive: true });
	});

	it("rejects managed paths that escape the system directory", async () => {
		await expect(
			registerFont(projectRoot, "Core", {
				name: "Escape",
				family: "Escape",
				faces: [
					{
						style: "normal",
						weight: "400",
						sources: [
							{
								kind: "managedFile",
								path: "fonts/../escape.woff2",
							},
						],
					},
				],
			}),
		).rejects.toMatchObject({
			code: "INVALID_FONT_PATH",
		} satisfies Partial<FontManifestError>);
	});

	it("rejects manifest font paths that resolve outside the project through symlinks", async () => {
		const outsideDir = await mkdtemp(
			path.join(projectRoot, ".tmp-outside-font-link-"),
		);
		const outsideFont = path.join(outsideDir, "linked.woff2");
		await writeFile(outsideFont, tinyWoff2);

		const linkedPath = path.join(projectRoot, "src", "linked.woff2");
		await mkdir(path.dirname(linkedPath), { recursive: true });
		await symlink(outsideFont, linkedPath);

		await registerFont(projectRoot, "Core", {
			fontId: "linked",
			name: "Linked",
			family: "Linked",
			faces: [
				{
					style: "normal",
					weight: "400",
					sources: [{ kind: "projectFile", path: "src/linked.woff2" }],
				},
			],
		});

		const manifestPath = resolveDesignSystemFontsPath(projectRoot, "Core");
		const escapedPath = path.join(projectRoot, "src", "..", "..", "escape.woff2");
		await writeFile(
			manifestPath,
			(
				await readFile(manifestPath, "utf8")
			).replace("src/linked.woff2", escapedPath.replace(/\\/g, "/")),
			"utf8",
		);

		await expect(readFontManifest(projectRoot, "Core")).rejects.toMatchObject({
			code: "INVALID_FONT_PATH",
		} satisfies Partial<FontManifestError>);

		await rm(outsideDir, { force: true, recursive: true });
	});
});
