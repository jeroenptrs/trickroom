import type { StyleProperty } from "../../../utils/tailwind-classname";

export function effectsUtility(property: StyleProperty, value: string): string {
	if (value.startsWith("[") || value.startsWith("(")) {
		switch (property) {
			case "effects.shadow":
				return `shadow-${value}`;
			case "effects.inset-shadow":
				return `inset-shadow-${value}`;
			case "effects.text-shadow":
				return `text-shadow-${value}`;
			case "effects.drop-shadow":
				return `drop-shadow-${value}`;
			case "effects.blur":
				return `blur-${value}`;
			case "effects.backdrop-blur":
				return `backdrop-blur-${value}`;
			case "effects.opacity":
				return `opacity-${value}`;
			default:
				return value;
		}
	}

	switch (property) {
		case "effects.shadow":
			return value === "DEFAULT" ? "shadow" : `shadow-${value}`;
		case "effects.inset-shadow":
			return value === "DEFAULT" ? "inset-shadow" : `inset-shadow-${value}`;
		case "effects.text-shadow":
			return value === "DEFAULT" ? "text-shadow" : `text-shadow-${value}`;
		case "effects.drop-shadow":
			return `drop-shadow-${value}`;
		case "effects.blur":
			return value === "DEFAULT" ? "blur" : `blur-${value}`;
		case "effects.backdrop-blur":
			return value === "DEFAULT" ? "backdrop-blur" : `backdrop-blur-${value}`;
		case "effects.opacity":
			return `opacity-${value}`;
		case "effects.mix-blend-mode":
			return `mix-blend-${value}`;
		case "effects.brightness":
			return value === "DEFAULT" ? "brightness" : `brightness-${value}`;
		case "effects.contrast":
			return value === "DEFAULT" ? "contrast" : `contrast-${value}`;
		case "effects.grayscale":
			return value === "DEFAULT" ? "grayscale" : `grayscale-${value}`;
		case "effects.hue-rotate":
			return `hue-rotate-${value}`;
		case "effects.invert":
			return value === "DEFAULT" ? "invert" : `invert-${value}`;
		case "effects.saturate":
			return `saturate-${value}`;
		case "effects.sepia":
			return value === "DEFAULT" ? "sepia" : `sepia-${value}`;
		default:
			return value;
	}
}
