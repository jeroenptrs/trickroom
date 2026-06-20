import path from "node:path";
import {
	fontNameToId,
	getFontFormatForPath,
	normalizeFontId,
	normalizeProjectRelativeFontPath,
	type FontFace,
	type FontSource,
	type SupportedFontFormat,
	validateRemoteUrl,
} from "./font-manifest-service.ts";
import {
	FontStylesheetResolutionError,
	isExplicitFontsourceCssImport,
	isFontsourceStylesheetImport,
	readResolvedStylesheet,
	readSystemStylesheetCss,
} from "./font-stylesheet-resolver.ts";
import { resolveTailwindCssPath } from "./tailwind-design-system.ts";

export type FontSourceInferenceDiagnosticCode =
	| "FONTSOURCE_UNSUPPORTED"
	| "FONTSOURCE_RESOLVE_FAILED"
	| "SKIPPED_FONT_FACE"
	| "SKIPPED_AMBIGUOUS_SRC";

export type FontSourceInferenceDiagnostic = {
	code: FontSourceInferenceDiagnosticCode;
	message: string;
};

export type InferredFontCandidate = {
	fontId: string;
	name: string;
	family: string;
	faces: FontFace[];
};

export type FontSourceInferenceOptions = {
	/** Required to map relative font URLs to projectFile sources. */
	projectRoot?: string;
	/** Directory used to resolve relative urls() inside @font-face rules. */
	stylesheetBase?: string;
};

export type FontSourceInferenceResult = {
	candidates: InferredFontCandidate[];
	diagnostics: FontSourceInferenceDiagnostic[];
};

const GOOGLE_STYLESHEET_PATTERN =
	/https:\/\/fonts\.googleapis\.com\/css2\?[^)\s"'<>]+/giu;

/**
 * Parse CSS text for conservative font manifest candidates.
 * Does not walk @import graphs; pass combined stylesheet text when needed.
 */
export function inferFontSourcesFromCss(
	css: string,
	options: FontSourceInferenceOptions = {},
): FontSourceInferenceResult {
	const diagnostics: FontSourceInferenceDiagnostic[] = [];
	const googleUrls = extractGoogleStylesheetUrls(css);
	const facesByFamily = new Map<string, FontFace[]>();

	for (const importRef of extractStylesheetImports(css)) {
		if (
			isFontsourceStylesheetImport(importRef) &&
			!isExplicitFontsourceCssImport(importRef)
		) {
			diagnostics.push({
				code: "FONTSOURCE_UNSUPPORTED",
				message: `Bare @fontsource package imports are unsupported. Use an explicit CSS subpath such as "@fontsource/<package>/latin-400.css". Skipped "${importRef}".`,
			});
		}
	}

	for (const block of extractFontFaceBlocks(css)) {
		const parsed = parseFontFaceBlock(block, options, diagnostics);
		if (!parsed) {
			diagnostics.push({
				code: "SKIPPED_FONT_FACE",
				message: "Skipped @font-face block without a usable family and sources.",
			});
			continue;
		}

		const faces = facesByFamily.get(parsed.normalizedFamily) ?? [];
		if (!faces.some((face) => faceSignature(face) === faceSignature(parsed.face))) {
			faces.push(parsed.face);
			facesByFamily.set(parsed.normalizedFamily, faces);
		}
	}

	const candidates: InferredFontCandidate[] = [];

	for (const url of googleUrls) {
		const validatedUrl = validateRemoteUrl(url);
		for (const family of parseGoogleFontFamiliesFromUrl(validatedUrl)) {
			const normalizedFamily = normalizeFamily(family);
			if (facesByFamily.has(normalizedFamily)) {
				const faces = facesByFamily.get(normalizedFamily) ?? [];
				const firstFace = faces[0];
				if (
					firstFace &&
					!firstFace.sources.some((source) => source.kind === "remoteStylesheet")
				) {
					firstFace.sources.unshift({
						kind: "remoteStylesheet",
						url: validatedUrl,
					});
				}
				continue;
			}

			candidates.push(buildGoogleCandidate(family, validatedUrl));
		}
	}

	for (const [normalizedFamily, faces] of facesByFamily) {
		const family = findFamilyDisplayName(css, normalizedFamily) ?? normalizedFamily;
		candidates.push({
			fontId: normalizeFontId(fontNameToId(family)),
			name: family,
			family,
			faces,
		});
	}

	return {
		candidates: dedupeCandidates(candidates),
		diagnostics,
	};
}

export async function inferFontSourcesFromSystemStylesheet(
	projectRoot: string,
	cssPath: string,
): Promise<FontSourceInferenceResult> {
	const resolvedCssPath = resolveTailwindCssPath(projectRoot, cssPath);
	const { content } = await readSystemStylesheetCss(projectRoot, cssPath);
	const stylesheetBase = path.dirname(resolvedCssPath);

	const combined = inferFontSourcesFromCss(content, {
		projectRoot,
		stylesheetBase,
	});

	const fontsourceImports = extractStylesheetImports(content).filter(
		isExplicitFontsourceCssImport,
	);

	for (const importRef of fontsourceImports) {
		try {
			const resolved = await readResolvedStylesheet(importRef, stylesheetBase);
			const imported = inferFontSourcesFromCss(resolved.content, {
				projectRoot,
				stylesheetBase: resolveInferenceStylesheetBase(
					projectRoot,
					resolved.absolutePath,
				),
			});
			combined.candidates = dedupeCandidates([
				...combined.candidates,
				...imported.candidates,
			]);
			combined.diagnostics.push(...imported.diagnostics);
		} catch (error) {
			if (error instanceof FontStylesheetResolutionError) {
				combined.diagnostics.push({
					code:
						error.code === "UNSUPPORTED_IMPORT"
							? "FONTSOURCE_UNSUPPORTED"
							: "FONTSOURCE_RESOLVE_FAILED",
					message: error.message,
				});
				continue;
			}

			const message = error instanceof Error ? error.message : String(error);
			combined.diagnostics.push({
				code: "FONTSOURCE_RESOLVE_FAILED",
				message: `Failed to resolve @fontsource import "${importRef}": ${message}`,
			});
		}
	}

	return combined;
}

export function extractGoogleStylesheetUrls(css: string): string[] {
	const urls = new Set<string>();

	for (const match of css.matchAll(GOOGLE_STYLESHEET_PATTERN)) {
		const raw = match[0]?.trim();
		if (raw && isGoogleStylesheetUrl(raw)) {
			urls.add(validateRemoteUrl(raw));
		}
	}

	const importPattern =
		/@import\s+(?:url\(\s*(['"]?)([^'")]+)\1\s*\)|(['"])([^'"]+)\3)(?:\s+[^;]*)?;/giu;
	for (const match of css.matchAll(importPattern)) {
		const specifier = (match[2] ?? match[4])?.trim();
		if (specifier && isGoogleStylesheetUrl(specifier)) {
			urls.add(validateRemoteUrl(specifier));
		}
	}

	return [...urls].sort();
}

function buildGoogleCandidate(family: string, url: string): InferredFontCandidate {
	return {
		fontId: normalizeFontId(fontNameToId(family)),
		name: family,
		family,
		faces: [
			{
				style: "normal",
				weight: "400",
				sources: [{ kind: "remoteStylesheet", url: validateRemoteUrl(url) }],
			},
		],
	};
}

function extractStylesheetImports(content: string): string[] {
	const imports: string[] = [];
	const importPattern =
		/@import\s+(?:url\(\s*(['"]?)([^'")]+)\1\s*\)|(['"])([^'"]+)\3)(?:\s+[^;]*)?;/giu;

	for (const match of content.matchAll(importPattern)) {
		const specifier = (match[2] ?? match[4])?.trim();
		if (specifier) {
			imports.push(specifier);
		}
	}

	return imports;
}

function resolveInferenceStylesheetBase(
	projectRoot: string,
	absoluteStylesheetPath: string,
): string {
	const resolvedProjectRoot = path.resolve(projectRoot);
	const resolvedStylesheet = path.resolve(absoluteStylesheetPath);
	const relativeToProject = path.relative(resolvedProjectRoot, resolvedStylesheet);

	if (
		relativeToProject.length > 0 &&
		!relativeToProject.startsWith(`..${path.sep}`) &&
		relativeToProject !== ".." &&
		!path.isAbsolute(relativeToProject)
	) {
		return path.dirname(path.resolve(resolvedProjectRoot, relativeToProject));
	}

	const nodeModulesMarker = `${path.sep}node_modules${path.sep}`;
	const markerIndex = resolvedStylesheet.indexOf(nodeModulesMarker);
	if (markerIndex >= 0) {
		const projectRelativeStylesheet = resolvedStylesheet.slice(markerIndex + 1);
		return path.dirname(
			path.resolve(resolvedProjectRoot, projectRelativeStylesheet),
		);
	}

	return path.dirname(resolvedStylesheet);
}

function isGoogleStylesheetUrl(url: string): boolean {
	try {
		const parsed = new URL(url);
		return (
			parsed.hostname === "fonts.googleapis.com" &&
			parsed.pathname.includes("/css")
		);
	} catch {
		return false;
	}
}

function parseGoogleFontFamiliesFromUrl(url: string): string[] {
	try {
		const families = new URL(url).searchParams.getAll("family");
		const parsed = families
			.map((familyParam) => familyParam.split(":")[0]?.replace(/\+/g, " ").trim())
			.filter((familyName): familyName is string =>
				Boolean(familyName && familyName.length > 0),
			);
		return [...new Set(parsed)];
	} catch {
		return [];
	}
}

function extractFontFaceBlocks(content: string): string[] {
	const blocks: string[] = [];
	const pattern = /@font-face\s*\{([^}]*)\}/giu;
	for (const match of content.matchAll(pattern)) {
		const body = match[1];
		if (body) {
			blocks.push(body);
		}
	}
	return blocks;
}

function parseFontFaceBlock(
	body: string,
	options: FontSourceInferenceOptions,
	diagnostics: FontSourceInferenceDiagnostic[],
): { normalizedFamily: string; face: FontFace } | null {
	const familyRaw = readFontFaceProperty(body, "font-family");
	const style = readFontFaceProperty(body, "font-style") ?? "normal";
	const weight = readFontFaceProperty(body, "font-weight") ?? "400";
	const display = readFontFaceProperty(body, "font-display");
	const src = readFontFaceProperty(body, "src");
	if (!familyRaw || !src) {
		return null;
	}

	const family = unquoteCssString(familyRaw);
	const sources = parseFontFaceSources(src, options, diagnostics);
	if (sources.length === 0) {
		return null;
	}

	return {
		normalizedFamily: normalizeFamily(family),
		face: {
			style,
			weight,
			...(display &&
			["auto", "block", "swap", "fallback", "optional"].includes(display)
				? { display: display as FontFace["display"] }
				: {}),
			sources,
		},
	};
}

function parseFontFaceSources(
	srcValue: string,
	options: FontSourceInferenceOptions,
	diagnostics: FontSourceInferenceDiagnostic[],
): FontSource[] {
	const sources: FontSource[] = [];
	const urlPattern =
		/url\(\s*(['"]?)([^'")]+)\1\s*\)(?:\s+format\(\s*(['"]?)([^'")]+)\3\s*\))?/giu;

	for (const match of srcValue.matchAll(urlPattern)) {
		const rawUrl = match[2]?.trim();
		if (!rawUrl) {
			continue;
		}

		const resolvedUrl = stripUrlQueryAndHash(rawUrl);
		const explicitFormat = normalizeCssFormat(match[4]);

		if (resolvedUrl.startsWith("data:")) {
			diagnostics.push({
				code: "SKIPPED_AMBIGUOUS_SRC",
				message: "Skipped data: URL in @font-face src.",
			});
			continue;
		}

		if (isHttpUrl(resolvedUrl)) {
			sources.push({
				kind: "remoteFile",
				url: validateRemoteUrl(resolvedUrl),
				...(explicitFormat ? { format: explicitFormat } : {}),
			});
			continue;
		}

		if (!isProjectRelativeUrl(resolvedUrl)) {
			diagnostics.push({
				code: "SKIPPED_AMBIGUOUS_SRC",
				message: `Skipped non-relative font URL "${rawUrl}".`,
			});
			continue;
		}

		if (!options.projectRoot || !options.stylesheetBase) {
			diagnostics.push({
				code: "SKIPPED_AMBIGUOUS_SRC",
				message: `Skipped relative font URL "${rawUrl}" without projectRoot/stylesheetBase.`,
			});
			continue;
		}

		try {
			const absolutePath = path.resolve(options.stylesheetBase, resolvedUrl);
			const projectRelative = path
				.relative(options.projectRoot, absolutePath)
				.replace(/\\/g, "/");
			const normalizedPath = normalizeProjectRelativeFontPath(
				options.projectRoot,
				projectRelative,
			);
			sources.push({
				kind: "projectFile",
				path: normalizedPath,
				format: getFontFormatForPath(normalizedPath, explicitFormat),
			});
		} catch {
			diagnostics.push({
				code: "SKIPPED_AMBIGUOUS_SRC",
				message: `Skipped font URL "${rawUrl}" that does not map safely into the project.`,
			});
		}
	}

	return sources;
}

function stripUrlQueryAndHash(url: string): string {
	const hashIndex = url.indexOf("#");
	const withoutHash = hashIndex >= 0 ? url.slice(0, hashIndex) : url;
	const queryIndex = withoutHash.indexOf("?");
	return queryIndex >= 0 ? withoutHash.slice(0, queryIndex) : withoutHash;
}

function isProjectRelativeUrl(url: string): boolean {
	return (
		url.startsWith("./") ||
		url.startsWith("../") ||
		(!url.includes("://") && !path.isAbsolute(url))
	);
}

function isHttpUrl(value: string): boolean {
	try {
		const parsed = new URL(value);
		return parsed.protocol === "http:" || parsed.protocol === "https:";
	} catch {
		return false;
	}
}

function normalizeCssFormat(value: string | undefined): SupportedFontFormat | undefined {
	if (!value) {
		return undefined;
	}
	switch (value.trim().toLowerCase()) {
		case "woff":
			return "woff";
		case "woff2":
			return "woff2";
		case "opentype":
		case "otf":
			return "opentype";
		case "truetype":
		case "ttf":
			return "truetype";
		default:
			return undefined;
	}
}

function readFontFaceProperty(body: string, property: string): string | null {
	const pattern = new RegExp(`${property}\\s*:\\s*([^;]+)`, "iu");
	return body.match(pattern)?.[1]?.trim() ?? null;
}

function unquoteCssString(value: string): string {
	const trimmed = value.trim();
	if (
		(trimmed.startsWith('"') && trimmed.endsWith('"')) ||
		(trimmed.startsWith("'") && trimmed.endsWith("'"))
	) {
		return trimmed.slice(1, -1);
	}
	return trimmed;
}

function normalizeFamily(family: string): string {
	return family.trim().toLowerCase();
}

function findFamilyDisplayName(css: string, normalizedFamily: string): string | null {
	for (const block of extractFontFaceBlocks(css)) {
		const familyRaw = readFontFaceProperty(block, "font-family");
		if (familyRaw && normalizeFamily(unquoteCssString(familyRaw)) === normalizedFamily) {
			return unquoteCssString(familyRaw);
		}
	}
	return null;
}

function faceSignature(face: FontFace): string {
	return `${face.style}:${face.weight}:${face.sources
		.map((source) => JSON.stringify(source))
		.join("|")}`;
}

function dedupeCandidates(candidates: InferredFontCandidate[]): InferredFontCandidate[] {
	const byId = new Map<string, InferredFontCandidate>();
	for (const candidate of candidates) {
		const existing = byId.get(candidate.fontId);
		if (!existing) {
			byId.set(candidate.fontId, candidate);
			continue;
		}
		existing.faces = mergeFaces(existing.faces, candidate.faces);
	}
	return [...byId.values()].sort((left, right) =>
		left.family.localeCompare(right.family),
	);
}

function mergeFaces(left: FontFace[], right: FontFace[]): FontFace[] {
	const merged = [...left];
	for (const face of right) {
		if (!merged.some((entry) => faceSignature(entry) === faceSignature(face))) {
			merged.push(face);
		}
	}
	return merged;
}
