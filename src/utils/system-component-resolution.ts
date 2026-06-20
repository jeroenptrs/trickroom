import {
	type ClassLayer,
	type ClassLayerMetadata,
	createClassLayers,
	flattenClassLayers,
	splitClassLayerTokens,
} from "./class-layers";
import {
	type ClassResolution,
	type ResolveClassLayersOptions,
	resolveClassLayers,
} from "./class-resolution";
import type { SystemComponentInstanceOverrides } from "./system-component-markers";
import { resolveSystemComponentOverrideValue } from "./system-component-override-targets";
import type {
	PublishedSystemComponentVersion,
	SystemComponentVariantSchema,
	SystemComponentVariantValue,
} from "./system-components";
import type { Props, RegistryComponentDefinition } from "../types";

const defaultClassResolutionOptions = {
	colorTokens: new Set<string>(),
} satisfies ResolveClassLayersOptions;

const hasClassValue = (value: string | undefined): value is string =>
	typeof value === "string" && value.trim().length > 0;

const stripBaseClassName = (
	className: string | undefined,
	baseClassName: string | undefined,
): string | undefined => {
	const classNames = splitClassLayerTokens(className);
	const baseClassNames = new Set(splitClassLayerTokens(baseClassName));
	if (classNames.length === 0 || baseClassNames.size === 0) {
		return hasClassValue(className) ? className : undefined;
	}

	const authoredClassNames = classNames.filter(
		(classToken) => !baseClassNames.has(classToken),
	);
	return authoredClassNames.length > 0
		? authoredClassNames.join(" ")
		: undefined;
};

const stripBaseClassNameFromLayers = (
	layers: readonly ClassLayer[],
	baseClassName: string | undefined,
): ClassLayer[] => {
	const baseClassNames = new Set(splitClassLayerTokens(baseClassName));
	if (baseClassNames.size === 0) {
		return [...layers];
	}

	return createClassLayers(
		layers.map((layer) => ({
			...layer,
			className: splitClassLayerTokens(layer.className)
				.filter((classToken) => !baseClassNames.has(classToken))
				.join(" "),
		})),
	);
};

const optionalMetadata = <T extends ClassLayerMetadata>(
	metadata: T,
): T | undefined => (Object.keys(metadata).length > 0 ? metadata : undefined);

export type SystemComponentClassResolutionContext = Pick<
	ClassLayerMetadata,
	"systemId" | "componentId" | "instanceId" | "library" | "component"
>;

export type SystemComponentClassComposition = {
	layers: ClassLayer[];
	resolution: ClassResolution;
	className: string | undefined;
	props: Partial<Props>;
};

export class SystemComponentResolutionError extends Error {
	readonly code:
		| "UNKNOWN_SYSTEM"
		| "UNKNOWN_COMPONENT"
		| "UNKNOWN_VERSION"
		| "INVALID_INSTANCE_STATE"
		| "UNKNOWN_REGISTRY_LIBRARY"
		| "UNKNOWN_REGISTRY_COMPONENT";

	constructor(code: SystemComponentResolutionError["code"], message: string) {
		super(message);
		this.name = "SystemComponentResolutionError";
		this.code = code;
	}
}

const defaultVariantValueForAxis = (
	axisKey: string,
	axis: SystemComponentVariantSchema["axes"][string],
	schema: SystemComponentVariantSchema,
) =>
	schema.defaultValues?.[axisKey] ??
	axis.defaultValue ??
	Object.keys(axis.values).sort((left, right) => left.localeCompare(right))[0];

export const resolveSystemComponentVariantValues = (
	variants: SystemComponentVariantSchema | undefined,
	selectedValues: Record<string, string> = {},
): Record<string, string> => {
	const axes = variants?.axes ?? {};
	const unknownAxes = Object.keys(selectedValues).filter(
		(axisKey) => !Object.hasOwn(axes, axisKey),
	);
	if (unknownAxes.length > 0) {
		throw new SystemComponentResolutionError(
			"INVALID_INSTANCE_STATE",
			`System component instance contains unknown variant axes: ${unknownAxes.join(", ")}.`,
		);
	}

	const resolved: Record<string, string> = {};
	for (const [axisKey, axis] of Object.entries(axes).sort(([left], [right]) =>
		left.localeCompare(right),
	)) {
		const value =
			selectedValues[axisKey] ??
			defaultVariantValueForAxis(axisKey, axis, variants ?? { axes: {} });
		if (value === undefined || !Object.hasOwn(axis.values, value)) {
			throw new SystemComponentResolutionError(
				"INVALID_INSTANCE_STATE",
				`System component variant axis "${axisKey}" has no valid value.`,
			);
		}
		resolved[axisKey] = value;
	}

	return resolved;
};

const compoundMatches = (
	when: Record<string, string | string[]>,
	variantValues: Record<string, string>,
) =>
	Object.entries(when).every(([axis, expected]) => {
		const actual = variantValues[axis];
		return Array.isArray(expected)
			? expected.includes(actual)
			: actual === expected;
	});

const classForVariantValue = (
	path: string,
	value: SystemComponentVariantValue | undefined,
) => value?.classesByPath?.[path];

export const resolveSystemComponentClassName = (
	version: PublishedSystemComponentVersion,
	path: string,
	templateClassName: string | undefined,
	variantValues: Record<string, string>,
	overrides: SystemComponentInstanceOverrides = {},
) => {
	return resolveSystemComponentClassComposition(
		version,
		path,
		templateClassName,
		variantValues,
		overrides,
	).className;
};

export const resolveSystemComponentClassComposition = (
	version: PublishedSystemComponentVersion,
	path: string,
	templateClassName: string | undefined,
	variantValues: Record<string, string>,
	overrides: SystemComponentInstanceOverrides = {},
	context: Partial<SystemComponentClassResolutionContext> = {},
	options: ResolveClassLayersOptions = defaultClassResolutionOptions,
): Omit<SystemComponentClassComposition, "props"> => {
	const layers = resolveSystemComponentClassLayers(
		version,
		path,
		templateClassName,
		variantValues,
		overrides,
		context,
	);

	return {
		layers,
		resolution: resolveClassLayers(layers, options),
		className: flattenClassLayers(layers),
	};
};

export const resolveMaterializedSystemComponentClassComposition = (
	version: PublishedSystemComponentVersion,
	path: string,
	templateClassName: string | undefined,
	templatePropsClassName: string | undefined,
	variantValues: Record<string, string>,
	overrides: SystemComponentInstanceOverrides,
	definition: RegistryComponentDefinition,
	context: Partial<SystemComponentClassResolutionContext> = {},
	options: ResolveClassLayersOptions = defaultClassResolutionOptions,
): SystemComponentClassComposition => {
	const rawSystemLayers = resolveSystemComponentClassLayers(
		version,
		path,
		templateClassName,
		variantValues,
		overrides,
		context,
	);
	const rawSystemClassName = flattenClassLayers(rawSystemLayers);
	const systemLayers = stripBaseClassNameFromLayers(
		rawSystemLayers,
		definition.baseClassName,
	);
	const fallbackClassName = rawSystemClassName
		? undefined
		: stripBaseClassName(templatePropsClassName, definition.baseClassName);
	const layers = createClassLayers([
		{
			source: "registry-base",
			className: definition.baseClassName,
			metadata: optionalMetadata(context),
		},
		...systemLayers,
		{
			source: "authored",
			className: fallbackClassName,
			metadata: { ...context, path, prop: "className" },
		},
	]);
	const className = flattenClassLayers(layers);

	return {
		layers,
		resolution: resolveClassLayers(layers, options),
		className,
		props: {
			...(className ? { className } : {}),
			...(hasClassValue(definition.baseClassName)
				? { "data-trickroom-materialized-base-class": "true" }
				: {}),
		},
	};
};

export const resolveSystemComponentMaterializedSnapshotClassComposition = (
	className: string | undefined,
	context: Partial<SystemComponentClassResolutionContext> = {},
	options: ResolveClassLayersOptions = defaultClassResolutionOptions,
): Omit<SystemComponentClassComposition, "props"> => {
	const layers = createClassLayers([
		{
			source: "materialized-snapshot",
			className,
			metadata: optionalMetadata(context),
		},
	]);

	return {
		layers,
		resolution: resolveClassLayers(layers, options),
		className: flattenClassLayers(layers),
	};
};

export const resolveSystemComponentClassLayers = (
	version: PublishedSystemComponentVersion,
	path: string,
	templateClassName: string | undefined,
	variantValues: Record<string, string>,
	overrides: SystemComponentInstanceOverrides = {},
	context: Partial<SystemComponentClassResolutionContext> = {},
): ClassLayer[] => {
	const variantLayers = Object.entries(version.variants?.axes ?? {})
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([axisKey, axis]) => ({
			source: "system-variant" as const,
			className: classForVariantValue(
				path,
				axis.values[variantValues[axisKey]],
			),
			metadata: {
				...context,
				path,
				axis: axisKey,
				value: variantValues[axisKey],
			},
		}));
	const compoundLayers = (version.variants?.compoundVariants ?? [])
		.map((compound, compoundIndex) => ({ compound, compoundIndex }))
		.filter(({ compound }) => compoundMatches(compound.when, variantValues))
		.map(({ compound, compoundIndex }) => ({
			source: "system-compound-variant" as const,
			className: compound.classesByPath[path],
			metadata: { ...context, path, compoundIndex },
		}));
	const overrideClassName = resolveSystemComponentOverrideValue(
		version,
		path,
		"className",
		overrides,
	);

	return createClassLayers([
		{
			source: "system-template",
			className: templateClassName,
			metadata: { ...context, path },
		},
		...variantLayers,
		...compoundLayers,
		{
			source: "instance-override",
			className: overrideClassName,
			metadata: { ...context, path, prop: "className" },
		},
	]);
};
