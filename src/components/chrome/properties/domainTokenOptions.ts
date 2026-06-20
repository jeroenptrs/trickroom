/**
 * Token option lists for the non-size TokenField domains (right-rail P2
 * rollout): position offsets, z-index, transform scales, motion timings,
 * named token domains (radius/ease/animate), percent stops, and keyword
 * sets. Sibling of `sizeTokenOptions.ts`, which owns the size domain.
 *
 * Like the spacing scale these are designer-facing curated lists, not
 * exhaustive — off-scale values stay reachable by typing.
 */

import { TAILWIND_DEFAULT_TOKEN_NAME } from "../../../utils/tailwind-token-domains";
import {
	spacingScaleOptions,
	type TokenFieldOption,
} from "./tokenFieldController";

function keyword(value: string, resolved?: string): TokenFieldOption {
	return resolved ? { value, resolved } : { value };
}

const FRACTIONS: readonly (readonly [string, string])[] = [
	["1/2", "50%"],
	["1/3", "33.33%"],
	["2/3", "66.67%"],
	["1/4", "25%"],
	["3/4", "75%"],
];

/**
 * Inset / translate offsets: the spacing scale plus fractions, `full`, and
 * `auto`. Negative values are typed (`-4`) and handled by the callers'
 * utility converters.
 */
export function offsetTokenOptions(
	spacingBasePx: number | null,
): TokenFieldOption[] {
	return [
		...spacingScaleOptions(spacingBasePx),
		keyword("px", "1px"),
		...FRACTIONS.map(([value, resolved]) => ({ value, resolved })),
		keyword("full", "100%"),
		keyword("auto"),
	];
}

/** Plain spacing scale (scroll margins/paddings and other spacing-typed fields). */
export function spacingTokenOptions(
	spacingBasePx: number | null,
): TokenFieldOption[] {
	return [...spacingScaleOptions(spacingBasePx), keyword("px", "1px")];
}

const Z_INDEX_STEPS = ["0", "10", "20", "30", "40", "50"] as const;

export function zIndexTokenOptions(): TokenFieldOption[] {
	return [...Z_INDEX_STEPS.map((step) => keyword(step)), keyword("auto")];
}

const ROTATE_STEPS = [
	"0",
	"1",
	"2",
	"3",
	"6",
	"12",
	"45",
	"90",
	"180",
] as const;

export function rotateTokenOptions(): TokenFieldOption[] {
	return ROTATE_STEPS.map((step) => keyword(step, `${step}deg`));
}

const SKEW_STEPS = ["0", "1", "2", "3", "6", "12"] as const;

export function skewTokenOptions(): TokenFieldOption[] {
	return SKEW_STEPS.map((step) => keyword(step, `${step}deg`));
}

const SCALE_STEPS = [
	"0",
	"50",
	"75",
	"90",
	"95",
	"100",
	"105",
	"110",
	"125",
	"150",
	"200",
] as const;

export function scaleTokenOptions(): TokenFieldOption[] {
	return SCALE_STEPS.map((step) => keyword(step, `${step}%`));
}

const DURATION_STEPS = [
	"75",
	"100",
	"150",
	"200",
	"300",
	"500",
	"700",
	"1000",
] as const;

/** Transition durations and delays, in Tailwind's millisecond steps. */
export function durationTokenOptions(): TokenFieldOption[] {
	return DURATION_STEPS.map((step) => keyword(step, `${step}ms`));
}

/**
 * Gradient / mask stop positions. The value text includes the `%` because
 * that is the utility suffix (`from-50%`, `mask-linear-from-50%`).
 */
const PERCENT_STOPS = [
	"0%",
	"5%",
	"10%",
	"15%",
	"20%",
	"25%",
	"30%",
	"40%",
	"50%",
	"60%",
	"70%",
	"75%",
	"80%",
	"90%",
	"95%",
	"100%",
] as const;

export function percentStopTokenOptions(): TokenFieldOption[] {
	return PERCENT_STOPS.map((stop) => keyword(stop));
}

/**
 * Named token domain (radius, ease, animate, blur, …) as options, resolved to
 * the synced CSS value. `DEFAULT` becomes the given utility value (e.g. the
 * bare `rounded`) when `defaultValue` is provided, and is dropped otherwise.
 */
export function namedDomainTokenOptions(
	tokens: ReadonlyMap<string, string>,
	{ defaultValue }: { defaultValue?: string } = {},
): TokenFieldOption[] {
	const options: TokenFieldOption[] = [];
	for (const [name, value] of tokens) {
		if (name === TAILWIND_DEFAULT_TOKEN_NAME) {
			if (defaultValue !== undefined) {
				options.push({ value: defaultValue, resolved: value });
			}
			continue;
		}
		options.push({ value: name, resolved: value });
	}
	return options;
}

/** Corner radius fields: the synced `--radius` scale plus none/full. */
export function radiusTokenOptions(
	tokens: ReadonlyMap<string, string>,
): TokenFieldOption[] {
	return [
		keyword("none", "0"),
		...namedDomainTokenOptions(tokens),
		keyword("full", "9999px"),
	];
}

/** Easing: the synced `--ease` tokens plus the static `linear` utility. */
export function easingTokenOptions(
	tokens: ReadonlyMap<string, string>,
): TokenFieldOption[] {
	return [keyword("linear", "linear"), ...namedDomainTokenOptions(tokens)];
}

/** Animation: the synced `--animate` tokens plus `none`. */
export function animationTokenOptions(
	tokens: ReadonlyMap<string, string>,
): TokenFieldOption[] {
	return [...namedDomainTokenOptions(tokens), keyword("none")];
}

const BLEND_MODES = [
	"normal",
	"multiply",
	"screen",
	"overlay",
	"darken",
	"lighten",
	"color-dodge",
	"color-burn",
	"hard-light",
	"soft-light",
	"difference",
	"exclusion",
	"hue",
	"saturation",
	"color",
	"luminosity",
] as const;

export function blendModeTokenOptions(): TokenFieldOption[] {
	return BLEND_MODES.map((mode) => keyword(mode));
}

const COLUMN_STEPS = ["1", "2", "3", "4", "5", "6", "8", "10", "12"] as const;

export function columnsTokenOptions(): TokenFieldOption[] {
	return [...COLUMN_STEPS.map((step) => keyword(step)), keyword("auto")];
}
