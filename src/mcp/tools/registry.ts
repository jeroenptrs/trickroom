import { z } from "zod";
import { getRegistryRecipes, type RegistryId } from "../../libraries/registry";
import {
	assertCanUseComponent,
	getMcpPolicy,
	isComponentAllowed,
} from "../governance";
import { DESIGN_GUIDE_TOPIC_NAMES } from "../guide/design-guide";
import { SYSTEM_COMPONENT_GUIDE_TOPIC_NAMES } from "../guide/system-component-guide";
import {
	createTopicInputSchema,
	UnknownGuideTopicError,
} from "../guide/topics";
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
	summarizeComponent,
	summarizeRecipe,
} from "../payloads/registry";
import type { TrickroomMcpServerContext } from "../server-types";
import { readOnlyClosedWorldAnnotations } from "./annotations";
import type { McpToolContext } from "./context";
import { createJsonResult, createToolErrorResult } from "./results";
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
				"List components in a registry with role, allowed children and control names. describeRegistryComponent returns one component's controls and defaults.",
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
								.map((component) =>
									summarizeComponent(selectedLibrary, component),
								),
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

	const runGuide = async (
		project: Parameters<typeof withPolicyErrorHandling>[0],
		build: (
			context: TrickroomMcpServerContext,
		) => Promise<Record<string, unknown>>,
	) =>
		withPolicyErrorHandling(project, async (context) => {
			try {
				return createJsonResult(await build(context));
			} catch (error) {
				if (error instanceof UnknownGuideTopicError) {
					return createToolErrorResult(context, error.code, error.message, {
						availableTopics: error.availableTopics,
					});
				}
				throw error;
			}
		});

	server.registerTool(
		"getSystemComponentAuthoringContract",
		{
			title: "Get System Component Authoring Contract",
			description:
				"Return the system component authoring contract: a short core (model, rules, workflow, topic list) without topic, or the requested topics. Call before createSystemComponentDraft or updateSystemComponentDraft.",
			inputSchema: withProjectScopedInput({
				systemName: z
					.string()
					.min(1)
					.optional()
					.describe(
						"Configured design system name or id, for its component counts and manifest revision.",
					),
				topic: createTopicInputSchema(
					SYSTEM_COMPONENT_GUIDE_TOPIC_NAMES,
					"Topic or topics to return instead of the core.",
				).optional(),
			}),
			annotations: readOnlyClosedWorldAnnotations,
		},
		async ({ systemName, topic, project }) =>
			runGuide(project, (context) =>
				getSystemComponentAuthoringContractPayload(context, {
					systemName,
					topic,
				}),
			),
	);

	server.registerTool(
		"getDesignAuthoringContract",
		{
			title: "Get Design Authoring Contract",
			description:
				"Return the design authoring contract. Without topic: a short core with the design model, rules, workflow, project facts and a list of topics. With topic: only those topics. Call once with designFileId before the first design write in a session. For system component drafts use getSystemComponentAuthoringContract.",
			inputSchema: withProjectScopedInput({
				designFileId: designFileIdSchema
					.optional()
					.describe(
						"Design file UUID. Adds the design's revision, boards and linked design system to the core and to system-specific topics.",
					),
				topic: createTopicInputSchema(
					DESIGN_GUIDE_TOPIC_NAMES,
					"Topic or topics to return instead of the core.",
				).optional(),
				library: z
					.string()
					.min(1)
					.optional()
					.describe(
						"Registry library filter for the registry and recipes topics.",
					),
				name: z
					.string()
					.min(1)
					.optional()
					.describe(
						'Name filter for the registry, recipes and components topics, e.g. "dialog" or "select.trigger".',
					),
			}),
			annotations: readOnlyClosedWorldAnnotations,
		},
		async ({ designFileId, topic, library, name, project }) =>
			runGuide(project, (context) =>
				getAuthoringContractPayload(context, {
					designFileId,
					topic,
					library,
					name,
				}),
			),
	);
};
