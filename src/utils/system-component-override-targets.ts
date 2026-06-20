import {
	getControlDefinitions,
	resolveRegistryComponent,
} from "../libraries/registry";
import type { Role } from "../types";
import { assetIdProp, iconIdProp } from "./resource-props";
import type { SystemComponentInstanceOverrides } from "./system-component-markers";
import type {
	PublishedSystemComponentVersion,
	SystemComponentOverrideTarget,
} from "./system-components";

export const SYSTEM_COMPONENT_OVERRIDE_CAPABILITIES = [
	"className",
	"text",
	"icon",
	"asset",
] as const;

export type SystemComponentOverrideCapability =
	(typeof SYSTEM_COMPONENT_OVERRIDE_CAPABILITIES)[number];

const CAPABILITY_SET = new Set<string>(SYSTEM_COMPONENT_OVERRIDE_CAPABILITIES);

export const isSystemComponentOverrideCapability = (
	value: string,
): value is SystemComponentOverrideCapability => CAPABILITY_SET.has(value);

export const normalizeOverrideTargetCapabilities = (
	target: Pick<SystemComponentOverrideTarget, "capabilities">,
): SystemComponentOverrideCapability[] => {
	const capabilities = target.capabilities?.filter(isSystemComponentOverrideCapability);
	if (!capabilities || capabilities.length === 0) {
		return ["className"];
	}
	return [...new Set(capabilities)];
};

export const inferOverrideTargetCapabilities = (entity: {
	role: Role;
	library: string;
	component: string;
}): SystemComponentOverrideCapability[] => {
	const capabilities: SystemComponentOverrideCapability[] = ["className"];
	if (entity.role === "text") {
		capabilities.push("text");
	}

	const resolution = resolveRegistryComponent(entity.library, entity.component);
	if (resolution.status === "known") {
		for (const control of getControlDefinitions(resolution.definition)) {
			if (control.prop === iconIdProp) {
				capabilities.push("icon");
			}
			if (control.prop === assetIdProp) {
				capabilities.push("asset");
			}
		}
	}

	return [...new Set(capabilities)];
};

export const findOverrideTargetForCapability = (
	version: PublishedSystemComponentVersion,
	path: string,
	capability: SystemComponentOverrideCapability,
): SystemComponentOverrideTarget | null => {
	const matches = Object.values(version.overrideTargets ?? {})
		.filter(
			(target) =>
				target.path === path &&
				normalizeOverrideTargetCapabilities(target).includes(capability),
		)
		.sort((left, right) => left.targetId.localeCompare(right.targetId));
	return matches[0] ?? null;
};

export const getOverrideTargetIdsForCapability = (
	version: PublishedSystemComponentVersion,
	path: string,
	capability: SystemComponentOverrideCapability,
) =>
	Object.values(version.overrideTargets ?? {})
		.filter(
			(target) =>
				target.path === path &&
				normalizeOverrideTargetCapabilities(target).includes(capability),
		)
		.sort((left, right) => left.targetId.localeCompare(right.targetId))
		.map((target) => target.targetId);

export const readSystemComponentOverrideValue = (
	overrides: SystemComponentInstanceOverrides,
	targetId: string,
	capability: SystemComponentOverrideCapability,
): string | undefined => {
	const override = overrides[targetId];
	if (!override) {
		return undefined;
	}
	switch (capability) {
		case "className":
			return override.className;
		case "text":
			return override.text;
		case "icon": {
			const value = override[iconIdProp];
			return typeof value === "string" ? value : undefined;
		}
		case "asset": {
			const value = override[assetIdProp];
			return typeof value === "string" ? value : undefined;
		}
	}
};

export const resolveSystemComponentOverrideValue = (
	version: PublishedSystemComponentVersion,
	path: string,
	capability: SystemComponentOverrideCapability,
	overrides: SystemComponentInstanceOverrides = {},
) => {
	for (const targetId of getOverrideTargetIdsForCapability(
		version,
		path,
		capability,
	)) {
		const value = readSystemComponentOverrideValue(
			overrides,
			targetId,
			capability,
		);
		if (value !== undefined) {
			return value;
		}
	}
	return undefined;
};
