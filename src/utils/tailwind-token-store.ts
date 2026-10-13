import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { writeJsonFileAtomically } from "../server-file-utils.ts";
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

/**
 * Legacy snapshot shape (pre-custom-namespace support). Still read for
 * migration; never written.
 */
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

/**
 * A custom `@utility` definition discovered in the system CSS source (one that
 * is not part of Tailwind's built-in domains), persisted so the editor can
 * recognise it as a known utility without re-loading the design system.
 */
export type TailwindCustomUtilityKind = "functional" | "static";

export interface TailwindCustomUtilityStorage {
	/** The `@utility` root, e.g. `text-interaction` for `text-interaction-*`. */
	root: string;
	/**
	 * `functional` = wildcard, value-taking (matched by prefix). `static` =
	 * value-less, matched exactly. Defaults to `functional` when absent (legacy).
	 */
	kind: TailwindCustomUtilityKind;
	/** CSS variable namespaces it consumes, e.g. `["--db-interaction"]`. */
	consumedNamespaces: string[];
	/** Completion values exposed by the design system, e.g. `["sm", "lg"]`. Empty for static. */
	completionValues: string[];
	/**
	 * UI domain(s) the utility folds into, inferred from the CSS it emits
	 * (e.g. `["color"]`, `["typography"]`, or several for semantic utilities).
	 * Optional for forward/backward compat; defaults to `[]` when absent.
	 */
	domains: string[];
}

/**
 * Legacy snapshot shape (before the confirmed state). Additive over v2: the
 * fixed `domains` whitelist is unchanged, and two dynamic sections carry
 * everything that whitelist cannot. Still read for migration; never written.
 */
export interface TailwindTokenStorageV3 {
	version: 3;
	metadata: {
		cssPath: string;
		syncedAt: string;
		tailwindBaselineVersion: string;
		reviewRequired: boolean;
	};
	domains: {
		[domain in TailwindTokenDomain]: TailwindDomainStorage;
	};
	/**
	 * Custom CSS variables outside the fixed domain whitelist, keyed by their
	 * full custom-property name (e.g. `--db-interaction-sm`). These are exactly
	 * the CSS variables that custom `@utility` definitions consume; they are
	 * just CSS custom properties, stored verbatim.
	 */
	customProperties: Record<string, string>;
	/** Custom `@utility` roots discovered in the system CSS source. */
	customUtilities: TailwindCustomUtilityStorage[];
}

/**
 * What the project itself defines in one domain, independent of Tailwind's
 * reference values: the tokens it adds or overrides (name to value) and the
 * default token names it removes.
 */
export interface TailwindProjectDomainDefinition {
	tokens: Record<string, string>;
	removed: string[];
}

/**
 * What the project defines, without Tailwind's reference values: no baseline
 * version, no `defaultValue` entries, no baseline tokens the theme leaves
 * alone. Overrides are not part of it: only confirming a review changes them.
 * `domains` lists only the domains the project defines something in.
 */
export interface TailwindProjectTokenDefinition {
	domains: Partial<
		Record<TailwindTokenDomain, TailwindProjectDomainDefinition>
	>;
	customProperties: Record<string, string>;
	customUtilities: TailwindCustomUtilityStorage[];
}

/** The project definition the user last confirmed in a token review. */
export interface TailwindConfirmedTokenState
	extends TailwindProjectTokenDefinition {
	confirmedAt: string;
	/** The Tailwind baseline the snapshot was synced against when confirmed. */
	tailwindBaselineVersion: string;
}

/**
 * Current snapshot shape. Adds `confirmed` over v3, the project definition at
 * the last confirmed review, so a review shows the changes since then. `null`
 * when nothing has been confirmed yet (a first review).
 */
export interface TailwindTokenStorageV4 {
	version: 4;
	metadata: {
		cssPath: string;
		syncedAt: string;
		tailwindBaselineVersion: string;
		reviewRequired: boolean;
	};
	domains: {
		[domain in TailwindTokenDomain]: TailwindDomainStorage;
	};
	customProperties: Record<string, string>;
	customUtilities: TailwindCustomUtilityStorage[];
	confirmed: TailwindConfirmedTokenState | null;
}

/** The canonical persisted snapshot shape (always the latest version). */
export type TailwindTokenStorage = TailwindTokenStorageV4;

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
	customProperties?: Record<string, string>;
	customUtilities?: TailwindCustomUtilityStorage[];
	/**
	 * The confirmed project definition. Omitted: a snapshot that needs no
	 * review is its own confirmed state, one that does has none.
	 */
	confirmed?: TailwindConfirmedTokenState | null;
};

export type ComparableTailwindTokenStorage = {
	version: 4;
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
	customProperties: Record<string, string>;
	customUtilities: TailwindCustomUtilityStorage[];
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
	options: { readOnly?: boolean } = {},
): Promise<string> {
	return resolveDesignSystemFilePath(
		projectRoot,
		systemHandle,
		"tokens.json",
		options,
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

	// Key order here MUST match `normalizeTailwindTokenStorage` exactly: reads
	// canonicalize-and-compare by `JSON.stringify`, so a different order would
	// trigger a needless rewrite on every read.
	const data: Omit<TailwindTokenStorage, "confirmed"> = {
		version: 4,
		metadata: {
			cssPath: normalizeCssPath(params.cssPath, params.projectRoot),
			syncedAt: params.syncedAt ?? new Date().toISOString(),
			tailwindBaselineVersion: params.tailwindBaselineVersion,
			reviewRequired: params.reviewRequired,
		},
		customProperties: normalizeCustomProperties(params.customProperties ?? {}),
		customUtilities: normalizeCustomUtilities(params.customUtilities ?? []),
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
	const confirmed =
		params.confirmed === undefined
			? defaultConfirmedState(data)
			: params.confirmed;

	await writeJsonFileAtomically(snapshotPath, {
		...data,
		confirmed: confirmed ? normalizeConfirmedState(confirmed) : null,
	} satisfies TailwindTokenStorage);
}

/**
 * Read domain-scoped token storage.
 * @returns Storage if found and valid, null otherwise.
 */
export async function readDomainTokens(
	projectRoot: string,
	systemName: string,
): Promise<TailwindTokenStorage | null> {
	return readDomainTokensInternal(projectRoot, systemName, {
		canonicalize: true,
	});
}

/**
 * Read without writing anything: neither the snapshot (not canonicalised)
 * nor the system manifest the handle resolves through (not normalised).
 */
export async function readDomainTokensReadonly(
	projectRoot: string,
	systemName: string,
): Promise<TailwindTokenStorage | null> {
	return readDomainTokensInternal(projectRoot, systemName, {
		canonicalize: false,
	});
}

async function readDomainTokensInternal(
	projectRoot: string,
	systemName: string,
	options: { canonicalize: boolean },
): Promise<TailwindTokenStorage | null> {
	const snapshotPath = await resolveTokenSnapshotPathForHandle(
		projectRoot,
		systemName,
		{ readOnly: !options.canonicalize },
	);

	try {
		const contents = await readFile(snapshotPath, "utf8");
		const data = JSON.parse(contents) as unknown;

		const migrated = migrateTokenStorageToLatest(data);
		if (!migrated) {
			return null;
		}

		const canonicalStorage = normalizeTailwindTokenStorage(
			migrated,
			projectRoot,
		);
		if (
			options.canonicalize &&
			JSON.stringify(canonicalStorage) !== JSON.stringify(data)
		) {
			await writeJsonFileAtomically(snapshotPath, canonicalStorage);
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
	storage: TailwindTokenStorage,
	projectRoot = "",
): ComparableTailwindTokenStorage {
	const normalized = normalizeTailwindTokenStorage(storage, projectRoot);
	return {
		version: 4,
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
		customProperties: normalized.customProperties,
		customUtilities: normalized.customUtilities,
	};
}

export function areTokenStoragesEquivalent(
	left: TailwindTokenStorage,
	right: TailwindTokenStorage,
	projectRoot = "",
): boolean {
	return (
		JSON.stringify(normalizeTokenStorageForComparison(left, projectRoot)) ===
		JSON.stringify(normalizeTokenStorageForComparison(right, projectRoot))
	);
}

/**
 * The project's own definition in a snapshot: its tokens, the defaults it
 * removes and its custom properties and utilities. Tailwind's reference
 * values are left out, so a Tailwind upgrade alone does not change it.
 */
export function getProjectTokenDefinition(
	storage: Pick<
		TailwindTokenStorage,
		"domains" | "customProperties" | "customUtilities"
	>,
): TailwindProjectTokenDefinition {
	return normalizeProjectTokenDefinition({
		domains: Object.fromEntries(
			TAILWIND_TOKEN_DOMAINS.map((domain) => [
				domain,
				{
					tokens: storage.domains[domain]?.tokens ?? {},
					removed: (storage.domains[domain]?.baselineDiff.removed ?? []).map(
						(token) => token.name,
					),
				},
			]),
		),
		customProperties: storage.customProperties,
		customUtilities: storage.customUtilities,
	});
}

/** The snapshot's project definition, as confirmed now. */
export function createConfirmedTokenState(
	storage: TailwindTokenStorage,
	confirmedAt: string,
): TailwindConfirmedTokenState {
	return {
		confirmedAt,
		tailwindBaselineVersion: storage.metadata.tailwindBaselineVersion,
		...getProjectTokenDefinition(storage),
	};
}

/**
 * Whether two project definitions are the same. Values compare normalized
 * (whitespace, hex case), like the baseline diff.
 */
export function areProjectTokenDefinitionsEquivalent(
	left: TailwindProjectTokenDefinition,
	right: TailwindProjectTokenDefinition,
): boolean {
	return (
		projectTokenDefinitionComparisonKey(left) ===
		projectTokenDefinitionComparisonKey(right)
	);
}

function projectTokenDefinitionComparisonKey(
	definition: TailwindProjectTokenDefinition,
): string {
	const normalized = normalizeProjectTokenDefinition(definition);
	const normalizeValues = (values: Record<string, string>) =>
		Object.fromEntries(
			Object.entries(values).map(([name, value]) => [
				name,
				normalizeTailwindTokenValue(value),
			]),
		);
	return JSON.stringify({
		domains: Object.fromEntries(
			Object.entries(normalized.domains).map(([domain, storage]) => [
				domain,
				{ tokens: normalizeValues(storage.tokens), removed: storage.removed },
			]),
		),
		customProperties: normalizeValues(normalized.customProperties),
		customUtilities: normalized.customUtilities,
	});
}

/**
 * A snapshot that needs no review is its own confirmed state: every change a
 * sync makes sets `reviewRequired`, so the stored definition is the one the
 * user last confirmed. One that needs review has none to go by.
 */
function defaultConfirmedState(
	storage: Pick<
		TailwindTokenStorage,
		"metadata" | "domains" | "customProperties" | "customUtilities"
	>,
): TailwindConfirmedTokenState | null {
	if (storage.metadata.reviewRequired) {
		return null;
	}

	return {
		confirmedAt: storage.metadata.syncedAt,
		tailwindBaselineVersion: storage.metadata.tailwindBaselineVersion,
		...getProjectTokenDefinition(storage),
	};
}

function normalizeProjectTokenDefinition(definition: {
	domains: Partial<Record<string, TailwindProjectDomainDefinition>>;
	customProperties: Record<string, string>;
	customUtilities: readonly TailwindCustomUtilityStorage[];
}): TailwindProjectTokenDefinition {
	const domains: TailwindProjectTokenDefinition["domains"] = {};
	for (const domain of TAILWIND_TOKEN_DOMAINS) {
		const storage = definition.domains[domain];
		if (!storage) {
			continue;
		}
		const tokens = normalizeStringRecord(storage.tokens);
		const removed = [...new Set(storage.removed)].sort((left, right) =>
			left.localeCompare(right),
		);
		if (Object.keys(tokens).length > 0 || removed.length > 0) {
			domains[domain] = { tokens, removed };
		}
	}

	return {
		domains,
		customProperties: normalizeCustomProperties(definition.customProperties),
		customUtilities: normalizeCustomUtilities(definition.customUtilities),
	};
}

function normalizeConfirmedState(
	confirmed: TailwindConfirmedTokenState,
): TailwindConfirmedTokenState {
	return {
		confirmedAt: confirmed.confirmedAt,
		tailwindBaselineVersion: confirmed.tailwindBaselineVersion,
		...normalizeProjectTokenDefinition(confirmed),
	};
}

function normalizeTailwindTokenStorage(
	storage: TailwindTokenStorage,
	projectRoot: string,
): TailwindTokenStorage {
	return {
		version: 4,
		metadata: {
			cssPath: normalizeCssPath(storage.metadata.cssPath, projectRoot),
			syncedAt: storage.metadata.syncedAt,
			tailwindBaselineVersion: storage.metadata.tailwindBaselineVersion,
			reviewRequired: storage.metadata.reviewRequired,
		},
		customProperties: normalizeCustomProperties(storage.customProperties),
		customUtilities: normalizeCustomUtilities(storage.customUtilities),
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
		confirmed: storage.confirmed
			? normalizeConfirmedState(storage.confirmed)
			: null,
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

function normalizeCustomProperties(
	properties: Record<string, string>,
): Record<string, string> {
	return Object.fromEntries(
		Object.entries(properties)
			.filter(([name]) => name.startsWith("--"))
			.map(([name, value]) => [name, value] as const)
			.sort(([leftName], [rightName]) => leftName.localeCompare(rightName)),
	);
}

function normalizeCustomUtilities(
	utilities: readonly TailwindCustomUtilityStorage[],
): TailwindCustomUtilityStorage[] {
	return [...utilities]
		.map((utility) => ({
			root: utility.root,
			kind: utility.kind === "static" ? "static" : "functional",
			consumedNamespaces: [...new Set(utility.consumedNamespaces)].sort(
				(left, right) => left.localeCompare(right),
			),
			completionValues: [...new Set(utility.completionValues)].sort(
				(left, right) => left.localeCompare(right),
			),
			domains: [...new Set(utility.domains ?? [])].sort((left, right) =>
				left.localeCompare(right),
			),
		}))
		.sort((left, right) => left.root.localeCompare(right.root));
}

function compareTokenEntriesByName(
	left: { name: string },
	right: { name: string },
): number {
	return left.name.localeCompare(right.name);
}

/**
 * Validate the metadata + fixed-domain portion that v2 and v3 share. The
 * version literal is checked by the per-version guards.
 */
function hasValidMetadataAndDomains(data: Record<string, unknown>): boolean {
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
			const storage = (data.domains as Record<string, unknown>)[domain];
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

function isTailwindTokenStorageV2(
	data: unknown,
): data is TailwindTokenStorageV2 {
	return (
		isRecord(data) && data.version === 2 && hasValidMetadataAndDomains(data)
	);
}

function isTailwindTokenStorageV3(
	data: unknown,
): data is TailwindTokenStorageV3 {
	return (
		isRecord(data) &&
		data.version === 3 &&
		hasValidMetadataAndDomains(data) &&
		isStringRecord(data.customProperties) &&
		Array.isArray(data.customUtilities) &&
		data.customUtilities.every(isCustomUtilityStorage)
	);
}

function isTailwindTokenStorageV4(
	data: unknown,
): data is TailwindTokenStorageV4 {
	return (
		isRecord(data) &&
		data.version === 4 &&
		hasValidMetadataAndDomains(data) &&
		isStringRecord(data.customProperties) &&
		Array.isArray(data.customUtilities) &&
		data.customUtilities.every(isCustomUtilityStorage) &&
		(data.confirmed === null || isConfirmedTokenState(data.confirmed))
	);
}

function isConfirmedTokenState(
	value: unknown,
): value is TailwindConfirmedTokenState {
	return (
		isRecord(value) &&
		typeof value.confirmedAt === "string" &&
		typeof value.tailwindBaselineVersion === "string" &&
		isRecord(value.domains) &&
		Object.entries(value.domains).every(
			([domain, storage]) =>
				(TAILWIND_TOKEN_DOMAINS as string[]).includes(domain) &&
				isRecord(storage) &&
				isStringRecord(storage.tokens) &&
				isStringArray(storage.removed),
		) &&
		isStringRecord(value.customProperties) &&
		Array.isArray(value.customUtilities) &&
		value.customUtilities.every(isCustomUtilityStorage)
	);
}

function isCustomUtilityStorage(
	value: unknown,
): value is TailwindCustomUtilityStorage {
	return (
		isRecord(value) &&
		typeof value.root === "string" &&
		// `kind` is backfilled by normalizeCustomUtilities, so accept it missing
		// (legacy) or one of the known values.
		(value.kind === undefined ||
			value.kind === "functional" ||
			value.kind === "static") &&
		isStringArray(value.consumedNamespaces) &&
		isStringArray(value.completionValues) &&
		// `domains` is backfilled by normalizeCustomUtilities, so accept it
		// missing (legacy) or a string array.
		(value.domains === undefined || isStringArray(value.domains))
	);
}

function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((v) => typeof v === "string");
}

/**
 * Read a snapshot of any supported version and upgrade it to the latest shape.
 * v2 → v3 adds empty `customProperties`/`customUtilities` sections. v3 → v4
 * adds `confirmed`: the snapshot's own project definition when it needs no
 * review (it was confirmed as it is), `null` when it does (a first review
 * then shows the full diff against Tailwind). Returns null for shapes we do
 * not recognise (treated as "no stored tokens").
 */
export function migrateTokenStorageToLatest(
	data: unknown,
): TailwindTokenStorage | null {
	if (isTailwindTokenStorageV4(data)) {
		return data;
	}
	const v3 = isTailwindTokenStorageV3(data)
		? data
		: isTailwindTokenStorageV2(data)
			? ({
					...data,
					version: 3,
					customProperties: {},
					customUtilities: [],
				} satisfies TailwindTokenStorageV3)
			: null;
	if (!v3) {
		return null;
	}
	return { ...v3, version: 4, confirmed: defaultConfirmedState(v3) };
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
