import { Hono } from "hono";
import {
	asErrnoException,
	isRecord,
	isTrickroomConfig,
	jsonError,
	readJsonFile,
} from "../server-utils";
import { defaultTailwindColorTokensVersion } from "../utils/default-tailwind-tokens";
import {
	diffTailwindColorTokensAgainstDefaults,
	extractTailwindColorTokens,
	extractTailwindColorTokensForPresentation,
	type TailwindColorTokenBaselineDiff,
	type TailwindTokensForPresentation,
} from "../utils/tailwind-color-tokens";
import {
	loadTailwindDesignSystem,
	resolveConfiguredTailwindSystemTarget,
	type TailwindDesignSystem,
	TailwindSystemResolutionError,
} from "../utils/tailwind-design-system";
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
): { systemName: string } | { cssPath: string } | null => {
	if (!isRecord(body)) {
		return null;
	}

	const hasSystemName = typeof body.systemName === "string";
	const hasCssPath = typeof body.cssPath === "string";
	if (hasSystemName === hasCssPath) {
		return null;
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
};

type TailwindSyncResponse = {
	status: "ok" | "updated";
	systemName: string;
	cssPath: string;
	tailwindBaselineVersion: string;
	tokens: TailwindTokensForPresentation;
	baselineDiff: TailwindColorTokenBaselineDiff;
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
	const allColorTokens = extractTailwindColorTokens(designSystem);
	const baselineDiff = diffTailwindColorTokensAgainstDefaults(allColorTokens);

	return {
		tokens: extractTailwindColorTokensForPresentation(baselineDiff),
		baselineDiff,
	} satisfies TailwindSyncPreview;
};

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

const buildCanonicalSnapshot = ({
	projectRoot,
	systemName,
	cssPath,
	tokens,
	overrides,
	baselineDiff,
	syncedAt,
	reviewRequired,
}: {
	projectRoot: string;
	systemName: string;
	cssPath: string;
	tokens: Record<string, string>;
	overrides: string[];
	baselineDiff: TailwindColorTokenBaselineDiff;
	syncedAt: string;
	reviewRequired: boolean;
}): TailwindTokenStorageV2 => ({
	version: 2,
	metadata: {
		systemName,
		cssPath: normalizeCssPath(cssPath, projectRoot),
		syncedAt,
		tailwindBaselineVersion: defaultTailwindColorTokensVersion,
		reviewRequired,
	},
	domains: {
		color: {
			tokens,
			overrides,
			baselineDiff: {
				added: baselineDiff.added,
				overridden: baselineDiff.overridden,
				removed: baselineDiff.removed,
			},
		},
	},
});

const buildTailwindSyncResponse = ({
	status,
	preview,
	storage,
}: {
	status: "ok" | "updated";
	preview: TailwindSyncPreview;
	storage: TailwindTokenStorageV2;
}): TailwindSyncResponse => ({
	status,
	systemName: storage.metadata.systemName,
	cssPath: storage.metadata.cssPath,
	tailwindBaselineVersion: storage.metadata.tailwindBaselineVersion,
	tokens: preview.tokens,
	baselineDiff: preview.baselineDiff,
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
			"Invalid sync target payload: provide exactly one of systemName or cssPath",
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
		const resolvedTarget = resolveConfiguredTailwindSystemTarget(
			projectRoot,
			config,
			target,
		);
		const preview = await syncTailwindTokensForCssPath(
			projectRoot,
			resolvedTarget.cssPath,
		);
		const stored = await readDomainTokens(
			projectRoot,
			resolvedTarget.systemName,
		);
		const syncedTokens = buildSyncedColorTokens(preview.baselineDiff);
		const overrides = stored?.domains.color.overrides ?? [];
		const nextCanonicalSnapshot = buildCanonicalSnapshot({
			projectRoot,
			systemName: resolvedTarget.systemName,
			cssPath: resolvedTarget.cssPath,
			tokens: syncedTokens,
			overrides,
			baselineDiff: preview.baselineDiff,
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
				}),
			);
		}

		await storeDomainTokens({
			projectRoot,
			systemName: resolvedTarget.systemName,
			cssPath: resolvedTarget.cssPath,
			tailwindBaselineVersion: defaultTailwindColorTokensVersion,
			tokens: syncedTokens,
			overrides,
			baselineDiff: preview.baselineDiff,
			reviewRequired: true,
		});
		const updated = await readDomainTokens(
			projectRoot,
			resolvedTarget.systemName,
		);
		if (!updated) {
			return jsonError("Failed to persist synced Tailwind tokens", 500);
		}

		return c.json(
			buildTailwindSyncResponse({
				status: "updated",
				preview,
				storage: updated,
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
			if (error.code === "INVALID_CSS_PATH") {
				return jsonError(error.message, 400);
			}
		}

		console.error(error);
		return jsonError("Failed to sync Tailwind tokens", 500);
	}
});

/**
 * Validate color token override pattern
 * Must match --color-... pattern (supports * as wildcard)
 */
const validateColorOverride = (pattern: string): boolean => {
	return /^--color-[a-z0-9\-*]+$/i.test(pattern);
};

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
		const stored = await readDomainTokens(projectRoot, systemName);

		if (!stored) {
			return jsonError(`No tokens stored for system "${systemName}"`, 404);
		}

		return c.json({
			ok: true,
			systemName: stored.metadata.systemName,
			cssPath: stored.metadata.cssPath,
			syncedAt: stored.metadata.syncedAt,
			tailwindBaselineVersion: stored.metadata.tailwindBaselineVersion,
			reviewRequired: stored.metadata.reviewRequired,
			domains: stored.domains,
		});
	} catch (error) {
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

	if (
		!isRecord(body) ||
		!isRecord(body.domains) ||
		!isRecord(body.domains.color) ||
		!Array.isArray(body.domains.color.overrides)
	) {
		return jsonError(
			"Request body must contain domains.color.overrides array",
			400,
		);
	}

	// Validate all overrides match color domain pattern
	const overrides = body.domains.color.overrides as unknown[];
	for (const override of overrides) {
		if (typeof override !== "string") {
			return jsonError("All overrides must be strings", 400);
		}
		if (!validateColorOverride(override)) {
			return jsonError(
				`Invalid override pattern: "${override}". Must match --color-... pattern`,
				400,
			);
		}
	}

	try {
		const stored = await readDomainTokens(projectRoot, systemName);

		if (!stored) {
			return jsonError(`No tokens stored for system "${systemName}"`, 404);
		}

		// Update overrides only, preserve synced tokens
		await storeDomainTokens({
			projectRoot,
			systemName,
			tokens: stored.domains.color.tokens,
			overrides: overrides as string[],
			tailwindBaselineVersion: stored.metadata.tailwindBaselineVersion,
			cssPath: stored.metadata.cssPath,
			baselineDiff: stored.domains.color.baselineDiff,
			reviewRequired: false,
			syncedAt: stored.metadata.syncedAt,
		});

		// Read back to get normalized (sorted) overrides
		const updated = await readDomainTokens(projectRoot, systemName);

		if (!updated) {
			return jsonError("Failed to read updated tokens", 500);
		}

		return c.json({
			ok: true,
			systemName: updated.metadata.systemName,
			cssPath: updated.metadata.cssPath,
			syncedAt: updated.metadata.syncedAt,
			tailwindBaselineVersion: updated.metadata.tailwindBaselineVersion,
			reviewRequired: updated.metadata.reviewRequired,
			domains: updated.domains,
		});
	} catch (error) {
		console.error(error);
		return jsonError("Failed to save and confirm overrides", 500);
	}
});
