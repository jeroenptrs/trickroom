/**
 * Node-side font resolution for exports. Mirrors the editor's
 * `buildSystemFontInjectionPlan` (`src/utils/font-injection.ts`) but produces a
 * fully standalone result: remote stylesheets/files keep their URLs, while
 * local project/managed font files are read from disk and inlined as `data:`
 * URIs (the editor serves those over `/api/...`, which doesn't exist in an
 * exported file).
 *
 * Fonts are driven entirely by the system's font manifest — no hardcoded
 * families — so a system that doesn't use IBM Plex never pulls it.
 *
 * Fonts referenced directly by `@font-face` rules in the system's own CSS are
 * handled separately by `inlineCssFontUrls` (re-exported here), which post-
 * processes the compiled Tailwind output.
 */

import {
	type FontFace,
	type FontManifest,
	readFontManifest,
	readManagedFontFile,
	readProjectFontFile,
	type SupportedFontFormat,
} from "../utils/font-manifest-service";

export { inlineCssFontUrls } from "../utils/css-font-urls";

export type ExportFontResult = {
	/** Remote stylesheet hrefs (e.g. Google Fonts) to add as `<link>`. */
	stylesheetLinks: string[];
	/** `@font-face` rules with remote URLs or inlined `data:` sources. */
	fontFaceCss: string;
};

const EMPTY: ExportFontResult = { stylesheetLinks: [], fontFaceCss: "" };

const FONT_MIME: Record<SupportedFontFormat, string> = {
	woff2: "font/woff2",
	woff: "font/woff",
	truetype: "font/ttf",
	opentype: "font/otf",
};

function hasControlChar(value: string): boolean {
	for (let index = 0; index < value.length; index += 1) {
		const code = value.charCodeAt(index);
		if (code <= 0x1f || code === 0x7f) {
			return true;
		}
	}
	return false;
}

// Reject control characters in CSS string values (mirrors src/utils/font-injection.ts).
function cssString(value: string): string {
	if (hasControlChar(value)) {
		throw new Error("Unsafe CSS string value.");
	}
	return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function dataUriSrc(contents: Buffer, format: SupportedFontFormat): string {
	return `url("data:${FONT_MIME[format]};base64,${contents.toString("base64")}") format("${format}")`;
}

function faceRule(family: string, face: FontFace, srcParts: string[]): string {
	return [
		"@font-face {",
		`\tfont-family: "${cssString(family)}";`,
		`\tfont-style: ${face.style};`,
		`\tfont-weight: ${face.weight};`,
		...(face.display ? [`\tfont-display: ${face.display};`] : []),
		`\tsrc: ${srcParts.join(", ")};`,
		"}",
	].join("\n");
}

/**
 * Build the export's font CSS for a system. Returns empty when there is no
 * system or no readable font manifest.
 */
export async function buildExportFontCss(
	projectRoot: string,
	systemId: string | null,
): Promise<ExportFontResult> {
	if (!systemId) {
		return EMPTY;
	}

	let manifest: FontManifest;
	try {
		manifest = await readFontManifest(projectRoot, systemId);
	} catch {
		return EMPTY;
	}

	const stylesheetLinks = new Set<string>();
	const faceRules: string[] = [];

	for (const font of Object.values(manifest.fonts)) {
		for (const face of font.faces) {
			const srcParts: string[] = [];
			for (const source of face.sources) {
				try {
					if (source.kind === "remoteStylesheet") {
						stylesheetLinks.add(source.url);
					} else if (source.kind === "remoteFile") {
						srcParts.push(
							source.format
								? `url("${cssString(source.url)}") format("${source.format}")`
								: `url("${cssString(source.url)}")`,
						);
					} else if (source.kind === "projectFile") {
						const file = await readProjectFontFile(projectRoot, source.path);
						srcParts.push(
							dataUriSrc(file.contents, source.format ?? file.format),
						);
					} else {
						const file = await readManagedFontFile(
							projectRoot,
							systemId,
							source.path,
						);
						srcParts.push(
							dataUriSrc(file.contents, source.format ?? file.format),
						);
					}
				} catch {
					// Skip an unreadable source; other sources/faces still apply.
				}
			}
			if (srcParts.length > 0) {
				faceRules.push(faceRule(font.family, face, srcParts));
			}
		}
	}

	return {
		stylesheetLinks: [...stylesheetLinks],
		fontFaceCss: faceRules.join("\n\n"),
	};
}
