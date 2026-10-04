import { DesignTransformError } from "../../services/design-transform-service";
import type { TrickroomDesign } from "../../types";
import {
	findDesignSystem,
	listDesignSystems,
} from "../../utils/design-system-store";
import { formatDidYouMean, suggestClosest } from "../../utils/suggestions";
import { readDomainTokensReadonly } from "../../utils/tailwind-token-store";
import { assertCanReadDesignFile, getMcpPolicy } from "../governance";
import type { TrickroomMcpServerContext } from "../server-types";
import { getDesignSystemHandle, readDesignFileForTool } from "./design-tree";

export const getCategoryForTokenName = (name: string) => {
	const separatorIndex = name.indexOf("-");
	return separatorIndex === -1 ? name : name.slice(0, separatorIndex);
};

/**
 * Domain overrides are stored as CSS property selectors (`--spacing`,
 * `--spacing-4`, `--spacing-*`), whereas token names are bare (`DEFAULT`,
 * `4`). Map the token name to its selector forms before matching so a
 * confirmed namespace override is not reported as unconfirmed.
 */
export const isTokenOverrideConfirmed = (
	domain: string,
	tokenName: string,
	overrides: readonly string[],
): boolean => {
	const namespace = domain.startsWith("--") ? domain : `--${domain}`;
	const namespaced =
		tokenName === "DEFAULT" ? namespace : `${namespace}-${tokenName}`;
	const separatorIndex = tokenName.indexOf("-");
	const familyWildcard =
		separatorIndex === -1
			? null
			: `${namespace}-${tokenName.slice(0, separatorIndex)}-*`;
	return (
		overrides.includes(tokenName) ||
		overrides.includes(namespaced) ||
		(familyWildcard !== null && overrides.includes(familyWildcard)) ||
		overrides.includes(`${namespace}-*`)
	);
};

export const getDesignSystemDisplayName = async (
	context: TrickroomMcpServerContext,
	design: TrickroomDesign,
) =>
	(await summarizeDesignSystemReference(context, getDesignSystemHandle(design)))
		?.systemName ?? null;

export const summarizeDesignSystemReference = async (
	context: TrickroomMcpServerContext,
	systemHandle: string | null | undefined,
) => {
	const normalizedSystemHandle = systemHandle ?? null;
	const system = normalizedSystemHandle
		? await findDesignSystem(context.projectRoot, normalizedSystemHandle)
		: null;

	return normalizedSystemHandle === null
		? null
		: {
				systemId: system?.manifest.systemId ?? null,
				systemName: system?.manifest.systemName ?? normalizedSystemHandle,
				configured: system !== null,
				...(system?.manifest.cssPath
					? { cssPath: system.manifest.cssPath }
					: {}),
			};
};

export const assertConfiguredSystem = async (
	context: TrickroomMcpServerContext,
	systemHandle: string,
) => {
	const system = await findDesignSystem(context.projectRoot, systemHandle);
	if (!system) {
		const systems = await listDesignSystems(context.projectRoot);
		const availableSystems = systems.map((entry) => ({
			systemId: entry.manifest.systemId,
			systemName: entry.manifest.systemName,
		}));
		const suggestions = suggestClosest(
			systemHandle,
			availableSystems.flatMap((entry) => [entry.systemName, entry.systemId]),
		);
		throw new DesignTransformError(
			"UNKNOWN_DESIGN_SYSTEM",
			`Design system "${systemHandle}" is not configured for this project.${formatDidYouMean(suggestions)}`,
			{ suggestions, availableSystems },
		);
	}

	return system;
};

export const canonicalizeDesignSystemReferenceForStorage = async (
	context: TrickroomMcpServerContext,
	design: TrickroomDesign,
): Promise<TrickroomDesign> => {
	const systemHandle = getDesignSystemHandle(design);
	const { systemName: _legacySystemName, ...withoutLegacyName } = design;

	if (systemHandle === null) {
		if (design.systemId !== undefined || design.systemName !== undefined) {
			return { ...withoutLegacyName, systemId: null };
		}
		return withoutLegacyName;
	}

	const system = await assertConfiguredSystem(context, systemHandle);
	return {
		...withoutLegacyName,
		systemId: system.manifest.systemId,
	};
};

export const getDesignSystemPayload = async (
	context: TrickroomMcpServerContext,
	designFileId: string,
) => {
	assertCanReadDesignFile(getMcpPolicy(context.config), designFileId);
	const read = await readDesignFileForTool(context, designFileId);
	const systemHandle = getDesignSystemHandle(read.design);
	const system = systemHandle
		? await findDesignSystem(context.projectRoot, systemHandle)
		: null;
	const storedTokens = system
		? await readDomainTokensReadonly(
				context.projectRoot,
				system.manifest.systemId,
			)
		: null;

	return {
		designFile: {
			id: designFileId,
			file: read.file,
			name: read.design.name,
			revision: read.revision,
			systemId:
				read.design.systemId !== undefined
					? read.design.systemId
					: (system?.manifest.systemId ?? null),
			systemName:
				systemHandle === null
					? null
					: (read.design.systemName ??
						system?.manifest.systemName ??
						systemHandle),
		},
		designSystem: systemHandle
			? {
					systemId: system?.manifest.systemId ?? null,
					systemName: system?.manifest.systemName ?? systemHandle,
					configured: system !== null,
					...(system?.manifest.cssPath
						? { cssPath: system.manifest.cssPath }
						: {}),
					tokenStorage: storedTokens
						? {
								available: true,
								version: storedTokens.version,
								cssPath: storedTokens.metadata.cssPath,
								syncedAt: storedTokens.metadata.syncedAt,
								tailwindBaselineVersion:
									storedTokens.metadata.tailwindBaselineVersion,
								reviewRequired: storedTokens.metadata.reviewRequired,
							}
						: {
								available: false,
							},
				}
			: null,
	};
};
