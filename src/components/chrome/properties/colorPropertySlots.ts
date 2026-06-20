/**
 * Computes the ordered list of "slots" a color property control should
 * render. A slot is one editable row keyed by its variant chain
 * (`""` = default, `"hover"`, `"md:hover"`, …).
 *
 * Each property surface exposes:
 *   1. The default slot ("") — always first, even when empty.
 *   2. Every variant for which the model has a class.
 *   3. Any "draft" variants the user added in the UI but hasn't yet
 *      picked a color for.
 *
 * Duplicate variant keys are de-duped, preserving first-occurrence
 * order.
 */

import type {
	ColorProperty,
	PropertyEntry,
	PropertyModel,
} from "../../../utils/tailwind-classname";

const DEFAULT_MODE = "";

export type ColorPropertySlot = {
	/** Variant key (`""` = default, `"hover"`, `"md:hover"`, …). */
	variantKey: string;
	/** Variant chain split for downstream `setColor`/`clearColor`. */
	variants: string[];
	/** Model entry, when one exists for this slot. */
	entry: PropertyEntry | undefined;
};

export function computeColorPropertySlots(
	model: PropertyModel,
	property: ColorProperty,
	draftVariants: readonly string[],
): ColorPropertySlot[] {
	const fromModel =
		model.byMode[DEFAULT_MODE]?.byProperty[property] ?? {};
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
