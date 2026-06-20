/**
 * Pure logic for the box-model spacing control (right-rail P4, board 03 "Box
 * model · unlinked"): reading a padding/margin group's effective per-side
 * values out of the PropertyModel, deriving the link state from the class
 * shape, writing one side back into the property that shape dictates, and
 * converting between shapes. The link state mirrors the classes exactly —
 * linked `p-4`, axis-split `px-`/`py-`, per-side `pt-/pr-/pb-/pl-` — so the
 * control never produces a shape you wouldn't write by hand.
 */

import {
	buildPropertyModel,
	type ModelOptions,
	type PropertyEntry,
	type PropertyModel,
	type SpacingProperty,
} from "../../../utils/tailwind-classname";
import {
	applySpacingChange,
	applySpacingClear,
	formatSpacingInputValue,
	parseSpacingInputValue,
} from "./spacingPropertiesController";
import {
	spacingScaleOptions,
	type TokenFieldOption,
} from "./tokenFieldController";

export type BoxModelGroup = "padding" | "margin";

export type BoxSide = "top" | "right" | "bottom" | "left";

export const BOX_SIDES: readonly BoxSide[] = ["top", "right", "bottom", "left"];

/** The class shape the group currently holds (most granular set level wins). */
export type BoxLinkState = "linked" | "axis" | "sides";

type BoxPart = "all" | "x" | "y" | BoxSide;

const BOX_PARTS: readonly BoxPart[] = [
	"all",
	"x",
	"y",
	"top",
	"right",
	"bottom",
	"left",
];

/** Which axis/all properties a side falls back to, most specific first. */
const SIDE_FALLBACKS: Record<BoxSide, readonly BoxPart[]> = {
	top: ["top", "y", "all"],
	right: ["right", "x", "all"],
	bottom: ["bottom", "y", "all"],
	left: ["left", "x", "all"],
};

export function boxProperty(
	group: BoxModelGroup,
	part: BoxPart,
): SpacingProperty {
	return (part === "all" ? group : `${group}-${part}`) as SpacingProperty;
}

/** Every property the box edits, for registration/clear-all sweeps. */
export function boxProperties(group: BoxModelGroup): SpacingProperty[] {
	return BOX_PARTS.map((part) => boxProperty(group, part));
}

export type BoxModelValues = {
	linkState: BoxLinkState;
	/** Effective input value per side (side ?? axis ?? all), null = unset. */
	sides: Record<BoxSide, string | null>;
};

const DEFAULT_MODE = "";

function entryAt(
	model: PropertyModel,
	property: SpacingProperty,
	variantKey: string,
): PropertyEntry | undefined {
	const entry = model.byMode[DEFAULT_MODE]?.byProperty[property]?.[variantKey];
	return entry?.intent.kind === "spacing" ? entry : undefined;
}

/** Read one scope's box values and derive the link state from its class shape. */
export function readBoxModel(
	model: PropertyModel,
	group: BoxModelGroup,
	variantKey: string,
): BoxModelValues {
	const partValues = new Map<BoxPart, string | null>();
	for (const part of BOX_PARTS) {
		const entry = entryAt(model, boxProperty(group, part), variantKey);
		partValues.set(part, entry ? formatSpacingInputValue(entry) : null);
	}

	const anySide = BOX_SIDES.some((side) => partValues.get(side) !== null);
	const anyAxis = partValues.get("x") !== null || partValues.get("y") !== null;
	const linkState: BoxLinkState = anySide
		? "sides"
		: anyAxis
			? "axis"
			: "linked";

	const sides = {} as Record<BoxSide, string | null>;
	for (const side of BOX_SIDES) {
		sides[side] =
			SIDE_FALLBACKS[side]
				.map((part) => partValues.get(part))
				.find((value) => value !== null) ?? null;
	}

	return { linkState, sides };
}

/** The property a side edit writes to under the given link state. */
export function boxWriteProperty(
	group: BoxModelGroup,
	side: BoxSide,
	linkState: BoxLinkState,
): SpacingProperty {
	if (linkState === "linked") return boxProperty(group, "all");
	if (linkState === "axis") {
		return boxProperty(group, side === "top" || side === "bottom" ? "y" : "x");
	}
	return boxProperty(group, side);
}

/**
 * Write one side's raw input (`4`, `auto`, `-2`, `[13px]`, empty = clear)
 * into the property the current link state dictates.
 */
export function writeBoxSide(
	className: string,
	options: ModelOptions,
	group: BoxModelGroup,
	side: BoxSide,
	input: string,
	linkState: BoxLinkState,
	variants: string[],
): string {
	const property = boxWriteProperty(group, side, linkState);
	const parsed = parseSpacingInputValue(input, property);
	if (!parsed) {
		return applySpacingClear(className, options, property, variants);
	}
	return applySpacingChange(className, options, {
		property,
		value: parsed.value,
		negative: parsed.negative,
		variants,
	});
}

export function nextLinkState(state: BoxLinkState): BoxLinkState {
	switch (state) {
		case "linked":
			return "axis";
		case "axis":
			return "sides";
		case "sides":
			return "linked";
	}
}

function firstDefined(values: readonly (string | null)[]): string | null {
	return values.find((value) => value !== null) ?? null;
}

/**
 * Re-shape one scope's classes to the target link state, preserving the
 * effective values: collapsing picks the first defined side in reading order
 * (top, right, bottom, left), so the result is predictable when sides differ
 * — exactly the value the user sees in the top field. One folded mutation.
 */
export function convertBoxShape(
	className: string,
	options: ModelOptions,
	group: BoxModelGroup,
	target: BoxLinkState,
	variants: string[],
): string {
	const variantKey = variants.join(":");
	const { sides } = readBoxModel(
		buildPropertyModel(className, options),
		group,
		variantKey,
	);

	const writes: { part: BoxPart; value: string }[] = [];
	if (target === "linked") {
		const value = firstDefined(BOX_SIDES.map((side) => sides[side]));
		if (value !== null) writes.push({ part: "all", value });
	} else if (target === "axis") {
		const y = firstDefined([sides.top, sides.bottom]);
		const x = firstDefined([sides.left, sides.right]);
		if (y !== null) writes.push({ part: "y", value: y });
		if (x !== null) writes.push({ part: "x", value: x });
	} else {
		for (const side of BOX_SIDES) {
			const value = sides[side];
			if (value !== null) writes.push({ part: side, value });
		}
	}

	let next = className;
	for (const part of BOX_PARTS) {
		next = applySpacingClear(next, options, boxProperty(group, part), variants);
	}
	for (const { part, value } of writes) {
		const property = boxProperty(group, part);
		const parsed = parseSpacingInputValue(value, property);
		if (!parsed) continue;
		next = applySpacingChange(next, options, {
			property,
			value: parsed.value,
			negative: parsed.negative,
			variants,
		});
	}
	return next;
}

const PX_OPTION: TokenFieldOption = { value: "px", resolved: "1px" };

/** Dropdown options for a box-model token field. Margins add `auto`. */
export function boxTokenOptions(
	group: BoxModelGroup,
	spacingBasePx: number | null,
): TokenFieldOption[] {
	const scale = [...spacingScaleOptions(spacingBasePx), PX_OPTION];
	return group === "margin" ? [{ value: "auto" }, ...scale] : scale;
}
