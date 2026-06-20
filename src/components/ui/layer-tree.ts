import { tv } from "tailwind-variants";

/**
 * Styling for the layer-tree rows shared by the design editor (`chrome/Layers`)
 * and the component draft editor (`system-editor/ComponentDraftLayers`). The
 * draft editor uses a subset of the variants (no recipe/component ownership).
 */

/** Disclosure chevron / leaf icon at the start of a layer row. */
const layerChevron = tv({
	base: "size-4 -ml-1 text-slate-400 transition-transform translate-y-px",
	variants: {
		open: {
			true: "rotate-90 -translate-x-px",
		},
		isEditing: {
			true: "-mr-0.5",
		},
		selected: {
			true: "text-cyan-500",
		},
		recipeOwned: {
			true: "text-orange-500",
		},
		componentOwned: {
			true: "text-emerald-500",
		},
	},
	compoundVariants: [
		{
			selected: true,
			recipeOwned: true,
			className: "text-orange-700",
		},
		{
			selected: true,
			componentOwned: true,
			className: "text-emerald-700",
		},
	],
});

/** Drop-target cue rendered during layer drag-and-drop. */
const layerDropIndicator = tv({
	base: "pointer-events-none absolute inset-x-0 z-10",
	variants: {
		intent: {
			before: "-top-px h-0.5 bg-cyan-500",
			after: "-bottom-px h-0.5 bg-cyan-500",
			inside: "inset-y-0 border border-cyan-400 bg-cyan-100/50",
		},
	},
});

/** The layer row itself, with selection, ownership, and drag states. */
const layerRow = tv({
	base: "relative pr-1 flex flex-row items-center leading-5 inset-shadow-[0_0_0_1px]",
	variants: {
		selected: {
			true: "bg-cyan-50 text-cyan-500 inset-shadow-transparent",
			false: "text-slate-950 inset-shadow-transparent hover:bg-slate-200",
		},
		recipeOwned: {
			true: "before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-orange-500 before:content-['']",
		},
		componentOwned: {
			true: "before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-emerald-500 before:content-['']",
		},
		dragging: {
			true: "opacity-40",
		},
	},
	compoundVariants: [
		{
			selected: false,
			recipeOwned: true,
			className:
				"bg-orange-50 text-orange-950 inset-shadow-orange-200 hover:bg-orange-100",
		},
		{
			selected: true,
			recipeOwned: true,
			className:
				"bg-orange-100 text-orange-950 inset-shadow-cyan-400 hover:bg-orange-100",
		},
		{
			selected: false,
			componentOwned: true,
			className:
				"bg-emerald-50 text-emerald-950 inset-shadow-emerald-200 hover:bg-emerald-100",
		},
		{
			selected: true,
			componentOwned: true,
			className:
				"bg-emerald-100 text-emerald-950 inset-shadow-cyan-400 hover:bg-emerald-100",
		},
	],
});

/** Slot-placeholder cue for a recipe-owned slot in the layer tree. */
const recipeSlotCue = tv({
	base: "mr-1 flex size-4 shrink-0 items-center justify-center text-orange-500",
	variants: {
		selected: {
			true: "text-orange-700",
		},
	},
});

/** Slot-placeholder cue for a component-owned slot in the layer tree. */
const componentSlotCue = tv({
	base: "mr-1 flex size-4 shrink-0 items-center justify-center text-emerald-500",
	variants: {
		selected: {
			true: "text-emerald-700",
		},
	},
});

export {
	componentSlotCue,
	layerChevron,
	layerDropIndicator,
	layerRow,
	recipeSlotCue,
};
