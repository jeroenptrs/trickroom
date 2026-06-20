import type { StyleProperty } from "../../../utils/tailwind-classname";

/** Map a semantic slot value to the Tailwind interaction utility body the model expects. */
export function interactionUtility(
	property: StyleProperty,
	value: string,
): string {
	if (value.startsWith("[") || value.startsWith("(")) {
		switch (property) {
			case "interaction.cursor":
				return `cursor-${value}`;
			case "interaction.scroll-margin-top":
				return `scroll-mt-${value}`;
			case "interaction.scroll-padding-top":
				return `scroll-pt-${value}`;
			case "interaction.will-change":
				return `will-change-${value}`;
			case "interaction.touch-action":
				return `touch-${value}`;
			default:
				return value;
		}
	}

	switch (property) {
		case "interaction.cursor":
			return `cursor-${value}`;
		case "interaction.pointer-events":
			return `pointer-events-${value}`;
		case "interaction.user-select":
			return value === "none"
				? "select-none"
				: value === "text"
					? "select-text"
					: value === "all"
						? "select-all"
						: `select-${value}`;
		case "interaction.resize":
			return value === "both" ? "resize" : `resize-${value}`;
		case "interaction.appearance":
			return `appearance-${value}`;
		case "interaction.scroll-behavior":
			return `scroll-${value}`;
		case "interaction.scroll-snap-type":
			return value === "none" ? "snap-none" : `snap-${value}`;
		case "interaction.scroll-snap-axis":
			return value === "both" ? "snap-both" : `snap-${value}`;
		case "interaction.scroll-snap-strictness":
			return `snap-${value}`;
		case "interaction.scroll-snap-align":
			return value === "none" ? "snap-align-none" : `snap-${value}`;
		case "interaction.scroll-snap-stop":
			return value === "normal" ? "snap-normal" : `snap-${value}`;
		case "interaction.scroll-margin-top":
			return `scroll-mt-${value}`;
		case "interaction.scroll-padding-top":
			return `scroll-pt-${value}`;
		case "interaction.touch-action":
			return value === "auto" ? "touch-auto" : `touch-${value}`;
		case "interaction.will-change":
			return value === "auto" ? "will-change-auto" : `will-change-${value}`;
		default:
			return value;
	}
}
