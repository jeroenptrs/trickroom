import { randomUUID } from "node:crypto";
import {
	mkdir,
	readdir,
	readFile,
	rename,
	rm,
	stat,
	unlink,
	writeFile,
} from "node:fs/promises";
import path from "node:path";
import { SYSTEM_COMPONENT_MANIFEST_FILE_NAME } from "./system-components.ts";

export const DESIGN_SYSTEM_MANIFEST_VERSION = 1;
export const DESIGN_SYSTEM_MANIFEST_FILE_NAME = "system.json";
export const DESIGN_SYSTEM_ID_PREFIX = "sys_";

export type DesignSystemManifest = {
	version: typeof DESIGN_SYSTEM_MANIFEST_VERSION;
	systemId: string;
	systemName: string;
	previousSystemNames?: string[];
	cssPath?: string;
	iconFolderPaths?: string[];
};

export type DesignSystemRecord = {
	storageKey: string;
	dir: string;
	manifestPath: string;
	manifest: DesignSystemManifest;
	warnings: DesignSystemManifestWarning[];
};

export type DesignSystemManifestRead = {
	manifest: DesignSystemManifest | null;
	warnings: DesignSystemManifestWarning[];
	record: DesignSystemRecord | null;
};

export type DesignSystemManifestWarningCode = "MISSING_ICON_FOLDER";

export type DesignSystemManifestWarning = {
	code: DesignSystemManifestWarningCode;
	message: string;
	path?: string;
};

export class DesignSystemStorageError extends Error {
	readonly code:
		| "EMPTY_SYSTEM_KEY"
		| "INVALID_SYSTEM_KEY"
		| "DUPLICATE_SYSTEM_ID"
		| "DUPLICATE_SYSTEM_KEY"
		| "DUPLICATE_SYSTEM_NAME"
		| "SYSTEM_NOT_FOUND"
		| "INVALID_MANIFEST";

	constructor(code: DesignSystemStorageError["code"], message: string) {
		super(message);
		this.name = "DesignSystemStorageError";
		this.code = code;
	}
}

export type DesignSystemSafeKeyCollision = {
	safeKey: string;
	systemNames: string[];
};

export type DesignSystemManifestFile = 
	| typeof DESIGN_SYSTEM_MANIFEST_FILE_NAME
	| typeof SYSTEM_COMPONENT_MANIFEST_FILE_NAME
	| "tokens.json"
	| "assets.json"
	| "icons.json"
	| "fonts.json";

/**
 * Convert a system name to a filesystem-safe key.
 * @example "my-system" -> "my-system", "My System" -> "my-system"
 */
export function systemNameToSafeKey(systemName: string): string {
	return systemName
		.toLowerCase()
		.replace(/\s+/g, "-")
		.replace(/[^a-z0-9\-_.]/g, "")
		.replace(/^-+|-+$/g, "");
}

export function resolveDesignSystemSafeKey(systemName: string): string {
	const safeKey = systemNameToSafeKey(systemName.trim());
	if (safeKey.length === 0) {
		throw new DesignSystemStorageError(
			"EMPTY_SYSTEM_KEY",
			`System name "${systemName}" does not produce a safe storage key`,
		);
	}

	if (safeKey === "." || safeKey === "..") {
		throw new DesignSystemStorageError(
			"INVALID_SYSTEM_KEY",
			`System name "${systemName}" produces a reserved storage key`,
		);
	}

	return safeKey;
}

export function findDesignSystemSafeKeyCollisions(
	systemNames: readonly string[],
): DesignSystemSafeKeyCollision[] {
	const namesBySafeKey = new Map<string, string[]>();

	for (const systemName of systemNames) {
		const trimmedName = systemName.trim();
		if (trimmedName.length === 0) {
			continue;
		}

		const safeKey = resolveDesignSystemSafeKey(trimmedName);
		const names = namesBySafeKey.get(safeKey) ?? [];
		names.push(trimmedName);
		namesBySafeKey.set(safeKey, names);
	}

	return [...namesBySafeKey.entries()]
		.filter(([, names]) => names.length > 1)
		.map(([safeKey, names]) => ({
			safeKey,
			systemNames: [...new Set(names)],
		}));
}

export function assertUniqueDesignSystemSafeKeys(
	systemNames: readonly string[],
): void {
	const collisions = findDesignSystemSafeKeyCollisions(systemNames);
	if (collisions.length === 0) {
		return;
	}

	const descriptions = collisions
		.map(
			(collision) =>
				`${collision.safeKey}: ${collision.systemNames.join(", ")}`,
		)
		.join("; ");

	throw new DesignSystemStorageError(
		"DUPLICATE_SYSTEM_KEY",
		`Design system names produce duplicate storage keys (${descriptions})`,
	);
}

export function generateSystemId() {
	return `${DESIGN_SYSTEM_ID_PREFIX}${randomUUID()}`;
}

export function isDesignSystemId(value: unknown): value is string {
	return (
		typeof value === "string" &&
		/^sys_[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
			value.trim(),
		)
	);
}

export function resolveDesignSystemsDir(projectRoot: string): string {
	return path.join(path.resolve(projectRoot), ".trickroom", "systems");
}

export function resolveDesignSystemDir(
	projectRoot: string,
	systemName: string,
): string {
	const systemsDir = resolveDesignSystemsDir(projectRoot);
	const systemDir = path.join(
		systemsDir,
		resolveDesignSystemSafeKey(systemName),
	);

	if (path.dirname(systemDir) !== systemsDir) {
		throw new DesignSystemStorageError(
			"INVALID_SYSTEM_KEY",
			`System name "${systemName}" must resolve to a direct child of .trickroom/systems`,
		);
	}

	return systemDir;
}

export function resolveDesignSystemManifestPath(
	projectRoot: string,
	systemName: string,
): string {
	return path.join(
		resolveDesignSystemDir(projectRoot, systemName),
		DESIGN_SYSTEM_MANIFEST_FILE_NAME,
	);
}

export function resolveDesignSystemComponentsPath(
	projectRoot: string,
	systemName: string,
): string {
	return path.join(
		resolveDesignSystemDir(projectRoot, systemName),
		SYSTEM_COMPONENT_MANIFEST_FILE_NAME,
	);
}

export function resolveDesignSystemTokensPath(
	projectRoot: string,
	systemName: string,
): string {
	return path.join(
		resolveDesignSystemDir(projectRoot, systemName),
		"tokens.json",
	);
}

export function resolveDesignSystemAssetsPath(
	projectRoot: string,
	systemName: string,
): string {
	return path.join(
		resolveDesignSystemDir(projectRoot, systemName),
		"assets.json",
	);
}

export function resolveDesignSystemIconsPath(
	projectRoot: string,
	systemName: string,
): string {
	return path.join(
		resolveDesignSystemDir(projectRoot, systemName),
		"icons.json",
	);
}

export function resolveDesignSystemFontsPath(
	projectRoot: string,
	systemName: string,
): string {
	return path.join(
		resolveDesignSystemDir(projectRoot, systemName),
		"fonts.json",
	);
}

export async function listDesignSystems(
	projectRoot: string,
): Promise<DesignSystemRecord[]> {
	const systemsDir = resolveDesignSystemsDir(projectRoot);
	let entries: Awaited<ReturnType<typeof readdir>>;

	try {
		entries = await readdir(systemsDir, { withFileTypes: true });
	} catch (error) {
		const fsError = error as NodeJS.ErrnoException;
		if (fsError.code === "ENOENT") {
			return [];
		}
		throw error;
	}

	const records: DesignSystemRecord[] = [];
	for (const entry of entries) {
		if (!entry.isDirectory()) {
			continue;
		}

		const storageKey = entry.name;
		const dir = path.join(systemsDir, storageKey);
		const manifestPath = path.join(dir, "system.json");
		let contents: string;
		try {
			contents = await readFile(manifestPath, "utf8");
		} catch (error) {
			const fsError = error as NodeJS.ErrnoException;
			if (fsError.code === "ENOENT") {
				continue;
			}
			throw error;
		}

		const { manifest, shouldWrite } = normalizeDesignSystemManifest(
			parseDesignSystemManifestContents(contents, manifestPath),
			projectRoot,
			{},
		);
		if (shouldWrite) {
			await writeJsonFileAtomically(manifestPath, manifest);
		}

		records.push({
			storageKey,
			dir,
			manifestPath,
			manifest,
			warnings: await collectManifestWarnings(projectRoot, manifest),
		});
	}

	assertUniqueRecordIdentities(records);
	return records.sort((left, right) =>
		left.manifest.systemName.localeCompare(right.manifest.systemName),
	);
}

export async function findDesignSystem(
	projectRoot: string,
	systemHandle: string,
): Promise<DesignSystemRecord | null> {
	const trimmedHandle = systemHandle.trim();
	if (!trimmedHandle) {
		return null;
	}

	const records = await listDesignSystems(projectRoot);
	return (
		records.find((record) => record.manifest.systemId === trimmedHandle) ??
		records.find((record) => record.manifest.systemName === trimmedHandle) ??
		records.find((record) => record.storageKey === trimmedHandle) ??
		null
	);
}

export async function resolveDesignSystemFilePath(
	projectRoot: string,
	systemHandle: string,
	fileName:
		| DesignSystemManifestFile,
): Promise<string> {
	const record = await findDesignSystem(projectRoot, systemHandle);
	if (record) {
		return path.join(record.dir, fileName);
	}

	return path.join(resolveDesignSystemDir(projectRoot, systemHandle), fileName);
}

export async function readDesignSystemManifest(
	projectRoot: string,
	systemHandle: string,
): Promise<DesignSystemManifestRead> {
	const record = await findDesignSystem(projectRoot, systemHandle);
	if (record) {
		return {
			manifest: record.manifest,
			warnings: record.warnings,
			record,
		};
	}

	const manifestPath = resolveDesignSystemManifestPath(
		projectRoot,
		systemHandle,
	);
	try {
		const contents = await readFile(manifestPath, "utf8");
		const { manifest, shouldWrite } = normalizeDesignSystemManifest(
			parseDesignSystemManifestContents(contents, manifestPath),
			projectRoot,
			{ fallbackSystemName: systemHandle },
		);
		if (shouldWrite) {
			await writeJsonFileAtomically(manifestPath, manifest);
		}
		const storageKey = path.basename(path.dirname(manifestPath));
		const newRecord = {
			storageKey,
			dir: path.dirname(manifestPath),
			manifestPath,
			manifest,
			warnings: await collectManifestWarnings(projectRoot, manifest),
		};

		return {
			manifest,
			warnings: newRecord.warnings,
			record: newRecord,
		};
	} catch (error) {
		const fsError = error as NodeJS.ErrnoException;
		if (fsError.code === "ENOENT") {
			return { manifest: null, warnings: [], record: null };
		}

		throw error;
	}
}

export async function writeDesignSystemManifest(
	projectRoot: string,
	systemHandle: string,
	manifest: Partial<DesignSystemManifest> = {},
): Promise<DesignSystemManifest> {
	const existing = await findDesignSystem(projectRoot, systemHandle);
	const nextSystemName =
		manifest.systemName ?? existing?.manifest.systemName ?? systemHandle;
	const nextManifest = normalizeDesignSystemManifest(
		{
			version: manifest.version ?? DESIGN_SYSTEM_MANIFEST_VERSION,
			systemId: manifest.systemId ?? existing?.manifest.systemId,
			systemName: nextSystemName,
			...(manifest.previousSystemNames !== undefined
				? { previousSystemNames: manifest.previousSystemNames }
				: existing?.manifest.previousSystemNames
					? { previousSystemNames: existing.manifest.previousSystemNames }
					: {}),
			...(manifest.cssPath !== undefined
				? { cssPath: manifest.cssPath }
				: existing?.manifest.cssPath
					? { cssPath: existing.manifest.cssPath }
					: {}),
			...(manifest.iconFolderPaths !== undefined
				? { iconFolderPaths: manifest.iconFolderPaths }
				: existing?.manifest.iconFolderPaths
					? { iconFolderPaths: existing.manifest.iconFolderPaths }
					: {}),
		},
		projectRoot,
		{ fallbackSystemName: nextSystemName },
	).manifest;
	const manifestPath =
		existing?.manifestPath ??
		resolveDesignSystemManifestPath(projectRoot, nextManifest.systemName);

	await assertManifestWriteIsUnique(projectRoot, nextManifest, existing);
	await mkdir(path.dirname(manifestPath), { recursive: true });
	await writeJsonFileAtomically(manifestPath, nextManifest);

	return nextManifest;
}

export async function ensureDesignSystemManifest(
	projectRoot: string,
	systemHandle: string,
	defaults: Partial<DesignSystemManifest> = {},
): Promise<DesignSystemManifest> {
	const { manifest } = await readDesignSystemManifest(
		projectRoot,
		systemHandle,
	);
	if (manifest) {
		return writeDesignSystemManifest(projectRoot, manifest.systemId, defaults);
	}

	return writeDesignSystemManifest(projectRoot, systemHandle, defaults);
}

export async function createDesignSystemStorage(
	projectRoot: string,
	params: {
		systemName: string;
		cssPath: string;
		systemId?: string;
		iconFolderPaths?: string[];
	},
): Promise<DesignSystemManifest> {
	const manifest = normalizeDesignSystemManifest(
		{
			version: DESIGN_SYSTEM_MANIFEST_VERSION,
			systemId: params.systemId,
			systemName: params.systemName,
			cssPath: params.cssPath,
			...(params.iconFolderPaths
				? { iconFolderPaths: params.iconFolderPaths }
				: {}),
		},
		projectRoot,
		{ fallbackSystemName: params.systemName },
	).manifest;

	await assertManifestWriteIsUnique(projectRoot, manifest, null);
	const manifestPath = resolveDesignSystemManifestPath(
		projectRoot,
		manifest.systemName,
	);
	await mkdir(path.dirname(manifestPath), { recursive: true });
	await writeJsonFileAtomically(manifestPath, manifest);
	return manifest;
}

export async function migrateConfiguredSystemsToManifests(
	projectRoot: string,
	systems: Record<string, string> | undefined,
): Promise<void> {
	assertUniqueDesignSystemSafeKeys(Object.keys(systems ?? {}));

	for (const [rawSystemName, rawCssPath] of Object.entries(systems ?? {})) {
		const systemName = rawSystemName.trim();
		const cssPath = rawCssPath.trim();
		if (!systemName || !cssPath) {
			continue;
		}

		const existing = await findDesignSystem(projectRoot, systemName);
		await writeDesignSystemManifest(
			projectRoot,
			existing?.manifest.systemId ?? systemName,
			{
				systemName,
				cssPath,
			},
		);
	}
}

export async function deleteDesignSystemStorage(
	projectRoot: string,
	systemHandle: string,
): Promise<void> {
	const record = await findDesignSystem(projectRoot, systemHandle);
	await rm(record?.dir ?? resolveDesignSystemDir(projectRoot, systemHandle), {
		force: true,
		recursive: true,
	});
}

export async function renameDesignSystemStorage(
	projectRoot: string,
	oldSystemHandle: string,
	newSystemName: string,
): Promise<DesignSystemManifest> {
	const existing = await findDesignSystem(projectRoot, oldSystemHandle);
	if (!existing) {
		throw new DesignSystemStorageError(
			"SYSTEM_NOT_FOUND",
			`Design system "${oldSystemHandle}" was not found.`,
		);
	}

	return writeDesignSystemManifest(projectRoot, existing.manifest.systemId, {
		systemName: newSystemName,
	});
}

export async function addIconFolderPath(
	projectRoot: string,
	systemHandle: string,
	folderPath: string,
): Promise<DesignSystemManifest> {
	const manifest = await ensureDesignSystemManifest(projectRoot, systemHandle);
	const normalizedFolderPath = normalizeProjectRelativeManifestPath(
		projectRoot,
		folderPath,
	);
	const iconFolderPaths = manifest.iconFolderPaths ?? [];
	if (iconFolderPaths.includes(normalizedFolderPath)) {
		return writeDesignSystemManifest(projectRoot, manifest.systemId, manifest);
	}

	return writeDesignSystemManifest(projectRoot, manifest.systemId, {
		...manifest,
		iconFolderPaths: [...iconFolderPaths, normalizedFolderPath],
	});
}

export async function removeIconFolderPath(
	projectRoot: string,
	systemHandle: string,
	folderPath: string,
): Promise<DesignSystemManifest> {
	const manifest = await ensureDesignSystemManifest(projectRoot, systemHandle);
	const normalizedFolderPath = normalizeProjectRelativeManifestPath(
		projectRoot,
		folderPath,
	);
	const iconFolderPaths = (manifest.iconFolderPaths ?? []).filter(
		(entry) => entry !== normalizedFolderPath,
	);

	return writeDesignSystemManifest(projectRoot, manifest.systemId, {
		...manifest,
		iconFolderPaths,
	});
}

function normalizeDesignSystemManifest(
	value: unknown,
	projectRoot: string,
	options: {
		fallbackSystemId?: string;
		fallbackSystemName?: string;
		fallbackCssPath?: string;
	} = {},
): { manifest: DesignSystemManifest; shouldWrite: boolean } {
	if (!isRecord(value)) {
		throw new DesignSystemStorageError(
			"INVALID_MANIFEST",
			"Design system manifest must be a JSON object",
		);
	}

	if (value.version !== DESIGN_SYSTEM_MANIFEST_VERSION) {
		throw new DesignSystemStorageError(
			"INVALID_MANIFEST",
			`Unsupported design system manifest version: ${String(value.version)}`,
		);
	}

	const rawSystemId =
		typeof value.systemId === "string"
			? value.systemId.trim()
			: options.fallbackSystemId;
	const systemId =
		rawSystemId && rawSystemId.length > 0 ? rawSystemId : generateSystemId();
	if (!isDesignSystemId(systemId)) {
		throw new DesignSystemStorageError(
			"INVALID_MANIFEST",
			"Invalid manifest: missing or malformed systemId",
		);
	}

	const rawSystemName =
		typeof value.systemName === "string"
			? value.systemName.trim()
			: options.fallbackSystemName?.trim();
	if (!rawSystemName) {
		throw new DesignSystemStorageError(
			"INVALID_MANIFEST",
			"Invalid manifest: missing or malformed systemName",
		);
	}

	const manifest: DesignSystemManifest = {
		version: DESIGN_SYSTEM_MANIFEST_VERSION,
		systemId,
		systemName: rawSystemName,
	};

	if (value.previousSystemNames !== undefined) {
		if (
			!Array.isArray(value.previousSystemNames) ||
			!value.previousSystemNames.every((entry) => typeof entry === "string")
		) {
			throw new DesignSystemStorageError(
				"INVALID_MANIFEST",
				"Design system manifest previousSystemNames must be an array of strings",
			);
		}

		const previousSystemNames = [
			...new Set(
				value.previousSystemNames
					.map((entry) => entry.trim())
					.filter((entry) => entry.length > 0 && entry !== manifest.systemName),
			),
		];
		if (previousSystemNames.length > 0) {
			manifest.previousSystemNames = previousSystemNames;
		}
	}

	const rawCssPath =
		value.cssPath === undefined ? options.fallbackCssPath : value.cssPath;
	if (rawCssPath !== undefined) {
		const cssPath = normalizeProjectRelativeManifestPath(
			projectRoot,
			rawCssPath,
		);
		manifest.cssPath = cssPath;
	}

	if (value.iconFolderPaths !== undefined) {
		if (!Array.isArray(value.iconFolderPaths)) {
			throw new DesignSystemStorageError(
				"INVALID_MANIFEST",
				"Design system manifest iconFolderPaths must be an array of strings",
			);
		}

		manifest.iconFolderPaths = value.iconFolderPaths.map((entry) =>
			normalizeProjectRelativeManifestPath(projectRoot, entry),
		);
	}

	return {
		manifest,
		shouldWrite:
			value.systemId !== manifest.systemId ||
			value.systemName !== manifest.systemName ||
			JSON.stringify(value.previousSystemNames ?? []) !==
				JSON.stringify(manifest.previousSystemNames ?? []) ||
			value.cssPath !== manifest.cssPath,
	};
}

function normalizeProjectRelativeManifestPath(
	projectRoot: string,
	value: unknown,
): string {
	if (typeof value !== "string") {
		throw new DesignSystemStorageError(
			"INVALID_MANIFEST",
			"Design system manifest paths must be strings",
		);
	}

	const trimmed = value.trim();
	if (trimmed.length === 0) {
		throw new DesignSystemStorageError(
			"INVALID_MANIFEST",
			"Design system manifest paths must be non-empty strings",
		);
	}

	if (path.isAbsolute(trimmed)) {
		throw new DesignSystemStorageError(
			"INVALID_MANIFEST",
			"Design system manifest paths must be project-relative",
		);
	}

	const normalized = path.normalize(trimmed).replace(/\\/g, "/");
	const resolvedProjectRoot = path.resolve(projectRoot);
	const resolvedPath = path.resolve(resolvedProjectRoot, normalized);
	if (
		resolvedPath !== resolvedProjectRoot &&
		!resolvedPath.startsWith(`${resolvedProjectRoot}${path.sep}`)
	) {
		throw new DesignSystemStorageError(
			"INVALID_MANIFEST",
			"Design system manifest paths must stay inside the project root",
		);
	}

	if (resolvedPath === resolvedProjectRoot) {
		throw new DesignSystemStorageError(
			"INVALID_MANIFEST",
			"Design system manifest paths must point inside the project root",
		);
	}

	return normalized.replace(/^(\.\/)+/u, "");
}

async function collectManifestWarnings(
	projectRoot: string,
	manifest: DesignSystemManifest,
): Promise<DesignSystemManifestWarning[]> {
	const warnings: DesignSystemManifestWarning[] = [];

	for (const iconFolderPath of manifest.iconFolderPaths ?? []) {
		try {
			const iconFolderStat = await stat(path.join(projectRoot, iconFolderPath));
			if (!iconFolderStat.isDirectory()) {
				warnings.push({
					code: "MISSING_ICON_FOLDER",
					message: `Icon folder path is not a directory: ${iconFolderPath}`,
					path: iconFolderPath,
				});
			}
		} catch (error) {
			const fsError = error as NodeJS.ErrnoException;
			if (fsError.code === "ENOENT") {
				warnings.push({
					code: "MISSING_ICON_FOLDER",
					message: `Icon folder path does not exist: ${iconFolderPath}`,
					path: iconFolderPath,
				});
				continue;
			}

			throw error;
		}
	}

	return warnings;
}

async function assertManifestWriteIsUnique(
	projectRoot: string,
	nextManifest: DesignSystemManifest,
	existing: DesignSystemRecord | null,
) {
	const records = await listDesignSystems(projectRoot);
	const nextStorageKey = resolveDesignSystemSafeKey(nextManifest.systemName);
	const nextManifestPath = path.resolve(
		resolveDesignSystemManifestPath(projectRoot, nextManifest.systemName),
	);
	const isExistingRecord = (record: DesignSystemRecord) =>
		record.manifest.systemId === existing?.manifest.systemId;
	const duplicateId = records.find(
		(record) =>
			record.manifest.systemId === nextManifest.systemId &&
			!isExistingRecord(record),
	);
	if (duplicateId) {
		throw new DesignSystemStorageError(
			"DUPLICATE_SYSTEM_ID",
			`Design system id "${nextManifest.systemId}" already exists.`,
		);
	}

	const duplicateName = records.find(
		(record) =>
			record.manifest.systemName === nextManifest.systemName &&
			!isExistingRecord(record),
	);
	if (duplicateName) {
		throw new DesignSystemStorageError(
			"DUPLICATE_SYSTEM_NAME",
			`Design system "${nextManifest.systemName}" already exists.`,
		);
	}

	const duplicateStorageKey = records.find(
		(record) =>
			!isExistingRecord(record) &&
			(record.storageKey === nextStorageKey ||
				resolveDesignSystemSafeKey(record.manifest.systemName) ===
					nextStorageKey ||
				path.resolve(record.manifestPath) === nextManifestPath),
	);
	if (duplicateStorageKey) {
		throw new DesignSystemStorageError(
			"DUPLICATE_SYSTEM_KEY",
			`Design system "${nextManifest.systemName}" resolves to storage key "${nextStorageKey}", which conflicts with "${duplicateStorageKey.manifest.systemName}".`,
		);
	}
}

function assertUniqueRecordIdentities(records: DesignSystemRecord[]) {
	const ids = new Map<string, string>();
	const names = new Map<string, string>();
	const safeKeys = new Map<string, DesignSystemRecord>();

	const registerSafeKey = (safeKey: string, record: DesignSystemRecord) => {
		const previous = safeKeys.get(safeKey);
		if (previous && previous !== record) {
			throw new DesignSystemStorageError(
				"DUPLICATE_SYSTEM_KEY",
				`Design system storage key "${safeKey}" is used by both "${previous.storageKey}" and "${record.storageKey}".`,
			);
		}
		safeKeys.set(safeKey, record);
	};

	for (const record of records) {
		const { systemId, systemName } = record.manifest;
		const previousIdKey = ids.get(systemId);
		if (previousIdKey) {
			throw new DesignSystemStorageError(
				"DUPLICATE_SYSTEM_ID",
				`Design system id "${systemId}" is used by both "${previousIdKey}" and "${record.storageKey}".`,
			);
		}
		ids.set(systemId, record.storageKey);

		const previousNameKey = names.get(systemName);
		if (previousNameKey) {
			throw new DesignSystemStorageError(
				"DUPLICATE_SYSTEM_NAME",
				`Design system name "${systemName}" is used by both "${previousNameKey}" and "${record.storageKey}".`,
			);
		}
		names.set(systemName, record.storageKey);

		registerSafeKey(record.storageKey, record);
		registerSafeKey(resolveDesignSystemSafeKey(systemName), record);
	}
}

function parseDesignSystemManifestContents(
	contents: string,
	manifestPath: string,
): unknown {
	try {
		return JSON.parse(contents) as unknown;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new DesignSystemStorageError(
			"INVALID_MANIFEST",
			`Invalid design system manifest JSON at ${manifestPath}: ${message}`,
		);
	}
}

async function writeJsonFileAtomically(filePath: string, value: unknown) {
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
