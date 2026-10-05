import {
	DESIGN_OPERATION_PARAMETERS,
	type DesignOperationName,
	designOperationNameSchema,
	SUBTREE_NODE_SIGNATURE,
} from "../design-operations";
import { TOOL } from "../tool-names";

/**
 * The operations topic, generated from DESIGN_OPERATION_PARAMETERS: the same
 * catalogue that validates batch steps and fills INVALID_OPERATION_PARAMETERS
 * errors, so the topic cannot drift from what the batch accepts. This file
 * adds one purpose line per operation and examples where the per-parameter
 * examples would not make a meaningful call.
 */
const OPERATION_GUIDE: Record<
	DesignOperationName,
	{ purpose: string; example?: Record<string, unknown> }
> = {
	addSubtree: {
		purpose:
			"Insert a tree of elements, and recipe nodes, in one step. Fill a recipe node's slots in a later step.",
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
	addElement: { purpose: "Insert one element." },
	addRecipe: {
		purpose:
			"Insert an attached recipe instance. Target its slots with $step:N:slot:<slot>.",
	},
	addSystemComponent: {
		purpose:
			"Place an instance of a published system component from the design's design system.",
		example: {
			parentId: "board-id",
			index: 0,
			systemId: "sys_…",
			componentId: "cmp_…",
			variantValues: { size: "md" },
			overrides: { label: { text: "Save changes" } },
		},
	},
	updateSystemComponentInstance: {
		purpose:
			"Change an attached system component instance's variant values and overrides.",
		example: {
			rootElementId: "instance-root-id",
			variantValues: { size: "sm" },
			overrides: { label: { text: "Cancel" } },
		},
	},
	detachSystemComponent: {
		purpose:
			"Turn a system component instance into plain editable elements that no longer follow the component.",
	},
	updateElementProps: {
		purpose:
			"Change an element's layer name, className or declared control props. On a recipe element this also sets the recipe's controls at that path.",
		example: {
			elementId: "element-id",
			className: "flex items-center justify-between gap-4 p-4 md:p-6",
		},
	},
	updateElementText: { purpose: "Replace the text of a text element." },
	updateRecipeControl: {
		purpose:
			"Set a declared recipe control. instanceId is any element of the instance ($step:N works) or the recipe instance id; path defaults to that element's template path.",
		example: { instanceId: "$step:0", prop: "defaultOpen", value: false },
	},
	updateRecipeInstance: {
		purpose:
			"Migrate a stale attached recipe instance to the current registry template, keeping slot content.",
	},
	detachRecipeInstance: {
		purpose:
			"Turn an attached recipe instance into plain editable elements; its structure stops being locked.",
	},
	moveElement: {
		purpose:
			"Move an element to another parent or position. Moving to the root makes it a board.",
	},
	copySubtree: {
		purpose: "Copy an element and its descendants with new ids.",
		example: { sourceElementId: "card-id", parentId: "list-id", index: 1 },
	},
	deleteElement: { purpose: "Delete an element and its descendants." },
	renameDesignFile: { purpose: "Rename the design file." },
};

/** Parameters described once in conventions; listed with their type only. */
const SHARED_PARAMETERS = new Set(["parentId", "index"]);

const describeParameters = (operation: DesignOperationName) =>
	Object.fromEntries(
		DESIGN_OPERATION_PARAMETERS[operation].map((parameter) => [
			`${parameter.name}${parameter.required ? "" : "?"}`,
			SHARED_PARAMETERS.has(parameter.name)
				? parameter.type
				: `${parameter.type}. ${parameter.description}`,
		]),
	);

const exampleParameters = (operation: DesignOperationName) =>
	OPERATION_GUIDE[operation].example ??
	Object.fromEntries(
		DESIGN_OPERATION_PARAMETERS[operation]
			.filter((parameter) => parameter.required)
			.map((parameter) => [parameter.name, parameter.example]),
	);

export const buildOperationsTopic = () => ({
	tools: `${TOOL.designApply}({ designFileId, expectedRevision, operations: [{ operation, parameters }], response? }) writes; ${TOOL.designValidate} takes the same steps and only dry-runs.`,
	conventions: [
		"name? marks an optional parameter. primitive = string | number | boolean | null.",
		`Node = ${SUBTREE_NODE_SIGNATURE}`,
		"parentId is the parent element id, or null to insert at the design root, which creates a board; targetParentId is accepted as an alias. index is the position among the parent's children, 0..childCount; childCount appends.",
		"Element id parameters accept $step:N references to elements created by earlier steps (step-references topic).",
		"A failing step reports failedStepIndex and its issues, and nothing is written. A parameter error lists every missing, invalid or unknown parameter.",
	],
	operations: designOperationNameSchema.options.map((operation) => ({
		operation,
		purpose: OPERATION_GUIDE[operation].purpose,
		parameters: describeParameters(operation),
		example: { operation, parameters: exampleParameters(operation) },
	})),
});
