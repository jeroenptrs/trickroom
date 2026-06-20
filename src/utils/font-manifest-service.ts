import { createHash, randomUUID } from "node:crypto";
import {
	copyFile,
	lstat,
	mkdir,
	readFile,
	realpath,
	rename,
	stat,
	unlink,
	writeFile,
} from "node:fs/promises";
import path from "node:path";
import {
	ensureDesignSystemManifest,
	findDesignSystem,
	resolveDesignSystemFilePath,
} from "./design-system-store.ts";

export const FONT_MANIFEST_VERSION = 1;

export const supportedFontExtensions = {
	".woff": "woff",
	".woff2": "woff2",
	".ttf": "truetype",
	".otf": "opentype",
} as const;

export type SupportedFontFormat =
	(typeof supportedFontExtensions)[keyof typeof supportedFontExtensions];

export type FontSourceKind =
	| "remoteStylesheet"
	| "remoteFile"
	| "projectFile"
	| "managedFile";

export type FontSource =
	| { kind: "remoteStylesheet"; url: string }
	| {
			kind: "remoteFile";
			url: string;
			format?: SupportedFontFormat;
	  }
	| {
			kind: "projectFile";
			path: string;
			format?: SupportedFontFormat;
	  }
	| {
			kind: "managedFile";
			path: string;
			format?: SupportedFontFormat;
	  };

export type FontFace = {
	style: string;
	weight: string;
	display?: "auto" | "block" | "swap" | "fallback" | "optional";
	sources: FontSource[];
};

export type FontManifestFont = {
	name: string;
	family: string;
	faces: FontFace[];
	createdAt: string;
	updatedAt: string;
};

export type FontManifest = {
	version: typeof FONT_MANIFEST_VERSION;
	metadata: {
		updatedAt: string;
	};
	fonts: Record<string, FontManifestFont>;
};

export type RegisterFontParams = {
	fontId?: string;
	name: string;
	family: string;
	faces: FontFace[];
	now?: string;
};

export type UpdateFontParams = {
	name?: string;
	family?: string;
	faces?: FontFace[];
	now?: string;
};

export type ImportManagedFontFileParams = {
	absoluteSourcePath: string;
	targetRelativePath: string;
	format?: SupportedFontFormat;
};

export class FontManifestError extends Error {
	readonly code:
		| "DUPLICATE_FONT_ID"
		| "FONT_NOT_FOUND"
		| "INVALID_FONT_ID"
		| "INVALID_FONT_MANIFEST"
		| "INVALID_FONT_PATH"
		| "INVALID_FONT_SOURCE"
		| "INVALID_REMOTE_URL"
		| "SYSTEM_NOT_FOUND"
		| "UNSUPPORTED_FONT_TYPE";

	constructor(code: FontManifestError["code"], message: string) {
		super(message);
		this.name = "FontManifestError";
		this.code = code;
	}
}

const emptyFontManifest = (): FontManifest => ({
	version: FONT_MANIFEST_VERSION,
	metadata: {
		updatedAt: new Date(0).toISOString(),
	},
	fonts: {},
});

const allowedRemoteProtocols = new Set(["http:", "https:"]);

const allowedFontDisplay = new Set<NonNullable<FontFace["display"]>>([
	"auto",
	"block",
	"swap",
	"fallback",
	"optional",
]);

const unsafeCssDeclarationPattern = /[\x00-\x1f\x7f{};\r\n]/u;

export function normalizeFontId(fontId: string): string {
	const normalized = fontId.trim().toLowerCase();
	if (!/^[a-z0-9][a-z0-9_-]*$/u.test(normalized)) {
		throw new FontManifestError(
			"INVALID_FONT_ID",
			`Invalid font id "${fontId}". Use lowercase letters, numbers, dashes, and underscores.`,
		);
	}

	return normalized;
}

export function fontNameToId(name: string): string {
	const safeName = name
		.trim()
		.toLowerCase()
		.replace(/\s+/g, "-")
		.replace(/[^a-z0-9_-]/g, "")
		.replace(/^-+|-+$/g, "");

	return `fnt_${safeName || "font"}`;
}

export function validateRemoteUrl(url: string): string {
	const trimmed = url.trim();
	if (trimmed.length === 0) {
		throw new FontManifestError(
			"INVALID_REMOTE_URL",
			"Remote font URLs must be non-empty.",
		);
	}

	let parsed: URL;
	try {
		parsed = new URL(trimmed);
	} catch {
		throw new FontManifestError(
			"INVALID_REMOTE_URL",
			`Invalid remote font URL "${url}".`,
		);
	}

	if (!allowedRemoteProtocols.has(parsed.protocol)) {
		throw new FontManifestError(
			"INVALID_REMOTE_URL",
			`Remote font URL must use http or https (got "${parsed.protocol}").`,
		);
	}

	return parsed.href;
}

export function validateSupportedFontFormat(
	format: string,
	label: string,
): SupportedFontFormat {
	if (!Object.values(supportedFontExtensions).includes(format as SupportedFontFormat)) {
		throw new FontManifestError(
			"UNSUPPORTED_FONT_TYPE",
			`${label}: unsupported font format "${format}". Supported: woff, woff2, truetype, opentype.`,
		);
	}

	return format as SupportedFontFormat;
}

export function validateCssDeclarationValue(value: string, label: string): string {
	const trimmed = value.trim();
	if (trimmed.length === 0 || unsafeCssDeclarationPattern.test(trimmed)) {
		throw new FontManifestError(
			"INVALID_FONT_MANIFEST",
			`${label} must be a safe CSS declaration value.`,
		);
	}

	return trimmed;
}

export function validateFontFamilyValue(family: string, label: string): string {
	const trimmed = family.trim();
	if (trimmed.length === 0 || unsafeCssDeclarationPattern.test(trimmed)) {
		throw new FontManifestError(
			"INVALID_FONT_MANIFEST",
			`${label} must be a non-empty font family without control characters.`,
		);
	}

	return trimmed;
}

export function validateFontDisplayValue(
	display: unknown,
	label: string,
): FontFace["display"] | undefined {
	if (display === undefined || display === null) {
		return undefined;
	}

	if (typeof display !== "string" || !allowedFontDisplay.has(display as FontFace["display"])) {
		throw new FontManifestError(
			"INVALID_FONT_MANIFEST",
			`${label} must be one of: auto, block, swap, fallback, optional.`,
		);
	}

	return display as FontFace["display"];
}

export function getFontFormatForPath(
	sourcePath: string,
	explicitFormat?: SupportedFontFormat,
): SupportedFontFormat {
	if (explicitFormat) {
		return validateSupportedFontFormat(
			explicitFormat,
			`Font format for "${sourcePath}"`,
		);
	}

	const extension = path.extname(sourcePath).toLowerCase();
	const format =
		supportedFontExtensions[extension as keyof typeof supportedFontExtensions];
	if (!format) {
		throw new FontManifestError(
			"UNSUPPORTED_FONT_TYPE",
			`Unsupported font type for "${sourcePath}". Supported: woff, woff2, ttf, otf.`,
		);
	}

	return format;
}

export function normalizeProjectRelativeFontPath(
	projectRoot: string,
	sourcePath: string,
): string {
	const trimmed = sourcePath.trim();
	if (trimmed.length === 0) {
		throw new FontManifestError(
			"INVALID_FONT_PATH",
			"Font path must be a non-empty project-relative path.",
		);
	}

	if (path.isAbsolute(trimmed)) {
		throw new FontManifestError(
			"INVALID_FONT_PATH",
			"Font path must be project-relative.",
		);
	}

	const normalized = path.normalize(trimmed).replace(/\\/g, "/");
	const resolvedProjectRoot = path.resolve(projectRoot);
	const resolvedPath = path.resolve(resolvedProjectRoot, normalized);
	if (
		resolvedPath !== resolvedProjectRoot &&
		!resolvedPath.startsWith(`${resolvedProjectRoot}${path.sep}`)
	) {
		throw new FontManifestError(
			"INVALID_FONT_PATH",
			"Font path must stay inside the project root.",
		);
	}

	if (resolvedPath === resolvedProjectRoot) {
		throw new FontManifestError(
			"INVALID_FONT_PATH",
			"Font path must point to a file inside the project root.",
		);
	}

	return normalized.replace(/^(\.\/)+/u, "");
}

export function normalizeManagedFontPath(managedPath: string): string {
	const trimmed = managedPath.trim();
	if (trimmed.length === 0) {
		throw new FontManifestError(
			"INVALID_FONT_PATH",
			"Managed font path must be non-empty.",
		);
	}

	if (path.isAbsolute(trimmed)) {
		throw new FontManifestError(
			"INVALID_FONT_PATH",
			"Managed font path must be relative to the design system directory.",
		);
	}

	const normalized = path.normalize(trimmed).replace(/\\/g, "/");
	if (normalized === "." || normalized === ".." || normalized.includes("/../")) {
		throw new FontManifestError(
			"INVALID_FONT_PATH",
			"Managed font path must not traverse outside the design system directory.",
		);
	}

	if (!normalized.startsWith("fonts/")) {
		throw new FontManifestError(
			"INVALID_FONT_PATH",
			'Managed font path must start with "fonts/".',
		);
	}

	return normalized;
}

export async function readFontManifest(
	projectRoot: string,
	systemHandle: string,
): Promise<FontManifest> {
	const manifestPath = await resolveDesignSystemFilePath(
		projectRoot,
		systemHandle,
		"fonts.json",
	);

	try {
		const contents = await readFile(manifestPath, "utf8");
		return normalizeFontManifest(JSON.parse(contents) as unknown, projectRoot);
	} catch (error) {
		const fsError = error as NodeJS.ErrnoException;
		if (fsError.code === "ENOENT") {
			return emptyFontManifest();
		}

		throw error;
	}
}

export async function writeFontManifest(
	projectRoot: string,
	systemHandle: string,
	manifest: FontManifest,
): Promise<FontManifest> {
	const normalized = normalizeFontManifest(manifest, projectRoot);

	await ensureDesignSystemManifest(projectRoot, systemHandle);
	const manifestPath = await resolveDesignSystemFilePath(
		projectRoot,
		systemHandle,
		"fonts.json",
	);
	await mkdir(path.dirname(manifestPath), { recursive: true });
	await writeJsonAtomically(manifestPath, normalized);
	return normalized;
}

export async function registerFont(
	projectRoot: string,
	systemHandle: string,
	params: RegisterFontParams,
): Promise<{
	fontId: string;
	font: FontManifestFont;
	manifest: FontManifest;
}> {
	const manifest = await readFontManifest(projectRoot, systemHandle);
	const now = params.now ?? new Date().toISOString();
	const fontId = params.fontId
		? normalizeFontId(params.fontId)
		: nextGeneratedFontId(manifest, params.name);

	if (manifest.fonts[fontId]) {
		throw new FontManifestError(
			"DUPLICATE_FONT_ID",
			`Font id "${fontId}" already exists in system "${systemHandle}".`,
		);
	}

	const font = {
		name: validateFontFamilyValue(params.name, "Font name"),
		family: validateFontFamilyValue(params.family, "Font family"),
		faces: normalizeFontFaces(params.faces, projectRoot),
		createdAt: now,
		updatedAt: now,
	} satisfies FontManifestFont;

	const nextManifest = {
		version: FONT_MANIFEST_VERSION,
		metadata: { updatedAt: now },
		fonts: {
			...manifest.fonts,
			[fontId]: font,
		},
	} satisfies FontManifest;

	return {
		fontId,
		font,
		manifest: await writeFontManifest(projectRoot, systemHandle, nextManifest),
	};
}

export async function updateFont(
	projectRoot: string,
	systemHandle: string,
	fontId: string,
	params: UpdateFontParams,
): Promise<{
	fontId: string;
	font: FontManifestFont;
	manifest: FontManifest;
}> {
	const normalizedFontId = normalizeFontId(fontId);
	const manifest = await readFontManifest(projectRoot, systemHandle);
	const existing = manifest.fonts[normalizedFontId];
	if (!existing) {
		throw new FontManifestError(
			"FONT_NOT_FOUND",
			`Unknown font id "${normalizedFontId}" in system "${systemHandle}".`,
		);
	}

	const now = params.now ?? new Date().toISOString();
	const nextFont = {
		...existing,
		...(params.name !== undefined
			? { name: validateFontFamilyValue(params.name, "Font name") }
			: {}),
		...(params.family !== undefined
			? { family: validateFontFamilyValue(params.family, "Font family") }
			: {}),
		...(params.faces !== undefined
			? { faces: normalizeFontFaces(params.faces, projectRoot) }
			: {}),
		updatedAt: now,
	} satisfies FontManifestFont;

	const nextManifest = {
		...manifest,
		metadata: { updatedAt: now },
		fonts: {
			...manifest.fonts,
			[normalizedFontId]: nextFont,
		},
	} satisfies FontManifest;

	return {
		fontId: normalizedFontId,
		font: nextFont,
		manifest: await writeFontManifest(projectRoot, systemHandle, nextManifest),
	};
}

export async function deleteFont(
	projectRoot: string,
	systemHandle: string,
	fontId: string,
): Promise<FontManifest> {
	const normalizedFontId = normalizeFontId(fontId);
	const manifest = await readFontManifest(projectRoot, systemHandle);
	if (!manifest.fonts[normalizedFontId]) {
		throw new FontManifestError(
			"FONT_NOT_FOUND",
			`Unknown font id "${normalizedFontId}" in system "${systemHandle}".`,
		);
	}

	const { [normalizedFontId]: _deleted, ...remainingFonts } = manifest.fonts;
	void _deleted;
	return writeFontManifest(projectRoot, systemHandle, {
		...manifest,
		metadata: {
			updatedAt: new Date().toISOString(),
		},
		fonts: remainingFonts,
	});
}

export async function readFont(
	projectRoot: string,
	systemHandle: string,
	fontId: string,
): Promise<FontManifestFont | null> {
	const manifest = await readFontManifest(projectRoot, systemHandle);
	return manifest.fonts[normalizeFontId(fontId)] ?? null;
}

export async function importManagedFontFile(
	projectRoot: string,
	systemHandle: string,
	params: ImportManagedFontFileParams,
): Promise<{
	managedPath: string;
	format: SupportedFontFormat;
}> {
	await ensureDesignSystemManifest(projectRoot, systemHandle);
	const record = await findDesignSystem(projectRoot, systemHandle);
	if (!record) {
		throw new FontManifestError(
			"SYSTEM_NOT_FOUND",
			`Unknown design system "${systemHandle}".`,
		);
	}

	const absoluteSourcePath = path.resolve(params.absoluteSourcePath.trim());
	const sourceStat = await stat(absoluteSourcePath).catch((error) => {
		const fsError = error as NodeJS.ErrnoException;
		if (fsError.code === "ENOENT") {
			throw new FontManifestError(
				"INVALID_FONT_PATH",
				`Font source file not found at "${params.absoluteSourcePath}".`,
			);
		}
		throw error;
	});
	if (!sourceStat.isFile()) {
		throw new FontManifestError(
			"INVALID_FONT_PATH",
			`Font source path is not a file: "${params.absoluteSourcePath}".`,
		);
	}

	const managedPath = normalizeManagedFontPath(params.targetRelativePath);
	const sourceFormat = getFontFormatForPath(absoluteSourcePath);
	const targetFormat = getFontFormatForPath(managedPath, params.format);
	if (sourceFormat !== targetFormat) {
		throw new FontManifestError(
			"UNSUPPORTED_FONT_TYPE",
			`Font source format "${sourceFormat}" does not match target format "${targetFormat}" for "${managedPath}".`,
		);
	}

	const destinationPath = path.join(record.dir, managedPath);
	const destinationParent = path.dirname(destinationPath);
	await mkdir(destinationParent, { recursive: true });

	const [realSystemDir, realDestinationParent] = await Promise.all([
		realpath(record.dir),
		realpath(destinationParent),
	]);
	if (
		realDestinationParent !== realSystemDir &&
		!realDestinationParent.startsWith(`${realSystemDir}${path.sep}`)
	) {
		throw new FontManifestError(
			"INVALID_FONT_PATH",
			"Managed font destination must resolve inside the design system directory.",
		);
	}

	try {
		const destinationStat = await lstat(destinationPath);
		if (destinationStat.isSymbolicLink()) {
			throw new FontManifestError(
				"INVALID_FONT_PATH",
				`Managed font destination is a symlink: "${managedPath}".`,
			);
		}
		throw new FontManifestError(
			"INVALID_FONT_PATH",
			`Managed font file already exists at "${managedPath}".`,
		);
	} catch (error) {
		if (error instanceof FontManifestError) {
			throw error;
		}
		const fsError = error as NodeJS.ErrnoException;
		if (fsError.code !== "ENOENT") {
			throw error;
		}
	}

	await copyFile(absoluteSourcePath, destinationPath);

	return { managedPath, format: targetFormat };
}

export async function readProjectFontFile(
	projectRoot: string,
	sourcePath: string,
): Promise<{ contents: Buffer; format: SupportedFontFormat }> {
	const normalizedSourcePath = normalizeProjectRelativeFontPath(
		projectRoot,
		sourcePath,
	);
	const filePath = await resolveExistingProjectFilePath(
		projectRoot,
		normalizedSourcePath,
	);
	const fileStat = await stat(filePath);
	if (!fileStat.isFile()) {
		throw Object.assign(new Error("Font sourcePath is not a file."), {
			code: "EISDIR",
		});
	}

	return {
		contents: await readFile(filePath),
		format: getFontFormatForPath(normalizedSourcePath),
	};
}

export async function readManagedFontFile(
	projectRoot: string,
	systemHandle: string,
	managedPath: string,
): Promise<{ contents: Buffer; format: SupportedFontFormat }> {
	const record = await findDesignSystem(projectRoot, systemHandle);
	if (!record) {
		throw new FontManifestError(
			"SYSTEM_NOT_FOUND",
			`Unknown design system "${systemHandle}".`,
		);
	}

	const normalizedManagedPath = normalizeManagedFontPath(managedPath);
	const filePath = path.join(record.dir, normalizedManagedPath);
	const [realSystemDir, realFilePath] = await Promise.all([
		realpath(record.dir),
		realpath(filePath),
	]);
	if (
		realFilePath !== realSystemDir &&
		!realFilePath.startsWith(`${realSystemDir}${path.sep}`)
	) {
		throw new FontManifestError(
			"INVALID_FONT_PATH",
			"Managed font path must resolve inside the design system directory.",
		);
	}

	const fileStat = await stat(realFilePath);
	if (!fileStat.isFile()) {
		throw Object.assign(new Error("Managed font path is not a file."), {
			code: "EISDIR",
		});
	}

	return {
		contents: await readFile(realFilePath),
		format: getFontFormatForPath(normalizedManagedPath),
	};
}

function normalizeFontFaces(
	faces: FontFace[],
	projectRoot: string,
): FontFace[] {
	if (!Array.isArray(faces) || faces.length === 0) {
		throw new FontManifestError(
			"INVALID_FONT_MANIFEST",
			"Each font must include at least one face.",
		);
	}

	return faces.map((face, index) => normalizeFontFace(face, projectRoot, index));
}

function normalizeFontFace(
	face: FontFace,
	projectRoot: string,
	index: number,
): FontFace {
	if (!isRecord(face)) {
		throw new FontManifestError(
			"INVALID_FONT_MANIFEST",
			`Font face ${index} must be a JSON object.`,
		);
	}

	if (
		typeof face.style !== "string" ||
		face.style.trim().length === 0 ||
		typeof face.weight !== "string" ||
		face.weight.trim().length === 0
	) {
		throw new FontManifestError(
			"INVALID_FONT_MANIFEST",
			`Font face ${index} must include non-empty style and weight.`,
		);
	}

	if (!Array.isArray(face.sources) || face.sources.length === 0) {
		throw new FontManifestError(
			"INVALID_FONT_MANIFEST",
			`Font face ${index} must include at least one source.`,
		);
	}

	const display = validateFontDisplayValue(
		face.display,
		`Font face ${index} display`,
	);

	return {
		style: validateCssDeclarationValue(face.style, `Font face ${index} style`),
		weight: validateCssDeclarationValue(face.weight, `Font face ${index} weight`),
		...(display ? { display } : {}),
		sources: face.sources.map((source, sourceIndex) =>
			normalizeFontSource(source, projectRoot, index, sourceIndex),
		),
	};
}

function normalizeFontSource(
	source: FontSource,
	projectRoot: string,
	faceIndex: number,
	sourceIndex: number,
): FontSource {
	const label = `face ${faceIndex} source ${sourceIndex}`;

	if (!isRecord(source) || typeof source.kind !== "string") {
		throw new FontManifestError(
			"INVALID_FONT_SOURCE",
			`Font ${label} must be a JSON object with a supported kind.`,
		);
	}

	switch (source.kind) {
		case "remoteStylesheet":
			return {
				kind: "remoteStylesheet",
				url: validateRemoteUrl(source.url),
			};
		case "remoteFile": {
			const url = validateRemoteUrl(source.url);
			const format =
				source.format !== undefined
					? validateSupportedFontFormat(String(source.format), label)
					: undefined;
			return {
				kind: "remoteFile",
				url,
				...(format ? { format } : {}),
			};
		}
		case "projectFile": {
			const normalizedPath = normalizeProjectRelativeFontPath(
				projectRoot,
				source.path,
			);
			getFontFormatForPath(normalizedPath, source.format);
			return {
				kind: "projectFile",
				path: normalizedPath,
				...(source.format ? { format: source.format } : {}),
			};
		}
		case "managedFile": {
			const normalizedPath = normalizeManagedFontPath(source.path);
			getFontFormatForPath(normalizedPath, source.format);
			return {
				kind: "managedFile",
				path: normalizedPath,
				...(source.format ? { format: source.format } : {}),
			};
		}
		default:
			throw new FontManifestError(
				"INVALID_FONT_SOURCE",
				`Unsupported font source kind for ${label}.`,
			);
	}
}

function normalizeFontManifest(value: unknown, projectRoot: string): FontManifest {
	if (!isRecord(value)) {
		throw new FontManifestError(
			"INVALID_FONT_MANIFEST",
			"Font manifest must be a JSON object.",
		);
	}

	if (value.version !== FONT_MANIFEST_VERSION) {
		throw new FontManifestError(
			"INVALID_FONT_MANIFEST",
			`Unsupported font manifest version: ${String(value.version)}.`,
		);
	}

	if (!isRecord(value.metadata)) {
		throw new FontManifestError(
			"INVALID_FONT_MANIFEST",
			"Font manifest metadata must be an object.",
		);
	}

	if (!isRecord(value.fonts)) {
		throw new FontManifestError(
			"INVALID_FONT_MANIFEST",
			"Font manifest fonts must be an object.",
		);
	}

	const fonts: Record<string, FontManifestFont> = {};
	for (const [rawFontId, rawFont] of Object.entries(value.fonts)) {
		const fontId = normalizeFontId(rawFontId);
		if (fonts[fontId]) {
			throw new FontManifestError(
				"INVALID_FONT_MANIFEST",
				`Duplicate normalized font id "${fontId}" in font manifest.`,
			);
		}
		if (!isRecord(rawFont)) {
			throw new FontManifestError(
				"INVALID_FONT_MANIFEST",
				`Font "${fontId}" must be a JSON object.`,
			);
		}

		if (
			typeof rawFont.name !== "string" ||
			rawFont.name.trim().length === 0 ||
			typeof rawFont.family !== "string" ||
			rawFont.family.trim().length === 0 ||
			!Array.isArray(rawFont.faces)
		) {
			throw new FontManifestError(
				"INVALID_FONT_MANIFEST",
				`Font "${fontId}" must have name, family, and faces.`,
			);
		}

		fonts[fontId] = {
			name: validateFontFamilyValue(rawFont.name, `Font "${fontId}" name`),
			family: validateFontFamilyValue(rawFont.family, `Font "${fontId}" family`),
			faces: normalizeFontFaces(rawFont.faces as FontFace[], projectRoot),
			createdAt:
				typeof rawFont.createdAt === "string"
					? rawFont.createdAt
					: new Date(0).toISOString(),
			updatedAt:
				typeof rawFont.updatedAt === "string"
					? rawFont.updatedAt
					: new Date(0).toISOString(),
		};
	}

	return {
		version: FONT_MANIFEST_VERSION,
		metadata: {
			updatedAt:
				typeof value.metadata.updatedAt === "string"
					? value.metadata.updatedAt
					: new Date(0).toISOString(),
		},
		fonts: Object.fromEntries(
			Object.entries(fonts).sort(([left], [right]) => left.localeCompare(right)),
		),
	};
}

function nextGeneratedFontId(manifest: FontManifest, name: string): string {
	const baseFontId = normalizeFontId(fontNameToId(name));
	if (!manifest.fonts[baseFontId]) {
		return baseFontId;
	}

	let suffix = 2;
	while (manifest.fonts[`${baseFontId}-${suffix}`]) {
		suffix += 1;
	}

	return `${baseFontId}-${suffix}`;
}

async function resolveExistingProjectFilePath(
	projectRoot: string,
	sourcePath: string,
): Promise<string> {
	const normalizedSourcePath = normalizeProjectRelativeFontPath(
		projectRoot,
		sourcePath,
	);
	const candidatePath = path.resolve(projectRoot, normalizedSourcePath);
	const [realProjectRoot, realCandidatePath] = await Promise.all([
		realpath(projectRoot),
		realpath(candidatePath),
	]);
	if (
		realCandidatePath !== realProjectRoot &&
		!realCandidatePath.startsWith(`${realProjectRoot}${path.sep}`)
	) {
		throw new FontManifestError(
			"INVALID_FONT_PATH",
			"Font path must resolve inside the project root.",
		);
	}

	return realCandidatePath;
}

async function writeJsonAtomically(filePath: string, value: unknown) {
	const contents = `${JSON.stringify(value, null, "\t")}\n`;
	const tempPath = `${filePath}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`;

	try {
		await writeFile(tempPath, contents, "utf8");
		await rename(tempPath, filePath);
	} catch (error) {
		await unlink(tempPath).catch(() => undefined);
		throw error;
	}
}

export function fontContentHash(contents: Buffer) {
	return `sha256:${createHash("sha256").update(contents).digest("hex")}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
