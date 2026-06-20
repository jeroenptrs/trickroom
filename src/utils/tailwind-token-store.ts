import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { defaultTailwindColorTokens } from "./default-tailwind-tokens";
import type {
	TailwindColorTokenBaselineDiff,
	TailwindDefaultTokenEntry,
	TailwindOverriddenTokenEntry,
	TailwindTokenEntry,
} from "./tailwind-color-tokens";
import { normalizeTailwindColorTokenValue } from "./tailwind-color-tokens";

export type TailwindMeaningfulColorBaselineDiff = {
	added: TailwindTokenEntry[];
	overridden: TailwindOverriddenTokenEntry[];
	removed: TailwindDefaultTokenEntry[];
};

export interface TailwindDomainStorage {
	tokens: Record<string, string>;
	overrides: string[];
	baselineDiff: TailwindMeaningfulColorBaselineDiff;
}

export interface TailwindTokenStorageV2 {
	version: 2;
	metadata: {
		systemName: string;
		cssPath: string;
		syncedAt: string;
		tailwindBaselineVersion: string;
		reviewRequired: boolean;
	};
	domains: {
		color: TailwindDomainStorage;
	};
}

export type StoreDomainTokensParams = {
	projectRoot: string;
	systemName: string;
	cssPath: string;
	tailwindBaselineVersion: string;
	tokens: Record<string, string>;
	overrides?: string[];
	baselineDiff:
		| TailwindMeaningfulColorBaselineDiff
		| TailwindColorTokenBaselineDiff;
	reviewRequired: boolean;
	syncedAt?: string;
};

export type ComparableTailwindTokenStorage = {
	version: 2;
	metadata: {
		cssPath: string;
		tailwindBaselineVersion: string;
	};
	domains: {
		color: {
			tokens: Record<string, string>;
			baselineDiff: TailwindMeaningfulColorBaselineDiff;
		};
	};
};

/**
 * Convert system name to filesystem-safe key.
 * @example "my-system" -> "my-system", "My System" -> "my-system"
 */
export function systemNameToSafeKey(systemName: string): string {
	return systemName
		.toLowerCase()
		.replace(/\s+/g, "-")
		.replace(/[^a-z0-9\-_.]/g, "")
		.replace(/^-+|-+$/g, "");
}

/**
 * Resolve path to stored token snapshot.
 * @returns Full path to `.trickroom/tailwind/<safe-key>/tokens.json`
 */
export function resolveTokenSnapshotPath(
	projectRoot: string,
	systemName: string,
): string {
	const safeKey = systemNameToSafeKey(systemName);
	return path.join(
		projectRoot,
		".trickroom",
		"tailwind",
		safeKey,
		"tokens.json",
	);
}

/**
 * Normalize CSS path for storage and comparison.
 */
export function normalizeCssPath(cssPath: string, projectRoot: string): string {
	const relativePath = path.isAbsolute(cssPath)
		? path.relative(projectRoot, cssPath)
		: cssPath;
	const normalized = path.normalize(relativePath).replace(/\\/g, "/");

	if (normalized === ".") {
		return "";
	}

	return normalized.replace(/^(\.\/)+/u, "");
}

export const trimCssPath = normalizeCssPath;

export async function storeDomainTokens(
	params: StoreDomainTokensParams,
): Promise<void>;
export async function storeDomainTokens(
	projectRoot: string,
	systemName: string,
	tokens: Record<string, string>,
	overrides: string[],
	tailwindBaselineVersion: string,
	cssPath: string,
	baselineDiff?:
		| TailwindMeaningfulColorBaselineDiff
		| TailwindColorTokenBaselineDiff,
	reviewRequired?: boolean,
): Promise<void>;
/**
 * Store domain-scoped token storage atomically.
 */
export async function storeDomainTokens(
	paramsOrProjectRoot: StoreDomainTokensParams | string,
	systemName?: string,
	tokens?: Record<string, string>,
	overrides: string[] = [],
	tailwindBaselineVersion?: string,
	cssPath?: string,
	baselineDiff:
		| TailwindMeaningfulColorBaselineDiff
		| TailwindColorTokenBaselineDiff = {
		added: [],
		overridden: [],
		removed: [],
	},
	reviewRequired = false,
): Promise<void> {
	const params =
		typeof paramsOrProjectRoot === "string"
			? {
					projectRoot: paramsOrProjectRoot,
					systemName: requireString(systemName, "systemName"),
					tokens: tokens ?? {},
					overrides,
					tailwindBaselineVersion: requireString(
						tailwindBaselineVersion,
						"tailwindBaselineVersion",
					),
					cssPath: requireString(cssPath, "cssPath"),
					baselineDiff,
					reviewRequired,
				}
			: paramsOrProjectRoot;

	const snapshotPath = resolveTokenSnapshotPath(
		params.projectRoot,
		params.systemName,
	);
	const snapshotDir = path.dirname(snapshotPath);

	await mkdir(snapshotDir, { recursive: true });

	const data: TailwindTokenStorageV2 = {
		version: 2,
		metadata: {
			systemName: params.systemName,
			cssPath: normalizeCssPath(params.cssPath, params.projectRoot),
			syncedAt: params.syncedAt ?? new Date().toISOString(),
			tailwindBaselineVersion: params.tailwindBaselineVersion,
			reviewRequired: params.reviewRequired,
		},
		domains: {
			color: {
				tokens: normalizeMeaningfulColorTokens(params.tokens),
				overrides: normalizeStringArray(params.overrides ?? []),
				baselineDiff: normalizeMeaningfulColorBaselineDiff(params.baselineDiff),
			},
		},
	};

	await writeJsonAtomically(snapshotPath, data);
}

/**
 * Read domain-scoped token storage.
 * @returns Storage if found and valid, null otherwise.
 */
export async function readDomainTokens(
	projectRoot: string,
	systemName: string,
): Promise<TailwindTokenStorageV2 | null> {
	const snapshotPath = resolveTokenSnapshotPath(projectRoot, systemName);

	try {
		const contents = await readFile(snapshotPath, "utf8");
		const data = JSON.parse(contents) as unknown;

		if (!isTailwindTokenStorageV2(data)) {
			return null;
		}

		const canonicalStorage = normalizeTailwindTokenStorage(data, projectRoot);
		if (JSON.stringify(canonicalStorage) !== JSON.stringify(data)) {
			await writeJsonAtomically(snapshotPath, canonicalStorage);
		}

		return canonicalStorage;
	} catch (error) {
		const err = error as NodeJS.ErrnoException;
		if (err.code === "ENOENT") {
			return null;
		}
		throw error;
	}
}

export function normalizeTokenStorageForComparison(
	storage: TailwindTokenStorageV2,
	projectRoot = "",
): ComparableTailwindTokenStorage {
	return {
		version: 2,
		metadata: {
			cssPath: normalizeCssPath(storage.metadata.cssPath, projectRoot),
			tailwindBaselineVersion: storage.metadata.tailwindBaselineVersion,
		},
		domains: {
			color: {
				tokens: normalizeMeaningfulColorTokens(storage.domains.color.tokens),
				baselineDiff: normalizeMeaningfulColorBaselineDiff(
					storage.domains.color.baselineDiff,
				),
			},
		},
	};
}

export function areTokenStoragesEquivalent(
	left: TailwindTokenStorageV2,
	right: TailwindTokenStorageV2,
	projectRoot = "",
): boolean {
	return (
		JSON.stringify(normalizeTokenStorageForComparison(left, projectRoot)) ===
		JSON.stringify(normalizeTokenStorageForComparison(right, projectRoot))
	);
}

function normalizeTailwindTokenStorage(
	storage: TailwindTokenStorageV2,
	projectRoot: string,
): TailwindTokenStorageV2 {
	return {
		version: 2,
		metadata: {
			systemName: storage.metadata.systemName,
			cssPath: normalizeCssPath(storage.metadata.cssPath, projectRoot),
			syncedAt: storage.metadata.syncedAt,
			tailwindBaselineVersion: storage.metadata.tailwindBaselineVersion,
			reviewRequired: storage.metadata.reviewRequired,
		},
		domains: {
			color: {
				tokens: normalizeMeaningfulColorTokens(storage.domains.color.tokens),
				overrides: normalizeStringArray(storage.domains.color.overrides),
				baselineDiff: normalizeMeaningfulColorBaselineDiff(
					storage.domains.color.baselineDiff,
				),
			},
		},
	};
}

function normalizeMeaningfulColorTokens(
	tokens: Record<string, string>,
): Record<string, string> {
	return normalizeStringRecord(
		Object.fromEntries(
			Object.entries(tokens).filter(([name, value]) => {
				const defaultValue =
					defaultTailwindColorTokens[
						name as keyof typeof defaultTailwindColorTokens
					];
				if (defaultValue === undefined) {
					return true;
				}

				return (
					normalizeTailwindColorTokenValue(value) !==
					normalizeTailwindColorTokenValue(defaultValue)
				);
			}),
		),
	);
}

function normalizeMeaningfulColorBaselineDiff(
	baselineDiff:
		| TailwindMeaningfulColorBaselineDiff
		| TailwindColorTokenBaselineDiff,
): TailwindMeaningfulColorBaselineDiff {
	return {
		added: baselineDiff.added
			.map((token) => ({
				name: token.name,
				value: token.value,
				domain: token.domain,
			}))
			.sort(compareTokenEntriesByName),
		overridden: baselineDiff.overridden
			.map((token) => ({
				name: token.name,
				value: token.value,
				defaultValue: token.defaultValue,
				domain: token.domain,
			}))
			.sort(compareTokenEntriesByName),
		removed: baselineDiff.removed
			.map((token) => ({
				name: token.name,
				defaultValue: token.defaultValue,
				domain: token.domain,
			}))
			.sort(compareTokenEntriesByName),
	};
}

function normalizeStringRecord(
	values: Record<string, string>,
): Record<string, string> {
	return Object.fromEntries(
		Object.entries(values).sort(([leftKey], [rightKey]) =>
			leftKey.localeCompare(rightKey),
		),
	);
}

function normalizeStringArray(values: string[]): string[] {
	return [...values].sort((left, right) => left.localeCompare(right));
}

function compareTokenEntriesByName(
	left: { name: string },
	right: { name: string },
): number {
	return left.name.localeCompare(right.name);
}

async function writeJsonAtomically(
	filePath: string,
	data: TailwindTokenStorageV2,
): Promise<void> {
	const contents = `${JSON.stringify(data, null, "\t")}\n`;
	const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;

	try {
		await writeFile(tempPath, contents, "utf8");
		await rename(tempPath, filePath);
	} catch (error) {
		await unlink(tempPath).catch(() => undefined);
		throw error;
	}
}

function isTailwindTokenStorageV2(
	data: unknown,
): data is TailwindTokenStorageV2 {
	if (!isRecord(data) || data.version !== 2) {
		return false;
	}

	if (!isRecord(data.metadata) || !isRecord(data.domains)) {
		return false;
	}

	if (!isRecord(data.domains.color)) {
		return false;
	}

	const { metadata } = data;
	const color = data.domains.color;

	return (
		typeof metadata.systemName === "string" &&
		typeof metadata.cssPath === "string" &&
		typeof metadata.syncedAt === "string" &&
		typeof metadata.tailwindBaselineVersion === "string" &&
		typeof metadata.reviewRequired === "boolean" &&
		isStringRecord(color.tokens) &&
		Array.isArray(color.overrides) &&
		color.overrides.every((override) => typeof override === "string") &&
		isMeaningfulColorBaselineDiff(color.baselineDiff)
	);
}

function isMeaningfulColorBaselineDiff(
	value: unknown,
): value is TailwindMeaningfulColorBaselineDiff {
	if (!isRecord(value)) {
		return false;
	}

	return (
		Array.isArray(value.added) &&
		value.added.every(isTailwindTokenEntry) &&
		Array.isArray(value.overridden) &&
		value.overridden.every(isTailwindOverriddenTokenEntry) &&
		Array.isArray(value.removed) &&
		value.removed.every(isTailwindDefaultTokenEntry)
	);
}

function isTailwindTokenEntry(value: unknown): value is TailwindTokenEntry {
	return (
		isRecord(value) &&
		typeof value.name === "string" &&
		typeof value.value === "string" &&
		value.domain === "color"
	);
}

function isTailwindOverriddenTokenEntry(
	value: unknown,
): value is TailwindOverriddenTokenEntry {
	return isTailwindTokenEntry(value) && typeof value.defaultValue === "string";
}

function isTailwindDefaultTokenEntry(
	value: unknown,
): value is TailwindDefaultTokenEntry {
	return (
		isRecord(value) &&
		typeof value.name === "string" &&
		typeof value.defaultValue === "string" &&
		value.domain === "color"
	);
}

function isStringRecord(value: unknown): value is Record<string, string> {
	return (
		isRecord(value) &&
		Object.values(value).every((recordValue) => typeof recordValue === "string")
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(value: string | undefined, name: string): string {
	if (typeof value !== "string") {
		throw new TypeError(`${name} is required`);
	}

	return value;
}
