import { Button as UnstyledButton } from "@base-ui/react/button";
import { Fragment } from "react";
import type { StageLayerCrumb } from "../stage/stage-interaction";

/**
 * The selected layer's ancestors under the inspector header, root first;
 * a crumb selects its layer. Shared by the design and component editors.
 * One line for every selection, a root layer included, so the tabs under it
 * never move; ancestors shrink to an ellipsis when the path runs out of room.
 */
export function LayerBreadcrumb({
	crumbs,
	onSelect,
}: {
	crumbs: readonly StageLayerCrumb[];
	onSelect: (id: string) => void;
}) {
	if (crumbs.length === 0) {
		return null;
	}

	return (
		<nav
			aria-label="Layer path"
			className="flex shrink-0 items-center gap-x-1 overflow-hidden whitespace-nowrap border-b border-slate-200 px-3 py-1 text-xs text-slate-500"
		>
			{crumbs.map((crumb, index) =>
				index === crumbs.length - 1 ? (
					<span
						key={crumb.id}
						aria-current="location"
						className="max-w-full shrink-0 truncate text-slate-950"
					>
						{crumb.name}
					</span>
				) : (
					<Fragment key={crumb.id}>
						<UnstyledButton
							className="min-w-0 max-w-full shrink truncate text-slate-500 hover:text-cyan-700 focus-visible:text-cyan-700 focus-visible:outline-none"
							onClick={() => onSelect(crumb.id)}
						>
							{crumb.name}
						</UnstyledButton>
						<span aria-hidden="true" className="shrink-0">
							/
						</span>
					</Fragment>
				),
			)}
		</nav>
	);
}
