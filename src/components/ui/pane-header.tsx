import type { ReactNode } from "react";

/**
 * Shared detail-pane header shell: bordered strip with an eyebrow, a title
 * row (wraps title + status badges), a meta row (mono sublines, diff chips),
 * error lines, and trailing actions. `banner` renders flush to the top edge
 * (e.g. a sync progress bar).
 */
function PaneHeader({
	eyebrow,
	title,
	meta,
	errors,
	actions,
	banner,
}: {
	eyebrow?: ReactNode;
	title: ReactNode;
	meta?: ReactNode;
	errors?: ReactNode;
	actions?: ReactNode;
	banner?: ReactNode;
}) {
	return (
		<header className="relative border-b border-slate-200">
			{banner}
			<div className="flex items-start justify-between gap-4 px-10 pt-8 pb-6">
				<div className="flex min-w-0 flex-1 flex-col gap-1">
					{eyebrow}
					<div className="flex min-w-0 flex-wrap items-center gap-3">
						{title}
					</div>
					{meta ? (
						<div className="flex min-w-0 flex-wrap items-center gap-2">
							{meta}
						</div>
					) : null}
					{errors}
				</div>
				{actions ? (
					<div className="flex shrink-0 items-center gap-2">{actions}</div>
				) : null}
			</div>
		</header>
	);
}

export { PaneHeader };
