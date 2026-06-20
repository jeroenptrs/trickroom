import type { ResolvedColorTokens } from "../../../utils/resolved-color-tokens";
import type { ColorIntent } from "../../../utils/tailwind-classname";
import type { ColorSwatchAppearance } from "../../ui/color-swatch";

/**
 * Maps a `ColorIntent` (from a parsed Tailwind class) to a presentation-
 * ready `ColorSwatchAppearance`. Encapsulates all of the little rules
 * about how `transparent`, `current`, `inherit`, arbitrary values, and
 * stale tokens should look in the picker UI.
 */
export function appearanceFromIntent(
	intent: ColorIntent,
	resolved: ResolvedColorTokens,
): ColorSwatchAppearance {
	if (intent.keyword === "transparent") {
		return { kind: "transparent" };
	}
	if (intent.keyword === "current" || intent.keyword === "inherit") {
		return { kind: "empty" };
	}
	if (intent.arbitraryValue) {
		// Strip the surrounding `[...]`. The inner CSS may use `_` as
		// a space placeholder per Tailwind's arbitrary-value syntax.
		const inner = intent.arbitraryValue.slice(1, -1).replace(/_/g, " ");
		return { kind: "color", cssValue: inner };
	}
	if (intent.token) {
		const cssValue = resolved.values.get(intent.token);
		if (cssValue) {
			return { kind: "color", cssValue };
		}
		// Token doesn't resolve — render as a warning swatch so the
		// user can clear or replace it.
		return { kind: "color", cssValue: "transparent", warning: true };
	}
	return { kind: "empty" };
}
