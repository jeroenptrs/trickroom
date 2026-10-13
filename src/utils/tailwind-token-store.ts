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
	/**
	 * The utility's `@utility` blocks as authored, normalized
	 * (`extractCustomUtilityDefinitions`). Compared to tell whether the
	 * project changed the utility. Absent in snapshots synced before it was
	 * recorded.
	 */
	definition?: string;
}

/** What the project's stylesheets author in one domain, as written. */
export interface TailwindAuthoredDomainDefinition {
	/** Theme values from the project's stylesheets, equal to a default or not. */
	tokens: Record<string, string>;
	/** Authored `initial` resets, e.g. `--color-*` or `--color-red-500`. */
	resets: string[];
	/**
	 * The `@theme` options of tokens that have any (`inline`, `reference`,
	 * `default`, `static`). Absent when none have, and in snapshots synced
	 * before options were recorded.
	 */
	options?: Record<string, string[]>;
}

/**
 * The theme the project's stylesheets author, independent of Tailwind's
 * defaults: a Tailwind upgrade (new defaults, other default values,
 * defaults removed) does not change it. `domains` lists only the domains the
 * stylesheets define something in; `other` holds the theme variables outside
 * the fixed domains (`--app-color`), keyed by their full name. `other` is
 * absent in snapshots synced before it was recorded.
 */
export interface TailwindAuthoredTokens {
	domains: Partial<
		Record<TailwindTokenDomain, TailwindAuthoredDomainDefinition>
	>;
	other?: TailwindAuthoredDomainDefinition;
}

/**
 * The project's own stylesheets, in the order Tailwind inlines them: each
 * file's project-relative path and a hash of its text with comments and
 * whitespace outside strings normalized away (`normalizeCssSource`). Any
 * other edit to any of them changes it.
 */
export interface TailwindStylesheetFingerprint {
	files: Array<{ path: string; hash: string }>;
}

/**
 * The current snapshot shape. Additive over v2: the fixed `domains`
 * whitelist is unchanged, and two dynamic sections carry everything that
 * whitelist cannot. `authored` and `confirmed` are optional so that an older
 * Trickroom still reads the file (and drops them when it rewrites it).
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
	/**
	 * The theme the CSS authors. Absent in snapshots synced before it was
	 * recorded; the next sync writes it.
	 */
	authored?: TailwindAuthoredTokens;
	/**
	 * The fingerprint of the project's stylesheets at this sync. Absent in
	 * snapshots synced before it was recorded.
	 */
	stylesheets?: TailwindStylesheetFingerprint;
	/**
	 * The project definition at the last confirmed review, so a review shows
	 * the changes since then. `null` when nothing has been confirmed yet.
	 * Absent (an older writer, or an older Trickroom dropped it): a snapshot
	 * that needs no review is its own confirmed state, one that does has none.
	 */
	confirmed?: TailwindConfirmedTokenState | null;
}

/**
 * The tokens one domain resolves to against Tailwind's defaults: the values
 * that differ from a default or have none, and the default names removed.
 */
export interface TailwindProjectDomainDefinition {
	tokens: Record<string, string>;
	removed: string[];
}

/**
 * What the project defines, without Tailwind's reference values (baseline
 * version, `defaultValue` entries, the baseline tokens the theme leaves
 * alone). Overrides are not part of it: only confirming a review changes them.
 *
 * `authored` is what reviews compare: the theme as written and its resets.
 * `domains`, the tokens as resolved against the defaults of the time (only
 * domains that define something), is the fallback while one side has no
 * `authored` yet.
 */
export interface TailwindProjectTokenDefinition {
	domains: Partial<
		Record<TailwindTokenDomain, TailwindProjectDomainDefinition>
	>;
	authored?: TailwindAuthoredTokens;
	/**
	 * The project's stylesheets. On a confirmed state, what gates a review:
	 * while the stylesheets are unchanged since the confirmation, nothing
	 * needs review. Absent before it was recorded.
	 */
	stylesheets?: TailwindStylesheetFingerprint;
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

/** The canonical persisted snapshot shape (always the latest version). */
export type TailwindTokenStorage = TailwindTokenStorageV3;

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
	authored?: TailwindAuthoredTokens;
	stylesheets?: TailwindStylesheetFingerprint;
	/**
	 * The confirmed project definition. Omitted: a snapshot that needs no
	 * review is its own confirmed state, one that does has none.
	 */
	confirmed?: TailwindConfirmedTokenState | null;
};

export type ComparableTailwindTokenStorage = {
	version: 3;
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
	authored?: TailwindAuthoredTokens;
	stylesheets?: TailwindStylesheetFingerprint;
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
		version: 3,
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
		authored: params.authored
			? normalizeAuthoredTokens(params.authored)
			: undefined,
		stylesheets: params.stylesheets
			? normalizeStylesheetFingerprint(params.stylesheets)
			: undefined,
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
		version: 3,
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
		authored: normalized.authored,
		stylesheets: normalized.stylesheets,
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
		| "domains"
		| "customProperties"
		| "customUtilities"
		| "authored"
		| "stylesheets"
	>,
): TailwindProjectTokenDefinition {
	return normalizeProjectTokenDefinition({
		authored: storage.authored,
		stylesheets: storage.stylesheets,
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
 * A snapshot that needs no review is its own confirmed state: every change a
 * sync makes sets `reviewRequired`, so the stored definition is the one the
 * user last confirmed. One that needs review has none to go by.
 */
function defaultConfirmedState(
	storage: Pick<
		TailwindTokenStorage,
		| "metadata"
		| "domains"
		| "customProperties"
		| "customUtilities"
		| "authored"
		| "stylesheets"
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
	authored?: TailwindAuthoredTokens;
	stylesheets?: TailwindStylesheetFingerprint;
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
		...(definition.authored
			? { authored: normalizeAuthoredTokens(definition.authored) }
			: {}),
		...(definition.stylesheets
			? { stylesheets: normalizeStylesheetFingerprint(definition.stylesheets) }
			: {}),
		customProperties: normalizeCustomProperties(definition.customProperties),
		customUtilities: normalizeCustomUtilities(definition.customUtilities),
	};
}

/** Sorted, with the domains that define nothing left out. */
export function normalizeAuthoredTokens(
	authored: TailwindAuthoredTokens,
): TailwindAuthoredTokens {
	const domains: TailwindAuthoredTokens["domains"] = {};
	for (const domain of TAILWIND_TOKEN_DOMAINS) {
		const storage = authored.domains[domain];
		const normalized = storage ? normalizeAuthoredDomain(storage) : null;
		if (
			normalized &&
			(Object.keys(normalized.tokens).length > 0 ||
				normalized.resets.length > 0)
		) {
			domains[domain] = normalized;
		}
	}
	return {
		domains,
		...(authored.other
			? { other: normalizeAuthoredDomain(authored.other) }
			: {}),
	};
}

function normalizeAuthoredDomain(
	storage: TailwindAuthoredDomainDefinition,
): TailwindAuthoredDomainDefinition {
	const options = Object.fromEntries(
		Object.entries(storage.options ?? {})
			.filter(([name, values]) => values.length > 0 && name in storage.tokens)
			.map(([name, values]) => [name, [...new Set(values)].sort()] as const)
			.sort(([left], [right]) => left.localeCompare(right)),
	);
	return {
		tokens: normalizeStringRecord(storage.tokens),
		resets: [...new Set(storage.resets)].sort((left, right) =>
			left.localeCompare(right),
		),
		...(Object.keys(options).length > 0 ? { options } : {}),
	};
}

function normalizeStylesheetFingerprint(
	fingerprint: TailwindStylesheetFingerprint,
): TailwindStylesheetFingerprint {
	return {
		files: fingerprint.files.map((file) => ({
			path: file.path,
			hash: file.hash,
		})),
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
	const confirmed =
		storage.confirmed === undefined
			? defaultConfirmedState(storage)
			: storage.confirmed;
	return {
		version: 3,
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
		authored: storage.authored
			? normalizeAuthoredTokens(storage.authored)
			: undefined,
		stylesheets: storage.stylesheets
			? normalizeStylesheetFingerprint(storage.stylesheets)
			: undefined,
		confirmed: confirmed ? normalizeConfirmedState(confirmed) : null,
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
			...(typeof utility.definition === "string"
				? { definition: utility.definition }
				: {}),
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
		(value.authored === undefined || isAuthoredTokens(value.authored)) &&
		(value.stylesheets === undefined ||
			isStylesheetFingerprint(value.stylesheets)) &&
		isStringRecord(value.customProperties) &&
		Array.isArray(value.customUtilities) &&
		value.customUtilities.every(isCustomUtilityStorage)
	);
}

function isAuthoredTokens(value: unknown): value is TailwindAuthoredTokens {
	return (
		isRecord(value) &&
		isRecord(value.domains) &&
		Object.entries(value.domains).every(
			([domain, storage]) =>
				(TAILWIND_TOKEN_DOMAINS as string[]).includes(domain) &&
				isAuthoredDomain(storage),
		) &&
		(value.other === undefined || isAuthoredDomain(value.other))
	);
}

function isAuthoredDomain(
	value: unknown,
): value is TailwindAuthoredDomainDefinition {
	return (
		isRecord(value) &&
		isStringRecord(value.tokens) &&
		isStringArray(value.resets) &&
		(value.options === undefined ||
			(isRecord(value.options) &&
				Object.values(value.options).every(isStringArray)))
	);
}

function isStylesheetFingerprint(
	value: unknown,
): value is TailwindStylesheetFingerprint {
	return (
		isRecord(value) &&
		Array.isArray(value.files) &&
		value.files.every(
			(file) =>
				isRecord(file) &&
				typeof file.path === "string" &&
				typeof file.hash === "string",
		)
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
		(value.domains === undefined || isStringArray(value.domains)) &&
		(value.definition === undefined || typeof value.definition === "string")
	);
}

function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((v) => typeof v === "string");
}

/**
 * Read a snapshot of any supported version and upgrade it to the latest shape.
 * v2 → v3 adds empty `customProperties`/`customUtilities` sections. The
 * optional `authored` and `confirmed` sections are dropped when malformed;
 * a missing `confirmed` is derived on normalization (`defaultConfirmedState`):
 * the snapshot's own definition when it needs no review, `null` (a first
 * review) when it does. Returns null for shapes we do not recognise (treated
 * as "no stored tokens").
 */
export function migrateTokenStorageToLatest(
	data: unknown,
): TailwindTokenStorage | null {
	if (isTailwindTokenStorageV3(data)) {
		const { authored, stylesheets, confirmed, ...rest } = data;
		return {
			...rest,
			...(authored !== undefined && isAuthoredTokens(authored)
				? { authored }
				: {}),
			...(stylesheets !== undefined && isStylesheetFingerprint(stylesheets)
				? { stylesheets }
				: {}),
			...(confirmed === null ||
			(confirmed !== undefined && isConfirmedTokenState(confirmed))
				? { confirmed }
				: {}),
		};
	}
	if (isTailwindTokenStorageV2(data)) {
		return { ...data, version: 3, customProperties: {}, customUtilities: [] };
	}
	return null;
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
