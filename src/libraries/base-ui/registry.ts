import type { LibraryRegistry, Registry } from "../../types";
import { assetIdProp } from "../../utils/resource-props";
import type { BaseUiComponents, BaseUiRecipes } from "./components";
import recipes from "./recipes";

const separatorClassName =
	"data-[orientation=vertical]:w-px data-[orientation=vertical]:self-stretch data-[orientation=horizontal]:h-px data-[orientation=horizontal]:w-full";

export const components = {
	"avatar.root": {
		role: "branch",
		label: "Avatar Root",
		description: "Base UI Avatar root.",
	},
	"avatar.image": {
		role: "leaf",
		label: "Avatar Image",
		description: "Base UI Avatar image backed by a linked system asset.",
		defaultProps: {
			[assetIdProp]: "",
			alt: "",
			className: "h-full w-full object-cover",
		},
		controls: {
			assetId: {
				label: "Asset",
				input: "text",
				prop: assetIdProp,
				valueType: "string",
				defaultValue: "",
			},
			alt: {
				label: "Alt text",
				input: "text",
				prop: "alt",
				valueType: "string",
				defaultValue: "",
			},
		},
	},
	"avatar.fallback": {
		role: "branch",
		label: "Avatar Fallback",
		description: "Base UI Avatar fallback and recipe slot host.",
	},
	"menu.root": {
		role: "branch",
		label: "Menu Root",
		description: "Base UI Menu root.",
		controls: {
			orientation: {
				label: "Orientation",
				input: "radio",
				prop: "orientation",
				valueType: "string",
				options: [
					{ label: "Vertical", value: "vertical" },
					{ label: "Horizontal", value: "horizontal" },
				],
				defaultValue: "vertical",
			},
			loopFocus: {
				label: "Loop focus",
				input: "switch",
				prop: "loopFocus",
				valueType: "boolean",
				defaultValue: true,
			},
			modal: {
				label: "Modal",
				input: "switch",
				prop: "modal",
				valueType: "boolean",
				defaultValue: true,
			},
			highlightItemOnHover: {
				label: "Highlight on hover",
				input: "switch",
				prop: "highlightItemOnHover",
				valueType: "boolean",
				defaultValue: true,
			},
			disabled: {
				label: "Disabled",
				input: "switch",
				prop: "disabled",
				valueType: "boolean",
				defaultValue: false,
			},
		},
	},
	"menu.trigger": {
		role: "branch",
		label: "Menu Trigger",
		description: "Button that opens a Base UI Menu.",
		defaultProps: {
			type: "button",
		},
		controls: {
			disabled: {
				label: "Disabled",
				input: "switch",
				prop: "disabled",
				valueType: "boolean",
				defaultValue: false,
			},
			openOnHover: {
				label: "Open on hover",
				input: "switch",
				prop: "openOnHover",
				valueType: "boolean",
				defaultValue: false,
			},
			delay: {
				label: "Hover delay",
				input: "number",
				prop: "delay",
				valueType: "number",
				defaultValue: 100,
			},
			closeDelay: {
				label: "Close delay",
				input: "number",
				prop: "closeDelay",
				valueType: "number",
				defaultValue: 0,
			},
		},
	},
	"menu.portal": {
		role: "branch",
		label: "Menu Portal",
		description: "Portal host for a Base UI Menu popup.",
		controls: {
			keepMounted: {
				label: "Keep mounted",
				input: "switch",
				prop: "keepMounted",
				valueType: "boolean",
				defaultValue: false,
			},
		},
	},
	"menu.positioner": {
		role: "branch",
		label: "Menu Positioner",
		description: "Positions a Base UI Menu popup against the trigger.",
		controls: {
			side: {
				label: "Side",
				input: "select",
				prop: "side",
				valueType: "string",
				options: [
					{ label: "Top", value: "top" },
					{ label: "Right", value: "right" },
					{ label: "Bottom", value: "bottom" },
					{ label: "Left", value: "left" },
				],
				defaultValue: "bottom",
			},
			align: {
				label: "Align",
				input: "select",
				prop: "align",
				valueType: "string",
				options: [
					{ label: "Start", value: "start" },
					{ label: "Center", value: "center" },
					{ label: "End", value: "end" },
				],
				defaultValue: "start",
			},
			sideOffset: {
				label: "Side offset",
				input: "number",
				prop: "sideOffset",
				valueType: "number",
				defaultValue: 4,
			},
		},
	},
	"menu.popup": {
		role: "branch",
		label: "Menu Popup",
		description: "Popup container for Base UI Menu items.",
	},
	"menu.item": {
		role: "branch",
		label: "Menu Item",
		description: "Interactive Base UI Menu item.",
		controls: {
			disabled: {
				label: "Disabled",
				input: "switch",
				prop: "disabled",
				valueType: "boolean",
				defaultValue: false,
			},
			closeOnClick: {
				label: "Close on click",
				input: "switch",
				prop: "closeOnClick",
				valueType: "boolean",
				defaultValue: true,
			},
			label: {
				label: "Text navigation label",
				input: "text",
				prop: "label",
				valueType: "string",
				defaultValue: "",
			},
		},
	},
	"menu.separator": {
		role: "leaf",
		label: "Menu Separator",
		description: "Separator between Base UI Menu item groups.",
		defaultProps: {
			className: separatorClassName,
			orientation: "horizontal",
		},
	},
	separator: {
		role: "leaf",
		label: "Separator",
		description: "Divider between content groups.",
		defaultProps: {
			className: separatorClassName,
			orientation: "horizontal",
		},
		controls: {
			orientation: {
				label: "Orientation",
				input: "radio",
				prop: "orientation",
				valueType: "string",
				options: [
					{ label: "Horizontal", value: "horizontal" },
					{ label: "Vertical", value: "vertical" },
				],
				defaultValue: "horizontal",
			},
		},
	},
} satisfies Registry<BaseUiComponents>;

export default {
	components,
	recipes,
} satisfies LibraryRegistry<BaseUiComponents, BaseUiRecipes>;
