import type { RecipeRegistry } from "../../types";
import { assetIdProp } from "../../utils/resource-props";
import type { BaseUiRecipes } from "./components";

const recipes = {
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
} satisfies RecipeRegistry<BaseUiRecipes>;

export default recipes;
