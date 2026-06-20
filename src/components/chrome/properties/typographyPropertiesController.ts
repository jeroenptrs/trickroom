import type { StyleProperty } from "../../../utils/tailwind-classname";

/** Map a semantic slot value to the Tailwind utility body the model expects. */
export function typographyUtility(
	property: StyleProperty,
	value: string,
): string {
	if (value.startsWith("[") || value.startsWith("(")) {
		switch (property) {
			case "typography.font-size":
				return `text-${value}`;
			case "typography.line-height":
				return `leading-${value}`;
			case "typography.letter-spacing":
				return `tracking-${value}`;
			default:
				return value;
		}
	}

	switch (property) {
		case "typography.font":
			return `font-${value}`;
		case "typography.font-size":
			return `text-${value}`;
		case "typography.font-weight":
			return `font-${value}`;
		case "typography.font-style":
			return value;
		case "typography.line-height":
			return value === "DEFAULT" ? "leading" : `leading-${value}`;
		case "typography.letter-spacing":
			return `tracking-${value}`;
		case "typography.text-align":
			return `text-${value}`;
		case "typography.text-transform":
			return value;
		case "typography.text-decoration-line":
			return value === "none" ? "no-underline" : value;
		case "typography.text-wrap":
			return value === "wrap" ? "text-wrap" : `text-${value}`;
		case "typography.text-overflow":
			return value === "truncate" ? "truncate" : `text-${value}`;
		case "typography.white-space":
			return `whitespace-${value}`;
		case "typography.line-clamp":
			return value === "none" ? "line-clamp-none" : `line-clamp-${value}`;
		default:
			return value;
	}
}
