import { tv } from "tailwind-variants";

/**
 * Styling slots for base-ui dropdown Menus (popup + item + group label).
 * Shared by the right-rail's add-override/add-scope, distribute, and color
 * override menus; sibling of context-menu.ts, which styles the layer context
 * menus.
 */
const dropdownMenu = tv({
	slots: {
		popup:
			"flex min-w-28 flex-col bg-slate-50 p-1 inset-shadow-[0_0_0_1px] inset-shadow-slate-200",
		item: "cursor-default px-2 py-0.5 text-left text-xs data-[highlighted]:bg-slate-200/60",
		groupLabel:
			"px-2 pt-1 pb-0.5 text-[9px] uppercase tracking-wide text-slate-400",
	},
});

export { dropdownMenu };
