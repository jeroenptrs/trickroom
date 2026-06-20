import type {
	ModelOptions,
	StyleProperty,
} from "../../../utils/tailwind-classname";
import {
	applyStyleUtility,
	clearStyleProperty,
	getStyleIntent,
	styleValueText,
} from "./styleSectionController";

export { getStyleIntent, styleValueText };

/** Map a structure slot value to its Tailwind utility body. */
export function structureUtility(
	property: StyleProperty,
	value: string,
): string {
	if (value.startsWith("[") || value.startsWith("(")) {
		switch (property) {
			case "structure.columns":
				return `columns-${value}`;
			case "structure.list-image":
				return `list-image-${value}`;
			case "structure.content":
				return `content-${value}`;
			default:
				// Arbitrary bracket/paren values are only valid for the cases above.
				return "";
		}
	}

	switch (property) {
		case "structure.box-sizing":
			return `box-${value}`;
		case "structure.box-decoration-break":
			return `box-decoration-${value}`;
		case "structure.visibility":
			return value;
		case "structure.float":
			return `float-${value}`;
		case "structure.clear":
			return `clear-${value}`;
		case "structure.columns":
			return `columns-${value}`;
		case "structure.break-before":
			return `break-before-${value}`;
		case "structure.break-after":
			return `break-after-${value}`;
		case "structure.break-inside":
			return `break-inside-${value}`;
		case "structure.list-style-type":
			return `list-${value}`;
		case "structure.list-style-position":
			return `list-${value}`;
		case "structure.list-image":
			return `list-image-${value}`;
		case "structure.table-layout":
			return `table-${value}`;
		case "structure.border-collapse":
			return value === "collapse" ? "border-collapse" : "border-separate";
		case "structure.caption-side":
			return `caption-${value}`;
		case "structure.content":
			return `content-${value}`;
		default:
			return value;
	}
}

/** Apply a ValueField input for a structure property with arbitrary/custom support. */
export function applyStructureInput(
	className: string,
	options: ModelOptions,
	property: StyleProperty,
	input: string,
): string {
	const trimmed = input.trim();
	if (!trimmed) return clearStyleProperty(className, options, property);
	return applyStyleUtility(
		className,
		options,
		property,
		structureUtility(property, trimmed),
	);
}

/** Return the display string for a structure property slot. */
export function readStructureValue(
	className: string,
	options: ModelOptions,
	property: StyleProperty,
): string {
	return styleValueText(getStyleIntent(className, options, property)) ?? "";
}
