import type { StyleProperty } from "../../../utils/tailwind-classname";

export function backgroundUtility(
	property: StyleProperty,
	value: string,
): string {
	if (value.startsWith("[") || value.startsWith("(")) {
		switch (property) {
			case "background.background-image":
				return `bg-${value}`;
			case "background.gradient-from-position":
				return `from-${value}`;
			case "background.gradient-via-position":
				return `via-${value}`;
			case "background.gradient-to-position":
				return `to-${value}`;
			default:
				return value;
		}
	}

	switch (property) {
		case "background.background-size":
			return `bg-${value}`;
		case "background.background-repeat":
			return `bg-${value}`;
		case "background.background-attachment":
			return `bg-${value}`;
		case "background.background-position":
			return `bg-${value}`;
		case "background.background-origin":
			return `bg-origin-${value}`;
		case "background.background-clip":
			return `bg-clip-${value}`;
		case "background.background-blend-mode":
			return `bg-blend-${value}`;
		case "background.background-gradient":
			return `bg-${value}`;
		case "background.gradient-from-position":
			return `from-${value}`;
		case "background.gradient-via-position":
			return `via-${value}`;
		case "background.gradient-to-position":
			return `to-${value}`;
		default:
			return value;
	}
}
