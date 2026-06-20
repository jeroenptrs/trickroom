import { createHash, randomUUID } from "node:crypto";
import {
	mkdir,
	readdir,
	readFile,
	realpath,
	rename,
	unlink,
	writeFile,
} from "node:fs/promises";
import path from "node:path";
import {
	ensureDesignSystemManifest,
	readDesignSystemManifest,
	resolveDesignSystemFilePath,
} from "./design-system-store.ts";

export const ICON_MANIFEST_VERSION = 1;

export type IconPaintMode = "fill" | "mixed" | "stroke" | "unknown";

export type IconManifestIcon = {
	name: string;
	sourcePath: string;
	viewBox?: string;
	paint: IconPaintMode;
	hash: string;
};

export type IconManifestDiagnostic = {
	code:
		| "DUPLICATE_ICON_ID"
		| "MISSING_ICON_FOLDER"
		| "SVG_READ_FAILED"
		| "UNSAFE_SVG";
	message: string;
	iconId?: string;
	sourcePath?: string;
	keptSourcePath?: string;
};

export type IconManifest = {
	version: typeof ICON_MANIFEST_VERSION;
	metadata: {
		indexedAt: string;
	};
	iconFolderPaths: string[];
	icons: Record<string, IconManifestIcon>;
	diagnostics: IconManifestDiagnostic[];
};

export class IconManifestError extends Error {
	readonly code:
		| "ICON_NOT_FOUND"
		| "INVALID_ICON_ID"
		| "INVALID_ICON_PATH"
		| "INVALID_ICON_MANIFEST"
		| "UNSAFE_SVG";

	constructor(code: IconManifestError["code"], message: string) {
		super(message);
		this.name = "IconManifestError";
		this.code = code;
	}
}

const emptyIconManifest = (): IconManifest => ({
	version: ICON_MANIFEST_VERSION,
	metadata: {
		indexedAt: new Date(0).toISOString(),
	},
	iconFolderPaths: [],
	icons: {},
	diagnostics: [],
});

export function normalizeIconId(iconId: string): string {
	const normalized = iconId.trim().toLowerCase();
	if (!/^[a-z0-9][a-z0-9_-]*(?:\/[a-z0-9][a-z0-9_-]*)*$/u.test(normalized)) {
		throw new IconManifestError(
			"INVALID_ICON_ID",
			`Invalid icon id "${iconId}". Use lowercase letters, numbers, dashes, underscores, and slashes.`,
		);
	}

	return normalized;
}

export async function readIconManifest(
	projectRoot: string,
	systemName: string,
): Promise<IconManifest> {
	const manifestPath = await resolveDesignSystemFilePath(
		projectRoot,
		systemName,
		"icons.json",
	);

	try {
		const contents = await readFile(manifestPath, "utf8");
		return normalizeIconManifest(JSON.parse(contents) as unknown, projectRoot);
	} catch (error) {
		const fsError = error as NodeJS.ErrnoException;
		if (fsError.code === "ENOENT") {
			return emptyIconManifest();
		}

		throw error;
	}
}

export async function writeIconManifest(
	projectRoot: string,
	systemName: string,
	manifest: IconManifest,
): Promise<IconManifest> {
	const normalized = normalizeIconManifest(manifest, projectRoot);
	await ensureDesignSystemManifest(projectRoot, systemName);
	const manifestPath = await resolveDesignSystemFilePath(
		projectRoot,
		systemName,
		"icons.json",
	);

	await mkdir(path.dirname(manifestPath), { recursive: true });
	await writeJsonAtomically(manifestPath, normalized);
	return normalized;
}

export async function syncIconManifest(
	projectRoot: string,
	systemName: string,
	now = new Date().toISOString(),
): Promise<IconManifest> {
	const { manifest, warnings } = await readDesignSystemManifest(
		projectRoot,
		systemName,
	);
	const iconFolderPaths = manifest?.iconFolderPaths ?? [];
	const icons: Record<string, IconManifestIcon> = {};
	const diagnostics: IconManifestDiagnostic[] = warnings.map((warning) => ({
		code: "MISSING_ICON_FOLDER",
		message: warning.message,
		...(warning.path ? { sourcePath: warning.path } : {}),
	}));

	for (const iconFolderPath of iconFolderPaths) {
		let folderPath: string;
		let svgPaths: string[] = [];
		try {
			folderPath = await resolveExistingProjectPath(
				projectRoot,
				iconFolderPath,
				{
					requireSvg: false,
				},
			);
			svgPaths = await findSvgFiles(folderPath);
		} catch (error) {
			const fsError = error as NodeJS.ErrnoException;
			if (fsError.code === "ENOENT") {
				continue;
			}
			throw error;
		}

		const prefix = createIconFolderPrefix(iconFolderPath);
		for (const svgPath of svgPaths) {
			const sourcePath = path
				.relative(projectRoot, svgPath)
				.replace(/\\/g, "/");
			const relativeSvgPath = path.relative(folderPath, svgPath);
			const iconId = normalizeIconId(
				`${prefix}/${relativeSvgPath
					.replace(/\\/g, "/")
					.replace(/\.svg$/iu, "")
					.toLowerCase()
					.replace(/[^a-z0-9/_-]/g, "-")
					.replace(/\/+/g, "/")
					.replace(/-+/g, "-")}`,
			);

			let svg: string;
			try {
				svg = await readFile(svgPath, "utf8");
			} catch {
				diagnostics.push({
					code: "SVG_READ_FAILED",
					message: `Failed to read SVG icon at ${sourcePath}.`,
					iconId,
					sourcePath,
				});
				continue;
			}

			const sanitized = sanitizeSvg(svg);
			if (!sanitized.ok) {
				diagnostics.push({
					code: "UNSAFE_SVG",
					message: sanitized.message,
					iconId,
					sourcePath,
				});
				continue;
			}

			if (icons[iconId]) {
				diagnostics.push({
					code: "DUPLICATE_ICON_ID",
					message: `Duplicate icon id "${iconId}" at ${sourcePath}; keeping ${icons[iconId].sourcePath}.`,
					iconId,
					sourcePath,
					keptSourcePath: icons[iconId].sourcePath,
				});
				continue;
			}

			icons[iconId] = {
				name: path.basename(sourcePath, ".svg"),
				sourcePath,
				...extractSvgMetadata(sanitized.svg),
				hash: `sha256:${createHash("sha256").update(sanitized.svg).digest("hex")}`,
			};
		}
	}

	return writeIconManifest(projectRoot, systemName, {
		version: ICON_MANIFEST_VERSION,
		metadata: {
			indexedAt: now,
		},
		iconFolderPaths,
		icons: Object.fromEntries(
			Object.entries(icons).sort(([left], [right]) =>
				left.localeCompare(right),
			),
		),
		diagnostics,
	});
}

export async function readIcon(
	projectRoot: string,
	systemName: string,
	iconId: string,
): Promise<IconManifestIcon | null> {
	const manifest = await readIconManifest(projectRoot, systemName);
	return manifest.icons[normalizeIconId(iconId)] ?? null;
}

export async function readSanitizedIconSvg(
	projectRoot: string,
	systemName: string,
	iconId: string,
): Promise<{ icon: IconManifestIcon; svg: string } | null> {
	const normalizedIconId = normalizeIconId(iconId);
	const manifest = await readIconManifest(projectRoot, systemName);
	const icon = manifest.icons[normalizedIconId];
	if (!icon) {
		return null;
	}

	const svgPath = await resolveExistingProjectPath(
		projectRoot,
		icon.sourcePath,
	);
	const svg = await readFile(svgPath, "utf8");
	const sanitized = sanitizeSvg(svg);
	if (!sanitized.ok) {
		throw new IconManifestError("UNSAFE_SVG", sanitized.message);
	}

	return { icon, svg: sanitized.svg };
}

export function sanitizeSvg(
	svg: string,
): { ok: true; svg: string } | { ok: false; message: string } {
	const withoutPreamble = stripSvgPreamble(svg.trim());
	if (
		!/^<svg[\s>]/iu.test(withoutPreamble) ||
		!/<\/svg>\s*$/iu.test(withoutPreamble)
	) {
		return { ok: false, message: "SVG icon must be a single svg document." };
	}

	const inspectionText = decodeSvgEntities(withoutPreamble);
	const unsafePattern = [
		/<script[\s>]/iu,
		/<foreignObject[\s>]/iu,
		/<iframe[\s>]/iu,
		/<object[\s>]/iu,
		/<embed[\s>]/iu,
		/<image[\s>]/iu,
		/\son[a-z]+\s*=/iu,
		/(?:href|src)\s*=\s*["']?(?!#)[^"'\s>]+/iu,
		/\sxlink:href\s*=/iu,
		/\sstyle\s*=/iu,
		/javascript\s*:/iu,
		/data\s*:/iu,
		/url\s*\(/iu,
	];
	for (const pattern of unsafePattern) {
		if (pattern.test(withoutPreamble) || pattern.test(inspectionText)) {
			return {
				ok: false,
				message: "SVG icon contains unsupported or unsafe content.",
			};
		}
	}

	const tagPattern = /<\/?([a-zA-Z][a-zA-Z0-9:-]*)\b[^>]*>/gu;
	const allowedTags = new Set([
		"svg",
		"g",
		"path",
		"circle",
		"rect",
		"line",
		"polyline",
		"polygon",
		"ellipse",
		"defs",
		"clipPath",
		"mask",
		"linearGradient",
		"radialGradient",
		"stop",
		"title",
		"symbol",
		"use",
	]);
	for (const match of withoutPreamble.matchAll(tagPattern)) {
		if (!allowedTags.has(match[1])) {
			return {
				ok: false,
				message: `SVG icon contains unsupported tag "${match[1]}".`,
			};
		}
	}

	return { ok: true, svg: withoutPreamble };
}

function stripSvgPreamble(svg: string): string {
	return svg
		.replace(/<\?xml[\s\S]*?\?>/giu, "")
		.replace(/<!doctype[\s\S]*?>/giu, "")
		.replace(/<!--[\s\S]*?-->/gu, "")
		.trim();
}

export function normalizeProjectRelativeIconPath(
	projectRoot: string,
	sourcePath: string,
): string {
	const normalized = normalizeProjectRelativeIconStoragePath(
		projectRoot,
		sourcePath,
	);
	if (path.extname(normalized).toLowerCase() !== ".svg") {
		throw new IconManifestError(
			"INVALID_ICON_PATH",
			"Icon sourcePath must point to an SVG file.",
		);
	}

	return normalized;
}

function normalizeProjectRelativeIconStoragePath(
	projectRoot: string,
	sourcePath: string,
): string {
	const trimmed = sourcePath.trim();
	if (trimmed.length === 0) {
		throw new IconManifestError(
			"INVALID_ICON_PATH",
			"Icon sourcePath must be a non-empty project-relative SVG path.",
		);
	}

	if (path.isAbsolute(trimmed)) {
		throw new IconManifestError(
			"INVALID_ICON_PATH",
			"Icon sourcePath must be project-relative.",
		);
	}

	const normalized = path.normalize(trimmed).replace(/\\/g, "/");
	const resolvedProjectRoot = path.resolve(projectRoot);
	const resolvedPath = path.resolve(resolvedProjectRoot, normalized);
	if (
		resolvedPath === resolvedProjectRoot ||
		!resolvedPath.startsWith(`${resolvedProjectRoot}${path.sep}`)
	) {
		throw new IconManifestError(
			"INVALID_ICON_PATH",
			"Icon sourcePath must stay inside the project root.",
		);
	}

	return normalized.replace(/^(\.\/)+/u, "");
}

function decodeSvgEntities(value: string): string {
	const namedEntities: Record<string, string> = {
		amp: "&",
		apos: "'",
		gt: ">",
		lt: "<",
		quot: '"',
	};

	return value.replace(
		/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]+);/giu,
		(match, entity: string) => {
			if (entity.startsWith("#x") || entity.startsWith("#X")) {
				const codePoint = Number.parseInt(entity.slice(2), 16);
				return codePointToString(codePoint) ?? match;
			}

			if (entity.startsWith("#")) {
				const codePoint = Number.parseInt(entity.slice(1), 10);
				return codePointToString(codePoint) ?? match;
			}

			return namedEntities[entity.toLowerCase()] ?? match;
		},
	);
}

function codePointToString(codePoint: number): string | null {
	if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff) {
		return null;
	}

	return String.fromCodePoint(codePoint);
}

async function resolveExistingProjectPath(
	projectRoot: string,
	sourcePath: string,
	options: { requireSvg?: boolean } = {},
): Promise<string> {
	const normalizedSourcePath =
		options.requireSvg === false
			? normalizeProjectRelativeIconStoragePath(projectRoot, sourcePath)
			: normalizeProjectRelativeIconPath(projectRoot, sourcePath);
	const candidatePath = path.resolve(projectRoot, normalizedSourcePath);
	const [realProjectRoot, realCandidatePath] = await Promise.all([
		realpath(projectRoot),
		realpath(candidatePath),
	]);
	if (
		realCandidatePath !== realProjectRoot &&
		!realCandidatePath.startsWith(`${realProjectRoot}${path.sep}`)
	) {
		throw new IconManifestError(
			"INVALID_ICON_PATH",
			"Icon sourcePath must resolve inside the project root.",
		);
	}

	return realCandidatePath;
}

function normalizeIconManifest(
	value: unknown,
	projectRoot: string,
): IconManifest {
	if (!isRecord(value)) {
		throw new IconManifestError(
			"INVALID_ICON_MANIFEST",
			"Icon manifest must be a JSON object.",
		);
	}

	if (value.version !== ICON_MANIFEST_VERSION) {
		throw new IconManifestError(
			"INVALID_ICON_MANIFEST",
			`Unsupported icon manifest version: ${String(value.version)}.`,
		);
	}

	if (!isRecord(value.metadata)) {
		throw new IconManifestError(
			"INVALID_ICON_MANIFEST",
			"Icon manifest metadata must be an object.",
		);
	}

	if (!Array.isArray(value.iconFolderPaths)) {
		throw new IconManifestError(
			"INVALID_ICON_MANIFEST",
			"Icon manifest iconFolderPaths must be an array.",
		);
	}

	if (!isRecord(value.icons)) {
		throw new IconManifestError(
			"INVALID_ICON_MANIFEST",
			"Icon manifest icons must be an object.",
		);
	}

	const icons: Record<string, IconManifestIcon> = {};
	for (const [rawIconId, rawIcon] of Object.entries(value.icons)) {
		const iconId = normalizeIconId(rawIconId);
		if (icons[iconId]) {
			throw new IconManifestError(
				"INVALID_ICON_MANIFEST",
				`Duplicate normalized icon id "${iconId}" in icon manifest.`,
			);
		}
		if (
			!isRecord(rawIcon) ||
			typeof rawIcon.name !== "string" ||
			typeof rawIcon.sourcePath !== "string" ||
			typeof rawIcon.hash !== "string"
		) {
			throw new IconManifestError(
				"INVALID_ICON_MANIFEST",
				`Icon "${iconId}" must have name, sourcePath, and hash strings.`,
			);
		}

		const sourcePath = normalizeProjectRelativeIconPath(
			projectRoot,
			rawIcon.sourcePath,
		);
		icons[iconId] = {
			name: rawIcon.name,
			sourcePath,
			...(typeof rawIcon.viewBox === "string"
				? { viewBox: rawIcon.viewBox }
				: {}),
			paint: isIconPaintMode(rawIcon.paint) ? rawIcon.paint : "unknown",
			hash: rawIcon.hash,
		};
	}

	return {
		version: ICON_MANIFEST_VERSION,
		metadata: {
			indexedAt:
				typeof value.metadata.indexedAt === "string"
					? value.metadata.indexedAt
					: new Date(0).toISOString(),
		},
		iconFolderPaths: value.iconFolderPaths.filter(
			(entry): entry is string => typeof entry === "string",
		),
		icons: Object.fromEntries(
			Object.entries(icons).sort(([left], [right]) =>
				left.localeCompare(right),
			),
		),
		diagnostics: Array.isArray(value.diagnostics)
			? value.diagnostics.filter(isIconManifestDiagnostic)
			: [],
	};
}

async function findSvgFiles(folderPath: string): Promise<string[]> {
	const entries = await readdir(folderPath, { withFileTypes: true });
	const files = await Promise.all(
		entries.map(async (entry) => {
			const entryPath = path.join(folderPath, entry.name);
			if (entry.isDirectory()) {
				return findSvgFiles(entryPath);
			}
			return entry.isFile() && entry.name.toLowerCase().endsWith(".svg")
				? [entryPath]
				: [];
		}),
	);

	return files.flat().sort((left, right) => left.localeCompare(right));
}

function createIconFolderPrefix(iconFolderPath: string): string {
	const parts = iconFolderPath.replace(/\\/g, "/").split("/").filter(Boolean);
	const known = [
		"heroicons",
		"lucide-static",
		"bootstrap-icons",
		"iconic",
		"iconoir",
		"tabler",
		"phosphor",
	];
	for (const knownPart of known) {
		if (parts.some((part) => part.toLowerCase().includes(knownPart))) {
			return knownPart;
		}
	}

	const generic = new Set([
		"icons",
		"svg",
		"outline",
		"solid",
		"regular",
		"fill",
	]);
	const preferred = [...parts]
		.reverse()
		.find((part) => !generic.has(part.toLowerCase()));
	return (preferred ?? "icons")
		.toLowerCase()
		.replace(/[^a-z0-9_-]/g, "-")
		.replace(/-+/g, "-");
}

function extractSvgMetadata(svg: string): {
	viewBox?: string;
	paint: IconPaintMode;
} {
	const viewBoxMatch = svg.match(/\sviewBox=["']([^"']+)["']/u);
	const hasStroke = /\sstroke=["'](?!none["'])/iu.test(svg);
	const hasFill = /\sfill=["'](?!none["'])/iu.test(svg);
	return {
		...(viewBoxMatch ? { viewBox: viewBoxMatch[1] } : {}),
		paint:
			hasStroke && hasFill
				? "mixed"
				: hasStroke
					? "stroke"
					: hasFill
						? "fill"
						: "unknown",
	};
}

function isIconPaintMode(value: unknown): value is IconPaintMode {
	return (
		value === "fill" ||
		value === "mixed" ||
		value === "stroke" ||
		value === "unknown"
	);
}

function isIconManifestDiagnostic(
	value: unknown,
): value is IconManifestDiagnostic {
	return (
		isRecord(value) &&
		typeof value.code === "string" &&
		typeof value.message === "string"
	);
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

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
