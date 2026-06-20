import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	resolveDesignSystemIconsPath,
	writeDesignSystemManifest,
} from "./design-system-store";
import {
	type IconManifestError,
	readIconManifest,
	readSanitizedIconSvg,
	sanitizeSvg,
	syncIconManifest,
} from "./icon-manifest-service";

const safeSvg =
	'<svg viewBox="0 0 24 24" fill="none"><path d="M4 12h16" stroke="currentColor" stroke-width="2"/></svg>';

describe("icon manifest service", () => {
	let projectRoot: string;

	beforeEach(async () => {
		projectRoot = await mkdtemp(
			path.join(process.cwd(), ".tmp-trickroom-icons-"),
		);
	});

	afterEach(async () => {
		await rm(projectRoot, { force: true, recursive: true });
	});

	it("indexes svg folders in order and records first-wins duplicate diagnostics", async () => {
		await mkdir(path.join(projectRoot, "src", "icons"), { recursive: true });
		await mkdir(path.join(projectRoot, "src", "svg"), { recursive: true });
		await mkdir(
			path.join(projectRoot, "node_modules", "lucide-static", "icons"),
			{ recursive: true },
		);
		await writeFile(
			path.join(projectRoot, "src", "icons", "search.svg"),
			safeSvg,
		);
		await writeFile(
			path.join(projectRoot, "src", "svg", "search.svg"),
			'<svg viewBox="0 0 20 20" fill="currentColor"><path d="M1 1h18v18H1z"/></svg>',
		);
		await writeFile(
			path.join(
				projectRoot,
				"node_modules",
				"lucide-static",
				"icons",
				"plus.svg",
			),
			'<!-- @license lucide-static v1.16.0 - ISC -->\n<svg viewBox="0 0 24 24"><path d="M12 5v14"/><path d="M5 12h14"/></svg>',
		);
		await writeDesignSystemManifest(projectRoot, "Core", {
			iconFolderPaths: [
				"src/icons",
				"src/svg",
				"node_modules/lucide-static/icons",
			],
		});

		const manifest = await syncIconManifest(
			projectRoot,
			"Core",
			"2026-05-15T00:00:00.000Z",
		);

		expect(manifest.icons["src/search"]).toMatchObject({
			sourcePath: "src/icons/search.svg",
			viewBox: "0 0 24 24",
			paint: "stroke",
		});
		expect(manifest.icons["lucide-static/plus"]).toMatchObject({
			sourcePath: "node_modules/lucide-static/icons/plus.svg",
			viewBox: "0 0 24 24",
		});
		expect(manifest.diagnostics).not.toContainEqual(
			expect.objectContaining({
				code: "UNSAFE_SVG",
				iconId: "lucide-static/plus",
			}),
		);
		expect(manifest.diagnostics).toContainEqual(
			expect.objectContaining({
				code: "DUPLICATE_ICON_ID",
				iconId: "src/search",
				sourcePath: "src/svg/search.svg",
				keptSourcePath: "src/icons/search.svg",
			}),
		);
	});

	it("skips unsafe SVG input during indexing", async () => {
		await mkdir(path.join(projectRoot, "src", "icons"), { recursive: true });
		await writeFile(
			path.join(projectRoot, "src", "icons", "bad.svg"),
			'<svg viewBox="0 0 24 24"><script>alert(1)</script></svg>',
		);
		await writeDesignSystemManifest(projectRoot, "Core", {
			iconFolderPaths: ["src/icons"],
		});

		const manifest = await syncIconManifest(projectRoot, "Core");

		expect(manifest.icons["src/bad"]).toBeUndefined();
		expect(manifest.diagnostics).toContainEqual(
			expect.objectContaining({
				code: "UNSAFE_SVG",
				iconId: "src/bad",
			}),
		);
	});

	it("sanitizes SVGs before exposing raw content", async () => {
		await mkdir(path.join(projectRoot, "src", "icons"), { recursive: true });
		await writeFile(
			path.join(projectRoot, "src", "icons", "search.svg"),
			safeSvg,
		);
		await writeDesignSystemManifest(projectRoot, "Core", {
			iconFolderPaths: ["src/icons"],
		});
		await syncIconManifest(projectRoot, "Core");

		const result = await readSanitizedIconSvg(
			projectRoot,
			"Core",
			"src/search",
		);

		expect(result?.svg).toBe(safeSvg);
		expect(sanitizeSvg('<svg onload="alert(1)"></svg>')).toMatchObject({
			ok: false,
		});
		expect(
			sanitizeSvg('<svg><use href="https://example.com/icon.svg#x"/></svg>'),
		).toMatchObject({ ok: false });
		expect(
			sanitizeSvg(
				'<svg><path style="&#x75;&#x72;&#x6c;(&#x6a;avascript:alert(1))"/></svg>',
			),
		).toMatchObject({ ok: false });
		expect(
			sanitizeSvg('<svg><use xlink:href="#local-symbol"/></svg>'),
		).toMatchObject({ ok: false });
		expect(
			sanitizeSvg('<svg><path style="fill: currentColor"/></svg>'),
		).toMatchObject({ ok: false });
		expect(
			sanitizeSvg(
				'<!-- @license lucide-static v1.16.0 - ISC -->\n<svg viewBox="0 0 24 24"><path d="M12 5v14"/></svg>',
			),
		).toMatchObject({
			ok: true,
			svg: '<svg viewBox="0 0 24 24"><path d="M12 5v14"/></svg>',
		});
	});

	it("rejects manifest icon source paths outside the project root", async () => {
		const manifestPath = resolveDesignSystemIconsPath(projectRoot, "Core");
		await mkdir(path.dirname(manifestPath), { recursive: true });
		await writeFile(
			manifestPath,
			JSON.stringify({
				version: 1,
				metadata: {
					systemName: "Core",
					indexedAt: "2026-05-15T00:00:00.000Z",
				},
				iconFolderPaths: [],
				icons: {
					"src/search": {
						name: "search",
						sourcePath: "../secret.svg",
						paint: "stroke",
						hash: "sha256:test",
					},
				},
				diagnostics: [],
			}),
			"utf8",
		);

		await expect(readIconManifest(projectRoot, "Core")).rejects.toMatchObject({
			code: "INVALID_ICON_PATH",
		} satisfies Partial<IconManifestError>);
	});

	it("rejects duplicate normalized icon IDs in hand-edited manifests", async () => {
		const manifestPath = resolveDesignSystemIconsPath(projectRoot, "Core");
		await mkdir(path.dirname(manifestPath), { recursive: true });
		await writeFile(
			manifestPath,
			JSON.stringify({
				version: 1,
				metadata: {
					systemName: "Core",
					indexedAt: "2026-05-15T00:00:00.000Z",
				},
				iconFolderPaths: [],
				icons: {
					"SRC/Search": {
						name: "search",
						sourcePath: "src/icons/search.svg",
						paint: "stroke",
						hash: "sha256:first",
					},
					"src/search": {
						name: "search",
						sourcePath: "src/icons/search.svg",
						paint: "stroke",
						hash: "sha256:second",
					},
				},
				diagnostics: [],
			}),
			"utf8",
		);

		await expect(readIconManifest(projectRoot, "Core")).rejects.toMatchObject({
			code: "INVALID_ICON_MANIFEST",
		} satisfies Partial<IconManifestError>);
	});

	it("rejects icon files that resolve outside the project through symlinks", async () => {
		const outsideRoot = await mkdtemp(
			path.join(process.cwd(), ".tmp-trickroom-icons-outside-"),
		);
		try {
			const outsideIconPath = path.join(outsideRoot, "search.svg");
			await writeFile(outsideIconPath, safeSvg);
			const iconPath = path.join(projectRoot, "src", "icons", "search.svg");
			await mkdir(path.dirname(iconPath), { recursive: true });
			await symlink(outsideIconPath, iconPath);
			await writeDesignSystemManifest(projectRoot, "Core", {
				iconFolderPaths: ["src/icons"],
			});
			const manifestPath = resolveDesignSystemIconsPath(projectRoot, "Core");
			await writeFile(
				manifestPath,
				JSON.stringify({
					version: 1,
					metadata: {
						systemName: "Core",
						indexedAt: "2026-05-15T00:00:00.000Z",
					},
					iconFolderPaths: ["src/icons"],
					icons: {
						"src/search": {
							name: "search",
							sourcePath: "src/icons/search.svg",
							paint: "stroke",
							hash: "sha256:test",
						},
					},
					diagnostics: [],
				}),
				"utf8",
			);

			await expect(
				readSanitizedIconSvg(projectRoot, "Core", "src/search"),
			).rejects.toMatchObject({
				code: "INVALID_ICON_PATH",
			} satisfies Partial<IconManifestError>);
		} finally {
			await rm(outsideRoot, { force: true, recursive: true });
		}
	});
});
