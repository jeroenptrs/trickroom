import type { ComponentProps } from "react";
import { tv } from "tailwind-variants/lite";

const { floatingPanel, floatingPanelHeader } = tv({
	slots: {
		floatingPanel:
			"absolute top-3 left-3 z-20 flex max-w-[calc(100%-1.5rem)] flex-col border border-slate-200 bg-white text-xs focus-visible:outline-none",
		floatingPanelHeader: "flex h-12 shrink-0 items-center gap-2 px-3",
	},
})();

/**
 * Small panel floating over the top-left of a workspace, kept on screen in
 * place of a collapsed side panel so its header (title, back navigation,
 * reopen control) stays reachable. Place it in a `relative` container.
 */
function FloatingPanel({ className, ...props }: ComponentProps<"aside">) {
	return (
		<aside
			data-slot="floating-panel"
			className={floatingPanel({ className })}
			{...props}
		/>
	);
}

/** A sidebar-style header row inside a floating panel. */
function FloatingPanelHeader({
	className,
	...props
}: ComponentProps<"header">) {
	return (
		<header
			data-slot="floating-panel-header"
			className={floatingPanelHeader({ className })}
			{...props}
		/>
	);
}

export { FloatingPanel, FloatingPanelHeader };
