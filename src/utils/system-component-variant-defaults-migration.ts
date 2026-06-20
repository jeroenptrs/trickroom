import type {
	SystemComponentVariantAxis,
	SystemComponentVariantSchema,
} from "./system-components.ts";
import { hashSystemComponentVariantSchema } from "./system-components-validation.ts";

export const firstSortedVariantValueKey = (
	axis: SystemComponentVariantAxis,
): string | undefined =>
	Object.keys(axis.values).sort((left, right) => left.localeCompare(right))[0];

export function backfillOptionalVariantDefaults(
	variants: SystemComponentVariantSchema | undefined,
): {
	variants: SystemComponentVariantSchema | undefined;
	changed: boolean;
} {
	if (!variants) {
		return { variants, changed: false };
	}

	let changed = false;
	const defaultValues = { ...(variants.defaultValues ?? {}) };
	for (const [axisKey, axis] of Object.entries(variants.axes).sort(
		([left], [right]) => left.localeCompare(right),
	)) {
		if (
			axis.defaultValue !== undefined ||
			defaultValues[axisKey] !== undefined
		) {
			continue;
		}
		const firstValueKey = firstSortedVariantValueKey(axis);
		if (!firstValueKey) {
			continue;
		}
		defaultValues[axisKey] = firstValueKey;
		changed = true;
	}

	if (!changed) {
		return { variants, changed: false };
	}

	return {
		variants: {
			...variants,
			defaultValues,
		},
		changed: true,
	};
}

export function hashSystemComponentVariantSchemaBeforeDefaultBackfill(
	variants: SystemComponentVariantSchema | undefined,
): string | null {
	if (!variants?.defaultValues) {
		return null;
	}

	const defaultValues = { ...variants.defaultValues };
	let changed = false;
	for (const [axisKey, axis] of Object.entries(variants.axes)) {
		if (axis.defaultValue !== undefined) {
			continue;
		}
		const firstValueKey = firstSortedVariantValueKey(axis);
		if (firstValueKey && defaultValues[axisKey] === firstValueKey) {
			delete defaultValues[axisKey];
			changed = true;
		}
	}

	if (!changed) {
		return null;
	}

	const { defaultValues: _defaultValues, ...rest } = variants;
	const legacyVariants: SystemComponentVariantSchema = {
		...rest,
		...(Object.keys(defaultValues).length > 0 ? { defaultValues } : {}),
	};
	return hashSystemComponentVariantSchema(legacyVariants);
}

export function variantSchemaHashMatchesDefaultBackfillMigration(
	variantSchemaHash: string | null | undefined,
	variants: SystemComponentVariantSchema | undefined,
) {
	if (!variantSchemaHash) {
		return false;
	}
	if (variantSchemaHash === hashSystemComponentVariantSchema(variants)) {
		return true;
	}

	// Existing attached roots keep the pre-migration variantSchemaHash marker.
	// The v1->v2 manifest migration only makes the resolver's former sorted-first
	// default explicit, so that legacy hash remains render-equivalent and should
	// not make every attached instance look stale.
	return (
		variantSchemaHash ===
		hashSystemComponentVariantSchemaBeforeDefaultBackfill(variants)
	);
}
