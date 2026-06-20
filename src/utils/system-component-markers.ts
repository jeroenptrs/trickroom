import type { Props } from "../types";
import { assetIdProp, iconIdProp } from "./resource-props";

export const systemComponentSystemIdProp =
	"data-trickroom-system-component-system-id";
export const systemComponentIdProp = "data-trickroom-system-component-id";
export const systemComponentInstanceProp =
	"data-trickroom-system-component-instance";
export const systemComponentVersionProp =
	"data-trickroom-system-component-version";
export const systemComponentPathProp = "data-trickroom-system-component-path";
export const systemComponentRootProp = "data-trickroom-system-component-root";
export const systemComponentSlotProp = "data-trickroom-system-component-slot";
export const systemComponentVariantValuesProp =
	"data-trickroom-system-component-variant-values";
export const systemComponentOverridesProp =
	"data-trickroom-system-component-overrides";
export const systemComponentTemplateHashProp =
	"data-trickroom-system-component-template-hash";
export const systemComponentVariantSchemaHashProp =
	"data-trickroom-system-component-variant-schema-hash";

export const SYSTEM_COMPONENT_MARKER_PROP_KEYS = new Set([
	systemComponentSystemIdProp,
	systemComponentIdProp,
	systemComponentInstanceProp,
	systemComponentVersionProp,
	systemComponentPathProp,
	systemComponentRootProp,
	systemComponentSlotProp,
	systemComponentVariantValuesProp,
	systemComponentOverridesProp,
	systemComponentTemplateHashProp,
	systemComponentVariantSchemaHashProp,
]);

export type SystemComponentMarkerPropKey =
	| typeof systemComponentSystemIdProp
	| typeof systemComponentIdProp
	| typeof systemComponentInstanceProp
	| typeof systemComponentVersionProp
	| typeof systemComponentPathProp
	| typeof systemComponentRootProp
	| typeof systemComponentSlotProp
	| typeof systemComponentVariantValuesProp
	| typeof systemComponentOverridesProp
	| typeof systemComponentTemplateHashProp
	| typeof systemComponentVariantSchemaHashProp;

export type SystemComponentInstanceOverrideValues = {
	className?: string;
	text?: string;
	[iconIdProp]?: string;
	[assetIdProp]?: string;
};

export type SystemComponentInstanceOverrides = Record<
	string,
	SystemComponentInstanceOverrideValues
>;

export type SystemComponentStructuralMetadata = {
	systemId: string;
	componentId: string;
	instanceId: string;
	version: string;
	path: string;
	isRoot: boolean;
	slotName: string | null;
	variantValues: Record<string, string>;
	overrides: SystemComponentInstanceOverrides;
	templateHash: string | null;
	variantSchemaHash: string | null;
};

const getStringProp = (
	props: Props | null | undefined,
	key: SystemComponentMarkerPropKey,
) => {
	const value = props?.[key];
	return typeof value === "string" && value.trim().length > 0 ? value : null;
};

const parseRecord = <T extends Record<string, unknown>>(
	value: string | null,
): T | null => {
	if (!value) {
		return null;
	}
	try {
		const parsed = JSON.parse(value) as unknown;
		return parsed && typeof parsed === "object" && !Array.isArray(parsed)
			? (parsed as T)
			: null;
	} catch {
		return null;
	}
};

const normalizeStringRecord = (
	value: Record<string, unknown> | null,
): Record<string, string> => {
	const result: Record<string, string> = {};
	for (const [key, entry] of Object.entries(value ?? {})) {
		if (typeof entry === "string") {
			result[key] = entry;
		}
	}
	return result;
};

const normalizeOverrides = (
	value: Record<string, unknown> | null,
): SystemComponentInstanceOverrides => {
	const result: SystemComponentInstanceOverrides = {};
	for (const [targetId, entry] of Object.entries(value ?? {})) {
		if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
			continue;
		}
		const record = entry as Record<string, unknown>;
		const next: SystemComponentInstanceOverrideValues = {};
		if (typeof record.className === "string") {
			next.className = record.className;
		}
		if (typeof record.text === "string") {
			next.text = record.text;
		}
		const iconId = record[iconIdProp];
		if (typeof iconId === "string") {
			next[iconIdProp] = iconId;
		}
		const assetId = record[assetIdProp];
		if (typeof assetId === "string") {
			next[assetIdProp] = assetId;
		}
		if (Object.keys(next).length > 0) {
			result[targetId] = next;
		}
	}
	return result;
};

export const isSystemComponentMarkerPropKey = (
	key: string,
): key is SystemComponentMarkerPropKey =>
	SYSTEM_COMPONENT_MARKER_PROP_KEYS.has(key);

export const getSystemComponentStructuralMetadata = (
	props: Props | null | undefined,
): SystemComponentStructuralMetadata | null => {
	const systemId = getStringProp(props, systemComponentSystemIdProp);
	const componentId = getStringProp(props, systemComponentIdProp);
	const instanceId = getStringProp(props, systemComponentInstanceProp);
	const version = getStringProp(props, systemComponentVersionProp);
	const path = getStringProp(props, systemComponentPathProp);
	if (!systemId || !componentId || !instanceId || !version || !path) {
		return null;
	}

	const rootValue = props?.[systemComponentRootProp];
	const variantValues = normalizeStringRecord(
		parseRecord(getStringProp(props, systemComponentVariantValuesProp)),
	);
	const overrides = normalizeOverrides(
		parseRecord(getStringProp(props, systemComponentOverridesProp)),
	);

	return {
		systemId,
		componentId,
		instanceId,
		version,
		path,
		isRoot: rootValue === "true" || rootValue === true,
		slotName: getStringProp(props, systemComponentSlotProp),
		variantValues,
		overrides,
		templateHash: getStringProp(props, systemComponentTemplateHashProp),
		variantSchemaHash: getStringProp(
			props,
			systemComponentVariantSchemaHashProp,
		),
	};
};

export const getSystemComponentMarkerProps = ({
	systemId,
	componentId,
	instanceId,
	version,
	path,
	isRoot = false,
	slotName = null,
	variantValues,
	overrides,
	templateHash,
	variantSchemaHash,
}: {
	systemId: string;
	componentId: string;
	instanceId: string;
	version: string;
	path: string;
	isRoot?: boolean;
	slotName?: string | null;
	variantValues?: Record<string, string>;
	overrides?: SystemComponentInstanceOverrides;
	templateHash?: string;
	variantSchemaHash?: string;
}): Partial<Props> => ({
	[systemComponentSystemIdProp]: systemId,
	[systemComponentIdProp]: componentId,
	[systemComponentInstanceProp]: instanceId,
	[systemComponentVersionProp]: version,
	[systemComponentPathProp]: path,
	...(isRoot ? { [systemComponentRootProp]: "true" } : {}),
	...(slotName ? { [systemComponentSlotProp]: slotName } : {}),
	...(isRoot && variantValues
		? { [systemComponentVariantValuesProp]: JSON.stringify(variantValues) }
		: {}),
	...(isRoot && overrides
		? { [systemComponentOverridesProp]: JSON.stringify(overrides) }
		: {}),
	...(isRoot && templateHash
		? { [systemComponentTemplateHashProp]: templateHash }
		: {}),
	...(isRoot && variantSchemaHash
		? { [systemComponentVariantSchemaHashProp]: variantSchemaHash }
		: {}),
});

export const omitSystemComponentMarkerProps = (props: Props): Props => {
	const nextProps = { ...props };
	for (const key of SYSTEM_COMPONENT_MARKER_PROP_KEYS) {
		delete nextProps[key];
	}
	return nextProps;
};

export const isSystemComponentRootStale = (
	props: Props | null | undefined,
	current: { templateHash?: string; variantSchemaHash?: string },
) => {
	const metadata = getSystemComponentStructuralMetadata(props);
	if (!metadata?.isRoot) {
		return false;
	}
	return (
		(current.templateHash !== undefined &&
			metadata.templateHash !== current.templateHash) ||
		(current.variantSchemaHash !== undefined &&
			metadata.variantSchemaHash !== current.variantSchemaHash)
	);
};
