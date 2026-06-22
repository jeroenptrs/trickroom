import type { TrickroomConfig, TrickroomDesign } from "../types";
import { findDesignSystem } from "./design-system-store";

export const resolvePersistedDefaultSystemId = (
	config: Pick<TrickroomConfig, "defaultSystemId">,
): string | undefined => {
	const trimmed = config.defaultSystemId?.trim();
	return trimmed && trimmed.length > 0 ? trimmed : undefined;
};

export const setConfigDefaultSystemId = (
	config: TrickroomConfig,
	systemId: string | null,
): TrickroomConfig => {
	if (!systemId?.trim()) {
		const { defaultSystemId: _removed, ...rest } = config;
		void _removed;
		return rest;
	}

	return { ...config, defaultSystemId: systemId.trim() };
};

export const clearDefaultSystemIfMatches = (
	config: TrickroomConfig,
	systemId: string,
): TrickroomConfig =>
	resolvePersistedDefaultSystemId(config) === systemId
		? setConfigDefaultSystemId(config, null)
		: config;

export const applyProjectDefaultSystemToDesign = async (
	projectRoot: string,
	config: TrickroomConfig,
	design: TrickroomDesign,
): Promise<TrickroomDesign> => {
	if (design.systemId !== undefined || design.systemName !== undefined) {
		return design;
	}

	const defaultSystemId = resolvePersistedDefaultSystemId(config);
	if (!defaultSystemId) {
		return design;
	}

	const system = await findDesignSystem(projectRoot, defaultSystemId);
	if (!system) {
		return design;
	}

	return { ...design, systemId: system.manifest.systemId };
};

export const resolveDefaultSystemIdFromName = async (
	projectRoot: string,
	defaultSystemName: string,
): Promise<string | undefined> => {
	const trimmed = defaultSystemName.trim();
	if (!trimmed) {
		return undefined;
	}

	const system = await findDesignSystem(projectRoot, trimmed);
	return system?.manifest.systemId;
};
