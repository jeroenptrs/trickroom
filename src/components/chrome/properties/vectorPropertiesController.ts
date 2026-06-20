import type { StyleProperty } from "../../../utils/tailwind-classname";

export function vectorUtility(property: StyleProperty, value: string): string {
	if (value.startsWith("[") || value.startsWith("(")) {
		switch (property) {
			case "vector.fill":
				return `fill-${value}`;
			case "vector.stroke":
			case "vector.stroke-width":
				return `stroke-${value}`;
			default:
				return value;
		}
	}

	switch (property) {
		case "vector.fill":
			return value === "none" ? "fill-none" : `fill-${value}`;
		case "vector.stroke":
			return value === "none" ? "stroke-none" : `stroke-${value}`;
		case "vector.stroke-width":
			return `stroke-${value}`;
		default:
			return value;
	}
}
