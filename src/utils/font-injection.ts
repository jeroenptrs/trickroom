import type {
	FontFace,
	FontManifest,
	FontManifestFont,
	FontSource,
	SupportedFontFormat,
} from "./font-manifest-service";

const MANAGED_LINK_ID_PREFIX = "trickroom-font-stylesheet-";
const MANAGED_STYLE_ID = "trickroom-system-fonts";

export function projectFontFileUrl(systemId: string, sourcePath: string): string {
	const query = new URLSearchParams({ path: sourcePath });
	return `/api/trickroom/systems/${encodeURIComponent(systemId)}/fonts/project-file?${query.toString()}`;
}

export function managedFontFileUrl(systemId: string, managedPath: string): string {
	const query = new URLSearchParams({ path: managedPath });
	return `/api/trickroom/systems/${encodeURIComponent(systemId)}/fonts/managed-file?${query.toString()}`;
}

function cssString(value: string): string {
	if (/[\x00-\x1f\x7f\r\n]/u.test(value)) {
		throw new Error("Unsafe CSS string value.");
	}

	return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function formatFontFaceSource(source: FontSource, systemId: string): string | null {
	switch (source.kind) {
		case "remoteFile":
			return source.format
				? `url("${cssString(source.url)}") format("${source.format}")`
				: `url("${cssString(source.url)}")`;
		case "projectFile":
			return `url("${cssString(projectFontFileUrl(systemId, source.path))}") format("${source.format ?? inferFormatFromPath(source.path)}")`;
		case "managedFile":
			return `url("${cssString(managedFontFileUrl(systemId, source.path))}") format("${source.format ?? inferFormatFromPath(source.path)}")`;
		default:
			return null;
	}
}

function inferFormatFromPath(sourcePath: string): SupportedFontFormat {
	const extension = sourcePath.slice(sourcePath.lastIndexOf(".")).toLowerCase();
	switch (extension) {
		case ".woff":
			return "woff";
		case ".woff2":
			return "woff2";
		case ".otf":
			return "opentype";
		default:
			return "truetype";
	}
}

function serializeFontFaceRule(
	fontFamily: string,
	face: FontFace,
	systemId: string,
): string | null {
	const srcParts = face.sources
		.map((source) => formatFontFaceSource(source, systemId))
		.filter((value): value is string => value !== null);
	if (srcParts.length === 0) {
		return null;
	}

	const lines = [
		"@font-face {",
		`\tfont-family: "${cssString(fontFamily)}";`,
		`\tfont-style: ${face.style};`,
		`\tfont-weight: ${face.weight};`,
		...(face.display ? [`\tfont-display: ${face.display};`] : []),
		`\tsrc: ${srcParts.join(", ")};`,
		"}",
	];
	return lines.join("\n");
}

export type SystemFontInjectionPlan = {
	stylesheetUrls: string[];
	fontFaceCss: string;
};

export type SystemFontInjectionInput = {
	fonts: FontManifest["fonts"] | readonly FontManifestFont[];
};

export function buildSystemFontInjectionPlan(
	systemId: string,
	manifest: SystemFontInjectionInput,
): SystemFontInjectionPlan {
	const stylesheetUrls: string[] = [];
	const faceRules: string[] = [];

	for (const font of Object.values(manifest.fonts)) {
		for (const face of font.faces) {
			for (const source of face.sources) {
				if (source.kind === "remoteStylesheet") {
					stylesheetUrls.push(source.url);
				}
			}

			const rule = serializeFontFaceRule(font.family, face, systemId);
			if (rule) {
				faceRules.push(rule);
			}
		}
	}

	return {
		stylesheetUrls: [...new Set(stylesheetUrls)],
		fontFaceCss: faceRules.join("\n\n"),
	};
}

export function managedStylesheetLinkId(index: number): string {
	return `${MANAGED_LINK_ID_PREFIX}${index}`;
}

export const systemFontsStyleId = MANAGED_STYLE_ID;
