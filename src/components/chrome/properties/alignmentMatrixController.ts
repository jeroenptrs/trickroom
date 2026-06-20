/**
 * Pure logic for the alignment matrix (right-rail P4): mapping between a
 * 3×3 grid cell and the (justify-content, align-items) pair it represents,
 * direction-aware. In a row flex container the matrix columns are the main
 * axis (justify) and the rows are the cross axis (align); a column container
 * swaps the axes so the matrix always matches what happens on canvas.
 */

export type AlignAxisValue = "start" | "center" | "end";

/** Main-axis orientation the matrix maps against. */
export type FlexAxis = "row" | "col";

export const ALIGN_AXIS_VALUES: readonly AlignAxisValue[] = [
	"start",
	"center",
	"end",
];

/** Justify values the matrix cannot represent; offered by the distribute menu. */
export const DISTRIBUTE_VALUES = ["between", "around", "evenly"] as const;

export type DistributeValue = (typeof DISTRIBUTE_VALUES)[number];

export function isDistributeValue(
	value: string | null,
): value is DistributeValue {
	return (
		value !== null && (DISTRIBUTE_VALUES as readonly string[]).includes(value)
	);
}

/** Normalize a flex-direction value text (`row`, `col-reverse`, …) to its axis. */
export function normalizeFlexAxis(direction: string | null): FlexAxis {
	return direction?.startsWith("col") ? "col" : "row";
}

function isAxisValue(value: string | null): value is AlignAxisValue {
	return (
		value !== null && (ALIGN_AXIS_VALUES as readonly string[]).includes(value)
	);
}

/** The (justify, align) pair a matrix cell writes, given the container axis. */
export function cellAlignment(
	axis: FlexAxis,
	column: number,
	row: number,
): { justify: AlignAxisValue; align: AlignAxisValue } {
	const columnValue = ALIGN_AXIS_VALUES[column];
	const rowValue = ALIGN_AXIS_VALUES[row];
	return axis === "row"
		? { justify: columnValue, align: rowValue }
		: { justify: rowValue, align: columnValue };
}

/**
 * The selected matrix cell for the current values, or null when either value
 * is unset or not a position the matrix can show (between, stretch, …).
 */
export function alignmentCell(
	axis: FlexAxis,
	justify: string | null,
	align: string | null,
): { column: number; row: number } | null {
	if (!isAxisValue(justify) || !isAxisValue(align)) {
		return null;
	}
	const justifyIndex = ALIGN_AXIS_VALUES.indexOf(justify);
	const alignIndex = ALIGN_AXIS_VALUES.indexOf(align);
	return axis === "row"
		? { column: justifyIndex, row: alignIndex }
		: { column: alignIndex, row: justifyIndex };
}
