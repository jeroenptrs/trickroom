import { DesignTransformError } from "../../services/design-transform-service";
import type { TrickroomDesign } from "../../types";
import {
	findDesignSystem,
	listDesignSystems,
} from "../../utils/design-system-store";
import { formatDidYouMean, suggestClosest } from "../../utils/suggestions";
import { assertCanReadDesignFile, getMcpPolicy } from "../governance";
import type { TrickroomMcpServerContext } from "../server-types";
import { getDesignSystemHandle, readDesignFileForTool } from "./design-tree";

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

/**
 * The design system a tool works on: systemName (a name or id), else the
 * system linked to designFileId, else the project default, else the only
 * configured system.
 */
export const resolveToolSystem = async (
	context: TrickroomMcpServerContext,
	{ systemName, designFileId }: { systemName?: string; designFileId?: string },
) => {
	if (systemName !== undefined) {
		return assertConfiguredSystem(context, systemName);
	}
	if (designFileId !== undefined) {
		assertCanReadDesignFile(getMcpPolicy(context.config), designFileId);
		const read = await readDesignFileForTool(context, designFileId);
		const handle = getDesignSystemHandle(read.design);
		if (handle === null) {
			throw new DesignTransformError(
				"DESIGN_NOT_LINKED_TO_SYSTEM",
				`Design "${read.design.name}" is not linked to a design system. Pass systemName instead.`,
			);
		}
		return assertConfiguredSystem(context, handle);
	}
	const systems = await listDesignSystems(context.projectRoot);
	const preferred =
		systems.find(
			(system) => system.manifest.systemId === context.config.defaultSystemId,
		) ?? (systems.length === 1 ? systems[0] : undefined);
	if (!preferred) {
		throw new DesignTransformError(
			"DESIGN_SYSTEM_REQUIRED",
			systems.length === 0
				? "This project has no design systems."
				: `Pass systemName: the project has ${systems.length} design systems and no default.`,
			{
				availableSystems: systems.map((system) => ({
					systemId: system.manifest.systemId,
					systemName: system.manifest.systemName,
				})),
			},
		);
	}
	return preferred;
};
