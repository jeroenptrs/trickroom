import type { ReactNode } from "react";
import { Text } from "./text";

/**
 * A labelled, read-only value displayed in a stamped mono box (e.g. resolved
 * paths, ids, generated config). Optional `action` sits in a divided slot on
 * the right (e.g. a copy button).
 */
function ReadOnlyField({
	label,
	value,
	action,
	className,
}: {
	label?: ReactNode;
	value: ReactNode;
	action?: ReactNode;
	className?: string;
}) {
	return (
		<div
			className={["flex flex-col gap-1.5", className].filter(Boolean).join(" ")}
		>
			{label ? (
				<Text variant="label" tone="foreground">
					{label}
				</Text>
			) : null}
			<div className="flex min-w-0 items-stretch rounded-none bg-slate-50 inset-shadow-[0_0_0_1px] inset-shadow-slate-200">
				<span className="min-w-0 flex-1 truncate px-2 py-1.5 font-mono text-xs text-slate-700">
					{value}
				</span>
				{action ? (
					<div className="flex shrink-0 items-center border-l border-slate-200">
						{action}
					</div>
				) : null}
			</div>
		</div>
	);
}

export { ReadOnlyField };
