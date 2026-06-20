import type { SegmentedOption } from "../components/ui/segmented";
import type { ResolvedFontTokens } from "./resolved-font-tokens";

/** Default stacks always surfaced first when present in the resolved set. */
export const DEFAULT_FONT_FAMILY_ORDER = ["sans", "serif", "mono"] as const;

/**
 * Font-weight utility values. A `--font-*` token with one of these names would
 * emit `font-bold` etc. instead of a family utility — exclude from family picks.
 */
export const FONT_FAMILY_WEIGHT_COLLISION_NAMES = new Set([
	"thin",
	"extralight",
	"light",
	"normal",
	"medium",
	"semibold",
	"bold",
	"extrabold",
	"black",
]);

const DEFAULT_FONT_FAMILY_LABELS: Record<
	(typeof DEFAULT_FONT_FAMILY_ORDER)[number],
	string
> = {
	sans: "Sans",
	serif: "Serif",
	mono: "Mono",
};

export function firstQuotedFontFamily(stack: string): string | null {
	const match = stack.match(/["']([^"']+)["']/);
	const family = match?.[1]?.trim();
	return family && family.length > 0 ? family : null;
}

export function isFontFamilyWeightCollision(tokenName: string): boolean {
	return FONT_FAMILY_WEIGHT_COLLISION_NAMES.has(tokenName);
}

export function orderedFontFamilyNames(names: Iterable<string>): string[] {
	const remaining = new Set(names);
	const ordered: string[] = [];

	for (const name of DEFAULT_FONT_FAMILY_ORDER) {
		if (remaining.delete(name)) {
			ordered.push(name);
		}
	}

	ordered.push(...Array.from(remaining).sort());
	return ordered;
}

export function labelFontFamilyToken(name: string, stack: string): string {
	const defaultLabel =
		DEFAULT_FONT_FAMILY_LABELS[
			name as keyof typeof DEFAULT_FONT_FAMILY_LABELS
		];
	if (defaultLabel) return defaultLabel;

	const quoted = firstQuotedFontFamily(stack);
	if (quoted && quoted.toLowerCase() !== name.toLowerCase()) {
		return quoted;
	}

	return name
		.split("-")
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join(" ");
}

export function buildFontFamilyOptions(
	resolved: ResolvedFontTokens,
): SegmentedOption<string>[] {
	const names = orderedFontFamilyNames(
		[...resolved.names].filter((name) => !isFontFamilyWeightCollision(name)),
	);

	return names.map((value) => {
		const stack = resolved.values.get(value) ?? "";
		return {
			value,
			label: labelFontFamilyToken(value, stack),
			title: stack,
		};
	});
}
