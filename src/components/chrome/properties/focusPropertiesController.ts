import type { StyleProperty } from "../../../utils/tailwind-classname";

export function focusUtility(property: StyleProperty, value: string): string {
	if (value.startsWith("[") || value.startsWith("(")) {
		switch (property) {
			case "focus.ring-width":
				return `ring-${value}`;
			case "focus.ring-offset":
				return `ring-offset-${value}`;
			case "focus.outline-width":
				return `outline-${value}`;
			case "focus.outline-offset":
				return `outline-offset-${value}`;
			default:
				return value;
		}
	}

	switch (property) {
		case "focus.ring-width":
			return value === "DEFAULT" ? "ring" : `ring-${value}`;
		case "focus.ring-inset":
			return value === "inset" ? "ring-inset" : value;
		case "focus.ring-offset":
			return `ring-offset-${value}`;
		case "focus.outline-width":
			return value === "DEFAULT" ? "outline" : `outline-${value}`;
		case "focus.outline-style":
			return value === "none" ? "outline-none" : `outline-${value}`;
		case "focus.outline-offset":
			return `outline-offset-${value}`;
		default:
			return value;
	}
}
