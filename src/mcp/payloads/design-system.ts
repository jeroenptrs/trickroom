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
			name: read.design.name,
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
								syncedAt: storedTokens.metadata.syncedAt,
								tailwindBaselineVersion:
									storedTokens.metadata.tailwindBaselineVersion,
								reviewRequired: storedTokens.metadata.reviewRequired,
								...(storedTokens.metadata.cssPath !== system?.manifest.cssPath
									? { cssPath: storedTokens.metadata.cssPath }
									: {}),
							}
						: {
								available: false,
							},
				}
			: null,
	};
};
