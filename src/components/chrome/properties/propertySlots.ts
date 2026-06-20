/**
 * Computes the ordered list of "slots" a property control should render for
 * one property — generalized from the original color-only version so every
 * Style domain can show base + selector/breakpoint override rows.
 *
 * A slot is one editable row keyed by its variant chain
 * (`""` = base/default, `"hover"`, `"md"`, `"md:hover"`, …):
 *   1. The base slot ("") — always first, even when empty.
 *   2. Every variant for which the model already has a class.
 *   3. Any "draft" variants the user added in the UI but hasn't filled in yet.
 *
 * Duplicate variant keys are de-duped, preserving first-occurrence order.
 */

import type {
	PropertyEntry,
	PropertyKey,
	PropertyModel,
} from "../../../utils/tailwind-classname";

const DEFAULT_MODE = "";

export type PropertySlot = {
	/** Variant key (`""` = base, `"hover"`, `"md:hover"`, …). */
	variantKey: string;
	/** Variant chain split for downstream set/clear mutations. */
	variants: string[];
	/** Model entry, when one exists for this slot. */
	entry: PropertyEntry | undefined;
};

/** Whether any slot (base or any variant) currently has a class for `property`. */
export function propertyHasEntries(
	model: PropertyModel,
	property: PropertyKey,
): boolean {
	const fromModel = model.byMode[DEFAULT_MODE]?.byProperty[property];
	return fromModel ? Object.values(fromModel).some(Boolean) : false;
}

export function computePropertySlots(
	model: PropertyModel,
	property: PropertyKey,
	draftVariants: readonly string[],
): PropertySlot[] {
	const fromModel = model.byMode[DEFAULT_MODE]?.byProperty[property] ?? {};
	const modelVariantKeys = Object.keys(fromModel);

	const seen = new Set<string>();
	const ordered: string[] = [];
	for (const key of [DEFAULT_MODE, ...modelVariantKeys, ...draftVariants]) {
		if (seen.has(key)) continue;
		seen.add(key);
		ordered.push(key);
	}

	return ordered.map((variantKey) => ({
		variantKey,
		variants: variantKey.length > 0 ? variantKey.split(":") : [],
		entry: fromModel[variantKey],
	}));
}
