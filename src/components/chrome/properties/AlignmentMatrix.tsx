import { useRef } from "react";
import {
	ALIGN_AXIS_VALUES,
	type AlignAxisValue,
	alignmentCell,
	cellAlignment,
	type FlexAxis,
} from "./alignmentMatrixController";

type AlignmentMatrixProps = {
	/** Main-axis orientation of the container (direction-aware mapping). */
	axis: FlexAxis;
	/** Current justify-content value text, or null when unset. */
	justify: string | null;
	/** Current align-items value text, or null when unset. */
	align: string | null;
	/** A cell was picked; re-picking the selected cell asks to clear both. */
	onSelect: (justify: AlignAxisValue, align: AlignAxisValue) => void;
};

const CELLS = ALIGN_AXIS_VALUES.flatMap((_, row) =>
	ALIGN_AXIS_VALUES.map((_, column) => ({ column, row })),
);

/**
 * 9-dot justify×align matrix (right-rail P4, board 02 marker 4): one glance
 * instead of two segmented rows. Radiogroup semantics with a roving tabindex;
 * arrow keys move and select within the grid. Values the matrix cannot show
 * (between, stretch) leave no cell selected — they live in the distribute
 * menu and the per-property override peeks.
 */
export function AlignmentMatrix({
	axis,
	justify,
	align,
	onSelect,
}: AlignmentMatrixProps) {
	const cellRefs = useRef(new Map<string, HTMLButtonElement>());
	const selected = alignmentCell(axis, justify, align);
	// Roving tabindex home: the selection, or the center cell while unset.
	const focusCell = selected ?? { column: 1, row: 1 };

	function select(column: number, row: number) {
		const next = cellAlignment(axis, column, row);
		onSelect(next.justify, next.align);
		cellRefs.current.get(`${column}:${row}`)?.focus();
	}

	function handleKeyDown(event: React.KeyboardEvent, cell: typeof focusCell) {
		const deltas: Record<string, [number, number]> = {
			ArrowLeft: [-1, 0],
			ArrowRight: [1, 0],
			ArrowUp: [0, -1],
			ArrowDown: [0, 1],
		};
		const delta = deltas[event.key];
		if (!delta) return;
		event.preventDefault();
		const column = Math.min(2, Math.max(0, cell.column + delta[0]));
		const row = Math.min(2, Math.max(0, cell.row + delta[1]));
		if (column !== cell.column || row !== cell.row) {
			select(column, row);
		}
	}

	return (
		<div
			role="radiogroup"
			aria-label="Alignment"
			className="grid w-16 shrink-0 grid-cols-3 gap-px bg-slate-100 p-1"
		>
			{CELLS.map(({ column, row }) => {
				const { justify: cellJustify, align: cellAlign } = cellAlignment(
					axis,
					column,
					row,
				);
				const isSelected = selected?.column === column && selected?.row === row;
				const isFocusHome =
					focusCell.column === column && focusCell.row === row;
				return (
					// biome-ignore lint/a11y/useSemanticElements: native radios cannot carry the spatial dot styling; button + radio role + roving tabindex is the WAI-ARIA-sanctioned equivalent
					<button
						key={`${column}:${row}`}
						ref={(node) => {
							if (node) cellRefs.current.set(`${column}:${row}`, node);
							else cellRefs.current.delete(`${column}:${row}`);
						}}
						type="button"
						role="radio"
						aria-checked={isSelected}
						aria-label={`Justify ${cellJustify}, align ${cellAlign}`}
						title={`Justify ${cellJustify}, align ${cellAlign}`}
						tabIndex={isFocusHome ? 0 : -1}
						onClick={() => select(column, row)}
						onKeyDown={(event) => handleKeyDown(event, { column, row })}
						className={`group/cell flex h-4 items-center justify-center focus-visible:outline-none focus-visible:inset-shadow-[0_0_0_1px] focus-visible:inset-shadow-cyan-500 ${
							isSelected ? "bg-cyan-100" : "bg-white hover:bg-slate-50"
						}`}
					>
						<span
							className={`size-1 ${
								isSelected
									? "bg-cyan-600"
									: "bg-slate-300 group-hover/cell:bg-slate-400"
							}`}
						/>
					</button>
				);
			})}
		</div>
	);
}
