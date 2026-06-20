import { createHash, randomUUID } from "node:crypto";
import {
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
	resolveDesignSystemFilePath,
} from "./design-system-store.ts";

export const ASSET_MANIFEST_VERSION = 1;

export const supportedImageMimeTypes = {
	".gif": "image/gif",
	".jpeg": "image/jpeg",
	".jpg": "image/jpeg",
	".png": "image/png",
	".webp": "image/webp",
} as const;

export type SupportedImageMimeType =
	(typeof supportedImageMimeTypes)[keyof typeof supportedImageMimeTypes];

export type AssetKind = "image";

export type AssetManifestAsset = {
	name: string;
	kind: AssetKind;
	sourcePath: string;
	mimeType: SupportedImageMimeType;
	width?: number;
	height?: number;
	alt?: string;
	createdAt: string;
	updatedAt: string;
};

export type AssetManifest = {
	version: typeof ASSET_MANIFEST_VERSION;
	metadata: {
		updatedAt: string;
	};
	assets: Record<string, AssetManifestAsset>;
};

export type RegisterAssetParams = {
	assetId?: string;
	name: string;
	sourcePath: string;
	alt?: string;
	now?: string;
};

export type UpdateAssetParams = {
	name?: string;
	sourcePath?: string;
	alt?: string | null;
	now?: string;
};

export class AssetManifestError extends Error {
	readonly code:
		| "ASSET_NOT_FOUND"
		| "DUPLICATE_ASSET_ID"
		| "INVALID_ASSET_ID"
		| "INVALID_ASSET_MANIFEST"
		| "INVALID_ASSET_PATH"
		| "UNSUPPORTED_ASSET_TYPE";

	constructor(code: AssetManifestError["code"], message: string) {
		super(message);
		this.name = "AssetManifestError";
		this.code = code;
	}
}

const emptyAssetManifest = (): AssetManifest => ({
	version: ASSET_MANIFEST_VERSION,
	metadata: {
		updatedAt: new Date(0).toISOString(),
	},
	assets: {},
});

export const isSupportedImageMimeType = (
	value: unknown,
): value is SupportedImageMimeType =>
	typeof value === "string" &&
	Object.values(supportedImageMimeTypes).includes(
		value as SupportedImageMimeType,
	);

export function normalizeAssetId(assetId: string): string {
	const normalized = assetId.trim().toLowerCase();
	if (!/^[a-z0-9][a-z0-9_-]*(?:\/[a-z0-9][a-z0-9_-]*)*$/u.test(normalized)) {
		throw new AssetManifestError(
			"INVALID_ASSET_ID",
			`Invalid asset id "${assetId}". Use lowercase letters, numbers, dashes, underscores, and slashes.`,
		);
	}

	return normalized;
}

export function assetNameToId(name: string): string {
	const safeName = name
		.trim()
		.toLowerCase()
		.replace(/\s+/g, "-")
		.replace(/[^a-z0-9_-]/g, "")
		.replace(/^-+|-+$/g, "");

	return `ast_${safeName || "asset"}`;
}

export function getImageMimeTypeForPath(
	sourcePath: string,
): SupportedImageMimeType {
	const extension = path.extname(sourcePath).toLowerCase();
	const mimeType =
		supportedImageMimeTypes[extension as keyof typeof supportedImageMimeTypes];
	if (!mimeType) {
		throw new AssetManifestError(
			"UNSUPPORTED_ASSET_TYPE",
			`Unsupported asset type for "${sourcePath}". Supported image types: png, jpg, jpeg, webp, gif.`,
		);
	}

	return mimeType;
}

export function normalizeProjectRelativeAssetPath(
	projectRoot: string,
	sourcePath: string,
): string {
	const trimmed = sourcePath.trim();
	if (trimmed.length === 0) {
		throw new AssetManifestError(
			"INVALID_ASSET_PATH",
			"Asset sourcePath must be a non-empty project-relative path.",
		);
	}

	if (path.isAbsolute(trimmed)) {
		throw new AssetManifestError(
			"INVALID_ASSET_PATH",
			"Asset sourcePath must be project-relative.",
		);
	}

	const normalized = path.normalize(trimmed).replace(/\\/g, "/");
	const resolvedProjectRoot = path.resolve(projectRoot);
	const resolvedPath = path.resolve(resolvedProjectRoot, normalized);
	if (
		resolvedPath !== resolvedProjectRoot &&
		!resolvedPath.startsWith(`${resolvedProjectRoot}${path.sep}`)
	) {
		throw new AssetManifestError(
			"INVALID_ASSET_PATH",
			"Asset sourcePath must stay inside the project root.",
		);
	}

	if (resolvedPath === resolvedProjectRoot) {
		throw new AssetManifestError(
			"INVALID_ASSET_PATH",
			"Asset sourcePath must point to a file inside the project root.",
		);
	}

	return normalized.replace(/^(\.\/)+/u, "");
}

export function resolveAssetSourceFilePath(
	projectRoot: string,
	asset: AssetManifestAsset,
): string {
	const normalizedSourcePath = normalizeProjectRelativeAssetPath(
		projectRoot,
		asset.sourcePath,
	);
	return path.resolve(projectRoot, normalizedSourcePath);
}

export async function readAssetManifest(
	projectRoot: string,
	systemName: string,
): Promise<AssetManifest> {
	const manifestPath = await resolveDesignSystemFilePath(
		projectRoot,
		systemName,
		"assets.json",
	);

	try {
		const contents = await readFile(manifestPath, "utf8");
		return normalizeAssetManifest(JSON.parse(contents) as unknown, projectRoot);
	} catch (error) {
		const fsError = error as NodeJS.ErrnoException;
		if (fsError.code === "ENOENT") {
			return emptyAssetManifest();
		}

		throw error;
	}
}

export async function writeAssetManifest(
	projectRoot: string,
	systemName: string,
	manifest: AssetManifest,
): Promise<AssetManifest> {
	const normalized = normalizeAssetManifest(manifest, projectRoot);

	await ensureDesignSystemManifest(projectRoot, systemName);
	const manifestPath = await resolveDesignSystemFilePath(
		projectRoot,
		systemName,
		"assets.json",
	);
	await mkdir(path.dirname(manifestPath), { recursive: true });
	await writeJsonAtomically(manifestPath, normalized);
	return normalized;
}

export async function registerAsset(
	projectRoot: string,
	systemName: string,
	params: RegisterAssetParams,
): Promise<{
	assetId: string;
	asset: AssetManifestAsset;
	manifest: AssetManifest;
}> {
	const manifest = await readAssetManifest(projectRoot, systemName);
	const now = params.now ?? new Date().toISOString();
	const assetId = params.assetId
		? normalizeAssetId(params.assetId)
		: nextGeneratedAssetId(manifest, params.name);

	if (manifest.assets[assetId]) {
		throw new AssetManifestError(
			"DUPLICATE_ASSET_ID",
			`Asset id "${assetId}" already exists in system "${systemName}".`,
		);
	}

	const sourcePath = normalizeProjectRelativeAssetPath(
		projectRoot,
		params.sourcePath,
	);
	const mimeType = getImageMimeTypeForPath(sourcePath);
	const metadata = await readImageMetadataIfPresent(
		projectRoot,
		sourcePath,
		mimeType,
	);
	const asset = {
		name: params.name.trim(),
		kind: "image",
		sourcePath,
		mimeType,
		...(metadata.width !== undefined ? { width: metadata.width } : {}),
		...(metadata.height !== undefined ? { height: metadata.height } : {}),
		...(params.alt !== undefined ? { alt: params.alt } : {}),
		createdAt: now,
		updatedAt: now,
	} satisfies AssetManifestAsset;
	const nextManifest = {
		version: ASSET_MANIFEST_VERSION,
		metadata: {
			updatedAt: now,
		},
		assets: {
			...manifest.assets,
			[assetId]: asset,
		},
	} satisfies AssetManifest;

	return {
		assetId,
		asset,
		manifest: await writeAssetManifest(projectRoot, systemName, nextManifest),
	};
}

export async function updateAsset(
	projectRoot: string,
	systemName: string,
	assetId: string,
	params: UpdateAssetParams,
): Promise<{
	assetId: string;
	asset: AssetManifestAsset;
	manifest: AssetManifest;
}> {
	const normalizedAssetId = normalizeAssetId(assetId);
	const manifest = await readAssetManifest(projectRoot, systemName);
	const existing = manifest.assets[normalizedAssetId];
	if (!existing) {
		throw new AssetManifestError(
			"ASSET_NOT_FOUND",
			`Unknown asset id "${normalizedAssetId}" in system "${systemName}".`,
		);
	}

	const now = params.now ?? new Date().toISOString();
	const nextSourcePath =
		params.sourcePath === undefined
			? existing.sourcePath
			: normalizeProjectRelativeAssetPath(projectRoot, params.sourcePath);
	const nextMimeType = getImageMimeTypeForPath(nextSourcePath);
	const metadata =
		params.sourcePath === undefined
			? { width: existing.width, height: existing.height }
			: await readImageMetadataIfPresent(
					projectRoot,
					nextSourcePath,
					nextMimeType,
				);
	const nextAsset = {
		...existing,
		...(params.name !== undefined ? { name: params.name.trim() } : {}),
		sourcePath: nextSourcePath,
		mimeType: nextMimeType,
		...(metadata.width !== undefined ? { width: metadata.width } : {}),
		...(metadata.height !== undefined ? { height: metadata.height } : {}),
		...(params.alt === null
			? { alt: undefined }
			: params.alt !== undefined
				? { alt: params.alt }
				: {}),
		updatedAt: now,
	} satisfies AssetManifestAsset;

	if (nextAsset.alt === undefined) {
		delete nextAsset.alt;
	}
	if (nextAsset.width === undefined) {
		delete nextAsset.width;
	}
	if (nextAsset.height === undefined) {
		delete nextAsset.height;
	}

	const nextManifest = {
		...manifest,
		metadata: { updatedAt: now },
		assets: {
			...manifest.assets,
			[normalizedAssetId]: nextAsset,
		},
	} satisfies AssetManifest;

	return {
		assetId: normalizedAssetId,
		asset: nextAsset,
		manifest: await writeAssetManifest(projectRoot, systemName, nextManifest),
	};
}

export async function deleteAsset(
	projectRoot: string,
	systemName: string,
	assetId: string,
): Promise<AssetManifest> {
	const normalizedAssetId = normalizeAssetId(assetId);
	const manifest = await readAssetManifest(projectRoot, systemName);
	if (!manifest.assets[normalizedAssetId]) {
		throw new AssetManifestError(
			"ASSET_NOT_FOUND",
			`Unknown asset id "${normalizedAssetId}" in system "${systemName}".`,
		);
	}

	const { [normalizedAssetId]: _deleted, ...remainingAssets } = manifest.assets;
	void _deleted;
	return writeAssetManifest(projectRoot, systemName, {
		...manifest,
		metadata: {
			updatedAt: new Date().toISOString(),
		},
		assets: remainingAssets,
	});
}

export async function refreshAssetMetadata(
	projectRoot: string,
	systemName: string,
	assetId: string,
	now = new Date().toISOString(),
): Promise<{
	assetId: string;
	asset: AssetManifestAsset;
	manifest: AssetManifest;
}> {
	const normalizedAssetId = normalizeAssetId(assetId);
	const manifest = await readAssetManifest(projectRoot, systemName);
	const existing = manifest.assets[normalizedAssetId];
	if (!existing) {
		throw new AssetManifestError(
			"ASSET_NOT_FOUND",
			`Unknown asset id "${normalizedAssetId}" in system "${systemName}".`,
		);
	}

	const mimeType = getImageMimeTypeForPath(existing.sourcePath);
	const metadata = await readImageMetadataIfPresent(
		projectRoot,
		existing.sourcePath,
		mimeType,
	);
	const nextAsset = {
		...existing,
		mimeType,
		...(metadata.width !== undefined ? { width: metadata.width } : {}),
		...(metadata.height !== undefined ? { height: metadata.height } : {}),
		updatedAt: now,
	} satisfies AssetManifestAsset;

	if (metadata.width === undefined) {
		delete nextAsset.width;
	}
	if (metadata.height === undefined) {
		delete nextAsset.height;
	}

	const nextManifest = {
		...manifest,
		metadata: { updatedAt: now },
		assets: {
			...manifest.assets,
			[normalizedAssetId]: nextAsset,
		},
	} satisfies AssetManifest;

	return {
		assetId: normalizedAssetId,
		asset: nextAsset,
		manifest: await writeAssetManifest(projectRoot, systemName, nextManifest),
	};
}

export async function readAsset(
	projectRoot: string,
	systemName: string,
	assetId: string,
): Promise<AssetManifestAsset | null> {
	const manifest = await readAssetManifest(projectRoot, systemName);
	return manifest.assets[normalizeAssetId(assetId)] ?? null;
}

export async function readAssetFile(
	projectRoot: string,
	asset: AssetManifestAsset,
): Promise<{ contents: Buffer; mimeType: SupportedImageMimeType }> {
	const filePath = await resolveExistingProjectFilePath(
		projectRoot,
		asset.sourcePath,
	);
	const fileStat = await stat(filePath);
	if (!fileStat.isFile()) {
		throw Object.assign(new Error("Asset sourcePath is not a file."), {
			code: "EISDIR",
		});
	}

	return {
		contents: await readFile(filePath),
		mimeType: getImageMimeTypeForPath(asset.sourcePath),
	};
}

function normalizeAssetManifest(
	value: unknown,
	projectRoot: string,
): AssetManifest {
	if (!isRecord(value)) {
		throw new AssetManifestError(
			"INVALID_ASSET_MANIFEST",
			"Asset manifest must be a JSON object.",
		);
	}

	if (value.version !== ASSET_MANIFEST_VERSION) {
		throw new AssetManifestError(
			"INVALID_ASSET_MANIFEST",
			`Unsupported asset manifest version: ${String(value.version)}.`,
		);
	}

	if (!isRecord(value.metadata)) {
		throw new AssetManifestError(
			"INVALID_ASSET_MANIFEST",
			"Asset manifest metadata must be an object.",
		);
	}

	if (!isRecord(value.assets)) {
		throw new AssetManifestError(
			"INVALID_ASSET_MANIFEST",
			"Asset manifest assets must be an object.",
		);
	}

	const assets: Record<string, AssetManifestAsset> = {};
	for (const [rawAssetId, rawAsset] of Object.entries(value.assets)) {
		const assetId = normalizeAssetId(rawAssetId);
		if (assets[assetId]) {
			throw new AssetManifestError(
				"INVALID_ASSET_MANIFEST",
				`Duplicate normalized asset id "${assetId}" in asset manifest.`,
			);
		}
		if (!isRecord(rawAsset)) {
			throw new AssetManifestError(
				"INVALID_ASSET_MANIFEST",
				`Asset "${assetId}" must be a JSON object.`,
			);
		}

		if (
			typeof rawAsset.name !== "string" ||
			rawAsset.name.trim().length === 0
		) {
			throw new AssetManifestError(
				"INVALID_ASSET_MANIFEST",
				`Asset "${assetId}" must have a non-empty name.`,
			);
		}

		if (rawAsset.kind !== "image") {
			throw new AssetManifestError(
				"INVALID_ASSET_MANIFEST",
				`Asset "${assetId}" has unsupported kind.`,
			);
		}

		if (typeof rawAsset.sourcePath !== "string") {
			throw new AssetManifestError(
				"INVALID_ASSET_MANIFEST",
				`Asset "${assetId}" must have a sourcePath string.`,
			);
		}

		const sourcePath = normalizeProjectRelativeAssetPath(
			projectRoot,
			rawAsset.sourcePath,
		);
		const mimeType = getImageMimeTypeForPath(sourcePath);
		if (
			rawAsset.mimeType !== undefined &&
			rawAsset.mimeType !== mimeType &&
			!isSupportedImageMimeType(rawAsset.mimeType)
		) {
			throw new AssetManifestError(
				"INVALID_ASSET_MANIFEST",
				`Asset "${assetId}" has unsupported mimeType.`,
			);
		}

		assets[assetId] = {
			name: rawAsset.name.trim(),
			kind: "image",
			sourcePath,
			mimeType,
			...(typeof rawAsset.width === "number" && rawAsset.width > 0
				? { width: rawAsset.width }
				: {}),
			...(typeof rawAsset.height === "number" && rawAsset.height > 0
				? { height: rawAsset.height }
				: {}),
			...(typeof rawAsset.alt === "string" ? { alt: rawAsset.alt } : {}),
			createdAt:
				typeof rawAsset.createdAt === "string"
					? rawAsset.createdAt
					: new Date(0).toISOString(),
			updatedAt:
				typeof rawAsset.updatedAt === "string"
					? rawAsset.updatedAt
					: new Date(0).toISOString(),
		};
	}

	return {
		version: ASSET_MANIFEST_VERSION,
		metadata: {
			updatedAt:
				typeof value.metadata.updatedAt === "string"
					? value.metadata.updatedAt
					: new Date(0).toISOString(),
		},
		assets: Object.fromEntries(
			Object.entries(assets).sort(([left], [right]) =>
				left.localeCompare(right),
			),
		),
	};
}

function nextGeneratedAssetId(manifest: AssetManifest, name: string): string {
	const baseAssetId = normalizeAssetId(assetNameToId(name));
	if (!manifest.assets[baseAssetId]) {
		return baseAssetId;
	}

	let suffix = 2;
	while (manifest.assets[`${baseAssetId}-${suffix}`]) {
		suffix += 1;
	}

	return `${baseAssetId}-${suffix}`;
}

async function readImageMetadataIfPresent(
	projectRoot: string,
	sourcePath: string,
	mimeType: SupportedImageMimeType,
): Promise<{ width?: number; height?: number }> {
	try {
		const filePath = await resolveExistingProjectFilePath(
			projectRoot,
			sourcePath,
		);
		const file = await readFile(filePath);
		return readImageMetadata(file, mimeType);
	} catch (error) {
		const fsError = error as NodeJS.ErrnoException;
		if (fsError.code === "ENOENT") {
			return {};
		}
		throw error;
	}
}

async function resolveExistingProjectFilePath(
	projectRoot: string,
	sourcePath: string,
): Promise<string> {
	const normalizedSourcePath = normalizeProjectRelativeAssetPath(
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
		throw new AssetManifestError(
			"INVALID_ASSET_PATH",
			"Asset sourcePath must resolve inside the project root.",
		);
	}

	return realCandidatePath;
}

function readImageMetadata(
	file: Buffer,
	mimeType: SupportedImageMimeType,
): { width?: number; height?: number } {
	if (mimeType === "image/png" && file.length >= 24) {
		return {
			width: file.readUInt32BE(16),
			height: file.readUInt32BE(20),
		};
	}

	if (mimeType === "image/gif" && file.length >= 10) {
		return {
			width: file.readUInt16LE(6),
			height: file.readUInt16LE(8),
		};
	}

	if (mimeType === "image/jpeg") {
		return readJpegMetadata(file);
	}

	if (mimeType === "image/webp") {
		return readWebpMetadata(file);
	}

	return {};
}

function readJpegMetadata(file: Buffer): { width?: number; height?: number } {
	let offset = 2;
	while (offset < file.length) {
		if (file[offset] !== 0xff) {
			return {};
		}
		const marker = file[offset + 1];
		const segmentLength = file.readUInt16BE(offset + 2);
		if (
			(marker >= 0xc0 && marker <= 0xc3) ||
			(marker >= 0xc5 && marker <= 0xc7) ||
			(marker >= 0xc9 && marker <= 0xcb) ||
			(marker >= 0xcd && marker <= 0xcf)
		) {
			return {
				height: file.readUInt16BE(offset + 5),
				width: file.readUInt16BE(offset + 7),
			};
		}
		offset += 2 + segmentLength;
	}

	return {};
}

function readWebpMetadata(file: Buffer): { width?: number; height?: number } {
	if (file.length < 30 || file.toString("ascii", 0, 4) !== "RIFF") {
		return {};
	}

	const format = file.toString("ascii", 12, 16);
	if (format === "VP8X" && file.length >= 30) {
		return {
			width: 1 + file.readUIntLE(24, 3),
			height: 1 + file.readUIntLE(27, 3),
		};
	}

	if (format === "VP8 " && file.length >= 30) {
		return {
			width: file.readUInt16LE(26) & 0x3fff,
			height: file.readUInt16LE(28) & 0x3fff,
		};
	}

	if (format === "VP8L" && file.length >= 25) {
		const bits = file.readUInt32LE(21);
		return {
			width: (bits & 0x3fff) + 1,
			height: ((bits >> 14) & 0x3fff) + 1,
		};
	}

	return {};
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

export function assetContentHash(contents: Buffer) {
	return `sha256:${createHash("sha256").update(contents).digest("hex")}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
