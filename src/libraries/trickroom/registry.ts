import type { LibraryRegistry, RecipeRegistry, Registry } from "../../types";
import { assetIdProp, iconIdProp } from "../../utils/resource-props";
import type { TrickRoomComponents } from "./components";

export const components = {
	asset: {
		role: "leaf",
		label: "Asset",
		description: "System-scoped raster image asset.",
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
			objectFit: {
				label: "Object fit",
				input: "select",
				prop: "objectFit",
				valueType: "string",
				options: [
					{ label: "Cover", value: "cover" },
					{ label: "Contain", value: "contain" },
					{ label: "Fill", value: "fill" },
					{ label: "None", value: "none" },
					{ label: "Scale down", value: "scale-down" },
				],
				visibility: "deprecated",
				deprecationReason:
					"Legacy registry control. Set `object-fit` via `className`.",
			},
			objectPosition: {
				label: "Object position",
				input: "text",
				prop: "objectPosition",
				valueType: "string",
				visibility: "deprecated",
				deprecationReason:
					"Legacy registry control. Set `object-position` via `className`.",
			},
			loading: {
				label: "Loading",
				input: "select",
				prop: "loading",
				valueType: "string",
				options: [
					{ label: "Lazy", value: "lazy" },
					{ label: "Eager", value: "eager" },
				],
				visibility: "deprecated",
				deprecationReason:
					"Legacy registry control. Keep existing values for backward compatibility, but avoid adding it to new assets.",
			},
			decoding: {
				label: "Decoding",
				input: "select",
				prop: "decoding",
				valueType: "string",
				options: [
					{ label: "Async", value: "async" },
					{ label: "Auto", value: "auto" },
					{ label: "Sync", value: "sync" },
				],
				visibility: "deprecated",
				deprecationReason:
					"Legacy registry control. Keep existing values for backward compatibility, but avoid adding it to new assets.",
			},
		},
	},
	container: {
		role: "branch",
		label: "Container",
		description: "Generic layout and grouping element.",
	},
	icon: {
		role: "leaf",
		label: "Icon",
		description: "System-scoped sanitized SVG icon.",
		defaultProps: {
			[iconIdProp]: "",
		},
		controls: {
			iconId: {
				label: "Icon",
				input: "text",
				prop: iconIdProp,
				valueType: "string",
				defaultValue: "",
			},
			ariaLabel: {
				label: "Accessible label",
				input: "text",
				prop: "aria-label",
				valueType: "string",
				defaultValue: "",
			},
		},
	},
	text: {
		role: "text",
		label: "Text",
		description: "Editable text content element.",
	},
} satisfies Registry<TrickRoomComponents>;

export const recipes = {} satisfies RecipeRegistry;

export default {
	components,
	recipes,
} satisfies LibraryRegistry<TrickRoomComponents>;
