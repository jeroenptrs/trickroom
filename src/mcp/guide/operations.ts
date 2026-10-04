import {
	type DesignOperationName,
	designOperationNameSchema,
	OPERATION_PARAMETER_SIGNATURES,
} from "../design-operations";

/**
 * Purpose and one example per batch operation. Parameter signatures come from
 * OPERATION_PARAMETER_SIGNATURES, the same source the batch tool schemas and
 * INVALID_OPERATION_PARAMETERS errors use, so the topic cannot drift from
 * what the batch accepts.
 */
const OPERATION_GUIDE: Record<
	DesignOperationName,
	{ purpose: string; example: Record<string, unknown> }
> = {
	addSubtree: {
		purpose:
			"Insert a tree of elements, and recipe nodes, in one step. Give nodes a tempId to reference them in later steps. A recipe node takes no children or classes: fill its slots in a later step.",
		example: {
			parentId: "board-id",
			index: 0,
			subtree: {
				tempId: "card",
				library: "trickroom",
				component: "container",
				name: "Card",
				className: "flex flex-col gap-2 rounded-lg border p-4",
				children: [
					{
						tempId: "title",
						library: "trickroom",
						component: "text",
						text: "Card title",
						className: "text-lg font-semibold",
					},
					{
						kind: "recipe",
						tempId: "menu",
						library: "base-ui",
						recipe: "menu.default",
					},
				],
			},
		},
	},
	addElement: {
		purpose:
			"Insert one element. text sets a text element's content; props sets declared controls.",
		example: {
			parentId: "board-id",
			index: 0,
			library: "trickroom",
			component: "text",
			name: "Caption",
			text: "Hello",
			className: "text-sm text-slate-700",
		},
	},
	addRecipe: {
		purpose:
			"Insert an attached recipe instance. The step reports its slot host ids; target them with $step:N:slot:<slot>.",
		example: {
			parentId: "board-id",
			index: 0,
			library: "base-ui",
			recipe: "dialog.default",
		},
	},
	addSystemComponent: {
		purpose:
			"Place an instance of a published system component from the design's design system. Omit version for the current one.",
		example: {
			parentId: "board-id",
			index: 0,
			systemId: "sys_…",
			componentId: "cmp_…",
			variantValues: { tone: "primary", size: "md" },
			overrides: { label: { text: "Save changes" } },
		},
	},
	updateSystemComponentInstance: {
		purpose:
			"Change an attached system component instance: variantValues merges axis values, unsetVariantAxes clears axes, overrides replaces the whole override map.",
		example: {
			rootElementId: "instance-root-id",
			variantValues: { tone: "secondary" },
			overrides: { label: { text: "Cancel" } },
		},
	},
	detachSystemComponent: {
		purpose:
			"Turn a system component instance into plain editable elements. It stops receiving component updates.",
		example: { elementId: "instance-root-id" },
	},
	updateElementProps: {
		purpose:
			'Change an element\'s layer name, className, or declared control props. className replaces the whole class string; "" clears it.',
		example: {
			elementId: "element-id",
			name: "Header",
			className: "flex items-center justify-between gap-4 p-4 md:p-6",
		},
	},
	updateElementText: {
		purpose: "Replace the text of a text element.",
		example: { elementId: "text-element-id", text: "Welcome back" },
	},
	updateRecipeControl: {
		purpose:
			"Set a declared control on an attached recipe instance, addressed by template path and prop.",
		example: {
			instanceId: "recipe-root-id",
			path: "root",
			prop: "defaultOpen",
			value: false,
		},
	},
	updateRecipeInstance: {
		purpose:
			"Migrate a stale attached recipe instance to the current registry template, keeping slot content.",
		example: { elementId: "any-element-in-the-instance" },
	},
	detachRecipeInstance: {
		purpose:
			"Turn an attached recipe instance into plain editable elements. Its structure stops being locked.",
		example: { elementId: "any-element-in-the-instance" },
	},
	moveElement: {
		purpose:
			"Move an element to another parent or position. targetParentId null moves it to the design root (it becomes a board).",
		example: {
			elementId: "element-id",
			targetParentId: "new-parent-id",
			index: 0,
		},
	},
	copySubtree: {
		purpose:
			"Copy an element and its descendants with new ids. Omit sourceDesignFileId to copy within this design; a cross-design copy also needs sourceExpectedRevision.",
		example: { sourceElementId: "card-id", parentId: "list-id", index: 1 },
	},
	deleteElement: {
		purpose: "Delete an element and all its descendants.",
		example: { elementId: "element-id" },
	},
	renameDesignFile: {
		purpose: "Rename the design file. The file id does not change.",
		example: { name: "Checkout flow" },
	},
};

export const buildOperationsTopic = () => ({
	tools:
		"applyDesignOperations({ designFileId, expectedRevision, operations: [{ operation, parameters }], response? }) writes; validateOperationPlan takes the same steps and only dry-runs.",
	conventions: [
		"? marks an optional parameter. primitive = string | number | boolean | null.",
		"parentId null inserts at the design root, which creates a board. index is 0..childCount; childCount appends.",
		"Insertions also accept targetParentId for parentId, and moveElement accepts parentId for targetParentId.",
		"Element id parameters accept $step:N references to elements created by earlier steps (see the step-references topic).",
		"A step that fails reports failedStepIndex and an issue; nothing is written. A parameter error lists the operation's expectedParameters.",
	],
	operations: designOperationNameSchema.options.map((operation) => ({
		operation,
		purpose: OPERATION_GUIDE[operation].purpose,
		parameters: OPERATION_PARAMETER_SIGNATURES[operation],
		example: { operation, parameters: OPERATION_GUIDE[operation].example },
	})),
});
