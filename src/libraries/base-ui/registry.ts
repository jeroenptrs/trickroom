import type { LibraryRegistry, Registry } from "../../types";
import { assetIdProp } from "../../utils/resource-props";
import type { BaseUiComponents, BaseUiRecipes } from "./components";
import recipes from "./recipes";

const separatorClassName =
	"data-[orientation=vertical]:w-px data-[orientation=vertical]:self-stretch data-[orientation=horizontal]:h-px data-[orientation=horizontal]:w-full";

const orientationOptions = [
	{ label: "Horizontal", value: "horizontal" },
	{ label: "Vertical", value: "vertical" },
];

const sideOptions = [
	{ label: "Top", value: "top" },
	{ label: "Right", value: "right" },
	{ label: "Bottom", value: "bottom" },
	{ label: "Left", value: "left" },
];

const alignOptions = [
	{ label: "Start", value: "start" },
	{ label: "Center", value: "center" },
	{ label: "End", value: "end" },
];

const swipeDirectionOptions = [
	{ label: "Up", value: "up" },
	{ label: "Right", value: "right" },
	{ label: "Down", value: "down" },
	{ label: "Left", value: "left" },
];

const inputTypeOptions = [
	{ label: "Text", value: "text" },
	{ label: "Email", value: "email" },
	{ label: "Password", value: "password" },
	{ label: "Search", value: "search" },
	{ label: "Telephone", value: "tel" },
	{ label: "URL", value: "url" },
	{ label: "Number", value: "number" },
];

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
	"alert-dialog.root": {
		role: "branch",
		label: "Alert Dialog Root",
		description: "Base UI Alert Dialog root.",
		controls: {
			defaultOpen: {
				label: "Default open",
				input: "switch",
				prop: "defaultOpen",
				valueType: "boolean",
				defaultValue: false,
			},
		},
	},
	"alert-dialog.trigger": {
		role: "branch",
		label: "Alert Dialog Trigger",
		description: "Button that opens a Base UI Alert Dialog.",
		defaultProps: {
			type: "button",
		},
	},
	"alert-dialog.portal": {
		role: "branch",
		label: "Alert Dialog Portal",
		description: "Portal host for Base UI Alert Dialog content.",
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
	"alert-dialog.backdrop": {
		role: "leaf",
		label: "Alert Dialog Backdrop",
		description: "Backdrop for a Base UI Alert Dialog.",
	},
	"alert-dialog.viewport": {
		role: "branch",
		label: "Alert Dialog Viewport",
		description: "Viewport for Base UI Alert Dialog content.",
	},
	"alert-dialog.popup": {
		role: "branch",
		label: "Alert Dialog Popup",
		description: "Popup container for a Base UI Alert Dialog.",
	},
	"alert-dialog.title": {
		role: "branch",
		label: "Alert Dialog Title",
		description: "Accessible title for a Base UI Alert Dialog.",
	},
	"alert-dialog.description": {
		role: "branch",
		label: "Alert Dialog Description",
		description: "Accessible description for a Base UI Alert Dialog.",
	},
	"alert-dialog.close": {
		role: "branch",
		label: "Alert Dialog Close",
		description: "Button that closes a Base UI Alert Dialog.",
		defaultProps: {
			type: "button",
		},
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
			type: {
				label: "Type",
				input: "select",
				prop: "type",
				valueType: "string",
				options: [
					{ label: "Button", value: "button" },
					{ label: "Submit", value: "submit" },
					{ label: "Reset", value: "reset" },
				],
				defaultValue: "button",
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
	"checkbox.root": {
		role: "branch",
		label: "Checkbox Root",
		description: "Base UI Checkbox root.",
		defaultProps: {
			value: "checkbox",
		},
		controls: {
			value: {
				label: "Value",
				description:
					"Must be unique among the checkboxes of this group — duplicate values are indistinguishable on submission.",
				input: "text",
				prop: "value",
				valueType: "string",
				defaultValue: "checkbox",
				uniqueAmongSiblings: true,
			},
			defaultChecked: {
				label: "Default checked",
				input: "switch",
				prop: "defaultChecked",
				valueType: "boolean",
				defaultValue: false,
			},
			indeterminate: {
				label: "Indeterminate",
				input: "switch",
				prop: "indeterminate",
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
	"checkbox.indicator": {
		role: "branch",
		label: "Checkbox Indicator",
		description: "Indicator for a Base UI Checkbox.",
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
	"checkbox-group": {
		role: "branch",
		label: "Checkbox Group",
		description: "Base UI Checkbox Group.",
		controls: {
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
	"combobox.root": {
		role: "branch",
		label: "Combobox Root",
		description: "Base UI Combobox root.",
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
			readOnly: {
				label: "Read only",
				input: "switch",
				prop: "readOnly",
				valueType: "boolean",
				defaultValue: false,
			},
		},
	},
	"combobox.label": {
		role: "branch",
		label: "Combobox Label",
		description: "Label for a Base UI Combobox.",
	},
	"combobox.value": {
		role: "branch",
		label: "Combobox Value",
		description: "Displayed value for a Base UI Combobox.",
	},
	"combobox.input": {
		role: "leaf",
		label: "Combobox Input",
		description: "Input for a Base UI Combobox.",
		defaultProps: {
			placeholder: "",
		},
		controls: {
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
	"combobox.input-group": {
		role: "branch",
		label: "Combobox Input Group",
		description: "Input group for a Base UI Combobox.",
	},
	"combobox.trigger": {
		role: "branch",
		label: "Combobox Trigger",
		description: "Button that opens a Base UI Combobox popup.",
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
	"combobox.list": {
		role: "branch",
		label: "Combobox List",
		description: "List container for Base UI Combobox items.",
	},
	"combobox.status": {
		role: "branch",
		label: "Combobox Status",
		description: "Status region for a Base UI Combobox.",
	},
	"combobox.portal": {
		role: "branch",
		label: "Combobox Portal",
		description: "Portal host for a Base UI Combobox popup.",
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
	"combobox.backdrop": {
		role: "leaf",
		label: "Combobox Backdrop",
		description: "Backdrop for a Base UI Combobox popup.",
	},
	"combobox.positioner": {
		role: "branch",
		label: "Combobox Positioner",
		description: "Positions a Base UI Combobox popup.",
		controls: {
			side: {
				label: "Side",
				input: "select",
				prop: "side",
				valueType: "string",
				options: sideOptions,
				defaultValue: "bottom",
			},
			align: {
				label: "Align",
				input: "select",
				prop: "align",
				valueType: "string",
				options: alignOptions,
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
	"combobox.popup": {
		role: "branch",
		label: "Combobox Popup",
		description: "Popup container for Base UI Combobox content.",
	},
	"combobox.arrow": {
		role: "branch",
		label: "Combobox Arrow",
		description: "Arrow element for a Base UI Combobox popup.",
	},
	"combobox.icon": {
		role: "branch",
		label: "Combobox Icon",
		description: "Icon slot for a Base UI Combobox trigger.",
	},
	"combobox.group": {
		role: "branch",
		label: "Combobox Group",
		description: "Group container for Base UI Combobox items.",
	},
	"combobox.group-label": {
		role: "branch",
		label: "Combobox Group Label",
		description: "Label for a Base UI Combobox group.",
	},
	"combobox.item": {
		role: "branch",
		label: "Combobox Item",
		description: "Selectable Base UI Combobox item.",
		defaultProps: {
			value: "item",
		},
		controls: {
			value: {
				label: "Value",
				description:
					"Must be unique among the items of this combobox — duplicate values make items indistinguishable on selection.",
				input: "text",
				prop: "value",
				valueType: "string",
				defaultValue: "item",
				uniqueAmongSiblings: true,
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
	"combobox.item-indicator": {
		role: "branch",
		label: "Combobox Item Indicator",
		description: "Indicator for a selected Base UI Combobox item.",
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
	"combobox.chips": {
		role: "branch",
		label: "Combobox Chips",
		description: "Chip list for a multiple Base UI Combobox.",
	},
	"combobox.chip": {
		role: "branch",
		label: "Combobox Chip",
		description: "Selected item chip for a Base UI Combobox.",
	},
	"combobox.chip-remove": {
		role: "branch",
		label: "Combobox Chip Remove",
		description: "Button that removes a Base UI Combobox chip.",
		defaultProps: {
			type: "button",
		},
	},
	"combobox.row": {
		role: "branch",
		label: "Combobox Row",
		description: "Row wrapper for Base UI Combobox content.",
	},
	"combobox.empty": {
		role: "branch",
		label: "Combobox Empty",
		description: "Empty state for a Base UI Combobox list.",
	},
	"combobox.clear": {
		role: "branch",
		label: "Combobox Clear",
		description: "Button that clears a Base UI Combobox input.",
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
	"combobox.separator": {
		role: "leaf",
		label: "Combobox Separator",
		description: "Separator between Base UI Combobox item groups.",
		baseClassName: separatorClassName,
		defaultProps: {
			orientation: "horizontal",
		},
	},
	"context-menu.root": {
		role: "branch",
		label: "Context Menu Root",
		description: "Base UI Context Menu root.",
	},
	"context-menu.trigger": {
		role: "branch",
		label: "Context Menu Trigger",
		description: "Surface that opens a Base UI Context Menu on right-click.",
	},
	"context-menu.portal": {
		role: "branch",
		label: "Context Menu Portal",
		description: "Portal host for a Base UI Context Menu popup.",
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
	"context-menu.positioner": {
		role: "branch",
		label: "Context Menu Positioner",
		description:
			"Positions a Base UI Context Menu popup against the pointer location.",
		controls: {
			side: {
				label: "Side",
				input: "select",
				prop: "side",
				valueType: "string",
				options: sideOptions,
				defaultValue: "bottom",
			},
			align: {
				label: "Align",
				input: "select",
				prop: "align",
				valueType: "string",
				options: alignOptions,
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
	"context-menu.popup": {
		role: "branch",
		label: "Context Menu Popup",
		description: "Popup container for Base UI Context Menu items.",
	},
	"context-menu.item": {
		role: "branch",
		label: "Context Menu Item",
		description: "Interactive Base UI Context Menu item.",
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
	"context-menu.separator": {
		role: "leaf",
		label: "Context Menu Separator",
		description: "Separator between Base UI Context Menu item groups.",
		baseClassName: separatorClassName,
		defaultProps: {
			orientation: "horizontal",
		},
	},
	"dialog.root": {
		role: "branch",
		label: "Dialog Root",
		description: "Base UI Dialog root.",
		controls: {
			defaultOpen: {
				label: "Default open",
				input: "switch",
				prop: "defaultOpen",
				valueType: "boolean",
				defaultValue: false,
			},
			modal: {
				label: "Modal",
				input: "switch",
				prop: "modal",
				valueType: "boolean",
				defaultValue: true,
			},
			disablePointerDismissal: {
				label: "Disable pointer dismissal",
				input: "switch",
				prop: "disablePointerDismissal",
				valueType: "boolean",
				defaultValue: false,
			},
		},
	},
	"dialog.trigger": {
		role: "branch",
		label: "Dialog Trigger",
		description: "Button that opens a Base UI Dialog.",
		defaultProps: {
			type: "button",
		},
	},
	"dialog.portal": {
		role: "branch",
		label: "Dialog Portal",
		description: "Portal host for Base UI Dialog content.",
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
	"dialog.backdrop": {
		role: "leaf",
		label: "Dialog Backdrop",
		description: "Backdrop for a Base UI Dialog.",
	},
	"dialog.viewport": {
		role: "branch",
		label: "Dialog Viewport",
		description: "Viewport for Base UI Dialog content.",
	},
	"dialog.popup": {
		role: "branch",
		label: "Dialog Popup",
		description: "Popup container for a Base UI Dialog.",
	},
	"dialog.title": {
		role: "branch",
		label: "Dialog Title",
		description: "Accessible title for a Base UI Dialog.",
	},
	"dialog.description": {
		role: "branch",
		label: "Dialog Description",
		description: "Accessible description for a Base UI Dialog.",
	},
	"dialog.close": {
		role: "branch",
		label: "Dialog Close",
		description: "Button that closes a Base UI Dialog.",
		defaultProps: {
			type: "button",
		},
	},
	"drawer.provider": {
		role: "branch",
		label: "Drawer Provider",
		description: "Optional provider for shared Base UI Drawer behavior.",
	},
	"drawer.root": {
		role: "branch",
		label: "Drawer Root",
		description: "Base UI Drawer root.",
		controls: {
			defaultOpen: {
				label: "Default open",
				input: "switch",
				prop: "defaultOpen",
				valueType: "boolean",
				defaultValue: true,
			},
			swipeDirection: {
				label: "Swipe direction",
				input: "select",
				prop: "swipeDirection",
				valueType: "string",
				options: swipeDirectionOptions,
				defaultValue: "down",
			},
		},
	},
	"drawer.trigger": {
		role: "branch",
		label: "Drawer Trigger",
		description: "Button that opens a Base UI Drawer.",
		defaultProps: {
			type: "button",
		},
	},
	"drawer.portal": {
		role: "branch",
		label: "Drawer Portal",
		description: "Portal host for Base UI Drawer content.",
	},
	"drawer.backdrop": {
		role: "leaf",
		label: "Drawer Backdrop",
		description: "Backdrop for a Base UI Drawer.",
	},
	"drawer.viewport": {
		role: "branch",
		label: "Drawer Viewport",
		description: "Viewport for Base UI Drawer content.",
	},
	"drawer.popup": {
		role: "branch",
		label: "Drawer Popup",
		description: "Popup container for a Base UI Drawer.",
	},
	"drawer.content": {
		role: "branch",
		label: "Drawer Content",
		description: "Content wrapper for a Base UI Drawer.",
	},
	"drawer.title": {
		role: "branch",
		label: "Drawer Title",
		description: "Accessible title for a Base UI Drawer.",
	},
	"drawer.description": {
		role: "branch",
		label: "Drawer Description",
		description: "Accessible description for a Base UI Drawer.",
	},
	"drawer.close": {
		role: "branch",
		label: "Drawer Close",
		description: "Button that closes a Base UI Drawer.",
		defaultProps: {
			type: "button",
		},
	},
	"drawer.swipe-area": {
		role: "branch",
		label: "Drawer Swipe Area",
		description: "Swipe handle area for a Base UI Drawer.",
	},
	"drawer.indent": {
		role: "branch",
		label: "Drawer Indent",
		description: "Indent surface for nested Base UI Drawers.",
	},
	"drawer.indent-background": {
		role: "branch",
		label: "Drawer Indent Background",
		description: "Background surface for nested Base UI Drawers.",
	},
	"field.root": {
		role: "branch",
		label: "Field Root",
		description: "Base UI Field root for labels, controls, and messages.",
		controls: {
			disabled: {
				label: "Disabled",
				input: "switch",
				prop: "disabled",
				valueType: "boolean",
				defaultValue: false,
			},
			invalid: {
				label: "Invalid",
				input: "switch",
				prop: "invalid",
				valueType: "boolean",
				defaultValue: false,
			},
			dirty: {
				label: "Dirty",
				input: "switch",
				prop: "dirty",
				valueType: "boolean",
				defaultValue: false,
			},
			touched: {
				label: "Touched",
				input: "switch",
				prop: "touched",
				valueType: "boolean",
				defaultValue: false,
			},
		},
	},
	"field.label": {
		role: "branch",
		label: "Field Label",
		description: "Accessible label for a Base UI Field control.",
	},
	"field.control": {
		role: "leaf",
		label: "Field Control",
		description: "Input control associated with a Base UI Field.",
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
				options: inputTypeOptions,
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
			readOnly: {
				label: "Read only",
				input: "switch",
				prop: "readOnly",
				valueType: "boolean",
				defaultValue: false,
			},
		},
	},
	"field.description": {
		role: "branch",
		label: "Field Description",
		description: "Description text associated with a Base UI Field control.",
	},
	"field.item": {
		role: "branch",
		label: "Field Item",
		description: "Item wrapper for grouped Field controls such as radios.",
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
	"field.error": {
		role: "branch",
		label: "Field Error",
		description: "Error message for a Base UI Field control.",
		controls: {
			match: {
				label: "Match",
				input: "select",
				prop: "match",
				valueType: "string",
				options: [
					{ label: "Valid", value: "valid" },
					{ label: "Bad input", value: "badInput" },
					{ label: "Custom error", value: "customError" },
					{ label: "Pattern mismatch", value: "patternMismatch" },
					{ label: "Range overflow", value: "rangeOverflow" },
					{ label: "Range underflow", value: "rangeUnderflow" },
					{ label: "Step mismatch", value: "stepMismatch" },
					{ label: "Too long", value: "tooLong" },
					{ label: "Too short", value: "tooShort" },
					{ label: "Type mismatch", value: "typeMismatch" },
					{ label: "Value missing", value: "valueMissing" },
				],
				defaultValue: "valueMissing",
			},
		},
	},
	"fieldset.root": {
		role: "branch",
		label: "Fieldset Root",
		description: "Base UI Fieldset root for grouping related controls.",
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
	"fieldset.legend": {
		role: "branch",
		label: "Fieldset Legend",
		description: "Legend for a Base UI Fieldset.",
	},
	form: {
		role: "branch",
		label: "Form",
		description: "Base UI Form root for semantic form structure.",
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
				options: inputTypeOptions,
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
	"meter.root": {
		role: "branch",
		label: "Meter Root",
		description: "Base UI Meter root.",
		defaultProps: {
			value: 50,
			min: 0,
			max: 100,
		},
		controls: {
			value: {
				label: "Value",
				input: "number",
				prop: "value",
				valueType: "number",
				defaultValue: 50,
			},
			min: {
				label: "Min",
				input: "number",
				prop: "min",
				valueType: "number",
				defaultValue: 0,
			},
			max: {
				label: "Max",
				input: "number",
				prop: "max",
				valueType: "number",
				defaultValue: 100,
			},
		},
	},
	"meter.label": {
		role: "branch",
		label: "Meter Label",
		description: "Label for a Base UI Meter.",
	},
	"meter.track": {
		role: "branch",
		label: "Meter Track",
		description: "Track for a Base UI Meter.",
	},
	"meter.indicator": {
		role: "branch",
		label: "Meter Indicator",
		description: "Indicator for a Base UI Meter value.",
	},
	"meter.value": {
		role: "branch",
		label: "Meter Value",
		description: "Formatted value for a Base UI Meter.",
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
	menubar: {
		role: "branch",
		label: "Menubar",
		description:
			"Base UI Menubar that groups menu roots into a horizontal or vertical bar.",
		controls: {
			orientation: {
				label: "Orientation",
				input: "radio",
				prop: "orientation",
				valueType: "string",
				options: orientationOptions,
				defaultValue: "horizontal",
			},
			modal: {
				label: "Modal",
				input: "switch",
				prop: "modal",
				valueType: "boolean",
				defaultValue: true,
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
	"number-field.root": {
		role: "branch",
		label: "Number Field Root",
		description: "Base UI Number Field root.",
		defaultProps: {
			defaultValue: 0,
		},
		controls: {
			defaultValue: {
				label: "Default value",
				input: "number",
				prop: "defaultValue",
				valueType: "number",
				defaultValue: 0,
			},
			min: {
				label: "Min",
				input: "number",
				prop: "min",
				valueType: "number",
			},
			max: {
				label: "Max",
				input: "number",
				prop: "max",
				valueType: "number",
			},
			step: {
				label: "Step",
				input: "number",
				prop: "step",
				valueType: "number",
				defaultValue: 1,
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
	"number-field.group": {
		role: "branch",
		label: "Number Field Group",
		description: "Groups the input with the increment and decrement buttons.",
	},
	"number-field.decrement": {
		role: "branch",
		label: "Number Field Decrement",
		description: "Button that decrements a Base UI Number Field value.",
		defaultProps: {
			type: "button",
		},
	},
	"number-field.input": {
		role: "leaf",
		label: "Number Field Input",
		description: "Input for a Base UI Number Field.",
	},
	"number-field.increment": {
		role: "branch",
		label: "Number Field Increment",
		description: "Button that increments a Base UI Number Field value.",
		defaultProps: {
			type: "button",
		},
	},
	"number-field.scrub-area": {
		role: "branch",
		label: "Number Field Scrub Area",
		description:
			"Area where pointer dragging scrubs a Base UI Number Field value, typically wrapping the label.",
		controls: {
			direction: {
				label: "Direction",
				input: "radio",
				prop: "direction",
				valueType: "string",
				options: orientationOptions,
				defaultValue: "horizontal",
			},
		},
	},
	"number-field.scrub-area-cursor": {
		role: "branch",
		label: "Number Field Scrub Area Cursor",
		description:
			"Custom cursor for a Base UI Number Field scrub area. Only visible while scrubbing.",
	},
	"otp-field.root": {
		role: "branch",
		label: "OTP Field Root",
		description:
			"Base UI OTP Field root that groups character inputs. Keep the length control in sync with the number of OTP Field Input children.",
		defaultProps: {
			length: 6,
		},
		controls: {
			length: {
				label: "Length",
				input: "number",
				prop: "length",
				valueType: "number",
				defaultValue: 6,
			},
			validationType: {
				label: "Validation",
				input: "select",
				prop: "validationType",
				valueType: "string",
				options: [
					{ label: "Numeric", value: "numeric" },
					{ label: "Alpha", value: "alpha" },
					{ label: "Alphanumeric", value: "alphanumeric" },
					{ label: "None", value: "none" },
				],
				defaultValue: "numeric",
			},
			mask: {
				label: "Mask",
				input: "switch",
				prop: "mask",
				valueType: "boolean",
				defaultValue: false,
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
	"otp-field.input": {
		role: "leaf",
		label: "OTP Field Input",
		description: "Individual character input for a Base UI OTP Field.",
	},
	"popover.root": {
		role: "branch",
		label: "Popover Root",
		description: "Root for an accessible popup anchored to a trigger.",
		controls: {
			defaultOpen: {
				label: "Default open",
				input: "switch",
				prop: "defaultOpen",
				valueType: "boolean",
				defaultValue: false,
			},
		},
	},
	"popover.trigger": {
		role: "branch",
		label: "Popover Trigger",
		description: "Button that anchors and opens a Base UI Popover.",
		defaultProps: {
			type: "button",
		},
	},
	"popover.portal": {
		role: "branch",
		label: "Popover Portal",
		description: "Portal host for Base UI Popover content.",
	},
	"popover.backdrop": {
		role: "leaf",
		label: "Popover Backdrop",
		description: "Optional visual backdrop behind a Base UI Popover.",
	},
	"popover.positioner": {
		role: "branch",
		label: "Popover Positioner",
		description:
			"Positions a Base UI Popover against its trigger. Placement controls visibly change the popup layout.",
		controls: {
			side: {
				label: "Side",
				input: "select",
				prop: "side",
				valueType: "string",
				options: sideOptions,
				defaultValue: "bottom",
			},
			align: {
				label: "Align",
				input: "select",
				prop: "align",
				valueType: "string",
				options: alignOptions,
				defaultValue: "center",
			},
			sideOffset: {
				label: "Side offset",
				input: "number",
				prop: "sideOffset",
				valueType: "number",
				defaultValue: 8,
			},
			alignOffset: {
				label: "Align offset",
				input: "number",
				prop: "alignOffset",
				valueType: "number",
				defaultValue: 0,
			},
			arrowPadding: {
				label: "Arrow padding",
				input: "number",
				prop: "arrowPadding",
				valueType: "number",
				defaultValue: 8,
			},
			collisionPadding: {
				label: "Collision padding",
				input: "number",
				prop: "collisionPadding",
				valueType: "number",
				defaultValue: 8,
			},
			sticky: {
				label: "Sticky",
				input: "switch",
				prop: "sticky",
				valueType: "boolean",
				defaultValue: false,
			},
			positionMethod: {
				label: "Position method",
				input: "radio",
				prop: "positionMethod",
				valueType: "string",
				options: [
					{ label: "Absolute", value: "absolute" },
					{ label: "Fixed", value: "fixed" },
				],
				defaultValue: "absolute",
			},
		},
	},
	"popover.popup": {
		role: "branch",
		label: "Popover Popup",
		description: "Popup container for Base UI Popover content.",
	},
	"popover.arrow": {
		role: "branch",
		label: "Popover Arrow",
		description: "Arrow that visually connects a popover to its trigger.",
	},
	"popover.viewport": {
		role: "branch",
		label: "Popover Viewport",
		description:
			"Viewport for animated content transitions between multiple triggers.",
	},
	"popover.title": {
		role: "branch",
		label: "Popover Title",
		description: "Accessible title for a Base UI Popover.",
	},
	"popover.description": {
		role: "branch",
		label: "Popover Description",
		description: "Accessible description for a Base UI Popover.",
	},
	"popover.close": {
		role: "branch",
		label: "Popover Close",
		description: "Button that closes a Base UI Popover.",
		defaultProps: {
			type: "button",
		},
	},
	"preview-card.root": {
		role: "branch",
		label: "Preview Card Root",
		description: "Base UI Preview Card root.",
		controls: {
			defaultOpen: {
				label: "Default open",
				input: "switch",
				prop: "defaultOpen",
				valueType: "boolean",
				defaultValue: false,
			},
		},
	},
	"preview-card.trigger": {
		role: "branch",
		label: "Preview Card Trigger",
		description: "Link that opens a Base UI Preview Card on hover or focus.",
		defaultProps: {
			href: "#",
		},
		controls: {
			href: {
				label: "Href",
				input: "text",
				prop: "href",
				valueType: "string",
				defaultValue: "#",
			},
			delay: {
				label: "Open delay",
				input: "number",
				prop: "delay",
				valueType: "number",
				defaultValue: 600,
			},
			closeDelay: {
				label: "Close delay",
				input: "number",
				prop: "closeDelay",
				valueType: "number",
				defaultValue: 300,
			},
		},
	},
	"preview-card.portal": {
		role: "branch",
		label: "Preview Card Portal",
		description: "Portal host for Base UI Preview Card content.",
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
	"preview-card.backdrop": {
		role: "leaf",
		label: "Preview Card Backdrop",
		description: "Backdrop for a Base UI Preview Card.",
	},
	"preview-card.positioner": {
		role: "branch",
		label: "Preview Card Positioner",
		description:
			"Positions a Base UI Preview Card against its trigger. Placement controls visibly change the popup layout.",
		controls: {
			side: {
				label: "Side",
				input: "select",
				prop: "side",
				valueType: "string",
				options: sideOptions,
				defaultValue: "bottom",
			},
			align: {
				label: "Align",
				input: "select",
				prop: "align",
				valueType: "string",
				options: alignOptions,
				defaultValue: "center",
			},
			sideOffset: {
				label: "Side offset",
				input: "number",
				prop: "sideOffset",
				valueType: "number",
				defaultValue: 8,
			},
			alignOffset: {
				label: "Align offset",
				input: "number",
				prop: "alignOffset",
				valueType: "number",
				defaultValue: 0,
			},
			arrowPadding: {
				label: "Arrow padding",
				input: "number",
				prop: "arrowPadding",
				valueType: "number",
				defaultValue: 8,
			},
			collisionPadding: {
				label: "Collision padding",
				input: "number",
				prop: "collisionPadding",
				valueType: "number",
				defaultValue: 8,
			},
		},
	},
	"preview-card.popup": {
		role: "branch",
		label: "Preview Card Popup",
		description: "Popup container for Base UI Preview Card content.",
	},
	"preview-card.arrow": {
		role: "branch",
		label: "Preview Card Arrow",
		description: "Arrow that visually connects a preview card to its trigger.",
	},
	"preview-card.viewport": {
		role: "branch",
		label: "Preview Card Viewport",
		description:
			"Viewport for animated content transitions between multiple triggers.",
	},
	"progress.root": {
		role: "branch",
		label: "Progress Root",
		description: "Base UI Progress root.",
		defaultProps: {
			value: 50,
			min: 0,
			max: 100,
		},
		controls: {
			value: {
				label: "Value",
				input: "number",
				prop: "value",
				valueType: "number",
				defaultValue: 50,
			},
			min: {
				label: "Min",
				input: "number",
				prop: "min",
				valueType: "number",
				defaultValue: 0,
			},
			max: {
				label: "Max",
				input: "number",
				prop: "max",
				valueType: "number",
				defaultValue: 100,
			},
		},
	},
	"progress.label": {
		role: "branch",
		label: "Progress Label",
		description: "Label for a Base UI Progress bar.",
	},
	"progress.track": {
		role: "branch",
		label: "Progress Track",
		description: "Track for a Base UI Progress bar.",
	},
	"progress.indicator": {
		role: "branch",
		label: "Progress Indicator",
		description: "Indicator for a Base UI Progress value.",
	},
	"progress.value": {
		role: "branch",
		label: "Progress Value",
		description: "Formatted value for a Base UI Progress bar.",
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
				description:
					"Must be unique among the radios of this group — duplicate values check together.",
				input: "text",
				prop: "value",
				valueType: "string",
				defaultValue: "option",
				uniqueAmongSiblings: true,
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
	"scroll-area.root": {
		role: "branch",
		label: "Scroll Area Root",
		description: "Base UI Scroll Area root.",
	},
	"scroll-area.viewport": {
		role: "branch",
		label: "Scroll Area Viewport",
		description: "Viewport for Base UI Scroll Area content.",
	},
	"scroll-area.content": {
		role: "branch",
		label: "Scroll Area Content",
		description: "Scrollable content for a Base UI Scroll Area.",
	},
	"scroll-area.scrollbar": {
		role: "branch",
		label: "Scroll Area Scrollbar",
		description: "Scrollbar for a Base UI Scroll Area.",
		controls: {
			orientation: {
				label: "Orientation",
				input: "radio",
				prop: "orientation",
				valueType: "string",
				options: orientationOptions,
				defaultValue: "vertical",
			},
		},
	},
	"scroll-area.thumb": {
		role: "branch",
		label: "Scroll Area Thumb",
		description: "Scrollbar thumb for a Base UI Scroll Area.",
	},
	"scroll-area.corner": {
		role: "leaf",
		label: "Scroll Area Corner",
		description: "Corner between Base UI Scroll Area scrollbars.",
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
	"select.root": {
		role: "branch",
		label: "Select Root",
		description: "Base UI Select root.",
		controls: {
			defaultOpen: {
				label: "Default open",
				input: "switch",
				prop: "defaultOpen",
				valueType: "boolean",
				defaultValue: false,
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
	"select.label": {
		role: "branch",
		label: "Select Label",
		description: "Label for a Base UI Select.",
	},
	"select.trigger": {
		role: "branch",
		label: "Select Trigger",
		description: "Button that opens a Base UI Select popup.",
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
	"select.value": {
		role: "branch",
		label: "Select Value",
		description: "Displayed value for a Base UI Select.",
	},
	"select.icon": {
		role: "branch",
		label: "Select Icon",
		description: "Icon slot for a Base UI Select trigger.",
	},
	"select.portal": {
		role: "branch",
		label: "Select Portal",
		description: "Portal host for a Base UI Select popup.",
	},
	"select.backdrop": {
		role: "leaf",
		label: "Select Backdrop",
		description: "Backdrop for a Base UI Select popup.",
	},
	"select.positioner": {
		role: "branch",
		label: "Select Positioner",
		description: "Positions a Base UI Select popup.",
		controls: {
			side: {
				label: "Side",
				input: "select",
				prop: "side",
				valueType: "string",
				options: sideOptions,
				defaultValue: "bottom",
			},
			align: {
				label: "Align",
				input: "select",
				prop: "align",
				valueType: "string",
				options: alignOptions,
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
	"select.popup": {
		role: "branch",
		label: "Select Popup",
		description: "Popup container for Base UI Select content.",
	},
	"select.list": {
		role: "branch",
		label: "Select List",
		description: "List container for Base UI Select items.",
	},
	"select.item": {
		role: "branch",
		label: "Select Item",
		description: "Selectable Base UI Select item.",
		defaultProps: {
			value: "item",
		},
		controls: {
			value: {
				label: "Value",
				description:
					"Must be unique among the items of this select — duplicate values make items indistinguishable on selection.",
				input: "text",
				prop: "value",
				valueType: "string",
				defaultValue: "item",
				uniqueAmongSiblings: true,
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
	"select.item-indicator": {
		role: "branch",
		label: "Select Item Indicator",
		description: "Indicator for a selected Base UI Select item.",
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
	"select.item-text": {
		role: "branch",
		label: "Select Item Text",
		description: "Text content for a Base UI Select item.",
	},
	"select.arrow": {
		role: "branch",
		label: "Select Arrow",
		description: "Arrow element for a Base UI Select popup.",
	},
	"select.scroll-down-arrow": {
		role: "branch",
		label: "Select Scroll Down Arrow",
		description: "Down scroll affordance for a Base UI Select list.",
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
	"select.scroll-up-arrow": {
		role: "branch",
		label: "Select Scroll Up Arrow",
		description: "Up scroll affordance for a Base UI Select list.",
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
	"select.group": {
		role: "branch",
		label: "Select Group",
		description: "Group container for Base UI Select items.",
	},
	"select.group-label": {
		role: "branch",
		label: "Select Group Label",
		description: "Label for a Base UI Select group.",
	},
	"select.separator": {
		role: "leaf",
		label: "Select Separator",
		description: "Separator between Base UI Select item groups.",
		baseClassName: separatorClassName,
		defaultProps: {
			orientation: "horizontal",
		},
	},
	"slider.root": {
		role: "branch",
		label: "Slider Root",
		description: "Base UI Slider root.",
		defaultProps: {
			defaultValue: 50,
			min: 0,
			max: 100,
			step: 1,
		},
		controls: {
			defaultValue: {
				label: "Default value",
				input: "number",
				prop: "defaultValue",
				valueType: "number",
				defaultValue: 50,
			},
			min: {
				label: "Min",
				input: "number",
				prop: "min",
				valueType: "number",
				defaultValue: 0,
			},
			max: {
				label: "Max",
				input: "number",
				prop: "max",
				valueType: "number",
				defaultValue: 100,
			},
			step: {
				label: "Step",
				input: "number",
				prop: "step",
				valueType: "number",
				defaultValue: 1,
			},
			orientation: {
				label: "Orientation",
				input: "radio",
				prop: "orientation",
				valueType: "string",
				options: orientationOptions,
				defaultValue: "horizontal",
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
	"slider.label": {
		role: "branch",
		label: "Slider Label",
		description: "Label for a Base UI Slider.",
	},
	"slider.value": {
		role: "branch",
		label: "Slider Value",
		description: "Formatted value for a Base UI Slider.",
	},
	"slider.control": {
		role: "branch",
		label: "Slider Control",
		description: "Control surface for a Base UI Slider.",
	},
	"slider.track": {
		role: "branch",
		label: "Slider Track",
		description: "Track for a Base UI Slider.",
	},
	"slider.thumb": {
		role: "branch",
		label: "Slider Thumb",
		description: "Draggable thumb for a Base UI Slider.",
	},
	"slider.indicator": {
		role: "branch",
		label: "Slider Indicator",
		description: "Filled indicator for a Base UI Slider.",
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
	"tabs.root": {
		role: "branch",
		label: "Tabs Root",
		description: "Base UI Tabs root.",
		controls: {
			defaultValue: {
				label: "Default value",
				input: "text",
				prop: "defaultValue",
				valueType: "string",
				defaultValue: "tab-1",
			},
			orientation: {
				label: "Orientation",
				input: "radio",
				prop: "orientation",
				valueType: "string",
				options: orientationOptions,
				defaultValue: "horizontal",
			},
		},
	},
	"tabs.list": {
		role: "branch",
		label: "Tabs List",
		description: "Tab list for Base UI Tabs.",
	},
	"tabs.tab": {
		role: "branch",
		label: "Tabs Tab",
		description: "Tab trigger for Base UI Tabs.",
		defaultProps: {
			value: "tab",
		},
		controls: {
			value: {
				label: "Value",
				description:
					"Must be unique among sibling tabs — duplicate values activate together and break tab switching. Pair with a Tabs Panel using the same value.",
				input: "text",
				prop: "value",
				valueType: "string",
				defaultValue: "tab",
				uniqueAmongSiblings: true,
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
	"tabs.indicator": {
		role: "branch",
		label: "Tabs Indicator",
		description: "Active tab indicator for Base UI Tabs.",
	},
	"tabs.panel": {
		role: "branch",
		label: "Tabs Panel",
		description: "Panel for Base UI Tabs content.",
		defaultProps: {
			value: "tab",
		},
		controls: {
			value: {
				label: "Value",
				description:
					"Must match the value of exactly one Tabs Tab and be unique among sibling panels.",
				input: "text",
				prop: "value",
				valueType: "string",
				defaultValue: "tab",
				uniqueAmongSiblings: true,
			},
			keepMounted: {
				label: "Keep mounted",
				input: "switch",
				prop: "keepMounted",
				valueType: "boolean",
				defaultValue: false,
			},
		},
	},
	"toolbar.root": {
		role: "branch",
		label: "Toolbar Root",
		description: "Base UI Toolbar root with roving focus across its controls.",
		controls: {
			orientation: {
				label: "Orientation",
				input: "radio",
				prop: "orientation",
				valueType: "string",
				options: orientationOptions,
				defaultValue: "horizontal",
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
	"toolbar.group": {
		role: "branch",
		label: "Toolbar Group",
		description: "Groups related controls inside a Base UI Toolbar.",
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
	"toolbar.button": {
		role: "branch",
		label: "Toolbar Button",
		description: "Button inside a Base UI Toolbar.",
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
	"toolbar.link": {
		role: "branch",
		label: "Toolbar Link",
		description: "Link inside a Base UI Toolbar.",
		defaultProps: {
			href: "#",
		},
		controls: {
			href: {
				label: "Href",
				input: "text",
				prop: "href",
				valueType: "string",
				defaultValue: "#",
			},
		},
	},
	"toolbar.input": {
		role: "leaf",
		label: "Toolbar Input",
		description: "Input inside a Base UI Toolbar.",
		defaultProps: {
			placeholder: "",
		},
		controls: {
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
	"toolbar.separator": {
		role: "leaf",
		label: "Toolbar Separator",
		description:
			"Separator between Base UI Toolbar groups. Orientation is derived perpendicular to the toolbar.",
		baseClassName: separatorClassName,
	},
	"tooltip.provider": {
		role: "branch",
		label: "Tooltip Provider",
		description:
			"Optional shared delay context for descendant tooltips. Place once around an artboard region when multiple tooltip roots should feel grouped.",
		controls: {
			delay: {
				label: "Open delay",
				input: "number",
				prop: "delay",
				valueType: "number",
				defaultValue: 600,
			},
			closeDelay: {
				label: "Close delay",
				input: "number",
				prop: "closeDelay",
				valueType: "number",
				defaultValue: 0,
			},
			timeout: {
				label: "Instant timeout",
				input: "number",
				prop: "timeout",
				valueType: "number",
				defaultValue: 400,
			},
		},
	},
	"tooltip.root": {
		role: "branch",
		label: "Tooltip Root",
		description:
			"Root for one tooltip. It works standalone; wrap multiple tooltip roots in Tooltip Provider only when they should share hover delay behavior.",
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
			disableHoverablePopup: {
				label: "Disable hoverable popup",
				input: "switch",
				prop: "disableHoverablePopup",
				valueType: "boolean",
				defaultValue: false,
			},
			trackCursorAxis: {
				label: "Track cursor",
				input: "select",
				prop: "trackCursorAxis",
				valueType: "string",
				options: [
					{ label: "None", value: "none" },
					{ label: "X", value: "x" },
					{ label: "Y", value: "y" },
					{ label: "Both", value: "both" },
				],
				defaultValue: "none",
			},
		},
	},
	"tooltip.trigger": {
		role: "branch",
		label: "Tooltip Trigger",
		description:
			"Button that anchors and opens one tooltip. Give icon-only triggers an accessible name; the popup is visual help, not the control label.",
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
			delay: {
				label: "Open delay",
				input: "number",
				prop: "delay",
				valueType: "number",
				defaultValue: 600,
			},
			closeDelay: {
				label: "Close delay",
				input: "number",
				prop: "closeDelay",
				valueType: "number",
				defaultValue: 0,
			},
			closeOnClick: {
				label: "Close on click",
				input: "switch",
				prop: "closeOnClick",
				valueType: "boolean",
				defaultValue: true,
			},
		},
	},
	"tooltip.portal": {
		role: "branch",
		label: "Tooltip Portal",
		description:
			"Portal host for a tooltip popup. Keep it inside the same tooltip root as the trigger it describes.",
	},
	"tooltip.positioner": {
		role: "branch",
		label: "Tooltip Positioner",
		description:
			"Positions the tooltip popup against its trigger. Side, alignment, offsets, and collision padding visibly change popup placement.",
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
					{ label: "Inline end", value: "inline-end" },
					{ label: "Inline start", value: "inline-start" },
				],
				defaultValue: "top",
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
				defaultValue: "center",
			},
			sideOffset: {
				label: "Side offset",
				input: "number",
				prop: "sideOffset",
				valueType: "number",
				defaultValue: 0,
			},
			alignOffset: {
				label: "Align offset",
				input: "number",
				prop: "alignOffset",
				valueType: "number",
				defaultValue: 0,
			},
			arrowPadding: {
				label: "Arrow padding",
				input: "number",
				prop: "arrowPadding",
				valueType: "number",
				defaultValue: 5,
			},
			collisionPadding: {
				label: "Collision padding",
				input: "number",
				prop: "collisionPadding",
				valueType: "number",
				defaultValue: 5,
			},
			sticky: {
				label: "Sticky",
				input: "switch",
				prop: "sticky",
				valueType: "boolean",
				defaultValue: false,
			},
			positionMethod: {
				label: "Position method",
				input: "radio",
				prop: "positionMethod",
				valueType: "string",
				options: [
					{ label: "Absolute", value: "absolute" },
					{ label: "Fixed", value: "fixed" },
				],
				defaultValue: "absolute",
			},
		},
	},
	"tooltip.popup": {
		role: "branch",
		label: "Tooltip Popup",
		description:
			"Popup container for supplementary visual help. Do not put required instructions or labels here because tooltips are not available on every input mode.",
	},
	"tooltip.arrow": {
		role: "branch",
		label: "Tooltip Arrow",
		description:
			"Arrow element positioned with the tooltip popup. Use with a positioner so arrow padding can keep it away from rounded corners.",
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
				description:
					"Must be unique among the toggles of a toggle group so the group can track which toggle is pressed.",
				input: "text",
				prop: "value",
				valueType: "string",
				defaultValue: "toggle",
				uniqueAmongSiblings: true,
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
