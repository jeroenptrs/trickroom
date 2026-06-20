import type { LibraryRegistry, Registry } from "../../types";
import { assetIdProp } from "../../utils/resource-props";
import type { BaseUiComponents, BaseUiRecipes } from "./components";
import recipes from "./recipes";

const separatorClassName =
	"data-[orientation=vertical]:w-px data-[orientation=vertical]:self-stretch data-[orientation=horizontal]:h-px data-[orientation=horizontal]:w-full";

export const components = {
	"accordion.root": {
		role: "branch",
		label: "Accordion Root",
		description: "Base UI Accordion root.",
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
			disabled: {
				label: "Disabled",
				input: "switch",
				prop: "disabled",
				valueType: "boolean",
				defaultValue: false,
			},
		},
	},
	"accordion.item": {
		role: "branch",
		label: "Accordion Item",
		description: "Base UI Accordion item.",
		controls: {
			disabled: {
				label: "Disabled",
				input: "switch",
				prop: "disabled",
				valueType: "boolean",
				defaultValue: false,
			},
		},
	},
	"accordion.header": {
		role: "branch",
		label: "Accordion Header",
		description: "Heading wrapper for a Base UI Accordion trigger.",
	},
	"accordion.trigger": {
		role: "branch",
		label: "Accordion Trigger",
		description: "Button that opens a Base UI Accordion panel.",
		defaultProps: {
			type: "button",
		},
	},
	"accordion.panel": {
		role: "branch",
		label: "Accordion Panel",
		description: "Content panel for a Base UI Accordion item.",
	},
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
	button: {
		role: "branch",
		label: "Button",
		description: "Base UI Button.",
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
		},
	},
	"collapsible.root": {
		role: "branch",
		label: "Collapsible Root",
		description: "Base UI Collapsible root.",
		controls: {
			defaultOpen: {
				label: "Default open",
				input: "switch",
				prop: "defaultOpen",
				valueType: "boolean",
				defaultValue: false,
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
	"collapsible.trigger": {
		role: "branch",
		label: "Collapsible Trigger",
		description: "Button that opens and closes a Base UI Collapsible panel.",
		defaultProps: {
			type: "button",
		},
	},
	"collapsible.panel": {
		role: "branch",
		label: "Collapsible Panel",
		description: "Content panel for a Base UI Collapsible.",
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
	input: {
		role: "leaf",
		label: "Input",
		description: "Base UI Input.",
		defaultProps: {
			type: "text",
			placeholder: "",
		},
		controls: {
			type: {
				label: "Type",
				input: "select",
				prop: "type",
				valueType: "string",
				options: [
					{ label: "Text", value: "text" },
					{ label: "Email", value: "email" },
					{ label: "Password", value: "password" },
					{ label: "Search", value: "search" },
					{ label: "Telephone", value: "tel" },
					{ label: "URL", value: "url" },
					{ label: "Number", value: "number" },
				],
				defaultValue: "text",
			},
			placeholder: {
				label: "Placeholder",
				input: "text",
				prop: "placeholder",
				valueType: "string",
				defaultValue: "",
			},
			defaultValue: {
				label: "Default value",
				input: "text",
				prop: "defaultValue",
				valueType: "string",
				defaultValue: "",
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
		baseClassName: separatorClassName,
		defaultProps: {
			orientation: "horizontal",
		},
	},
	"radio-group": {
		role: "branch",
		label: "Radio Group",
		description: "Base UI Radio Group.",
		controls: {
			name: {
				label: "Name",
				input: "text",
				prop: "name",
				valueType: "string",
				defaultValue: "",
			},
			defaultValue: {
				label: "Default value",
				input: "text",
				prop: "defaultValue",
				valueType: "string",
				defaultValue: "",
			},
			disabled: {
				label: "Disabled",
				input: "switch",
				prop: "disabled",
				valueType: "boolean",
				defaultValue: false,
			},
			readOnly: {
				label: "Read only",
				input: "switch",
				prop: "readOnly",
				valueType: "boolean",
				defaultValue: false,
			},
			required: {
				label: "Required",
				input: "switch",
				prop: "required",
				valueType: "boolean",
				defaultValue: false,
			},
		},
	},
	"radio.root": {
		role: "branch",
		label: "Radio Root",
		description: "Base UI Radio root.",
		defaultProps: {
			value: "option",
		},
		controls: {
			value: {
				label: "Value",
				input: "text",
				prop: "value",
				valueType: "string",
				defaultValue: "option",
			},
			disabled: {
				label: "Disabled",
				input: "switch",
				prop: "disabled",
				valueType: "boolean",
				defaultValue: false,
			},
			readOnly: {
				label: "Read only",
				input: "switch",
				prop: "readOnly",
				valueType: "boolean",
				defaultValue: false,
			},
			required: {
				label: "Required",
				input: "switch",
				prop: "required",
				valueType: "boolean",
				defaultValue: false,
			},
		},
	},
	"radio.indicator": {
		role: "branch",
		label: "Radio Indicator",
		description: "Indicator for a Base UI Radio.",
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
	separator: {
		role: "leaf",
		label: "Separator",
		description: "Divider between content groups.",
		baseClassName: separatorClassName,
		defaultProps: {
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
	"switch.root": {
		role: "branch",
		label: "Switch Root",
		description: "Base UI Switch root.",
		controls: {
			name: {
				label: "Name",
				input: "text",
				prop: "name",
				valueType: "string",
				defaultValue: "",
			},
			defaultChecked: {
				label: "Default checked",
				input: "switch",
				prop: "defaultChecked",
				valueType: "boolean",
				defaultValue: false,
			},
			disabled: {
				label: "Disabled",
				input: "switch",
				prop: "disabled",
				valueType: "boolean",
				defaultValue: false,
			},
			readOnly: {
				label: "Read only",
				input: "switch",
				prop: "readOnly",
				valueType: "boolean",
				defaultValue: false,
			},
			required: {
				label: "Required",
				input: "switch",
				prop: "required",
				valueType: "boolean",
				defaultValue: false,
			},
		},
	},
	"switch.thumb": {
		role: "branch",
		label: "Switch Thumb",
		description: "Movable thumb for a Base UI Switch.",
	},
	toggle: {
		role: "branch",
		label: "Toggle",
		description: "Base UI Toggle.",
		defaultProps: {
			type: "button",
			value: "toggle",
		},
		controls: {
			value: {
				label: "Value",
				input: "text",
				prop: "value",
				valueType: "string",
				defaultValue: "toggle",
			},
			defaultPressed: {
				label: "Default pressed",
				input: "switch",
				prop: "defaultPressed",
				valueType: "boolean",
				defaultValue: false,
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
	"toggle-group": {
		role: "branch",
		label: "Toggle Group",
		description: "Base UI Toggle Group.",
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
			multiple: {
				label: "Multiple",
				input: "switch",
				prop: "multiple",
				valueType: "boolean",
				defaultValue: false,
			},
			loopFocus: {
				label: "Loop focus",
				input: "switch",
				prop: "loopFocus",
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
} satisfies Registry<BaseUiComponents>;

export default {
	components,
	recipes,
} satisfies LibraryRegistry<BaseUiComponents, BaseUiRecipes>;
