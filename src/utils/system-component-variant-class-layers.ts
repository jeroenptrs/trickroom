import {
	type ClassLayer,
	type ClassLayerMetadata,
	createClassLayers,
} from "./class-layers";
import type {
	SystemComponentCompoundVariant,
	SystemComponentVariantSchema,
	SystemComponentVariantValue,
} from "./system-components";

export const compoundMatches = (
	when: Record<string, string | string[]>,
	variantValues: Record<string, string | undefined>,
) =>
	Object.entries(when).every(([axis, expected]) => {
		const actual = variantValues[axis];
		return Array.isArray(expected)
			? expected.includes(actual)
			: actual === expected;
	});

export const classForVariantValue = (
	path: string,
	value: SystemComponentVariantValue | undefined,
) => value?.classesByPath?.[path];

export type SystemComponentVariantClassLookups = {
	classForAxisValue?: (
		path: string,
		axisKey: string,
		valueKey: string,
		axis: SystemComponentVariantSchema["axes"][string],
	) => string | undefined;
	classForCompound?: (
		path: string,
		compound: SystemComponentCompoundVariant,
		compoundIndex: number,
	) => string | undefined;
};

export type ComposeSystemComponentVariantClassLayersInput = {
	variants: SystemComponentVariantSchema | undefined;
	path: string;
	templateClassName: string | undefined;
	variantValues: Record<string, string | undefined>;
	context?: Partial<ClassLayerMetadata>;
	instanceOverrideClassName?: string | undefined;
	lookups?: SystemComponentVariantClassLookups;
};

export const composeSystemComponentVariantClassLayers = ({
	variants,
	path,
	templateClassName,
	variantValues,
	context = {},
	instanceOverrideClassName,
	lookups,
}: ComposeSystemComponentVariantClassLayersInput): ClassLayer[] => {
	const resolveAxisClass =
		lookups?.classForAxisValue ??
		((
			lookupPath: string,
			_axisKey: string,
			valueKey: string,
			axis: SystemComponentVariantSchema["axes"][string],
		) => classForVariantValue(lookupPath, axis.values[valueKey]));

	const resolveCompoundClass =
		lookups?.classForCompound ??
		((lookupPath: string, compound: SystemComponentCompoundVariant) =>
			compound.classesByPath[lookupPath]);

	const variantLayers = Object.entries(variants?.axes ?? {})
		.sort(([left], [right]) => left.localeCompare(right))
		.flatMap(([axisKey, axis]) => {
			const valueKey = variantValues[axisKey];
			if (!valueKey) {
				return [];
			}

			return [
				{
					source: "system-variant" as const,
					className: resolveAxisClass(path, axisKey, valueKey, axis),
					metadata: {
						...context,
						path,
						axis: axisKey,
						value: valueKey,
					},
				},
			];
		});
	const compoundLayers = (variants?.compoundVariants ?? [])
		.map((compound, compoundIndex) => ({ compound, compoundIndex }))
		.filter(({ compound }) => compoundMatches(compound.when, variantValues))
		.map(({ compound, compoundIndex }) => ({
			source: "system-compound-variant" as const,
			className: resolveCompoundClass(path, compound, compoundIndex),
			metadata: { ...context, path, compoundIndex },
		}));

	return createClassLayers([
		{
			source: "system-template",
			className: templateClassName,
			metadata: { ...context, path },
		},
		...variantLayers,
		...compoundLayers,
		...(instanceOverrideClassName === undefined
			? []
			: [
					{
						source: "instance-override" as const,
						className: instanceOverrideClassName,
						metadata: { ...context, path, prop: "className" as const },
					},
				]),
	]);
};
