import type { ReactElement } from "react";
import { Tooltip } from "../ui/tooltip";

/**
 * Says why a disabled control is disabled. A disabled button takes no
 * pointer or focus, so the tooltip hangs on a wrapper that is focusable
 * only while there is a reason to read.
 */
export function DisabledReason({
	reason,
	className,
	children,
}: {
	/** Null while the control is enabled. */
	reason: string | null;
	className?: string;
	children: ReactElement;
}) {
	if (!reason) {
		return children;
	}
	return (
		<Tooltip content={reason}>
			{/* biome-ignore lint/a11y/noNoninteractiveTabindex: the wrapper carries the disabled control's reason to keyboard users. */}
			<span tabIndex={0} className={className}>
				{children}
				<span className="sr-only">{reason}</span>
			</span>
		</Tooltip>
	);
}
