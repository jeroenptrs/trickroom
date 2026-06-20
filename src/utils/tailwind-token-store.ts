import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { defaultTailwindTokensByDomain } from "./default-tailwind-tokens";
import {
	ensureDesignSystemManifest,
	resolveDesignSystemDir,
	resolveDesignSystemFilePath,
} from "./design-system-store.ts";
import type {
	TailwindColorTokenBaselineDiff,
	TailwindDefaultTokenEntry,
	TailwindOverriddenTokenEntry,
	TailwindTokenEntry,
} from "./tailwind-color-tokens";
import {
	normalizeTailwindTokenValue,
	TAILWIND_TOKEN_DOMAINS,
	type TailwindMeaningfulTokenBaselineDiff,
	type TailwindTokenBaselineDiff,
	type TailwindTokenDomain,
} from "./tailwind-token-domains";

export type TailwindMeaningfulColorBaselineDiff = {
	added: TailwindTokenEntry[];
	overridden: TailwindOverriddenTokenEntry[];
	removed: TailwindDefaultTokenEntry[];
};

export interface TailwindDomainStorage {
	tokens: Record<string, string>;
	overrides: string[];
	baselineDiff: TailwindMeaningfulTokenBaselineDiff;
}

export interface TailwindTokenStorageV2 {
	version: 2;
	metadata: {
		cssPath: string;
		syncedAt: string;
		tailwindBaselineVersion: string;
		reviewRequired: boolean;
	};
	domains: {
		[domain in TailwindTokenDomain]: TailwindDomainStorage;
	};
}

export type StoreDomainTokensParams = {
	projectRoot: string;
	systemName: string;
	cssPath: string;
	tailwindBaselineVersion: string;
	tokens: Record<string, string>;
	domains?: Partial<Record<TailwindTokenDomain, Record<string, string>>>;
	overrides?: string[];
	domainOverrides?: Partial<Record<TailwindTokenDomain, string[]>>;
	baselineDiff:
		| TailwindMeaningfulColorBaselineDiff
		| TailwindColorTokenBaselineDiff;
	domainBaselineDiffs?: Partial<
		Record<
			TailwindTokenDomain,
			TailwindMeaningfulTokenBaselineDiff | TailwindTokenBaselineDiff
		>
	>;
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
		[domain in TailwindTokenDomain]: {
			tokens: Record<string, string>;
			baselineDiff: TailwindMeaningfulTokenBaselineDiff;
		};
	};
};

export { systemNameToSafeKey } from "./design-system-store.ts";

/**
 * Resolve path to stored token snapshot.
 * @returns Full path to `.trickroom/systems/<safe-key>/tokens.json`
 */
export function resolveTokenSnapshotPath(
	projectRoot: string,
	systemName: string,
): string {
	return path.join(
		resolveDesignSystemDir(projectRoot, systemName),
		"tokens.json",
	);
}

async function resolveTokenSnapshotPathForHandle(
	projectRoot: string,
	systemHandle: string,
): Promise<string> {
	return resolveDesignSystemFilePath(projectRoot, systemHandle, "tokens.json");
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

	await ensureDesignSystemManifest(params.projectRoot, params.systemName);
	const snapshotPath = await resolveTokenSnapshotPathForHandle(
		params.projectRoot,
		params.systemName,
	);
	const snapshotDir = path.dirname(snapshotPath);
	await mkdir(snapshotDir, { recursive: true });

	const data: TailwindTokenStorageV2 = {
		version: 2,
		metadata: {
			cssPath: normalizeCssPath(params.cssPath, params.projectRoot),
			syncedAt: params.syncedAt ?? new Date().toISOString(),
			tailwindBaselineVersion: params.tailwindBaselineVersion,
			reviewRequired: params.reviewRequired,
		},
		domains: normalizeDomainStorages({
			tokensByDomain: {
				color: params.tokens,
				...(params.domains ?? {}),
			},
			overridesByDomain: {
				color: params.overrides ?? [],
				...(params.domainOverrides ?? {}),
			},
			baselineDiffsByDomain: {
				color: params.baselineDiff,
				...(params.domainBaselineDiffs ?? {}),
			},
		}),
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
	return readDomainTokensInternal(projectRoot, systemName, {
		canonicalize: true,
	});
}

export async function readDomainTokensReadonly(
	projectRoot: string,
	systemName: string,
): Promise<TailwindTokenStorageV2 | null> {
	return readDomainTokensInternal(projectRoot, systemName, {
		canonicalize: false,
	});
}

async function readDomainTokensInternal(
	projectRoot: string,
	systemName: string,
	options: { canonicalize: boolean },
): Promise<TailwindTokenStorageV2 | null> {
	const snapshotPath = await resolveTokenSnapshotPathForHandle(
		projectRoot,
		systemName,
	);

	try {
		const contents = await readFile(snapshotPath, "utf8");
		const data = JSON.parse(contents) as unknown;

		if (!isTailwindTokenStorageV2(data)) {
			return null;
		}

		const canonicalStorage = normalizeTailwindTokenStorage(data, projectRoot);
		if (
			options.canonicalize &&
			JSON.stringify(canonicalStorage) !== JSON.stringify(data)
		) {
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
	const normalized = normalizeTailwindTokenStorage(storage, projectRoot);
	return {
		version: 2,
		metadata: {
			cssPath: normalized.metadata.cssPath,
			tailwindBaselineVersion: normalized.metadata.tailwindBaselineVersion,
		},
		domains: Object.fromEntries(
			TAILWIND_TOKEN_DOMAINS.map((domain) => [
				domain,
				{
					tokens: normalized.domains[domain].tokens,
					baselineDiff: normalized.domains[domain].baselineDiff,
				},
			]),
		) as ComparableTailwindTokenStorage["domains"],
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
			cssPath: normalizeCssPath(storage.metadata.cssPath, projectRoot),
			syncedAt: storage.metadata.syncedAt,
			tailwindBaselineVersion: storage.metadata.tailwindBaselineVersion,
			reviewRequired: storage.metadata.reviewRequired,
		},
		domains: normalizeDomainStorages({
			tokensByDomain: Object.fromEntries(
				TAILWIND_TOKEN_DOMAINS.map((domain) => [
					domain,
					storage.domains[domain]?.tokens ?? {},
				]),
			) as Partial<Record<TailwindTokenDomain, Record<string, string>>>,
			overridesByDomain: Object.fromEntries(
				TAILWIND_TOKEN_DOMAINS.map((domain) => [
					domain,
					storage.domains[domain]?.overrides ?? [],
				]),
			) as Partial<Record<TailwindTokenDomain, string[]>>,
			baselineDiffsByDomain: Object.fromEntries(
				TAILWIND_TOKEN_DOMAINS.map((domain) => [
					domain,
					storage.domains[domain]?.baselineDiff ?? emptyMeaningfulDiff(),
				]),
			) as Partial<
				Record<TailwindTokenDomain, TailwindMeaningfulTokenBaselineDiff>
			>,
		}),
	};
}

function normalizeDomainStorages({
	tokensByDomain,
	overridesByDomain,
	baselineDiffsByDomain,
}: {
	tokensByDomain: Partial<Record<TailwindTokenDomain, Record<string, string>>>;
	overridesByDomain: Partial<Record<TailwindTokenDomain, string[]>>;
	baselineDiffsByDomain: Partial<
		Record<
			TailwindTokenDomain,
			TailwindMeaningfulTokenBaselineDiff | TailwindTokenBaselineDiff
		>
	>;
}): TailwindTokenStorageV2["domains"] {
	return Object.fromEntries(
		TAILWIND_TOKEN_DOMAINS.map((domain) => [
			domain,
			{
				tokens: normalizeMeaningfulDomainTokens(
					domain,
					tokensByDomain[domain] ?? {},
				),
				overrides: normalizeStringArray(overridesByDomain[domain] ?? []),
				baselineDiff: normalizeMeaningfulBaselineDiff(
					baselineDiffsByDomain[domain] ?? emptyMeaningfulDiff(),
					domain,
				),
			},
		]),
	) as TailwindTokenStorageV2["domains"];
}

function normalizeMeaningfulDomainTokens(
	domain: TailwindTokenDomain,
	tokens: Record<string, string>,
): Record<string, string> {
	const defaults = defaultTailwindTokensByDomain[domain] ?? {};
	return normalizeStringRecord(
		Object.fromEntries(
			Object.entries(tokens).filter(([name, value]) => {
				const defaultValue = defaults[name as keyof typeof defaults];
				if (defaultValue === undefined) {
					return true;
				}

				return (
					normalizeTailwindTokenValue(value) !==
					normalizeTailwindTokenValue(defaultValue)
				);
			}),
		),
	);
}

function normalizeMeaningfulBaselineDiff(
	baselineDiff: TailwindMeaningfulTokenBaselineDiff | TailwindTokenBaselineDiff,
	domain: TailwindTokenDomain,
): TailwindMeaningfulTokenBaselineDiff {
	return {
		added: baselineDiff.added
			.map((token) => ({
				name: token.name,
				value: token.value,
				domain,
			}))
			.sort(compareTokenEntriesByName),
		overridden: baselineDiff.overridden
			.map((token) => ({
				name: token.name,
				value: token.value,
				defaultValue: token.defaultValue,
				domain,
			}))
			.sort(compareTokenEntriesByName),
		removed: baselineDiff.removed
			.map((token) => ({
				name: token.name,
				defaultValue: token.defaultValue,
				domain,
			}))
			.sort(compareTokenEntriesByName),
	};
}

function emptyMeaningfulDiff(): TailwindMeaningfulTokenBaselineDiff {
	return {
		added: [],
		overridden: [],
		removed: [],
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
	const tempPath = `${filePath}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`;

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

	return (
		typeof metadata.cssPath === "string" &&
		typeof metadata.syncedAt === "string" &&
		typeof metadata.tailwindBaselineVersion === "string" &&
		typeof metadata.reviewRequired === "boolean" &&
		TAILWIND_TOKEN_DOMAINS.every((domain) => {
			const storage = data.domains[domain];
			if (storage === undefined) {
				return domain !== "color";
			}
			return (
				isRecord(storage) &&
				isStringRecord(storage.tokens) &&
				Array.isArray(storage.overrides) &&
				storage.overrides.every((override) => typeof override === "string") &&
				isMeaningfulBaselineDiff(storage.baselineDiff)
			);
		})
	);
}

function isMeaningfulBaselineDiff(
	value: unknown,
): value is TailwindMeaningfulTokenBaselineDiff {
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
		typeof value.domain === "string" &&
		(TAILWIND_TOKEN_DOMAINS as string[]).includes(value.domain)
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
		typeof value.domain === "string" &&
		(TAILWIND_TOKEN_DOMAINS as string[]).includes(value.domain)
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
