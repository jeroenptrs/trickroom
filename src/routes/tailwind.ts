import { Hono } from "hono";
import {
	asErrnoException,
	isRecord,
	isTrickroomConfig,
	jsonError,
	readJsonFile,
} from "../server-utils";
import {
	defaultTailwindTokensByDomain,
	defaultTailwindTokensVersion,
} from "../utils/default-tailwind-tokens";
import {
	DesignSystemStorageError,
	findDesignSystem,
} from "../utils/design-system-store.ts";
import type {
	TailwindColorTokenBaselineDiff,
	TailwindTokensForPresentation,
} from "../utils/tailwind-color-tokens";
import {
	loadTailwindDesignSystem,
	resolveConfiguredTailwindSystemTarget,
	type TailwindDesignSystem,
	TailwindSystemResolutionError,
} from "../utils/tailwind-design-system";
import {
	diffTailwindTokensAgainstDefaults,
	extractTailwindTokensForPresentation as extractAllTailwindTokensForPresentation,
	extractTailwindTokens,
	isValidTokenDomain,
	TAILWIND_TOKEN_DOMAIN_NAMESPACES,
	TAILWIND_TOKEN_DOMAINS,
	type TailwindMeaningfulTokenBaselineDiff,
	type TailwindTokenDomain,
	type TailwindTokenDomainDiffs,
	type TailwindTokenDomains,
} from "../utils/tailwind-token-domains";
import {
	areTokenStoragesEquivalent,
	normalizeCssPath,
	readDomainTokens,
	storeDomainTokens,
	type TailwindTokenStorageV2,
} from "../utils/tailwind-token-store";

export const tailwindRoutes = new Hono();

const readTailwindSyncTarget = (
	body: unknown,
):
	| { systemId: string }
	| { systemName: string }
	| { cssPath: string }
	| null => {
	if (!isRecord(body)) {
		return null;
	}

	const hasSystemId = typeof body.systemId === "string";
	const hasSystemName = typeof body.systemName === "string";
	const hasCssPath = typeof body.cssPath === "string";
	if ([hasSystemId, hasSystemName, hasCssPath].filter(Boolean).length !== 1) {
		return null;
	}

	if (hasSystemId) {
		const systemId = body.systemId.trim();
		if (systemId.length === 0) {
			return null;
		}

		return { systemId };
	}

	if (hasSystemName) {
		const systemName = body.systemName.trim();
		if (systemName.length === 0) {
			return null;
		}

		return { systemName };
	}

	const cssPath = body.cssPath.trim();
	if (cssPath.length === 0) {
		return null;
	}

	return { cssPath };
};

type TailwindSyncPreview = {
	tokens: TailwindTokensForPresentation;
	baselineDiff: TailwindColorTokenBaselineDiff;
	baselineDiffs: TailwindTokenDomainDiffs;
	tokensByDomain: TailwindTokenDomains;
};

type TailwindSyncResponse = {
	status: "ok" | "updated";
	systemId: string;
	systemName: string;
	cssPath: string;
	tailwindBaselineVersion: string;
	tokens: TailwindTokensForPresentation;
	baselineDiff: TailwindColorTokenBaselineDiff;
	baselineDiffs: TailwindTokenDomainDiffs;
	syncedAt: string;
	reviewRequired: boolean;
};

const syncTailwindTokensForCssPath = async (
	projectRoot: string,
	targetCssPath: string,
) => {
	const loaded = await loadTailwindDesignSystem({
		projectRoot,
		cssPath: targetCssPath,
	});
	return syncTailwindTokensForLoadedDesignSystem(loaded.designSystem);
};

const syncTailwindTokensForLoadedDesignSystem = (
	designSystem: TailwindDesignSystem,
) => {
	const tokensByDomain = extractTailwindTokens(designSystem);
	const baselineDiffs = diffTailwindTokensAgainstDefaults(
		tokensByDomain,
		defaultTailwindTokensByDomainForRoute,
	);
	const baselineDiff = baselineDiffs.color;

	return {
		tokens: extractAllTailwindTokensForPresentation(baselineDiffs),
		baselineDiff,
		baselineDiffs,
		tokensByDomain,
	} satisfies TailwindSyncPreview;
};

const defaultTailwindTokensByDomainForRoute =
	defaultTailwindTokensByDomain as TailwindTokenDomains;

const buildSyncedColorTokens = (
	baselineDiff: TailwindColorTokenBaselineDiff,
): Record<string, string> => {
	const syncedTokens: Record<string, string> = {};

	for (const token of baselineDiff.added) {
		syncedTokens[token.name] = token.value;
	}

	for (const token of baselineDiff.overridden) {
		syncedTokens[token.name] = token.value;
	}

	return syncedTokens;
};

const buildSyncedDomainTokens = (
	baselineDiffs: TailwindTokenDomainDiffs,
): TailwindTokenDomains =>
	Object.fromEntries(
		TAILWIND_TOKEN_DOMAINS.map((domain) => [
			domain,
			buildSyncedColorTokens(baselineDiffs[domain]),
		]),
	) as TailwindTokenDomains;

const buildCanonicalSnapshot = ({
	projectRoot,
	cssPath,
	tokens,
	domains,
	overrides,
	domainOverrides,
	baselineDiff,
	baselineDiffs,
	syncedAt,
	reviewRequired,
}: {
	projectRoot: string;
	cssPath: string;
	tokens: Record<string, string>;
	domains: TailwindTokenDomains;
	overrides: string[];
	domainOverrides: Partial<Record<TailwindTokenDomain, string[]>>;
	baselineDiff: TailwindColorTokenBaselineDiff;
	baselineDiffs: TailwindTokenDomainDiffs;
	syncedAt: string;
	reviewRequired: boolean;
}): TailwindTokenStorageV2 => ({
	version: 2,
	metadata: {
		cssPath: normalizeCssPath(cssPath, projectRoot),
		syncedAt,
		tailwindBaselineVersion: defaultTailwindTokensVersion,
		reviewRequired,
	},
	domains: Object.fromEntries(
		TAILWIND_TOKEN_DOMAINS.map((domain) => [
			domain,
			{
				tokens: domain === "color" ? tokens : domains[domain],
				overrides:
					domain === "color" ? overrides : (domainOverrides[domain] ?? []),
				baselineDiff: {
					added: (domain === "color" ? baselineDiff : baselineDiffs[domain])
						.added,
					overridden: (domain === "color"
						? baselineDiff
						: baselineDiffs[domain]
					).overridden,
					removed: (domain === "color" ? baselineDiff : baselineDiffs[domain])
						.removed,
				},
			},
		]),
	) as TailwindTokenStorageV2["domains"],
});

const buildTailwindSyncResponse = ({
	status,
	preview,
	storage,
	system,
}: {
	status: "ok" | "updated";
	preview: TailwindSyncPreview;
	storage: TailwindTokenStorageV2;
	system: { systemId: string; systemName: string; cssPath: string };
}): TailwindSyncResponse => ({
	status,
	systemId: system.systemId,
	systemName: system.systemName,
	cssPath: system.cssPath,
	tailwindBaselineVersion: storage.metadata.tailwindBaselineVersion,
	tokens: preview.tokens,
	baselineDiff: preview.baselineDiff,
	baselineDiffs: preview.baselineDiffs,
	syncedAt: storage.metadata.syncedAt,
	reviewRequired: storage.metadata.reviewRequired,
});

// We expect these to be provided by the main app context or passed in.
// For now, we'll re-derive them or assume they are in the request context if we used middleware.
// But the simplest is to have a way to inject them.
// Hono allows setting variables in context.

tailwindRoutes.post("/sync-tokens", async (c) => {
	const projectRoot = c.get("projectRoot") as string;
	const configPath = c.get("configPath") as string;

	const body = await c.req.json().catch(() => null);
	const target = readTailwindSyncTarget(body);
	if (!target) {
		return jsonError(
			"Invalid sync target payload: provide exactly one of systemId, systemName, or cssPath",
			400,
		);
	}

	let config: unknown;
	try {
		config = await readJsonFile<unknown>(configPath);
	} catch (error) {
		const fsError = asErrnoException(error);
		if (fsError.code === "ENOENT") {
			return jsonError(`Config file not found at ${configPath}`, 404);
		}

		return jsonError("Failed to read trickroom config file", 500);
	}

	if (!isTrickroomConfig(config)) {
		return jsonError("Invalid trickroom config file", 400);
	}

	try {
		const resolvedTarget = await resolveConfiguredTailwindSystemTarget(
			projectRoot,
			config,
			target,
		);
		const preview = await syncTailwindTokensForCssPath(
			projectRoot,
			resolvedTarget.cssPath,
		);
		const stored = await readDomainTokens(projectRoot, resolvedTarget.systemId);
		const syncedTokens = buildSyncedColorTokens(preview.baselineDiff);
		const syncedDomainTokens = buildSyncedDomainTokens(preview.baselineDiffs);
		const overrides = stored?.domains.color.overrides ?? [];
		const domainOverrides = Object.fromEntries(
			TAILWIND_TOKEN_DOMAINS.map((domain) => [
				domain,
				stored?.domains[domain]?.overrides ?? [],
			]),
		) as Partial<Record<TailwindTokenDomain, string[]>>;
		const nextCanonicalSnapshot = buildCanonicalSnapshot({
			projectRoot,
			cssPath: resolvedTarget.cssPath,
			tokens: syncedTokens,
			domains: syncedDomainTokens,
			overrides,
			domainOverrides,
			baselineDiff: preview.baselineDiff,
			baselineDiffs: preview.baselineDiffs,
			syncedAt: stored?.metadata.syncedAt ?? new Date().toISOString(),
			reviewRequired: stored ? stored.metadata.reviewRequired : true,
		});

		if (
			stored &&
			areTokenStoragesEquivalent(stored, nextCanonicalSnapshot, projectRoot)
		) {
			return c.json(
				buildTailwindSyncResponse({
					status: "ok",
					preview,
					storage: stored,
					system: resolvedTarget,
				}),
			);
		}

		await storeDomainTokens({
			projectRoot,
			systemName: resolvedTarget.systemId,
			cssPath: resolvedTarget.cssPath,
			tailwindBaselineVersion: defaultTailwindTokensVersion,
			tokens: syncedTokens,
			domains: syncedDomainTokens,
			overrides,
			domainOverrides,
			baselineDiff: preview.baselineDiff,
			domainBaselineDiffs: preview.baselineDiffs,
			reviewRequired: true,
		});
		const updated = await readDomainTokens(
			projectRoot,
			resolvedTarget.systemId,
		);
		if (!updated) {
			return jsonError("Failed to persist synced Tailwind tokens", 500);
		}

		return c.json(
			buildTailwindSyncResponse({
				status: "updated",
				preview,
				storage: updated,
				system: resolvedTarget,
			}),
		);
	} catch (error) {
		if (error instanceof TailwindSystemResolutionError) {
			if (error.code === "NO_SYSTEMS_CONFIGURED") {
				return jsonError("No design system is configured", 400);
			}
			if (
				error.code === "UNKNOWN_SYSTEM" ||
				error.code === "UNKNOWN_CSS_PATH"
			) {
				return jsonError(error.message, 404);
			}
			if (error.code === "AMBIGUOUS_CSS_PATH") {
				return jsonError(error.message, 409);
			}
			if (error.code === "DUPLICATE_SYSTEM_KEY") {
				return jsonError(error.message, 409);
			}
			if (error.code === "INVALID_CSS_PATH") {
				return jsonError(error.message, 400);
			}
			if (error.code === "INVALID_SYSTEM_NAME") {
				return jsonError(error.message, 400);
			}
		}
		if (
			error instanceof DesignSystemStorageError &&
			error.code === "DUPLICATE_SYSTEM_KEY"
		) {
			return jsonError(error.message, 409);
		}

		console.error(error);
		return jsonError("Failed to sync Tailwind tokens", 500);
	}
});

const validateDomainOverride = (
	domain: TailwindTokenDomain,
	pattern: string,
): boolean => {
	const namespace = TAILWIND_TOKEN_DOMAIN_NAMESPACES[domain];
	const normalizedPattern = pattern.toLowerCase();
	const normalizedNamespace = namespace.toLowerCase();
	if (normalizedPattern === normalizedNamespace) {
		return true;
	}
	if (normalizedPattern === `${normalizedNamespace}-*`) {
		return true;
	}
	if (!normalizedPattern.startsWith(`${normalizedNamespace}-`)) {
		return false;
	}
	// Longest namespace wins: --font must not claim --font-weight-* patterns
	// (nor --text claim --text-shadow-*), which belong to the more specific
	// domain and would otherwise be stored under the wrong domain.
	for (const otherNamespace of Object.values(TAILWIND_TOKEN_DOMAIN_NAMESPACES)) {
		const otherNormalized = otherNamespace.toLowerCase();
		if (
			otherNormalized.length > normalizedNamespace.length &&
			(normalizedPattern === otherNormalized ||
				normalizedPattern === `${otherNormalized}-*` ||
				normalizedPattern.startsWith(`${otherNormalized}-`))
		) {
			return false;
		}
	}
	const suffix = pattern.slice(namespace.length + 1);
	return suffix.length > 0 && /^[a-z0-9\-_.*/]+$/i.test(suffix);
};

const readDomainOverridesPayload = (
	body: unknown,
): Partial<Record<TailwindTokenDomain, string[]>> | null => {
	if (!isRecord(body) || !isRecord(body.domains)) {
		return null;
	}

	const overridesByDomain: Partial<Record<TailwindTokenDomain, string[]>> = {};
	for (const [domainName, domainPayload] of Object.entries(body.domains)) {
		if (!isValidTokenDomain(domainName)) {
			return null;
		}
		if (!isRecord(domainPayload) || !Array.isArray(domainPayload.overrides)) {
			return null;
		}
		const overrides: string[] = [];
		for (const override of domainPayload.overrides) {
			if (typeof override !== "string") {
				return null;
			}
			if (!validateDomainOverride(domainName, override)) {
				return null;
			}
			overrides.push(override);
		}
		overridesByDomain[domainName] = overrides;
	}

	return overridesByDomain;
};

const isInvalidSystemStorageError = (error: unknown) =>
	error instanceof DesignSystemStorageError &&
	(error.code === "EMPTY_SYSTEM_KEY" || error.code === "INVALID_SYSTEM_KEY");

/**
 * GET /systems/:systemName/tokens - Retrieve stored tokens and overrides
 */
tailwindRoutes.get("/systems/:systemName/tokens", async (c) => {
	const projectRoot = c.get("projectRoot") as string;
	const systemName = c.req.param("systemName");

	if (typeof systemName !== "string" || systemName.trim().length === 0) {
		return jsonError("Invalid system name", 400);
	}

	try {
		const system = await findDesignSystem(projectRoot, systemName);
		const systemHandle = system?.manifest.systemId ?? systemName;
		const stored = await readDomainTokens(projectRoot, systemHandle);

		if (!stored) {
			return jsonError(`No tokens stored for system "${systemName}"`, 404);
		}

		return c.json({
			ok: true,
			systemId: system?.manifest.systemId ?? systemName,
			systemName: system?.manifest.systemName ?? systemName,
			cssPath: system?.manifest.cssPath ?? stored.metadata.cssPath,
			syncedAt: stored.metadata.syncedAt,
			tailwindBaselineVersion: stored.metadata.tailwindBaselineVersion,
			reviewRequired: stored.metadata.reviewRequired,
			domains: stored.domains,
		});
	} catch (error) {
		if (isInvalidSystemStorageError(error)) {
			return jsonError("Invalid system name", 400);
		}

		console.error(error);
		return jsonError("Failed to read stored tokens", 500);
	}
});

/**
 * POST /systems/:systemName/tokens - Save and confirm overrides
 */
tailwindRoutes.post("/systems/:systemName/tokens", async (c) => {
	const projectRoot = c.get("projectRoot") as string;
	const systemName = c.req.param("systemName");

	if (typeof systemName !== "string" || systemName.trim().length === 0) {
		return jsonError("Invalid system name", 400);
	}

	let body: unknown;
	try {
		body = await c.req.json();
	} catch {
		return jsonError("Invalid request body", 400);
	}

	const requestedOverrides = readDomainOverridesPayload(body);
	if (!requestedOverrides) {
		return jsonError(
			"Request body must contain domains.<domain>.overrides arrays with valid Tailwind theme variable patterns such as --color-*",
			400,
		);
	}

	try {
		const system = await findDesignSystem(projectRoot, systemName);
		const systemHandle = system?.manifest.systemId ?? systemName;
		const stored = await readDomainTokens(projectRoot, systemHandle);

		if (!stored) {
			return jsonError(`No tokens stored for system "${systemName}"`, 404);
		}

		const domainOverrides = Object.fromEntries(
			TAILWIND_TOKEN_DOMAINS.map((domain) => [
				domain,
				requestedOverrides[domain] ?? stored.domains[domain].overrides,
			]),
		) as Partial<Record<TailwindTokenDomain, string[]>>;

		// Update overrides only, preserve synced tokens
		await storeDomainTokens({
			projectRoot,
			systemName: systemHandle,
			tokens: stored.domains.color.tokens,
			domains: Object.fromEntries(
				TAILWIND_TOKEN_DOMAINS.map((domain) => [
					domain,
					stored.domains[domain].tokens,
				]),
			) as TailwindTokenDomains,
			overrides: domainOverrides.color ?? [],
			domainOverrides,
			tailwindBaselineVersion: stored.metadata.tailwindBaselineVersion,
			cssPath: stored.metadata.cssPath,
			baselineDiff: stored.domains.color.baselineDiff,
			domainBaselineDiffs: Object.fromEntries(
				TAILWIND_TOKEN_DOMAINS.map((domain) => [
					domain,
					stored.domains[domain].baselineDiff,
				]),
			) as Partial<
				Record<TailwindTokenDomain, TailwindMeaningfulTokenBaselineDiff>
			>,
			reviewRequired: false,
			syncedAt: stored.metadata.syncedAt,
		});

		// Read back to get normalized (sorted) overrides
		const updated = await readDomainTokens(projectRoot, systemHandle);

		if (!updated) {
			return jsonError("Failed to read updated tokens", 500);
		}

		return c.json({
			ok: true,
			systemId: system?.manifest.systemId ?? systemName,
			systemName: system?.manifest.systemName ?? systemName,
			cssPath: system?.manifest.cssPath ?? updated.metadata.cssPath,
			syncedAt: updated.metadata.syncedAt,
			tailwindBaselineVersion: updated.metadata.tailwindBaselineVersion,
			reviewRequired: updated.metadata.reviewRequired,
			domains: updated.domains,
		});
	} catch (error) {
		if (isInvalidSystemStorageError(error)) {
			return jsonError("Invalid system name", 400);
		}

		console.error(error);
		return jsonError("Failed to save and confirm overrides", 500);
	}
});
