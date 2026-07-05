import {
	getDefaultProps,
	getDefaultText,
	isJsonPrimitive,
	isRegistryId,
	resolveRegistryComponent,
} from "../libraries/registry";
import type { Node, RecipeTemplateNode } from "../types";
import { createClassLayers, flattenClassLayers } from "./class-layers.ts";
import { assetIdProp, iconIdProp } from "./resource-props.ts";
import {
	getSystemComponentMarkerProps,
	type SystemComponentInstanceOverrides,
} from "./system-component-markers.ts";
import {
	isValidSystemComponentPropOverride,
	resolveSystemComponentOverrideValue,
	resolveSystemComponentTargetPropValues,
} from "./system-component-override-targets.ts";

export {
	resolveSystemComponentClassName,
	resolveSystemComponentVariantValues,
	SystemComponentResolutionError,
} from "./system-component-resolution";

import {
	resolveMaterializedSystemComponentClassComposition,
	resolveSystemComponentVariantValues,
	SystemComponentResolutionError,
} from "./system-component-resolution";
import {
	type PublishedSystemComponentVersion,
	type SystemComponentRecord,
	spliceSlotChildren,
} from "./system-components.ts";

export type ResolvedPublishedSystemComponent = {
	systemId: string;
	componentId: string;
	record: SystemComponentRecord;
	version: PublishedSystemComponentVersion;
};

export type SystemComponentExpansionOptions = {
	createElementId?: () => string;
	createInstanceId?: () => string;
	variantValues?: Record<string, string>;
	overrides?: SystemComponentInstanceOverrides;
};

export type SystemComponentExpansionResult = {
	systemId: string;
	componentId: string;
	version: string;
	instanceId: string;
	root: Node;
	elementIdsByPath: Record<string, string>;
	variantValues: Record<string, string>;
	overrides: SystemComponentInstanceOverrides;
};

const createId = () => globalThis.crypto.randomUUID();

const getTemplateSlotName = (
	version: PublishedSystemComponentVersion,
	template: RecipeTemplateNode,
) =>
	template.slot ??
	Object.values(version.slots ?? {}).find(
		(slot) => slot.hostPath === template.path,
	)?.name ??
	null;

const getTemplateSlotDefinition = (
	version: PublishedSystemComponentVersion,
	template: RecipeTemplateNode,
) => {
	const slotName = getTemplateSlotName(version, template);
	if (!slotName) {
		return null;
	}

	return (
		version.slots?.[slotName] ??
		Object.values(version.slots ?? {}).find((slot) => slot.name === slotName) ??
		null
	);
};

const resolveRegistryDefinition = (
	componentId: string,
	version: string,
	template: RecipeTemplateNode,
) => {
	if (!isRegistryId(template.library)) {
		throw new SystemComponentResolutionError(
			"UNKNOWN_REGISTRY_LIBRARY",
			`System component "${componentId}" version "${version}" references unknown registry library "${template.library}".`,
		);
	}

	const resolution = resolveRegistryComponent(
		template.library,
		template.component,
	);
	if (resolution.status !== "known") {
		throw new SystemComponentResolutionError(
			"UNKNOWN_REGISTRY_COMPONENT",
			`System component "${componentId}" version "${version}" references unknown component "${template.component}" in registry "${template.library}".`,
		);
	}

	return resolution.definition;
};

const expandAuthoredTemplateNode = (
	componentId: string,
	version: PublishedSystemComponentVersion,
	template: RecipeTemplateNode,
	createElementId: () => string,
): Node => {
	const definition = resolveRegistryDefinition(
		componentId,
		version.version,
		template,
	);
	const id = createElementId();
	const role = definition.role;
	const name = template.name ?? definition.label;
	const className = flattenClassLayers(
		createClassLayers([
			{
				source: "system-template",
				className: template.className,
				metadata: { path: template.path },
			},
		]),
	);
	const props = {
		...getDefaultProps(template.library, template.component, definition, name),
		...(template.props ?? {}),
		...(className ? { className } : {}),
		"data-trickroom-name": name,
		"data-trickroom-library": template.library,
		"data-trickroom-component": template.component,
		"data-trickroom-role": role,
	};

	const children =
		role === "text"
			? (template.text ?? getDefaultText(role) ?? "")
			: role === "leaf"
				? []
				: (template.children ?? []).map((child) =>
						expandAuthoredTemplateNode(
							componentId,
							version,
							child,
							createElementId,
						),
					);

	return { id, props, children };
};

const expandTemplateNode = (
	resolved: ResolvedPublishedSystemComponent,
	template: RecipeTemplateNode,
	instanceId: string,
	variantValues: Record<string, string>,
	overrides: SystemComponentInstanceOverrides,
	elementIdsByPath: Record<string, string>,
	createElementId: () => string,
	isRoot: boolean,
): Node => {
	const definition = resolveRegistryDefinition(
		resolved.componentId,
		resolved.version.version,
		template,
	);
	const id = createElementId();
	elementIdsByPath[template.path] = id;
	const role = definition.role;
	const name = template.name ?? definition.label;
	const templatePropsClassName =
		typeof template.props?.className === "string"
			? template.props.className
			: undefined;
	const classComposition = resolveMaterializedSystemComponentClassComposition(
		resolved.version,
		template.path,
		template.className,
		templatePropsClassName,
		variantValues,
		overrides,
		definition,
		{
			systemId: resolved.systemId,
			componentId: resolved.componentId,
			instanceId,
			library: template.library,
			component: template.component,
		},
	);
	const iconOverride = resolveSystemComponentOverrideValue(
		resolved.version,
		template.path,
		"icon",
		overrides,
	);
	const assetOverride = resolveSystemComponentOverrideValue(
		resolved.version,
		template.path,
		"asset",
		overrides,
	);
	const propOverrides = resolveSystemComponentTargetPropValues(
		resolved.version,
		template,
		overrides,
	);
	const props = {
		...getDefaultProps(template.library, template.component, definition, name),
		...(template.props ?? {}),
		...classComposition.props,
		...propOverrides,
		...(iconOverride !== undefined ? { [iconIdProp]: iconOverride } : {}),
		...(assetOverride !== undefined ? { [assetIdProp]: assetOverride } : {}),
		"data-trickroom-name": name,
		"data-trickroom-library": template.library,
		"data-trickroom-component": template.component,
		"data-trickroom-role": role,
		...getSystemComponentMarkerProps({
			systemId: resolved.systemId,
			componentId: resolved.componentId,
			instanceId,
			version: resolved.version.version,
			path: template.path,
			isRoot,
			slotName: getTemplateSlotName(resolved.version, template),
			variantValues,
			overrides,
			templateHash: resolved.version.templateHash,
			variantSchemaHash: resolved.version.variantSchemaHash,
		}),
	};

	const slotDefinition = getTemplateSlotDefinition(resolved.version, template);
	const defaultSlotChildren = slotDefinition?.defaultChildren ?? [];
	const textOverride = resolveSystemComponentOverrideValue(
		resolved.version,
		template.path,
		"text",
		overrides,
	);
	const children =
		role === "text"
			? (textOverride ?? template.text ?? getDefaultText(role) ?? "")
			: role === "leaf"
				? []
				: spliceSlotChildren(
						(template.children ?? []).map((child) =>
							expandTemplateNode(
								resolved,
								child,
								instanceId,
								variantValues,
								overrides,
								elementIdsByPath,
								createElementId,
								false,
							),
						),
						defaultSlotChildren.map((child) =>
							expandAuthoredTemplateNode(
								resolved.componentId,
								resolved.version,
								child,
								createElementId,
							),
						),
						slotDefinition?.insertIndex,
					);

	return { id, props, children };
};

export const assertValidSystemComponentInstanceOverrides = (
	version: PublishedSystemComponentVersion,
	overrides: SystemComponentInstanceOverrides,
) => {
	const validTargetIds = new Set(Object.keys(version.overrideTargets ?? {}));
	const unknownTargets = Object.keys(overrides).filter(
		(targetId) => !validTargetIds.has(targetId),
	);
	if (unknownTargets.length > 0) {
		throw new SystemComponentResolutionError(
			"INVALID_INSTANCE_STATE",
			`System component instance contains unknown override targets: ${unknownTargets.join(", ")}.`,
		);
	}

	for (const [targetId, override] of Object.entries(overrides)) {
		const target = version.overrideTargets?.[targetId];
		if (!target) {
			continue;
		}
		if (
			override.className !== undefined &&
			typeof override.className !== "string"
		) {
			throw new SystemComponentResolutionError(
				"INVALID_INSTANCE_STATE",
				`System component override target "${targetId}" className must be a string.`,
			);
		}
		if (override.text !== undefined && typeof override.text !== "string") {
			throw new SystemComponentResolutionError(
				"INVALID_INSTANCE_STATE",
				`System component override target "${targetId}" text must be a string.`,
			);
		}
		const iconId = override[iconIdProp];
		if (iconId !== undefined && typeof iconId !== "string") {
			throw new SystemComponentResolutionError(
				"INVALID_INSTANCE_STATE",
				`System component override target "${targetId}" icon id must be a string.`,
			);
		}
		const assetId = override[assetIdProp];
		if (assetId !== undefined && typeof assetId !== "string") {
			throw new SystemComponentResolutionError(
				"INVALID_INSTANCE_STATE",
				`System component override target "${targetId}" asset id must be a string.`,
			);
		}
		for (const [prop, value] of Object.entries(override.props ?? {})) {
			if (
				!isJsonPrimitive(value) ||
				!isValidSystemComponentPropOverride(version, target, prop, value)
			) {
				throw new SystemComponentResolutionError(
					"INVALID_INSTANCE_STATE",
					`System component override target "${targetId}" prop "${prop}" is not a declared registry control override or has an invalid value.`,
				);
			}
		}
	}
};

export const resolvePublishedVersionId = (
	componentId: string,
	systemId: string,
	record: SystemComponentRecord,
	version?: string | null,
) => {
	const explicitVersion =
		typeof version === "string" && version.trim().length > 0
			? version.trim()
			: null;
	const resolvedVersionId =
		explicitVersion ?? record.published?.currentVersion ?? null;
	if (!resolvedVersionId) {
		throw new SystemComponentResolutionError(
			"UNKNOWN_VERSION",
			record.published
				? `System component "${componentId}" has no current published version in system "${systemId}".`
				: `System component "${componentId}" has no published versions in system "${systemId}".`,
		);
	}
	return resolvedVersionId;
};

export function expandResolvedSystemComponent(
	resolved: ResolvedPublishedSystemComponent,
	options: SystemComponentExpansionOptions = {},
): SystemComponentExpansionResult {
	const createElementId = options.createElementId ?? createId;
	const instanceId = (options.createInstanceId ?? createId)();
	const variantValues = resolveSystemComponentVariantValues(
		resolved.version.variants,
		options.variantValues,
	);
	const overrides = options.overrides ?? {};
	assertValidSystemComponentInstanceOverrides(resolved.version, overrides);

	const elementIdsByPath: Record<string, string> = {};
	const root = expandTemplateNode(
		resolved,
		resolved.version.root,
		instanceId,
		variantValues,
		overrides,
		elementIdsByPath,
		createElementId,
		true,
	);

	return {
		systemId: resolved.systemId,
		componentId: resolved.componentId,
		version: resolved.version.version,
		instanceId,
		root,
		elementIdsByPath,
		variantValues,
		overrides,
	};
}
