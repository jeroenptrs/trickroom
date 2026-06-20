/**
 * Token option lists for the size domain's TokenFields (right-rail P2).
 *
 * The numeric scale resolves px through the system's `--spacing` multiplier
 * (Tailwind v4 computes spacing utilities as `calc(var(--spacing) * N)`),
 * `max-w` prepends the container scale from the synced `--container-*`
 * tokens, and aspect ratios come from `--aspect-*` — so the resolved column
 * tracks the synced design system rather than hardcoded defaults.
 */

import { parseBreakpointPx } from "../../../utils/resolved-breakpoints";
import type { StyleProperty } from "../../../utils/tailwind-classname";
import { TAILWIND_DEFAULT_TOKEN_NAME } from "../../../utils/tailwind-token-domains";
import {
	formatPx,
	spacingScaleOptions,
	type TokenFieldOption,
} from "./tokenFieldController";

export type SizeTokenContext = {
	/** Resolved `--spacing` multiplier in px (null = unknown, px column hidden). */
	spacingBasePx: number | null;
	/** Resolved container scale tokens (name → CSS value). */
	containerTokens: ReadonlyMap<string, string>;
	/** Resolved aspect tokens (name → CSS value). */
	aspectTokens: ReadonlyMap<string, string>;
};

/** Resolve the `--spacing` multiplier (px) from the resolved spacing domain. */
export function resolveSpacingBasePx(
	values: ReadonlyMap<string, string>,
): number | null {
	const base = values.get(TAILWIND_DEFAULT_TOKEN_NAME);
	return base ? parseBreakpointPx(base) : null;
}

const FRACTIONS: readonly (readonly [string, string])[] = [
	["1/2", "50%"],
	["1/3", "33.33%"],
	["2/3", "66.67%"],
	["1/4", "25%"],
	["3/4", "75%"],
];

const PX_OPTION: TokenFieldOption = { value: "px", resolved: "1px" };

function keyword(value: string, resolved?: string): TokenFieldOption {
	return resolved ? { value, resolved } : { value };
}

function fractionOptions(): TokenFieldOption[] {
	return FRACTIONS.map(([value, resolved]) => ({ value, resolved }));
}

function contentKeywords(): TokenFieldOption[] {
	return [
		keyword("min", "min-content"),
		keyword("max", "max-content"),
		keyword("fit", "fit-content"),
	];
}

/** Container scale (3xs…7xl) sorted ascending, resolved rem→px. */
function containerScaleOptions(
	tokens: ReadonlyMap<string, string>,
): TokenFieldOption[] {
	return [...tokens.entries()]
		.filter(([name]) => name !== TAILWIND_DEFAULT_TOKEN_NAME)
		.map(([name, value]) => ({ name, value, px: parseBreakpointPx(value) }))
		.sort(
			(a, b) =>
				(a.px ?? Number.POSITIVE_INFINITY) -
					(b.px ?? Number.POSITIVE_INFINITY) || a.name.localeCompare(b.name),
		)
		.map(({ name, value, px }) => ({
			value: name,
			resolved: px !== null ? formatPx(px) : value,
		}));
}

function aspectOptions(
	tokens: ReadonlyMap<string, string>,
): TokenFieldOption[] {
	const named = [...tokens.entries()]
		.filter(([name]) => name !== TAILWIND_DEFAULT_TOKEN_NAME)
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([name, value]) => ({ value: name, resolved: value }));
	// `aspect-square` is a static utility (no token behind it), so it is
	// offered alongside whatever the system's `--aspect-*` tokens define.
	return [keyword("auto"), { value: "square", resolved: "1 / 1" }, ...named];
}

/** Build the dropdown options for one size-domain property. */
export function sizeTokenOptions(
	property: StyleProperty,
	context: SizeTokenContext,
): TokenFieldOption[] {
	const scale = () => [
		...spacingScaleOptions(context.spacingBasePx),
		PX_OPTION,
	];

	switch (property) {
		case "size.width":
			return [
				...scale(),
				...fractionOptions(),
				keyword("auto"),
				keyword("full", "100%"),
				keyword("screen", "100vw"),
				...contentKeywords(),
			];
		case "size.height":
			return [
				...scale(),
				...fractionOptions(),
				keyword("auto"),
				keyword("full", "100%"),
				keyword("screen", "100vh"),
				...contentKeywords(),
			];
		case "size.size":
			return [
				...scale(),
				...fractionOptions(),
				keyword("auto"),
				keyword("full", "100%"),
				...contentKeywords(),
			];
		case "size.min-width":
			return [
				...scale(),
				keyword("auto"),
				keyword("full", "100%"),
				keyword("screen", "100vw"),
				...contentKeywords(),
			];
		case "size.min-height":
			return [
				...scale(),
				keyword("auto"),
				keyword("full", "100%"),
				keyword("screen", "100vh"),
				...contentKeywords(),
			];
		case "size.max-width":
			return [
				...containerScaleOptions(context.containerTokens),
				...scale(),
				keyword("none"),
				keyword("full", "100%"),
				keyword("screen", "100vw"),
				...contentKeywords(),
			];
		case "size.max-height":
			return [
				...scale(),
				keyword("none"),
				keyword("full", "100%"),
				keyword("screen", "100vh"),
				...contentKeywords(),
			];
		case "size.aspect-ratio":
			return aspectOptions(context.aspectTokens);
		case "size.flex-basis":
			return [
				...scale(),
				...fractionOptions(),
				keyword("auto"),
				keyword("full", "100%"),
			];
		default:
			return [];
	}
}
