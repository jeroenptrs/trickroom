import type {
	CallToolResult,
	ToolAnnotations,
} from "@modelcontextprotocol/sdk/types.js";
import type { z } from "zod";
import type { TrickroomDesign } from "../../types";
import {
	type DesignOperationName,
	OPERATION_PARAMETER_SHAPES,
} from "../design-operations";
import { assertCanWriteDesignFile, getMcpPolicy } from "../governance";
import type { DesignOperationExecution } from "../operation-plan";
import {
	getCompactElementSummary,
	getMutationContext,
} from "../payloads/design-tree";
import { getProjectReference } from "../payloads/project";
import type { TrickroomMcpServerContext } from "../server-types";
import {
	destructiveMutationAnnotations,
	mutationAnnotations,
} from "./annotations";
import type { McpToolContext } from "./context";
import {
	getMutationDiagnostics,
	mutateDesignWithOperation,
	withMutationErrorHandling,
} from "./mutation-support";
import { createJsonResult } from "./results";
import {
	designFileIdSchema,
	expectedRevisionSchema,
	type MutationResponseDetail,
	withMutationScopedInput,
} from "./schemas";

const insertAnnotations = {
	...mutationAnnotations,
	destructiveHint: false,
	idempotentHint: false,
};

type OperationToolInput = {
	designFileId: string;
	expectedRevision: string;
	response?: MutationResponseDetail;
	project?: unknown;
	[parameter: string]: unknown;
};

/** The changed element and its parent/sibling context. */
const describeChangedElement = (execution: DesignOperationExecution) =>
	execution.changedElementId === undefined
		? {}
		: {
				changedElement: getCompactElementSummary(
					execution.design,
					execution.changedElementId,
				),
				context: getMutationContext(
					execution.design,
					execution.changedElementId,
				),
			};

/**
 * Register a single-element write tool as a thin wrapper over the batch
 * operation of the same name: same parameters, same implementation
 * (mutateDesignWithOperation), one write. `respond` adds the tool's
 * operation-specific fields.
 */
const registerOperationTool = <Operation extends DesignOperationName>(
	{ server, withProjectContext }: McpToolContext,
	tool: {
		operation: Operation;
		title: string;
		description: string;
		annotations: ToolAnnotations;
		auditDetails: (
			parameters: Record<string, unknown>,
		) => Record<string, unknown>;
		respond?: (
			execution: DesignOperationExecution,
			before: TrickroomDesign,
			parameters: Record<string, unknown>,
		) => Record<string, unknown>;
	},
) => {
	const shape = OPERATION_PARAMETER_SHAPES[tool.operation] as z.ZodRawShape;
	server.registerTool(
		tool.operation,
		{
			title: tool.title,
			description: tool.description,
			inputSchema: withMutationScopedInput({
				designFileId: designFileIdSchema,
				expectedRevision: expectedRevisionSchema,
				...shape,
			}),
			annotations: tool.annotations,
		},
		(async (input: OperationToolInput) => {
			const {
				designFileId,
				expectedRevision,
				response,
				project,
				...parameters
			} = input;
			return withProjectContext(
				project as Parameters<typeof withProjectContext>[0],
				async (context: TrickroomMcpServerContext) => {
					const policy = getMcpPolicy(context.config);
					return withMutationErrorHandling(
						context,
						{
							toolName: tool.operation,
							operation: tool.operation,
							projectId: context.config.projectId ?? null,
							designFileId,
							expectedRevision,
							details: tool.auditDetails(parameters),
						},
						async () => {
							assertCanWriteDesignFile(policy, designFileId);
							return mutateDesignWithOperation(
								context,
								{ designFileId, expectedRevision },
								tool.operation,
								parameters,
								async (execution, write, before): Promise<CallToolResult> =>
									createJsonResult({
										status: "success",
										project: getProjectReference(context),
										newRevision: write.revision,
										...(tool.respond
											? tool.respond(execution, before, parameters)
											: describeChangedElement(execution)),
										...(await getMutationDiagnostics(
											context,
											write.design,
											response,
											execution.affectedElementIds,
										)),
									}),
							);
						},
					);
				},
			);
		}) as never,
	);
};

export const registerDesignNodeInsertTools = (ctx: McpToolContext) => {
	registerOperationTool(ctx, {
		operation: "addElement",
		title: "Add Element",
		description:
			"Create a new registry element inside a design file. Requires expectedRevision from a prior read.",
		annotations: insertAnnotations,
		auditDetails: ({ library, component, parentId }) => ({
			componentRef: `${library}/${component}`,
			parentId,
		}),
	});

	registerOperationTool(ctx, {
		operation: "addRecipe",
		title: "Add Recipe",
		description:
			"Expand a built-in registry recipe into attached design elements. Requires expectedRevision from a prior read.",
		annotations: insertAnnotations,
		auditDetails: ({ library, recipe, parentId }) => ({
			recipeRef: `${library}/${recipe}`,
			parentId,
		}),
		respond: (execution) => ({
			recipe: execution.summary.recipe,
			...describeChangedElement(execution),
		}),
	});

	registerOperationTool(ctx, {
		operation: "addSystemComponent",
		title: "Add System Component",
		description:
			"Insert a published design-system component instance into a design file. Requires expectedRevision from a prior read.",
		annotations: insertAnnotations,
		auditDetails: ({ systemId, componentId, parentId }) => ({
			systemId,
			componentId,
			parentId,
		}),
		respond: (execution) => ({
			systemComponent: execution.summary.systemComponent,
			...describeChangedElement(execution),
		}),
	});

	registerOperationTool(ctx, {
		operation: "updateSystemComponentInstance",
		title: "Update System Component Instance",
		description:
			"Update variant values, clear variant axes, and/or override classNames on an attached system component root. Component marker props cannot be edited through generic element tools.",
		annotations: insertAnnotations,
		auditDetails: ({ rootElementId }) => ({ rootElementId }),
		respond: (execution) => {
			const { summary } = execution;
			return {
				systemComponent: {
					...(summary.systemComponent as Record<string, unknown>),
					rootElementId: summary.rootElementId,
					changedElementIds: summary.changedElementIds,
					variantValues: summary.variantValues,
					overrides: summary.overrides,
				},
				...describeChangedElement(execution),
			};
		},
	});
};

export const registerDesignNodeEditTools = (ctx: McpToolContext) => {
	registerOperationTool(ctx, {
		operation: "detachSystemComponent",
		title: "Detach System Component",
		description:
			"Detach the attached system component instance containing the target element. Removes component marker props from the whole instance so former structural nodes can be mutated normally.",
		annotations: destructiveMutationAnnotations,
		auditDetails: ({ elementId }) => ({ elementId }),
		respond: (execution) => ({
			systemComponent: execution.summary.systemComponent,
			...describeChangedElement(execution),
			detachedElementIds: execution.summary.detachedElementIds,
		}),
	});

	registerOperationTool(ctx, {
		operation: "updateElementProps",
		title: "Update Element Props",
		description:
			"Update allowed instance props on a design element: name, className, and/or registry-backed control props. Registry-reference props (library, component, role) cannot be changed.",
		annotations: destructiveMutationAnnotations,
		auditDetails: ({ elementId }) => ({ elementId }),
	});

	registerOperationTool(ctx, {
		operation: "updateRecipeControl",
		title: "Update Recipe Control",
		description:
			"Update a declared recipe-level control by attached recipe instance ID and template path. This keeps the recipe attached and rejects undeclared structural props.",
		annotations: destructiveMutationAnnotations,
		auditDetails: ({ instanceId, path, prop }) => ({ instanceId, path, prop }),
		respond: (execution, _before, { instanceId, path, prop, value }) => ({
			recipeControl: { instanceId, path, prop, value },
			...describeChangedElement(execution),
		}),
	});

	registerOperationTool(ctx, {
		operation: "updateRecipeInstance",
		title: "Update Recipe Instance",
		description:
			"Explicitly migrate a stale attached recipe instance to the current registry recipe template while preserving mutable settings and safely mapped authored slot contents.",
		annotations: destructiveMutationAnnotations,
		auditDetails: ({ elementId }) => ({ elementId }),
		respond: (execution) => ({
			recipeMigration: execution.summary.recipeMigration,
			...describeChangedElement(execution),
		}),
	});

	registerOperationTool(ctx, {
		operation: "updateElementText",
		title: "Update Element Text",
		description:
			"Update the text content of a text role element. Only valid for elements with role 'text'.",
		annotations: destructiveMutationAnnotations,
		auditDetails: ({ elementId }) => ({ elementId }),
	});

	registerOperationTool(ctx, {
		operation: "moveElement",
		title: "Move Element",
		description:
			"Move a design element to a new parent or position. Rejects cycles, non-branch parents, and missing targets.",
		annotations: destructiveMutationAnnotations,
		auditDetails: ({ elementId, targetParentId }) => ({
			elementId,
			targetParentId,
		}),
	});

	registerOperationTool(ctx, {
		operation: "deleteElement",
		title: "Delete Element",
		description:
			"Delete a design element and all its descendants. This operation cannot be undone.",
		annotations: destructiveMutationAnnotations,
		auditDetails: ({ elementId }) => ({ elementId }),
		respond: (execution, before, { elementId }) => {
			const originalContext = getMutationContext(before, String(elementId));
			const parentId = originalContext?.parentId ?? null;
			return {
				deletedElementId: execution.changedElementId,
				deletedCount: execution.deletedIds?.length ?? 0,
				context: {
					wasRoot: originalContext?.root ?? false,
					parentId,
					parentContext:
						parentId === null
							? null
							: getMutationContext(execution.design, parentId),
				},
			};
		},
	});

	registerOperationTool(ctx, {
		operation: "detachRecipeInstance",
		title: "Detach Recipe Instance",
		description:
			"Detach the attached recipe instance containing the target structural element. Removes recipe marker props from the whole instance so former structural nodes can be mutated normally.",
		annotations: destructiveMutationAnnotations,
		auditDetails: ({ elementId }) => ({ elementId }),
		respond: (execution) => ({
			recipe: execution.summary.recipe,
			...describeChangedElement(execution),
			detachedElementIds: execution.summary.detachedElementIds,
		}),
	});
};
