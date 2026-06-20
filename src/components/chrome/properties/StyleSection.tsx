import { ChevronDown, ChevronRight } from "lucide-react";
import { type ReactNode, useState } from "react";

type StyleSectionProps = {
	title: string;
	/** Right-aligned value summary, shown collapsed or open (e.g. "flex · row"). */
	summary?: string | null;
	defaultOpen?: boolean;
	children: ReactNode;
};

/**
 * Collapsible Style-tab section shell. Matches the right-rail exploration:
 * a header row (disclosure + title + value summary) over a padded body. The
 * dividing rules come from the parent container's `divide-y`.
 */
export function StyleSection({
	title,
	summary,
	defaultOpen = true,
	children,
}: StyleSectionProps) {
	const [open, setOpen] = useState(defaultOpen);
	const Chevron = open ? ChevronDown : ChevronRight;

	return (
		<section className="flex flex-col">
			<button
				type="button"
				onClick={() => setOpen((value) => !value)}
				className="flex items-center justify-between gap-2 px-3 py-2 text-left"
				aria-expanded={open}
			>
				<span className="flex items-center gap-1 text-[11px] font-semibold text-slate-700">
					<Chevron className="size-3 text-slate-400" />
					{title}
				</span>
				{summary ? (
					<span className="min-w-0 truncate text-[10px] text-slate-400">
						{summary}
					</span>
				) : null}
			</button>
			{open ? (
				<div className="flex flex-col gap-2 px-3 pb-3">{children}</div>
			) : null}
		</section>
	);
}
