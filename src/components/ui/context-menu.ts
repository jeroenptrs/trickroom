import { tv } from "tailwind-variants";

/**
 * Styling slots for a base-ui ContextMenu (trigger + floating popup). Shared by
 * the design-editor and component-draft layer context menus.
 */
const contextMenu = tv({
	slots: {
		trigger: "select-none",
		positioner: "outline-hidden",
		popup:
			"max-h-(--available-height) min-w-25 overflow-y-auto origin-(--transform-origin) transition-opacity data-ending-style:opacity-0 shadow-lg shadow-slate-500/10 bg-slate-50 text-slate-950 inset-shadow-[0_0_0_1px] inset-shadow-slate-200",
		item: "flex max-w-56 cursor-default p-1 text-xs outline-hidden select-none data-disabled:opacity-50 data-highlighted:bg-slate-200 data-highlighted:active:text-cyan-900 data-highlighted:active:bg-cyan-100",
	},
});

export { contextMenu };
