import { addElement } from "../../stores/design-store";
import { Button } from "../ui/button";
import { EmptyState } from "../ui/empty-state";

/** Adds an empty container as a board; used when the design has none. */
export function addBoard() {
	addElement(
		{
			"data-trickroom-library": "trickroom",
			"data-trickroom-component": "container",
		},
		null,
		0,
	);
}

/** A design with no boards: says so once, with the one action. */
export function NoBoards({ className }: { className?: string }) {
	return (
		<EmptyState
			size="sm"
			className={className}
			title="No boards yet"
			action={
				<Button
					variant="filled"
					className="px-3 py-1.5 text-xs"
					onClick={addBoard}
				>
					Add a board
				</Button>
			}
		/>
	);
}
