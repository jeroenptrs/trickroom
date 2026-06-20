/**
 * Color-typed view over the generic {@link computePropertySlots}. Kept as a
 * thin alias so existing color controls and their tests are unchanged while
 * every other Style domain shares the same slot machinery (see #403).
 */

import type {
	ColorProperty,
	PropertyModel,
} from "../../../utils/tailwind-classname";
import { computePropertySlots, type PropertySlot } from "./propertySlots";

export type ColorPropertySlot = PropertySlot;

export function computeColorPropertySlots(
	model: PropertyModel,
	property: ColorProperty,
	draftVariants: readonly string[],
): ColorPropertySlot[] {
	return computePropertySlots(model, property, draftVariants);
}
