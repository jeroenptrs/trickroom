import { z } from "zod";
import {
	applyAddElement,
	applyAddRecipe,
	applyAddSystemComponent,
	applyDeleteElement,
	applyDetachRecipeInstance,
	applyDetachSystemComponent,
	applyMoveElement,
	applyUpdateElementProps,
	applyUpdateElementText,
	applyUpdateRecipeControl,
	applyUpdateRecipeInstance,
	applyUpdateSystemComponentInstance,
	DesignTransformError,
} from "../../services/design-transform-service";
import {
	assertOperationAllowedByPolicy,
	getElementComponentReference,
	normalizeUpdateElementPropsParameters,
} from "../design-operations";
import {
	assertCanUseComponent,
	assertCanWriteDesignFile,
	getComponentRef,
	getMcpPolicy,
} from "../governance";
import {
	findElementContext,
	getCompactElementSummary,
	getMutationContext,
} from "../payloads/design-tree";
import { getProjectReference } from "../payloads/project";
import {
	assertCanUseSubtreeComponents,
	assertResourceElementReferenceExists,
	assertResourceReferencesExist,
	getSubtreeElementIds,
} from "../payloads/references";
import { assertCanUseRecipe, getRecipeOrThrow } from "../payloads/registry";
import {
	destructiveMutationAnnotations,
	mutationAnnotations,
} from "./annotations";
import type { McpToolContext } from "./context";
import {
	getMutationDiagnostics,
	mutateDesignFile,
	withMutationErrorHandling,
} from "./mutation-support";
import {
	addRecipeOperationParameterSchema,
	addSystemComponentOperationParameterSchema,
	detachRecipeInstanceOperationParameterSchema,
	detachSystemComponentOperationParameterSchema,
	updateRecipeControlOperationParameterSchema,
	updateRecipeInstanceOperationParameterSchema,
	updateSystemComponentInstanceOperationParameterSchema,
} from "./operation-schemas";
import { createJsonResult } from "./results";
import { jsonPrimitiveSchema, withMutationScopedInput } from "./schemas";

export const registerDesignNodeInsertTools = (ctx: McpToolContext) => {
	const { server, withProjectContext } = ctx;

	server.registerTool(
		"addElement",
		{
			title: "Add Element",
			description:
				"Create a new registry element inside a design file. Requires expectedRevision from a prior read.",
			inputSchema: withMutationScopedInput({
				designFileId: z.string().uuid().describe("Design file UUID."),
				expectedRevision: z
					.string()
					.startsWith("sha256:")
					.describe(
						"Current revision from a prior read. Required for safe writes.",
					),
				parentId: z
					.string()
					.min(1)
					.nullable()
					.describe("Parent element ID, or null to add at the design root."),
				index: z
					.number()
					.int()
					.min(0)
					.describe(
						"Insertion index within the parent's children or the root.",
					),
				library: z
					.string()
					.min(1)
					.describe("Registry library id, e.g. 'trickroom'."),
				component: z
					.string()
					.min(1)
					.describe("Registry component id, e.g. 'container' or 'text'."),
				name: z
					.string()
					.min(1)
					.optional()
					.describe(
						'Layer name (data-trickroom-name). Shortcut — takes precedence over props["data-trickroom-name"] when both are supplied. Defaults to the component id.',
					),
				className: z
					.string()
					.optional()
					.describe(
						"Tailwind class string. Shortcut — takes precedence over props.className when both are supplied.",
					),
				text: z
					.string()
					.optional()
					.describe(
						"Initial text content for text role elements. Defaults to 'Text'.",
					),
				props: z
					.record(z.string(), jsonPrimitiveSchema)
					.optional()
					.describe(
						"Optional extra instance props. Allowed keys: className, data-trickroom-name, and registry-backed control props. Registry-reference keys (data-trickroom-library, data-trickroom-component, data-trickroom-role) and unknown keys are rejected with INVALID_PROP_KEY.",
					),
			}),
			annotations: {
				...mutationAnnotations,
				destructiveHint: false,
				idempotentHint: false,
			},
		},
		async ({
			designFileId,
			expectedRevision,
			parentId,
			index,
			library,
			component,
			name,
			className,
			text,
			props,
			response,
			project,
		}) => {
			return withProjectContext(project, async (context) => {
				const policy = getMcpPolicy(context.config);
				return withMutationErrorHandling(
					context,
					{
						toolName: "addElement",
						operation: "addElement",
						projectId: context.config.projectId ?? null,
						designFileId,
						expectedRevision,
						details: {
							componentRef: getComponentRef(library, component),
							parentId,
						},
					},
					async () => {
						assertCanWriteDesignFile(policy, designFileId);
						assertCanUseComponent(policy, library, component);
						return mutateDesignFile(
							context,
							{ designFileId, expectedRevision },
							{
								mutate: async (read) => {
									const result = applyAddElement(read.design, {
										parentId,
										index,
										library,
										component,
										name,
										className,
										text,
										props,
									});
									await assertResourceElementReferenceExists(
										context,
										result.design,
										result.changedElementId,
									);
									return result;
								},
								respond: async (result, write) => {
									const element = getCompactElementSummary(
										result.design,
										result.changedElementId,
									);
									const elementContext = getMutationContext(
										result.design,
										result.changedElementId,
									);

									return createJsonResult({
										status: "success",
										project: getProjectReference(context),
										newRevision: write.revision,
										changedElement: element,
										context: elementContext,
										...(await getMutationDiagnostics(
											context,
											write.design,
											response,
											[result.changedElementId],
										)),
									});
								},
							},
						);
					},
				);
			});
		},
	);

	server.registerTool(
		"addRecipe",
		{
			title: "Add Recipe",
			description:
				"Expand a built-in registry recipe into attached design elements. Requires expectedRevision from a prior read.",
			inputSchema: withMutationScopedInput({
				designFileId: z.string().uuid().describe("Design file UUID."),
				expectedRevision: z
					.string()
					.startsWith("sha256:")
					.describe(
						"Current revision from a prior read. Required for safe writes.",
					),
				...addRecipeOperationParameterSchema,
			}),
			annotations: {
				...mutationAnnotations,
				destructiveHint: false,
				idempotentHint: false,
			},
		},
		async ({
			designFileId,
			expectedRevision,
			parentId,
			index,
			library,
			recipe,
			response,
			project,
		}) => {
			return withProjectContext(project, async (context) => {
				const policy = getMcpPolicy(context.config);
				return withMutationErrorHandling(
					context,
					{
						toolName: "addRecipe",
						operation: "addRecipe",
						projectId: context.config.projectId ?? null,
						designFileId,
						expectedRevision,
						details: {
							recipeRef: `${library}/${recipe}`,
							parentId,
						},
					},
					async () => {
						assertCanWriteDesignFile(policy, designFileId);
						const resolution = getRecipeOrThrow(library, recipe);
						assertCanUseRecipe(policy, resolution.definition);

						return mutateDesignFile(
							context,
							{ designFileId, expectedRevision },
							{
								mutate: async (read) => {
									const result = applyAddRecipe(read.design, {
										parentId,
										index,
										library,
										recipe,
									});
									await assertResourceReferencesExist(context, result.design);
									return result;
								},
								respond: async (result, write) => {
									return createJsonResult({
										status: "success",
										project: getProjectReference(context),
										newRevision: write.revision,
										recipe: {
											id: result.recipeId,
											instanceId: result.instanceId,
											elementIdsByPath: result.elementIdsByPath,
										},
										changedElement: getCompactElementSummary(
											result.design,
											result.changedElementId,
										),
										context: getMutationContext(
											result.design,
											result.changedElementId,
										),
										...(await getMutationDiagnostics(
											context,
											write.design,
											response,
											Object.values(result.elementIdsByPath),
										)),
									});
								},
							},
						);
					},
				);
			});
		},
	);

	server.registerTool(
		"addSystemComponent",
		{
			title: "Add System Component",
			description:
				"Insert a published design-system component instance into a design file. Requires expectedRevision from a prior read.",
			inputSchema: withMutationScopedInput({
				designFileId: z.string().uuid().describe("Design file UUID."),
				expectedRevision: z
					.string()
					.startsWith("sha256:")
					.describe(
						"Current revision from a prior read. Required for safe writes.",
					),
				...addSystemComponentOperationParameterSchema,
			}),
			annotations: {
				...mutationAnnotations,
				destructiveHint: false,
				idempotentHint: false,
			},
		},
		async ({
			designFileId,
			expectedRevision,
			parentId,
			index,
			systemId,
			componentId,
			version,
			variantValues,
			unsetVariantAxes,
			overrides,
			response,
			project,
		}) => {
			return withProjectContext(project, async (context) => {
				const policy = getMcpPolicy(context.config);
				return withMutationErrorHandling(
					context,
					{
						toolName: "addSystemComponent",
						operation: "addSystemComponent",
						projectId: context.config.projectId ?? null,
						designFileId,
						expectedRevision,
						details: {
							systemId,
							componentId,
							parentId,
						},
					},
					async () => {
						assertCanWriteDesignFile(policy, designFileId);
						return mutateDesignFile(
							context,
							{ designFileId, expectedRevision },
							{
								mutate: async (read) => {
									const result = await applyAddSystemComponent(read.design, {
										projectRoot: context.projectRoot,
										parentId,
										index,
										systemId,
										componentId,
										version: version ?? null,
										variantValues,
										unsetVariantAxes,
										overrides,
									});
									const insertedRoot = findElementContext(
										result.design,
										result.changedElementId,
									);
									if (!insertedRoot) {
										throw new DesignTransformError(
											"INVALID_OPERATION",
											"Failed to validate inserted system component root after mutation.",
										);
									}
									assertCanUseSubtreeComponents(policy, insertedRoot.element);
									await assertResourceReferencesExist(context, result.design);
									return result;
								},
								respond: async (result, write) => {
									return createJsonResult({
										status: "success",
										project: getProjectReference(context),
										newRevision: write.revision,
										systemComponent: {
											systemId: result.systemId,
											componentId: result.componentId,
											version: result.version,
											instanceId: result.instanceId,
											elementIdsByPath: result.elementIdsByPath,
											variantValues: result.variantValues,
											overrides: result.overrides,
										},
										changedElement: getCompactElementSummary(
											result.design,
											result.changedElementId,
										),
										context: getMutationContext(
											result.design,
											result.changedElementId,
										),
										...(await getMutationDiagnostics(
											context,
											write.design,
											response,
											Object.values(result.elementIdsByPath),
										)),
									});
								},
							},
						);
					},
				);
			});
		},
	);

	server.registerTool(
		"updateSystemComponentInstance",
		{
			title: "Update System Component Instance",
			description:
				"Update variant values, clear variant axes, and/or override classNames on an attached system component root. Component marker props cannot be edited through generic element tools.",
			inputSchema: withMutationScopedInput({
				designFileId: z.string().uuid().describe("Design file UUID."),
				expectedRevision: z
					.string()
					.startsWith("sha256:")
					.describe(
						"Current revision from a prior read. Required for safe writes.",
					),
				...updateSystemComponentInstanceOperationParameterSchema,
			}),
			annotations: {
				...mutationAnnotations,
				destructiveHint: false,
				idempotentHint: false,
			},
		},
		async ({
			designFileId,
			expectedRevision,
			rootElementId,
			variantValues,
			unsetVariantAxes,
			overrides,
			response,
			project,
		}) => {
			return withProjectContext(project, async (context) => {
				const policy = getMcpPolicy(context.config);
				return withMutationErrorHandling(
					context,
					{
						toolName: "updateSystemComponentInstance",
						operation: "updateSystemComponentInstance",
						projectId: context.config.projectId ?? null,
						designFileId,
						expectedRevision,
						details: { rootElementId },
					},
					async () => {
						assertCanWriteDesignFile(policy, designFileId);
						return mutateDesignFile(
							context,
							{ designFileId, expectedRevision },
							{
								mutate: async (read) => {
									assertOperationAllowedByPolicy(
										policy,
										read.design,
										"updateSystemComponentInstance",
										{
											rootElementId,
											variantValues,
											unsetVariantAxes,
											overrides,
										},
									);

									const result = await applyUpdateSystemComponentInstance(
										read.design,
										{
											projectRoot: context.projectRoot,
											rootElementId,
											variantValues,
											unsetVariantAxes,
											overrides,
										},
									);
									return result;
								},
								respond: async (result, write) => {
									return createJsonResult({
										status: "success",
										project: getProjectReference(context),
										newRevision: write.revision,
										systemComponent: {
											systemId: result.systemId,
											componentId: result.componentId,
											version: result.version,
											instanceId: result.instanceId,
											rootElementId: result.rootElementId,
											changedElementIds: result.changedElementIds,
											variantValues: result.variantValues,
											overrides: result.overrides,
										},
										changedElement: getCompactElementSummary(
											result.design,
											result.changedElementId,
										),
										context: getMutationContext(
											result.design,
											result.changedElementId,
										),
										...(await getMutationDiagnostics(
											context,
											write.design,
											response,
											getSubtreeElementIds(write.design, result.rootElementId),
										)),
									});
								},
							},
						);
					},
				);
			});
		},
	);
};

export const registerDesignNodeEditTools = (ctx: McpToolContext) => {
	const { server, withProjectContext } = ctx;

	server.registerTool(
		"detachSystemComponent",
		{
			title: "Detach System Component",
			description:
				"Detach the attached system component instance containing the target element. Removes component marker props from the whole instance so former structural nodes can be mutated normally.",
			inputSchema: withMutationScopedInput({
				designFileId: z.string().uuid().describe("Design file UUID."),
				expectedRevision: z
					.string()
					.startsWith("sha256:")
					.describe(
						"Current revision from a prior read. Required for safe writes.",
					),
				...detachSystemComponentOperationParameterSchema,
			}),
			annotations: destructiveMutationAnnotations,
		},
		async ({
			designFileId,
			expectedRevision,
			elementId,
			response,
			project,
		}) => {
			return withProjectContext(project, async (context) => {
				const policy = getMcpPolicy(context.config);
				return withMutationErrorHandling(
					context,
					{
						toolName: "detachSystemComponent",
						operation: "detachSystemComponent",
						projectId: context.config.projectId ?? null,
						designFileId,
						expectedRevision,
						details: { elementId },
					},
					async () => {
						assertCanWriteDesignFile(policy, designFileId);
						return mutateDesignFile(
							context,
							{ designFileId, expectedRevision },
							{
								mutate: async (read) => {
									assertOperationAllowedByPolicy(
										policy,
										read.design,
										"detachSystemComponent",
										{
											elementId,
										},
									);

									const result = await applyDetachSystemComponent(read.design, {
										projectRoot: context.projectRoot,
										elementId,
									});
									return result;
								},
								respond: async (result, write) => {
									return createJsonResult({
										status: "success",
										project: getProjectReference(context),
										newRevision: write.revision,
										systemComponent: {
											systemId: result.systemId,
											componentId: result.componentId,
											instanceId: result.instanceId,
											rootElementId: result.rootElementId,
										},
										changedElement: getCompactElementSummary(
											result.design,
											result.changedElementId,
										),
										detachedElementIds: result.detachedElementIds,
										context: getMutationContext(
											result.design,
											result.changedElementId,
										),
										...(await getMutationDiagnostics(
											context,
											write.design,
											response,
											result.detachedElementIds,
										)),
									});
								},
							},
						);
					},
				);
			});
		},
	);

	server.registerTool(
		"updateElementProps",
		{
			title: "Update Element Props",
			description:
				"Update allowed instance props on a design element: name, className, and/or registry-backed control props. Registry-reference props (library, component, role) cannot be changed.",
			inputSchema: withMutationScopedInput({
				designFileId: z.string().uuid().describe("Design file UUID."),
				expectedRevision: z
					.string()
					.startsWith("sha256:")
					.describe(
						"Current revision from a prior read. Required for safe writes.",
					),
				elementId: z.string().min(1).describe("Element ID to update."),
				name: z
					.string()
					.min(1)
					.optional()
					.describe("New layer name for this element."),
				className: z
					.string()
					.optional()
					.describe("New Tailwind class string. Pass empty string to clear."),
				props: z
					.record(z.string(), jsonPrimitiveSchema)
					.optional()
					.describe(
						'Registry-backed control props to update, for example { "orientation": "vertical" } for base-ui/separator.',
					),
				propUpdates: z
					.array(
						z.object({
							name: z
								.string()
								.min(1)
								.describe(
									'Prop name to update. Use "name" or "data-trickroom-name" for the layer name, "className" for classes, or a registry-backed control prop.',
								),
							value: jsonPrimitiveSchema,
						}),
					)
					.optional()
					.describe(
						"Compatibility batch update form. Prefer top-level name/className/props for new calls.",
					),
			}),
			annotations: destructiveMutationAnnotations,
		},
		async ({
			designFileId,
			expectedRevision,
			elementId,
			name,
			className,
			props,
			propUpdates,
			response,
			project,
		}) => {
			return withProjectContext(project, async (context) => {
				const policy = getMcpPolicy(context.config);
				return withMutationErrorHandling(
					context,
					{
						toolName: "updateElementProps",
						operation: "updateElementProps",
						projectId: context.config.projectId ?? null,
						designFileId,
						expectedRevision,
						details: { elementId },
					},
					async () => {
						assertCanWriteDesignFile(policy, designFileId);
						return mutateDesignFile(
							context,
							{ designFileId, expectedRevision },
							{
								mutate: async (read) => {
									const target = getElementComponentReference(
										read.design,
										elementId,
									);
									assertCanUseComponent(
										policy,
										target.library,
										target.component,
									);

									const normalizedProps = normalizeUpdateElementPropsParameters(
										{
											name,
											className,
											props,
											propUpdates,
										},
									);
									const result = applyUpdateElementProps(read.design, {
										elementId,
										...normalizedProps,
									});
									await assertResourceElementReferenceExists(
										context,
										result.design,
										result.changedElementId,
									);
									return result;
								},
								respond: async (result, write) => {
									return createJsonResult({
										status: "success",
										project: getProjectReference(context),
										newRevision: write.revision,
										changedElement: getCompactElementSummary(
											result.design,
											result.changedElementId,
										),
										context: getMutationContext(
											result.design,
											result.changedElementId,
										),
										...(await getMutationDiagnostics(
											context,
											write.design,
											response,
											[result.changedElementId],
										)),
									});
								},
							},
						);
					},
				);
			});
		},
	);

	server.registerTool(
		"updateRecipeControl",
		{
			title: "Update Recipe Control",
			description:
				"Update a declared recipe-level control by attached recipe instance ID and template path. This keeps the recipe attached and rejects undeclared structural props.",
			inputSchema: withMutationScopedInput({
				designFileId: z.string().uuid().describe("Design file UUID."),
				expectedRevision: z
					.string()
					.startsWith("sha256:")
					.describe(
						"Current revision from a prior read. Required for safe writes.",
					),
				...updateRecipeControlOperationParameterSchema,
			}),
			annotations: destructiveMutationAnnotations,
		},
		async ({
			designFileId,
			expectedRevision,
			instanceId,
			path,
			prop,
			value,
			response,
			project,
		}) => {
			return withProjectContext(project, async (context) => {
				const policy = getMcpPolicy(context.config);
				return withMutationErrorHandling(
					context,
					{
						toolName: "updateRecipeControl",
						operation: "updateRecipeControl",
						projectId: context.config.projectId ?? null,
						designFileId,
						expectedRevision,
						details: { instanceId, path, prop },
					},
					async () => {
						assertCanWriteDesignFile(policy, designFileId);
						return mutateDesignFile(
							context,
							{ designFileId, expectedRevision },
							{
								mutate: async (read) => {
									const result = applyUpdateRecipeControl(read.design, {
										instanceId,
										path,
										prop,
										value,
									});
									const target = getElementComponentReference(
										result.design,
										result.changedElementId,
									);
									assertCanUseComponent(
										policy,
										target.library,
										target.component,
									);
									await assertResourceElementReferenceExists(
										context,
										result.design,
										result.changedElementId,
									);
									return result;
								},
								respond: async (result, write) => {
									return createJsonResult({
										status: "success",
										project: getProjectReference(context),
										newRevision: write.revision,
										recipeControl: { instanceId, path, prop, value },
										changedElement: getCompactElementSummary(
											result.design,
											result.changedElementId,
										),
										context: getMutationContext(
											result.design,
											result.changedElementId,
										),
										...(await getMutationDiagnostics(
											context,
											write.design,
											response,
											[result.changedElementId],
										)),
									});
								},
							},
						);
					},
				);
			});
		},
	);

	server.registerTool(
		"updateRecipeInstance",
		{
			title: "Update Recipe Instance",
			description:
				"Explicitly migrate a stale attached recipe instance to the current registry recipe template while preserving mutable settings and safely mapped authored slot contents.",
			inputSchema: withMutationScopedInput({
				designFileId: z.string().uuid().describe("Design file UUID."),
				expectedRevision: z
					.string()
					.startsWith("sha256:")
					.describe(
						"Current revision from a prior read. Required for safe writes.",
					),
				...updateRecipeInstanceOperationParameterSchema,
			}),
			annotations: destructiveMutationAnnotations,
		},
		async ({
			designFileId,
			expectedRevision,
			elementId,
			response,
			project,
		}) => {
			return withProjectContext(project, async (context) => {
				const policy = getMcpPolicy(context.config);
				return withMutationErrorHandling(
					context,
					{
						toolName: "updateRecipeInstance",
						operation: "updateRecipeInstance",
						projectId: context.config.projectId ?? null,
						designFileId,
						expectedRevision,
						details: { elementId },
					},
					async () => {
						assertCanWriteDesignFile(policy, designFileId);
						return mutateDesignFile(
							context,
							{ designFileId, expectedRevision },
							{
								mutate: async (read) => {
									const target = getElementComponentReference(
										read.design,
										elementId,
									);
									assertCanUseComponent(
										policy,
										target.library,
										target.component,
									);

									const result = applyUpdateRecipeInstance(read.design, {
										elementId,
									});
									await assertResourceReferencesExist(context, result.design);
									return result;
								},
								respond: async (result, write) => {
									return createJsonResult({
										status: "success",
										project: getProjectReference(context),
										newRevision: write.revision,
										recipeMigration: result.recipeMigration,
										changedElement: getCompactElementSummary(
											result.design,
											result.changedElementId,
										),
										context: getMutationContext(
											result.design,
											result.changedElementId,
										),
										...(await getMutationDiagnostics(
											context,
											write.design,
											response,
											getSubtreeElementIds(
												write.design,
												result.changedElementId,
											),
										)),
									});
								},
							},
						);
					},
				);
			});
		},
	);

	server.registerTool(
		"updateElementText",
		{
			title: "Update Element Text",
			description:
				"Update the text content of a text role element. Only valid for elements with role 'text'.",
			inputSchema: withMutationScopedInput({
				designFileId: z.string().uuid().describe("Design file UUID."),
				expectedRevision: z
					.string()
					.startsWith("sha256:")
					.describe(
						"Current revision from a prior read. Required for safe writes.",
					),
				elementId: z
					.string()
					.min(1)
					.describe("Text role element ID to update."),
				text: z.string().describe("New text content."),
			}),
			annotations: destructiveMutationAnnotations,
		},
		async ({
			designFileId,
			expectedRevision,
			elementId,
			text,
			response,
			project,
		}) => {
			return withProjectContext(project, async (context) => {
				const policy = getMcpPolicy(context.config);
				return withMutationErrorHandling(
					context,
					{
						toolName: "updateElementText",
						operation: "updateElementText",
						projectId: context.config.projectId ?? null,
						designFileId,
						expectedRevision,
						details: { elementId },
					},
					async () => {
						assertCanWriteDesignFile(policy, designFileId);
						return mutateDesignFile(
							context,
							{ designFileId, expectedRevision },
							{
								mutate: async (read) => {
									const target = getElementComponentReference(
										read.design,
										elementId,
									);
									assertCanUseComponent(
										policy,
										target.library,
										target.component,
									);

									const result = applyUpdateElementText(read.design, {
										elementId,
										text,
									});
									return result;
								},
								respond: async (result, write) => {
									return createJsonResult({
										status: "success",
										project: getProjectReference(context),
										newRevision: write.revision,
										changedElement: getCompactElementSummary(
											result.design,
											result.changedElementId,
										),
										context: getMutationContext(
											result.design,
											result.changedElementId,
										),
										...(await getMutationDiagnostics(
											context,
											write.design,
											response,
											[result.changedElementId],
										)),
									});
								},
							},
						);
					},
				);
			});
		},
	);

	server.registerTool(
		"moveElement",
		{
			title: "Move Element",
			description:
				"Move a design element to a new parent or position. Rejects cycles, non-branch parents, and missing targets.",
			inputSchema: withMutationScopedInput({
				designFileId: z.string().uuid().describe("Design file UUID."),
				expectedRevision: z
					.string()
					.startsWith("sha256:")
					.describe(
						"Current revision from a prior read. Required for safe writes.",
					),
				elementId: z.string().min(1).describe("Element ID to move."),
				targetParentId: z
					.string()
					.min(1)
					.nullable()
					.describe(
						"New parent element ID, or null to move to the design root.",
					),
				index: z
					.number()
					.int()
					.min(0)
					.describe(
						"Insertion index within the target parent's children or the root.",
					),
			}),
			annotations: destructiveMutationAnnotations,
		},
		async ({
			designFileId,
			expectedRevision,
			elementId,
			targetParentId,
			index,
			response,
			project,
		}) => {
			return withProjectContext(project, async (context) => {
				const policy = getMcpPolicy(context.config);
				return withMutationErrorHandling(
					context,
					{
						toolName: "moveElement",
						operation: "moveElement",
						projectId: context.config.projectId ?? null,
						designFileId,
						expectedRevision,
						details: { elementId, targetParentId },
					},
					async () => {
						assertCanWriteDesignFile(policy, designFileId);
						return mutateDesignFile(
							context,
							{ designFileId, expectedRevision },
							{
								mutate: async (read) => {
									const target = getElementComponentReference(
										read.design,
										elementId,
									);
									assertCanUseComponent(
										policy,
										target.library,
										target.component,
									);
									if (targetParentId !== null) {
										const parent = getElementComponentReference(
											read.design,
											targetParentId,
											"PARENT_NOT_FOUND",
										);
										assertCanUseComponent(
											policy,
											parent.library,
											parent.component,
										);
									}

									const result = applyMoveElement(read.design, {
										elementId,
										targetParentId,
										index,
									});
									return result;
								},
								respond: async (result, write) => {
									return createJsonResult({
										status: "success",
										project: getProjectReference(context),
										newRevision: write.revision,
										changedElement: getCompactElementSummary(
											result.design,
											result.changedElementId,
										),
										context: getMutationContext(
											result.design,
											result.changedElementId,
										),
										...(await getMutationDiagnostics(
											context,
											write.design,
											response,
											[result.changedElementId],
										)),
									});
								},
							},
						);
					},
				);
			});
		},
	);

	server.registerTool(
		"deleteElement",
		{
			title: "Delete Element",
			description:
				"Delete a design element and all its descendants. This operation cannot be undone.",
			inputSchema: withMutationScopedInput({
				designFileId: z.string().uuid().describe("Design file UUID."),
				expectedRevision: z
					.string()
					.startsWith("sha256:")
					.describe(
						"Current revision from a prior read. Required for safe writes.",
					),
				elementId: z.string().min(1).describe("Element ID to delete."),
			}),
			annotations: destructiveMutationAnnotations,
		},
		async ({
			designFileId,
			expectedRevision,
			elementId,
			response,
			project,
		}) => {
			return withProjectContext(project, async (context) => {
				const policy = getMcpPolicy(context.config);
				return withMutationErrorHandling(
					context,
					{
						toolName: "deleteElement",
						operation: "deleteElement",
						projectId: context.config.projectId ?? null,
						designFileId,
						expectedRevision,
						details: { elementId },
					},
					async () => {
						assertCanWriteDesignFile(policy, designFileId);
						return mutateDesignFile(
							context,
							{ designFileId, expectedRevision },
							{
								mutate: async (read) => {
									const target = getElementComponentReference(
										read.design,
										elementId,
									);
									assertCanUseComponent(
										policy,
										target.library,
										target.component,
									);

									const originalContext = getMutationContext(
										read.design,
										elementId,
									);

									const result = applyDeleteElement(read.design, {
										elementId,
									});
									return { ...result, originalContext };
								},
								respond: async (result, write) => {
									const { originalContext } = result;
									const parentSiblings =
										originalContext?.parentId !== null &&
										originalContext?.parentId
											? getMutationContext(
													result.design,
													originalContext.parentId,
												)
											: null;

									return createJsonResult({
										status: "success",
										project: getProjectReference(context),
										newRevision: write.revision,
										deletedElementId: result.changedElementId,
										deletedCount: result.deletedIds.length,
										context: {
											wasRoot: originalContext?.root ?? false,
											parentId: originalContext?.parentId ?? null,
											parentContext: parentSiblings,
										},
										...(await getMutationDiagnostics(
											context,
											write.design,
											response,
											[],
										)),
									});
								},
							},
						);
					},
				);
			});
		},
	);

	server.registerTool(
		"detachRecipeInstance",
		{
			title: "Detach Recipe Instance",
			description:
				"Detach the attached recipe instance containing the target structural element. Removes recipe marker props from the whole instance so former structural nodes can be mutated normally.",
			inputSchema: withMutationScopedInput({
				designFileId: z.string().uuid().describe("Design file UUID."),
				expectedRevision: z
					.string()
					.startsWith("sha256:")
					.describe(
						"Current revision from a prior read. Required for safe writes.",
					),
				...detachRecipeInstanceOperationParameterSchema,
			}),
			annotations: destructiveMutationAnnotations,
		},
		async ({
			designFileId,
			expectedRevision,
			elementId,
			response,
			project,
		}) => {
			return withProjectContext(project, async (context) => {
				const policy = getMcpPolicy(context.config);
				return withMutationErrorHandling(
					context,
					{
						toolName: "detachRecipeInstance",
						operation: "detachRecipeInstance",
						projectId: context.config.projectId ?? null,
						designFileId,
						expectedRevision,
						details: { elementId },
					},
					async () => {
						assertCanWriteDesignFile(policy, designFileId);
						return mutateDesignFile(
							context,
							{ designFileId, expectedRevision },
							{
								mutate: async (read) => {
									const target = getElementComponentReference(
										read.design,
										elementId,
									);
									assertCanUseComponent(
										policy,
										target.library,
										target.component,
									);

									const result = applyDetachRecipeInstance(read.design, {
										elementId,
									});
									return result;
								},
								respond: async (result, write) => {
									return createJsonResult({
										status: "success",
										project: getProjectReference(context),
										newRevision: write.revision,
										recipe: {
											id: result.recipeId,
											instanceId: result.instanceId,
											rootElementId: result.rootElementId,
										},
										changedElement: getCompactElementSummary(
											result.design,
											result.changedElementId,
										),
										detachedElementIds: result.detachedElementIds,
										context: getMutationContext(
											result.design,
											result.changedElementId,
										),
										...(await getMutationDiagnostics(
											context,
											write.design,
											response,
											result.detachedElementIds,
										)),
									});
								},
							},
						);
					},
				);
			});
		},
	);
};
