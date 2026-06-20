import type { SystemComponentInstanceOverrides } from "./system-component-markers";
import { resolveSystemComponentOverrideValue } from "./system-component-override-targets";
import type {
	PublishedSystemComponentVersion,
	SystemComponentVariantSchema,
	SystemComponentVariantValue,
} from "./system-components";

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

const joinClasses = (...entries: Array<string | undefined>) =>
	entries
		.flatMap((entry) => entry?.trim().split(/\s+/u) ?? [])
		.filter(Boolean)
		.join(" ");

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
	const variantClasses = Object.entries(version.variants?.axes ?? {})
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([axisKey, axis]) =>
			classForVariantValue(path, axis.values[variantValues[axisKey]]),
		);
	const compoundClasses = (version.variants?.compoundVariants ?? [])
		.filter((compound) => compoundMatches(compound.when, variantValues))
		.map((compound) => compound.classesByPath[path]);
	const overrideClassName = resolveSystemComponentOverrideValue(
		version,
		path,
		"className",
		overrides,
	);

	return joinClasses(
		templateClassName,
		...variantClasses,
		...compoundClasses,
		overrideClassName,
	);
};
