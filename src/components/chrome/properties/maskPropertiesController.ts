import type { StyleProperty } from "../../../utils/tailwind-classname";

/** Map a semantic slot value to the Tailwind mask utility body the model expects. */
export function maskUtility(property: StyleProperty, value: string): string {
	if (value.startsWith("[") || value.startsWith("(")) {
		return `mask-${value}`;
	}

	switch (property) {
		case "mask.mask-image":
			return value === "none" ? "mask-none" : `mask-${value}`;
		case "mask.mask-mode":
			return `mask-${value}`;
		case "mask.mask-size":
		case "mask.mask-position":
			return `mask-${value}`;
		case "mask.mask-repeat":
			return value === "repeat" ? "mask-repeat" : `mask-${value}`;
		case "mask.mask-origin":
			return `mask-origin-${value}`;
		case "mask.mask-clip":
			return `mask-clip-${value}`;
		case "mask.mask-composite":
			return `mask-${value}`;
		case "mask.mask-linear":
			return `mask-linear-${value}`;
		case "mask.mask-linear-from":
			return `mask-linear-from-${value}`;
		case "mask.mask-linear-to":
			return `mask-linear-to-${value}`;
		case "mask.mask-radial-position":
			return `mask-radial-at-${value}`;
		case "mask.mask-radial-from":
			return `mask-radial-from-${value}`;
		case "mask.mask-radial-to":
			return `mask-radial-to-${value}`;
		case "mask.mask-conic":
			return `mask-conic-${value}`;
		case "mask.mask-conic-from":
			return `mask-conic-from-${value}`;
		case "mask.mask-conic-to":
			return `mask-conic-to-${value}`;
		default:
			return `mask-${value}`;
	}
}
