import { z } from "zod";
import { getRegistryRecipes, type RegistryId } from "../../libraries/registry";
import {
	assertCanUseComponent,
	getMcpPolicy,
	isComponentAllowed,
} from "../governance";
import {
	getAuthoringContractPayload,
	getSystemComponentAuthoringContractPayload,
} from "../payloads/authoring-contract";
import {
	assertCanUseRecipe,
	describeComponent,
	describeRecipe,
	getComponentIds,
	getRecipeOrThrow,
	getRegistryIds,
	getRegistryOrThrow,
	isRecipeAllowed,
	summarizeRecipe,
} from "../payloads/registry";
import { readOnlyClosedWorldAnnotations } from "./annotations";
import type { McpToolContext } from "./context";
import { createJsonResult } from "./results";
import { designFileIdSchema, withProjectScopedInput } from "./schemas";

export const registerRegistryTools = (ctx: McpToolContext) => {
	const { server, withPolicyErrorHandling } = ctx;

	server.registerTool(
		"listRegistries",
		{
			title: "List Registries",
			description:
				"List read-only component registries available to this Trickroom project.",
			annotations: readOnlyClosedWorldAnnotations,
		},
		async () =>
			createJsonResult({
				registries: getRegistryIds().map((library) => ({
					library,
					builtIn: true,
					readOnly: true,
					componentCount: getComponentIds(library).length,
					components: getComponentIds(library),
				})),
			}),
	);

	server.registerTool(
		"listRegistryComponents",
		{
			title: "List Registry Components",
			description:
				"List components in a registry, including compact role and child-behavior metadata.",
			inputSchema: withProjectScopedInput({
				library: z
					.string()
					.optional()
					.describe("Registry library id. Omit to list all registries."),
			}),
			annotations: readOnlyClosedWorldAnnotations,
		},
		async ({ library, project }) =>
			withPolicyErrorHandling(project, async (context) => {
				const policy = getMcpPolicy(context.config);
				const selectedLibraries =
					library === undefined ? getRegistryIds() : [library as RegistryId];

				return createJsonResult({
					registries: selectedLibraries.map((selectedLibrary) => {
						getRegistryOrThrow(selectedLibrary);
						return {
							library: selectedLibrary,
							components: getComponentIds(selectedLibrary)
								.filter((component) =>
									isComponentAllowed(policy, selectedLibrary, component),
								)
								.map((component) => {
									const summary = describeComponent(selectedLibrary, component);
									return {
										library: summary.library,
										component: summary.component,
										role: summary.role,
										allowedChildren: summary.allowedChildren,
										composition: summary.composition,
										defaults: summary.defaults,
									};
								}),
						};
					}),
				});
			}),
	);

	server.registerTool(
		"describeRegistryComponent",
		{
			title: "Describe Registry Component",
			description:
				"Describe one read-only registry component, including role, allowed children, defaults, and supported props.",
			inputSchema: withProjectScopedInput({
				library: z.string().min(1).describe("Registry library id."),
				component: z.string().min(1).describe("Registry component id."),
			}),
			annotations: readOnlyClosedWorldAnnotations,
		},
		async ({ library, component, project }) =>
			withPolicyErrorHandling(project, async (context) => {
				const policy = getMcpPolicy(context.config);
				assertCanUseComponent(policy, library, component);
				return createJsonResult(
					describeComponent(library as RegistryId, component),
				);
			}),
	);

	server.registerTool(
		"listRegistryRecipes",
		{
			title: "List Registry Recipes",
			description:
				"List composable recipes in a registry, including compact structure and slot metadata.",
			inputSchema: withProjectScopedInput({
				library: z
					.string()
					.optional()
					.describe("Registry library id. Omit to list all registries."),
			}),
			annotations: readOnlyClosedWorldAnnotations,
		},
		async ({ library, project }) =>
			withPolicyErrorHandling(project, async (context) => {
				const policy = getMcpPolicy(context.config);
				const selectedLibraries =
					library === undefined ? getRegistryIds() : [library as RegistryId];

				return createJsonResult({
					registries: selectedLibraries.map((selectedLibrary) => {
						getRegistryOrThrow(selectedLibrary);
						return {
							library: selectedLibrary,
							recipes: getRegistryRecipes(selectedLibrary)
								.filter((recipe) => isRecipeAllowed(policy, recipe))
								.map((recipe) => summarizeRecipe(selectedLibrary, recipe)),
						};
					}),
				});
			}),
	);

	server.registerTool(
		"describeRegistryRecipe",
		{
			title: "Describe Registry Recipe",
			description:
				"Describe one read-only registry recipe, including structure, slots, defaults, and system-owned marker guidance.",
			inputSchema: withProjectScopedInput({
				library: z.string().min(1).describe("Registry library id."),
				recipe: z
					.string()
					.min(1)
					.describe(
						"Registry recipe id, either local to the library such as avatar.default or fully qualified such as base-ui/avatar.default.",
					),
			}),
			annotations: readOnlyClosedWorldAnnotations,
		},
		async ({ library, recipe, project }) =>
			withPolicyErrorHandling(project, async (context) => {
				const policy = getMcpPolicy(context.config);
				const resolution = getRecipeOrThrow(library, recipe);
				assertCanUseRecipe(policy, resolution.definition);
				return createJsonResult(
					describeRecipe(resolution.library, resolution.definition),
				);
			}),
	);

	server.registerTool(
		"getSystemComponentAuthoringContract",
		{
			title: "Get System Component Authoring Contract",
			description:
				"Return the compact authoring contract for system component drafts: root template nodes, slot maps, variant axes/classesByPath, override targets, validation diagnostics, and examples. Prefer this before createSystemComponentDraft or updateSystemComponentDraft.",
			inputSchema: withProjectScopedInput({
				systemName: z
					.string()
					.min(1)
					.optional()
					.describe(
						"Optional configured design system name or id to echo availability context.",
					),
				includeExamples: z
					.boolean()
					.optional()
					.describe(
						"Include compact draft authoring examples. Defaults to true.",
					),
			}),
			annotations: readOnlyClosedWorldAnnotations,
		},
		async ({ systemName, includeExamples, project }) =>
			withPolicyErrorHandling(project, async (context) =>
				createJsonResult(
					await getSystemComponentAuthoringContractPayload(context, {
						systemName,
						includeExamples,
					}),
				),
			),
	);

	server.registerTool(
		"getDesignAuthoringContract",
		{
			title: "Get Design Authoring Contract",
			description:
				"Return the primary compact planning contract for agents editing design files: design grammar, registry component and recipe vocabulary, writable/system-owned props, composition and mutation rules, optional token/resource summaries, authoring guidance, and examples. For system component draft authoring, use getSystemComponentAuthoringContract.",
			inputSchema: withProjectScopedInput({
				designFileId: designFileIdSchema
					.optional()
					.describe(
						"Optional design file UUID used to include design-system, token, and resource planning context.",
					),
				includeExamples: z
					.boolean()
					.optional()
					.describe(
						"Include compact machine-readable mutation examples. Defaults to true.",
					),
				includeRecipes: z
					.enum(["summary", "none"])
					.optional()
					.describe(
						"Include compact recipe summaries per registry. Defaults to none.",
					),
				includeResources: z
					.boolean()
					.optional()
					.describe(
						"Include asset/icon planning summaries when designFileId resolves to a linked system. Defaults to false.",
					),
				includeRegistryComponents: z
					.enum(["summary", "full", "none"])
					.optional()
					.describe(
						"Include registry component vocabulary in the contract. summary returns compact entries; full includes controls and composition metadata. Defaults to summary.",
					),
			}),
			annotations: readOnlyClosedWorldAnnotations,
		},
		async ({
			designFileId,
			includeExamples,
			includeRecipes,
			includeResources,
			includeRegistryComponents,
			project,
		}) =>
			withPolicyErrorHandling(project, async (context) =>
				createJsonResult(
					await getAuthoringContractPayload(context, {
						designFileId,
						includeExamples,
						includeRecipes,
						includeResources,
						includeRegistryComponents,
					}),
				),
			),
	);
};
