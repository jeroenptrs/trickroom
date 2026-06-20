import type { RecipeRegistry } from "../../types";
import { assetIdProp } from "../../utils/resource-props";
import type { BaseUiRecipes } from "./components";

const recipes = {
	"accordion.default": {
		id: "base-ui/accordion.default",
		label: "Accordion",
		description: "Accordion root with item slot.",
		version: 1,
		root: {
			path: "root",
			library: "base-ui",
			component: "accordion.root",
			slot: "items",
			children: [],
		},
		slots: {
			items: {
				name: "items",
				label: "Items",
				hostPath: "root",
				allowedChildren: [
					{ library: "base-ui", component: "accordion.item" },
					{
						kind: "recipe",
						library: "base-ui",
						recipe: "accordion.item.default",
					},
				],
			},
		},
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
				path: "root",
			},
			disabled: {
				label: "Disabled",
				input: "switch",
				prop: "disabled",
				valueType: "boolean",
				defaultValue: false,
				path: "root",
			},
		},
	},
	"accordion.item.default": {
		id: "base-ui/accordion.item.default",
		label: "Accordion Item",
		description: "Accordion item with trigger and panel slots.",
		version: 1,
		root: {
			path: "root",
			library: "base-ui",
			component: "accordion.item",
			children: [
				{
					path: "header",
					library: "base-ui",
					component: "accordion.header",
					children: [
						{
							path: "trigger",
							library: "base-ui",
							component: "accordion.trigger",
							slot: "trigger",
							children: [],
						},
					],
				},
				{
					path: "panel",
					library: "base-ui",
					component: "accordion.panel",
					slot: "panel",
					children: [],
				},
			],
		},
		slots: {
			trigger: {
				name: "trigger",
				label: "Trigger",
				hostPath: "trigger",
				allowedChildren: undefined,
			},
			panel: {
				name: "panel",
				label: "Panel",
				hostPath: "panel",
				allowedChildren: undefined,
			},
		},
		controls: {
			disabled: {
				label: "Disabled",
				input: "switch",
				prop: "disabled",
				valueType: "boolean",
				defaultValue: false,
				path: "root",
			},
		},
	},
	"avatar.default": {
		id: "base-ui/avatar.default",
		label: "Avatar",
		description: "Avatar composition with image and fallback slot.",
		version: 1,
		root: {
			path: "root",
			library: "base-ui",
			component: "avatar.root",
			children: [
				{
					path: "image",
					library: "base-ui",
					component: "avatar.image",
					props: {
						[assetIdProp]: "",
						alt: "",
					},
				},
				{
					path: "fallback",
					library: "base-ui",
					component: "avatar.fallback",
					slot: "fallback",
					children: [],
				},
			],
		},
		slots: {
			fallback: {
				name: "fallback",
				label: "Fallback",
				hostPath: "fallback",
				allowedChildren: undefined,
			},
		},
	},
	"checkbox.default": {
		id: "base-ui/checkbox.default",
		label: "Checkbox",
		description: "Checkbox with indicator and label slots.",
		version: 1,
		root: {
			path: "root",
			library: "base-ui",
			component: "checkbox.root",
			props: {
				value: "checkbox",
			},
			children: [
				{
					path: "indicator",
					library: "base-ui",
					component: "checkbox.indicator",
					slot: "indicator",
					children: [],
				},
				{
					path: "label",
					library: "trickroom",
					component: "container",
					slot: "label",
					children: [],
				},
			],
		},
		slots: {
			indicator: {
				name: "indicator",
				label: "Indicator",
				hostPath: "indicator",
				allowedChildren: undefined,
				defaultChildren: [
					{
						path: "indicator-mark",
						library: "trickroom",
						component: "text",
						text: "Check",
					},
				],
			},
			label: {
				name: "label",
				label: "Label",
				hostPath: "label",
				allowedChildren: undefined,
				defaultChildren: [
					{
						path: "label-text",
						library: "trickroom",
						component: "text",
						text: "Checkbox",
					},
				],
			},
		},
		controls: {
			defaultChecked: {
				label: "Default checked",
				input: "switch",
				prop: "defaultChecked",
				valueType: "boolean",
				defaultValue: false,
				path: "root",
			},
			indeterminate: {
				label: "Indeterminate",
				input: "switch",
				prop: "indeterminate",
				valueType: "boolean",
				defaultValue: false,
				path: "root",
			},
			disabled: {
				label: "Disabled",
				input: "switch",
				prop: "disabled",
				valueType: "boolean",
				defaultValue: false,
				path: "root",
			},
		},
	},
	"checkbox-group.default": {
		id: "base-ui/checkbox-group.default",
		label: "Checkbox Group",
		description: "Checkbox group with checkbox item slot.",
		version: 1,
		root: {
			path: "root",
			library: "base-ui",
			component: "checkbox-group",
			slot: "items",
			children: [],
		},
		slots: {
			items: {
				name: "items",
				label: "Items",
				hostPath: "root",
				allowedChildren: [
					{ library: "base-ui", component: "checkbox.root" },
					{
						kind: "recipe",
						library: "base-ui",
						recipe: "checkbox.default",
					},
				],
			},
		},
		controls: {
			disabled: {
				label: "Disabled",
				input: "switch",
				prop: "disabled",
				valueType: "boolean",
				defaultValue: false,
				path: "root",
			},
			readOnly: {
				label: "Read only",
				input: "switch",
				prop: "readOnly",
				valueType: "boolean",
				defaultValue: false,
				path: "root",
			},
		},
	},
	"combobox.default": {
		id: "base-ui/combobox.default",
		label: "Combobox",
		description: "Combobox composition with input and option slots.",
		version: 1,
		root: {
			path: "root",
			library: "base-ui",
			component: "combobox.root",
			props: {
				defaultOpen: true,
			},
			children: [
				{
					path: "label",
					library: "base-ui",
					component: "combobox.label",
					slot: "label",
					children: [],
				},
				{
					path: "input-group",
					library: "base-ui",
					component: "combobox.input-group",
					children: [
						{
							path: "input",
							library: "base-ui",
							component: "combobox.input",
							props: {
								placeholder: "Search",
							},
						},
						{
							path: "trigger",
							library: "base-ui",
							component: "combobox.trigger",
							slot: "trigger",
							children: [],
						},
					],
				},
				{
					path: "portal",
					library: "base-ui",
					component: "combobox.portal",
					children: [
						{
							path: "positioner",
							library: "base-ui",
							component: "combobox.positioner",
							props: {
								side: "bottom",
								align: "start",
								sideOffset: 4,
							},
							children: [
								{
									path: "popup",
									library: "base-ui",
									component: "combobox.popup",
									children: [
										{
											path: "list",
											library: "base-ui",
											component: "combobox.list",
											slot: "items",
											children: [],
										},
									],
								},
							],
						},
					],
				},
			],
		},
		slots: {
			label: {
				name: "label",
				label: "Label",
				hostPath: "label",
				allowedChildren: undefined,
				defaultChildren: [
					{
						path: "label-text",
						library: "trickroom",
						component: "text",
						text: "Combobox",
					},
				],
			},
			trigger: {
				name: "trigger",
				label: "Trigger",
				hostPath: "trigger",
				allowedChildren: undefined,
				defaultChildren: [
					{
						path: "trigger-icon",
						library: "trickroom",
						component: "text",
						text: "v",
					},
				],
			},
			items: {
				name: "items",
				label: "Items",
				hostPath: "list",
				allowedChildren: [
					{ library: "base-ui", component: "combobox.item" },
					{ library: "base-ui", component: "combobox.group" },
					{ library: "base-ui", component: "combobox.separator" },
				],
				defaultChildren: [
					{
						path: "item-1",
						library: "base-ui",
						component: "combobox.item",
						props: { value: "option-1" },
						children: [
							{
								path: "item-1-text",
								library: "trickroom",
								component: "text",
								text: "Option 1",
							},
						],
					},
					{
						path: "item-2",
						library: "base-ui",
						component: "combobox.item",
						props: { value: "option-2" },
						children: [
							{
								path: "item-2-text",
								library: "trickroom",
								component: "text",
								text: "Option 2",
							},
						],
					},
				],
			},
		},
		controls: {
			defaultOpen: {
				label: "Default open",
				input: "switch",
				prop: "defaultOpen",
				valueType: "boolean",
				defaultValue: true,
				path: "root",
			},
			placeholder: {
				label: "Placeholder",
				input: "text",
				prop: "placeholder",
				valueType: "string",
				defaultValue: "Search",
				path: "input",
			},
			disabled: {
				label: "Disabled",
				input: "switch",
				prop: "disabled",
				valueType: "boolean",
				defaultValue: false,
				path: "root",
			},
		},
	},
	"collapsible.default": {
		id: "base-ui/collapsible.default",
		label: "Collapsible",
		description: "Collapsible composition with trigger and panel slots.",
		version: 1,
		root: {
			path: "root",
			library: "base-ui",
			component: "collapsible.root",
			children: [
				{
					path: "trigger",
					library: "base-ui",
					component: "collapsible.trigger",
					slot: "trigger",
					children: [],
				},
				{
					path: "panel",
					library: "base-ui",
					component: "collapsible.panel",
					slot: "panel",
					children: [],
				},
			],
		},
		slots: {
			trigger: {
				name: "trigger",
				label: "Trigger",
				hostPath: "trigger",
				allowedChildren: undefined,
			},
			panel: {
				name: "panel",
				label: "Panel",
				hostPath: "panel",
				allowedChildren: undefined,
			},
		},
		controls: {
			defaultOpen: {
				label: "Default open",
				input: "switch",
				prop: "defaultOpen",
				valueType: "boolean",
				defaultValue: false,
				path: "root",
			},
			disabled: {
				label: "Disabled",
				input: "switch",
				prop: "disabled",
				valueType: "boolean",
				defaultValue: false,
				path: "root",
			},
			keepMounted: {
				label: "Keep mounted",
				input: "switch",
				prop: "keepMounted",
				valueType: "boolean",
				defaultValue: false,
				path: "panel",
			},
		},
	},
	"drawer.default": {
		id: "base-ui/drawer.default",
		label: "Drawer",
		description:
			"Drawer composition with trigger, backdrop, content, and close slots.",
		version: 1,
		root: {
			path: "root",
			library: "base-ui",
			component: "drawer.root",
			props: {
				defaultOpen: true,
			},
			children: [
				{
					path: "trigger",
					library: "base-ui",
					component: "drawer.trigger",
					slot: "trigger",
					children: [],
				},
				{
					path: "portal",
					library: "base-ui",
					component: "drawer.portal",
					children: [
						{
							path: "backdrop",
							library: "base-ui",
							component: "drawer.backdrop",
							className: "fixed inset-0 bg-black/20",
						},
						{
							path: "viewport",
							library: "base-ui",
							component: "drawer.viewport",
							children: [
								{
									path: "popup",
									library: "base-ui",
									component: "drawer.popup",
									className:
										"fixed inset-x-0 bottom-0 rounded-t-lg bg-white p-4 shadow-lg",
									children: [
										{
											path: "content",
											library: "base-ui",
											component: "drawer.content",
											slot: "content",
											children: [],
										},
									],
								},
							],
						},
					],
				},
			],
		},
		slots: {
			trigger: {
				name: "trigger",
				label: "Trigger",
				hostPath: "trigger",
				allowedChildren: undefined,
				defaultChildren: [
					{
						path: "trigger-text",
						library: "trickroom",
						component: "text",
						text: "Open drawer",
					},
				],
			},
			content: {
				name: "content",
				label: "Content",
				hostPath: "content",
				allowedChildren: undefined,
				defaultChildren: [
					{
						path: "title",
						library: "base-ui",
						component: "drawer.title",
						children: [
							{
								path: "title-text",
								library: "trickroom",
								component: "text",
								text: "Drawer",
							},
						],
					},
					{
						path: "description",
						library: "base-ui",
						component: "drawer.description",
						children: [
							{
								path: "description-text",
								library: "trickroom",
								component: "text",
								text: "Drawer content",
							},
						],
					},
					{
						path: "close",
						library: "base-ui",
						component: "drawer.close",
						children: [
							{
								path: "close-text",
								library: "trickroom",
								component: "text",
								text: "Close",
							},
						],
					},
				],
			},
		},
		controls: {
			defaultOpen: {
				label: "Default open",
				input: "switch",
				prop: "defaultOpen",
				valueType: "boolean",
				defaultValue: true,
				path: "root",
			},
			swipeDirection: {
				label: "Swipe direction",
				input: "select",
				prop: "swipeDirection",
				valueType: "string",
				options: [
					{ label: "Up", value: "up" },
					{ label: "Right", value: "right" },
					{ label: "Down", value: "down" },
					{ label: "Left", value: "left" },
				],
				defaultValue: "down",
				path: "root",
			},
		},
	},
	"field.default": {
		id: "base-ui/field.default",
		label: "Field",
		description:
			"Field composition with label, control, description, and error.",
		version: 1,
		root: {
			path: "root",
			library: "base-ui",
			component: "field.root",
			children: [
				{
					path: "label",
					library: "base-ui",
					component: "field.label",
					slot: "label",
					children: [],
				},
				{
					path: "control",
					library: "base-ui",
					component: "field.control",
					props: {
						type: "text",
						placeholder: "Placeholder",
					},
				},
				{
					path: "description",
					library: "base-ui",
					component: "field.description",
					slot: "description",
					children: [],
				},
				{
					path: "error",
					library: "base-ui",
					component: "field.error",
					props: {
						match: true,
					},
					slot: "error",
					children: [],
				},
			],
		},
		slots: {
			label: {
				name: "label",
				label: "Label",
				hostPath: "label",
				allowedChildren: undefined,
				defaultChildren: [
					{
						path: "label-text",
						library: "trickroom",
						component: "text",
						text: "Label",
					},
				],
			},
			description: {
				name: "description",
				label: "Description",
				hostPath: "description",
				allowedChildren: undefined,
				defaultChildren: [
					{
						path: "description-text",
						library: "trickroom",
						component: "text",
						text: "Description",
					},
				],
			},
			error: {
				name: "error",
				label: "Error",
				hostPath: "error",
				allowedChildren: undefined,
				defaultChildren: [
					{
						path: "error-text",
						library: "trickroom",
						component: "text",
						text: "Error",
					},
				],
			},
		},
		controls: {
			disabled: {
				label: "Disabled",
				input: "switch",
				prop: "disabled",
				valueType: "boolean",
				defaultValue: false,
				path: "root",
			},
			invalid: {
				label: "Invalid",
				input: "switch",
				prop: "invalid",
				valueType: "boolean",
				defaultValue: false,
				path: "root",
			},
			dirty: {
				label: "Dirty",
				input: "switch",
				prop: "dirty",
				valueType: "boolean",
				defaultValue: false,
				path: "root",
			},
			touched: {
				label: "Touched",
				input: "switch",
				prop: "touched",
				valueType: "boolean",
				defaultValue: false,
				path: "root",
			},
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
				path: "control",
			},
			placeholder: {
				label: "Placeholder",
				input: "text",
				prop: "placeholder",
				valueType: "string",
				defaultValue: "Placeholder",
				path: "control",
			},
			defaultValue: {
				label: "Default value",
				input: "text",
				prop: "defaultValue",
				valueType: "string",
				defaultValue: "",
				path: "control",
			},
			controlDisabled: {
				label: "Control disabled",
				input: "switch",
				prop: "disabled",
				valueType: "boolean",
				defaultValue: false,
				path: "control",
			},
			readOnly: {
				label: "Read only",
				input: "switch",
				prop: "readOnly",
				valueType: "boolean",
				defaultValue: false,
				path: "control",
			},
			match: {
				label: "Error match",
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
				path: "error",
			},
		},
	},
	"fieldset.default": {
		id: "base-ui/fieldset.default",
		label: "Fieldset",
		description: "Fieldset composition with legend and field slots.",
		version: 1,
		root: {
			path: "root",
			library: "base-ui",
			component: "fieldset.root",
			slot: "fields",
			children: [
				{
					path: "legend",
					library: "base-ui",
					component: "fieldset.legend",
					slot: "legend",
					children: [],
				},
			],
		},
		slots: {
			legend: {
				name: "legend",
				label: "Legend",
				hostPath: "legend",
				allowedChildren: undefined,
				defaultChildren: [
					{
						path: "legend-text",
						library: "trickroom",
						component: "text",
						text: "Legend",
					},
				],
			},
			fields: {
				name: "fields",
				label: "Fields",
				hostPath: "root",
				allowedChildren: [
					{ library: "base-ui", component: "field.root" },
					{
						kind: "recipe",
						library: "base-ui",
						recipe: "field.default",
					},
				],
			},
		},
		controls: {
			disabled: {
				label: "Disabled",
				input: "switch",
				prop: "disabled",
				valueType: "boolean",
				defaultValue: false,
				path: "root",
			},
		},
	},
	"form.default": {
		id: "base-ui/form.default",
		label: "Form",
		description: "Semantic form composition with editable content.",
		version: 1,
		root: {
			path: "root",
			library: "base-ui",
			component: "form",
			slot: "content",
			children: [],
		},
		slots: {
			content: {
				name: "content",
				label: "Content",
				hostPath: "root",
				allowedChildren: [
					{ library: "base-ui", component: "field.root" },
					{ library: "base-ui", component: "fieldset.root" },
					{ library: "base-ui", component: "button" },
					{
						kind: "recipe",
						library: "base-ui",
						recipe: "field.default",
					},
					{
						kind: "recipe",
						library: "base-ui",
						recipe: "fieldset.default",
					},
				],
			},
		},
	},
	"meter.default": {
		id: "base-ui/meter.default",
		label: "Meter",
		description: "Meter with label, track, indicator, and value.",
		version: 1,
		root: {
			path: "root",
			library: "base-ui",
			component: "meter.root",
			props: {
				value: 50,
				min: 0,
				max: 100,
			},
			children: [
				{
					path: "label",
					library: "base-ui",
					component: "meter.label",
					slot: "label",
					children: [],
				},
				{
					path: "track",
					library: "base-ui",
					component: "meter.track",
					children: [
						{
							path: "indicator",
							library: "base-ui",
							component: "meter.indicator",
							slot: "indicator",
							children: [],
						},
					],
				},
				{
					path: "value",
					library: "base-ui",
					component: "meter.value",
				},
			],
		},
		slots: {
			label: {
				name: "label",
				label: "Label",
				hostPath: "label",
				allowedChildren: undefined,
				defaultChildren: [
					{
						path: "label-text",
						library: "trickroom",
						component: "text",
						text: "Usage",
					},
				],
			},
			indicator: {
				name: "indicator",
				label: "Indicator",
				hostPath: "indicator",
				allowedChildren: undefined,
			},
		},
		controls: {
			value: {
				label: "Value",
				input: "number",
				prop: "value",
				valueType: "number",
				defaultValue: 50,
				path: "root",
			},
			min: {
				label: "Min",
				input: "number",
				prop: "min",
				valueType: "number",
				defaultValue: 0,
				path: "root",
			},
			max: {
				label: "Max",
				input: "number",
				prop: "max",
				valueType: "number",
				defaultValue: 100,
				path: "root",
			},
		},
	},
	"menu.default": {
		id: "base-ui/menu.default",
		label: "Menu",
		description: "Menu composition with trigger and item slots.",
		version: 1,
		root: {
			path: "root",
			library: "base-ui",
			component: "menu.root",
			children: [
				{
					path: "trigger",
					library: "base-ui",
					component: "menu.trigger",
					slot: "trigger",
					children: [],
				},
				{
					path: "portal",
					library: "base-ui",
					component: "menu.portal",
					children: [
						{
							path: "positioner",
							library: "base-ui",
							component: "menu.positioner",
							children: [
								{
									path: "popup",
									library: "base-ui",
									component: "menu.popup",
									slot: "items",
									children: [],
								},
							],
						},
					],
				},
			],
		},
		slots: {
			trigger: {
				name: "trigger",
				label: "Trigger",
				hostPath: "trigger",
				allowedChildren: undefined,
			},
			items: {
				name: "items",
				label: "Items",
				hostPath: "popup",
				allowedChildren: [
					{ library: "base-ui", component: "menu.item" },
					{ library: "base-ui", component: "menu.separator" },
				],
			},
		},
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
				path: "root",
			},
			loopFocus: {
				label: "Loop focus",
				input: "switch",
				prop: "loopFocus",
				valueType: "boolean",
				defaultValue: true,
				path: "root",
			},
			modal: {
				label: "Modal",
				input: "switch",
				prop: "modal",
				valueType: "boolean",
				defaultValue: true,
				path: "root",
			},
			openOnHover: {
				label: "Open on hover",
				input: "switch",
				prop: "openOnHover",
				valueType: "boolean",
				defaultValue: false,
				path: "trigger",
			},
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
				path: "positioner",
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
				path: "positioner",
			},
			sideOffset: {
				label: "Side offset",
				input: "number",
				prop: "sideOffset",
				valueType: "number",
				defaultValue: 4,
				path: "positioner",
			},
		},
	},
	"radio-group.default": {
		id: "base-ui/radio-group.default",
		label: "Radio Group",
		description: "Radio group with radio item slot.",
		version: 1,
		root: {
			path: "root",
			library: "base-ui",
			component: "radio-group",
			slot: "items",
			children: [],
		},
		slots: {
			items: {
				name: "items",
				label: "Items",
				hostPath: "root",
				allowedChildren: [
					{ library: "base-ui", component: "radio.root" },
					{
						kind: "recipe",
						library: "base-ui",
						recipe: "radio.default",
					},
				],
			},
		},
		controls: {
			name: {
				label: "Name",
				input: "text",
				prop: "name",
				valueType: "string",
				defaultValue: "",
				path: "root",
			},
			defaultValue: {
				label: "Default value",
				input: "text",
				prop: "defaultValue",
				valueType: "string",
				defaultValue: "",
				path: "root",
			},
			disabled: {
				label: "Disabled",
				input: "switch",
				prop: "disabled",
				valueType: "boolean",
				defaultValue: false,
				path: "root",
			},
			readOnly: {
				label: "Read only",
				input: "switch",
				prop: "readOnly",
				valueType: "boolean",
				defaultValue: false,
				path: "root",
			},
			required: {
				label: "Required",
				input: "switch",
				prop: "required",
				valueType: "boolean",
				defaultValue: false,
				path: "root",
			},
		},
	},
	"radio.default": {
		id: "base-ui/radio.default",
		label: "Radio",
		description: "Radio item with indicator slot.",
		version: 1,
		root: {
			path: "root",
			library: "base-ui",
			component: "radio.root",
			props: {
				value: "option",
			},
			children: [
				{
					path: "indicator",
					library: "base-ui",
					component: "radio.indicator",
					slot: "indicator",
					children: [],
				},
			],
		},
		slots: {
			indicator: {
				name: "indicator",
				label: "Indicator",
				hostPath: "indicator",
				allowedChildren: undefined,
			},
		},
		controls: {
			value: {
				label: "Value",
				input: "text",
				prop: "value",
				valueType: "string",
				defaultValue: "option",
				path: "root",
			},
			disabled: {
				label: "Disabled",
				input: "switch",
				prop: "disabled",
				valueType: "boolean",
				defaultValue: false,
				path: "root",
			},
			readOnly: {
				label: "Read only",
				input: "switch",
				prop: "readOnly",
				valueType: "boolean",
				defaultValue: false,
				path: "root",
			},
			required: {
				label: "Required",
				input: "switch",
				prop: "required",
				valueType: "boolean",
				defaultValue: false,
				path: "root",
			},
			keepMounted: {
				label: "Keep mounted",
				input: "switch",
				prop: "keepMounted",
				valueType: "boolean",
				defaultValue: false,
				path: "indicator",
			},
		},
	},
	"scroll-area.default": {
		id: "base-ui/scroll-area.default",
		label: "Scroll Area",
		description: "Scroll area with viewport, content, scrollbar, and thumb.",
		version: 1,
		root: {
			path: "root",
			library: "base-ui",
			component: "scroll-area.root",
			children: [
				{
					path: "viewport",
					library: "base-ui",
					component: "scroll-area.viewport",
					children: [
						{
							path: "content",
							library: "base-ui",
							component: "scroll-area.content",
							slot: "content",
							children: [],
						},
					],
				},
				{
					path: "scrollbar",
					library: "base-ui",
					component: "scroll-area.scrollbar",
					props: {
						orientation: "vertical",
					},
					children: [
						{
							path: "thumb",
							library: "base-ui",
							component: "scroll-area.thumb",
						},
					],
				},
				{
					path: "corner",
					library: "base-ui",
					component: "scroll-area.corner",
				},
			],
		},
		slots: {
			content: {
				name: "content",
				label: "Content",
				hostPath: "content",
				allowedChildren: undefined,
				defaultChildren: [
					{
						path: "content-text",
						library: "trickroom",
						component: "text",
						text: "Scrollable content",
					},
				],
			},
		},
		controls: {
			orientation: {
				label: "Scrollbar orientation",
				input: "radio",
				prop: "orientation",
				valueType: "string",
				options: [
					{ label: "Horizontal", value: "horizontal" },
					{ label: "Vertical", value: "vertical" },
				],
				defaultValue: "vertical",
				path: "scrollbar",
			},
		},
	},
	"select.default": {
		id: "base-ui/select.default",
		label: "Select",
		description: "Select composition with trigger and item slots.",
		version: 1,
		root: {
			path: "root",
			library: "base-ui",
			component: "select.root",
			props: {
				defaultOpen: true,
				defaultValue: "option-1",
			},
			children: [
				{
					path: "label",
					library: "base-ui",
					component: "select.label",
					slot: "label",
					children: [],
				},
				{
					path: "trigger",
					library: "base-ui",
					component: "select.trigger",
					children: [
						{
							path: "value",
							library: "base-ui",
							component: "select.value",
							slot: "value",
							children: [],
						},
						{
							path: "icon",
							library: "base-ui",
							component: "select.icon",
							slot: "icon",
							children: [],
						},
					],
				},
				{
					path: "portal",
					library: "base-ui",
					component: "select.portal",
					children: [
						{
							path: "positioner",
							library: "base-ui",
							component: "select.positioner",
							props: {
								side: "bottom",
								align: "start",
								sideOffset: 4,
							},
							children: [
								{
									path: "popup",
									library: "base-ui",
									component: "select.popup",
									children: [
										{
											path: "list",
											library: "base-ui",
											component: "select.list",
											slot: "items",
											children: [],
										},
									],
								},
							],
						},
					],
				},
			],
		},
		slots: {
			label: {
				name: "label",
				label: "Label",
				hostPath: "label",
				allowedChildren: undefined,
				defaultChildren: [
					{
						path: "label-text",
						library: "trickroom",
						component: "text",
						text: "Select",
					},
				],
			},
			value: {
				name: "value",
				label: "Value",
				hostPath: "value",
				allowedChildren: undefined,
				defaultChildren: [
					{
						path: "value-text",
						library: "trickroom",
						component: "text",
						text: "Choose an option",
					},
				],
			},
			icon: {
				name: "icon",
				label: "Icon",
				hostPath: "icon",
				allowedChildren: undefined,
				defaultChildren: [
					{
						path: "icon-text",
						library: "trickroom",
						component: "text",
						text: "v",
					},
				],
			},
			items: {
				name: "items",
				label: "Items",
				hostPath: "list",
				allowedChildren: [
					{ library: "base-ui", component: "select.item" },
					{ library: "base-ui", component: "select.group" },
					{ library: "base-ui", component: "select.separator" },
				],
				defaultChildren: [
					{
						path: "item-1",
						library: "base-ui",
						component: "select.item",
						props: { value: "option-1" },
						children: [
							{
								path: "item-1-text",
								library: "base-ui",
								component: "select.item-text",
								children: [
									{
										path: "item-1-label",
										library: "trickroom",
										component: "text",
										text: "Option 1",
									},
								],
							},
						],
					},
					{
						path: "item-2",
						library: "base-ui",
						component: "select.item",
						props: { value: "option-2" },
						children: [
							{
								path: "item-2-text",
								library: "base-ui",
								component: "select.item-text",
								children: [
									{
										path: "item-2-label",
										library: "trickroom",
										component: "text",
										text: "Option 2",
									},
								],
							},
						],
					},
				],
			},
		},
		controls: {
			defaultOpen: {
				label: "Default open",
				input: "switch",
				prop: "defaultOpen",
				valueType: "boolean",
				defaultValue: true,
				path: "root",
			},
			defaultValue: {
				label: "Default value",
				input: "text",
				prop: "defaultValue",
				valueType: "string",
				defaultValue: "option-1",
				path: "root",
			},
			disabled: {
				label: "Disabled",
				input: "switch",
				prop: "disabled",
				valueType: "boolean",
				defaultValue: false,
				path: "root",
			},
		},
	},
	"slider.default": {
		id: "base-ui/slider.default",
		label: "Slider",
		description: "Slider with label, value, track, indicator, and thumb.",
		version: 1,
		root: {
			path: "root",
			library: "base-ui",
			component: "slider.root",
			props: {
				defaultValue: 50,
				min: 0,
				max: 100,
				step: 1,
			},
			children: [
				{
					path: "label",
					library: "base-ui",
					component: "slider.label",
					slot: "label",
					children: [],
				},
				{
					path: "value",
					library: "base-ui",
					component: "slider.value",
				},
				{
					path: "control",
					library: "base-ui",
					component: "slider.control",
					children: [
						{
							path: "track",
							library: "base-ui",
							component: "slider.track",
							children: [
								{
									path: "indicator",
									library: "base-ui",
									component: "slider.indicator",
								},
								{
									path: "thumb",
									library: "base-ui",
									component: "slider.thumb",
								},
							],
						},
					],
				},
			],
		},
		slots: {
			label: {
				name: "label",
				label: "Label",
				hostPath: "label",
				allowedChildren: undefined,
				defaultChildren: [
					{
						path: "label-text",
						library: "trickroom",
						component: "text",
						text: "Slider",
					},
				],
			},
		},
		controls: {
			defaultValue: {
				label: "Default value",
				input: "number",
				prop: "defaultValue",
				valueType: "number",
				defaultValue: 50,
				path: "root",
			},
			min: {
				label: "Min",
				input: "number",
				prop: "min",
				valueType: "number",
				defaultValue: 0,
				path: "root",
			},
			max: {
				label: "Max",
				input: "number",
				prop: "max",
				valueType: "number",
				defaultValue: 100,
				path: "root",
			},
			step: {
				label: "Step",
				input: "number",
				prop: "step",
				valueType: "number",
				defaultValue: 1,
				path: "root",
			},
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
				path: "root",
			},
			disabled: {
				label: "Disabled",
				input: "switch",
				prop: "disabled",
				valueType: "boolean",
				defaultValue: false,
				path: "root",
			},
		},
	},
	"switch.default": {
		id: "base-ui/switch.default",
		label: "Switch",
		description: "Switch with thumb slot.",
		version: 1,
		root: {
			path: "root",
			library: "base-ui",
			component: "switch.root",
			children: [
				{
					path: "thumb",
					library: "base-ui",
					component: "switch.thumb",
					slot: "thumb",
					children: [],
				},
			],
		},
		slots: {
			thumb: {
				name: "thumb",
				label: "Thumb",
				hostPath: "thumb",
				allowedChildren: undefined,
			},
		},
		controls: {
			name: {
				label: "Name",
				input: "text",
				prop: "name",
				valueType: "string",
				defaultValue: "",
				path: "root",
			},
			defaultChecked: {
				label: "Default checked",
				input: "switch",
				prop: "defaultChecked",
				valueType: "boolean",
				defaultValue: false,
				path: "root",
			},
			disabled: {
				label: "Disabled",
				input: "switch",
				prop: "disabled",
				valueType: "boolean",
				defaultValue: false,
				path: "root",
			},
			readOnly: {
				label: "Read only",
				input: "switch",
				prop: "readOnly",
				valueType: "boolean",
				defaultValue: false,
				path: "root",
			},
			required: {
				label: "Required",
				input: "switch",
				prop: "required",
				valueType: "boolean",
				defaultValue: false,
				path: "root",
			},
		},
	},
	"tabs.default": {
		id: "base-ui/tabs.default",
		label: "Tabs",
		description: "Tabs with list, indicator, and panel slots.",
		version: 1,
		root: {
			path: "root",
			library: "base-ui",
			component: "tabs.root",
			props: {
				defaultValue: "tab-1",
			},
			children: [
				{
					path: "list",
					library: "base-ui",
					component: "tabs.list",
					children: [
						{
							path: "tab-1",
							library: "base-ui",
							component: "tabs.tab",
							props: { value: "tab-1" },
							slot: "tab-1",
							children: [],
						},
						{
							path: "tab-2",
							library: "base-ui",
							component: "tabs.tab",
							props: { value: "tab-2" },
							slot: "tab-2",
							children: [],
						},
						{
							path: "indicator",
							library: "base-ui",
							component: "tabs.indicator",
						},
					],
				},
				{
					path: "panel-1",
					library: "base-ui",
					component: "tabs.panel",
					props: { value: "tab-1" },
					slot: "panel-1",
					children: [],
				},
				{
					path: "panel-2",
					library: "base-ui",
					component: "tabs.panel",
					props: { value: "tab-2" },
					slot: "panel-2",
					children: [],
				},
			],
		},
		slots: {
			"tab-1": {
				name: "tab-1",
				label: "Tab 1",
				hostPath: "tab-1",
				allowedChildren: undefined,
				defaultChildren: [
					{
						path: "tab-1-text",
						library: "trickroom",
						component: "text",
						text: "Tab 1",
					},
				],
			},
			"tab-2": {
				name: "tab-2",
				label: "Tab 2",
				hostPath: "tab-2",
				allowedChildren: undefined,
				defaultChildren: [
					{
						path: "tab-2-text",
						library: "trickroom",
						component: "text",
						text: "Tab 2",
					},
				],
			},
			"panel-1": {
				name: "panel-1",
				label: "Panel 1",
				hostPath: "panel-1",
				allowedChildren: undefined,
				defaultChildren: [
					{
						path: "panel-1-text",
						library: "trickroom",
						component: "text",
						text: "Panel 1",
					},
				],
			},
			"panel-2": {
				name: "panel-2",
				label: "Panel 2",
				hostPath: "panel-2",
				allowedChildren: undefined,
				defaultChildren: [
					{
						path: "panel-2-text",
						library: "trickroom",
						component: "text",
						text: "Panel 2",
					},
				],
			},
		},
		controls: {
			defaultValue: {
				label: "Default value",
				input: "text",
				prop: "defaultValue",
				valueType: "string",
				defaultValue: "tab-1",
				path: "root",
			},
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
				path: "root",
			},
		},
	},
	"tooltip.default": {
		id: "base-ui/tooltip.default",
		label: "Tooltip Provider",
		description:
			"Optional wrapper for a region that contains multiple tooltips. Add tooltip items anywhere inside the content slot when shared hover timing is useful.",
		version: 1,
		root: {
			path: "root",
			library: "base-ui",
			component: "tooltip.provider",
			slot: "content",
			children: [],
		},
		slots: {
			content: {
				name: "content",
				label: "Content",
				description:
					"General content region. Tooltip items can be nested directly or deep inside this subtree.",
				hostPath: "root",
				allowedChildren: undefined,
				defaultChildren: [
					{
						path: "content",
						library: "trickroom",
						component: "container",
						className: "flex items-center gap-2",
					},
				],
			},
		},
		controls: {
			delay: {
				label: "Open delay",
				description: "Shared delay before descendant tooltips open.",
				input: "number",
				prop: "delay",
				valueType: "number",
				defaultValue: 600,
				path: "root",
			},
			closeDelay: {
				label: "Close delay",
				description: "Shared delay before descendant tooltips close.",
				input: "number",
				prop: "closeDelay",
				valueType: "number",
				defaultValue: 0,
				path: "root",
			},
			timeout: {
				label: "Instant timeout",
				description:
					"Window where another descendant tooltip can open instantly after a tooltip was visible.",
				input: "number",
				prop: "timeout",
				valueType: "number",
				defaultValue: 400,
				path: "root",
			},
		},
	},
	"tooltip.item.default": {
		id: "base-ui/tooltip.item.default",
		label: "Tooltip Item",
		description:
			"One tooltip with trigger and popup slots. Works standalone, or place it inside a Tooltip Provider when multiple tooltips should share hover timing.",
		version: 1,
		root: {
			path: "root",
			library: "base-ui",
			component: "tooltip.root",
			props: {
				defaultOpen: true,
			},
			children: [
				{
					path: "trigger",
					library: "base-ui",
					component: "tooltip.trigger",
					className:
						"inline-flex items-center rounded border border-slate-300 px-2 py-1 text-sm",
					props: {
						type: "button",
					},
					slot: "trigger",
					children: [],
				},
				{
					path: "portal",
					library: "base-ui",
					component: "tooltip.portal",
					children: [
						{
							path: "positioner",
							library: "base-ui",
							component: "tooltip.positioner",
							props: {
								sideOffset: 8,
								arrowPadding: 8,
							},
							children: [
								{
									path: "popup",
									library: "base-ui",
									component: "tooltip.popup",
									className:
										"rounded bg-slate-950 px-2 py-1 text-xs text-white shadow-md",
									slot: "popup",
									children: [],
								},
							],
						},
					],
				},
			],
		},
		slots: {
			trigger: {
				name: "trigger",
				label: "Trigger",
				description:
					"Trigger content. Prefer visible text or an icon/button with an accessible name.",
				hostPath: "trigger",
				allowedChildren: undefined,
				defaultChildren: [
					{
						path: "trigger-label",
						library: "trickroom",
						component: "text",
						text: "Trigger",
					},
				],
			},
			popup: {
				name: "popup",
				label: "Popup",
				description:
					"Supplementary visual help. Keep required labels or instructions outside the tooltip.",
				hostPath: "popup",
				allowedChildren: undefined,
				defaultChildren: [
					{
						path: "arrow",
						library: "base-ui",
						component: "tooltip.arrow",
						className: "size-2 rotate-45 bg-slate-950",
					},
					{
						path: "popup-content",
						library: "trickroom",
						component: "text",
						text: "Tooltip",
					},
				],
			},
		},
		controls: {
			defaultOpen: {
				label: "Default open",
				description:
					"Useful while designing because it makes the popup visible by default.",
				input: "switch",
				prop: "defaultOpen",
				valueType: "boolean",
				defaultValue: true,
				path: "root",
			},
			disabled: {
				label: "Disabled",
				input: "switch",
				prop: "disabled",
				valueType: "boolean",
				defaultValue: false,
				path: "root",
			},
			disableHoverablePopup: {
				label: "Disable hoverable popup",
				input: "switch",
				prop: "disableHoverablePopup",
				valueType: "boolean",
				defaultValue: false,
				path: "root",
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
				path: "root",
			},
			triggerDelay: {
				label: "Open delay",
				input: "number",
				prop: "delay",
				valueType: "number",
				defaultValue: 600,
				path: "trigger",
			},
			triggerCloseDelay: {
				label: "Close delay",
				input: "number",
				prop: "closeDelay",
				valueType: "number",
				defaultValue: 0,
				path: "trigger",
			},
			closeOnClick: {
				label: "Close on click",
				input: "switch",
				prop: "closeOnClick",
				valueType: "boolean",
				defaultValue: true,
				path: "trigger",
			},
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
				path: "positioner",
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
				path: "positioner",
			},
			sideOffset: {
				label: "Side offset",
				input: "number",
				prop: "sideOffset",
				valueType: "number",
				defaultValue: 8,
				path: "positioner",
			},
			alignOffset: {
				label: "Align offset",
				input: "number",
				prop: "alignOffset",
				valueType: "number",
				defaultValue: 0,
				path: "positioner",
			},
			arrowPadding: {
				label: "Arrow padding",
				input: "number",
				prop: "arrowPadding",
				valueType: "number",
				defaultValue: 8,
				path: "positioner",
			},
			collisionPadding: {
				label: "Collision padding",
				input: "number",
				prop: "collisionPadding",
				valueType: "number",
				defaultValue: 5,
				path: "positioner",
			},
			sticky: {
				label: "Sticky",
				input: "switch",
				prop: "sticky",
				valueType: "boolean",
				defaultValue: false,
				path: "positioner",
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
				path: "positioner",
			},
		},
	},
	"toggle-group.default": {
		id: "base-ui/toggle-group.default",
		label: "Toggle Group",
		description: "Toggle group with toggle item slot.",
		version: 1,
		root: {
			path: "root",
			library: "base-ui",
			component: "toggle-group",
			slot: "items",
			children: [],
		},
		slots: {
			items: {
				name: "items",
				label: "Items",
				hostPath: "root",
				allowedChildren: [{ library: "base-ui", component: "toggle" }],
			},
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
				path: "root",
			},
			multiple: {
				label: "Multiple",
				input: "switch",
				prop: "multiple",
				valueType: "boolean",
				defaultValue: false,
				path: "root",
			},
			loopFocus: {
				label: "Loop focus",
				input: "switch",
				prop: "loopFocus",
				valueType: "boolean",
				defaultValue: true,
				path: "root",
			},
			disabled: {
				label: "Disabled",
				input: "switch",
				prop: "disabled",
				valueType: "boolean",
				defaultValue: false,
				path: "root",
			},
		},
	},
} satisfies RecipeRegistry<BaseUiRecipes>;

export default recipes;
