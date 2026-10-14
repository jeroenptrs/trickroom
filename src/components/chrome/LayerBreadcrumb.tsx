import { Button as UnstyledButton } from "@base-ui/react/button";
import { Fragment } from "react";
import type { StageLayerCrumb } from "../stage/stage-interaction";

/**
 * The selected layer's ancestors under the inspector header, root first;
 * a crumb selects its layer. Shared by the design and component editors.
 * Nothing renders for a root layer, which has no ancestors to go to.
 */
export function LayerBreadcrumb({
	crumbs,
	onSelect,
}: {
	crumbs: readonly StageLayerCrumb[];
	onSelect: (id: string) => void;
}) {
	if (crumbs.length < 2) {
		return null;
	}

	return (
		<nav
			aria-label="Layer path"
			className="flex shrink-0 flex-wrap items-center gap-x-1 border-b border-slate-200 px-3 py-1 font-mono text-xs text-slate-400"
		>
			{crumbs.map((crumb, index) =>
				index === crumbs.length - 1 ? (
					<span
						key={crumb.id}
						aria-current="location"
						className="max-w-full truncate text-slate-950"
					>
						{crumb.name}
					</span>
				) : (
					<Fragment key={crumb.id}>
						<UnstyledButton
							className="max-w-full truncate text-slate-500 hover:text-cyan-700 focus-visible:text-cyan-700 focus-visible:outline-none"
							onClick={() => onSelect(crumb.id)}
						>
							{crumb.name}
						</UnstyledButton>
						<span aria-hidden="true">/</span>
					</Fragment>
				),
			)}
		</nav>
	);
}
