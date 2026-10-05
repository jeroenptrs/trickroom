import { z } from "zod";
import { UnknownGuideTopicError } from "../guide/topics";
import {
	GUIDE_TOPIC_NAMES,
	getGuidePayload,
} from "../payloads/authoring-contract";
import { TOOL } from "../tool-names";
import {
	ALWAYS_LOAD_META_KEY,
	MAX_RESULT_SIZE_META_KEY,
	readOnlyClosedWorldAnnotations,
	SEARCH_HINT_META_KEY,
} from "./annotations";
import type { McpToolContext } from "./context";
import { createJsonResult, createToolErrorResult } from "./results";
import { designFileIdSchema, withProjectScopedInput } from "./schemas";

/** Topics are fetched on purpose and some are long (registry, examples). */
const GUIDE_MAX_RESULT_CHARS = 60_000;

export const registerGuideTools = (ctx: McpToolContext) => {
	const { server, withPolicyErrorHandling } = ctx;
	const topicName = z.enum(GUIDE_TOPIC_NAMES);

	server.registerTool(
		TOOL.guide,
		{
			title: "Trickroom Guide",
			description: `How to design in Trickroom. Without topic: a short core with the design model, rules, workflow, an example batch, this project's facts (governance, design system, components, memory note counts) and the list of topics; with designFileId it adds that design's revision, boards and linked system. Call it once before the first design write in a session. With topic (one or several): only those sections, e.g. "operations" (every ${TOOL.designApply} operation with parameters and an example), "recipes", "components", "registry" (raw elements: roles, controls, defaults), "tokens", "overlays", "examples". library and name filter the registry, recipes and components topics. Topics starting with "component-" cover authoring design system components; systemName adds that system's component counts.`,
			inputSchema: withProjectScopedInput({
				topic: z
					.union([topicName, z.array(topicName).min(1)])
					.optional()
					.describe("Topic or topics to return instead of the core."),
				designFileId: designFileIdSchema
					.optional()
					.describe(
						"Add this design's revision, boards and linked system to the core and system-specific topics.",
					),
				systemName: z
					.string()
					.min(1)
					.optional()
					.describe(
						"component-authoring: a design system name or id for its component counts.",
					),
				library: z
					.string()
					.min(1)
					.optional()
					.describe("Registry library filter for registry and recipes."),
				name: z
					.string()
					.min(1)
					.optional()
					.describe(
						'Name filter for registry, recipes and components, e.g. "dialog" or "select.trigger".',
					),
			}),
			annotations: readOnlyClosedWorldAnnotations,
			_meta: {
				[ALWAYS_LOAD_META_KEY]: true,
				[SEARCH_HINT_META_KEY]:
					"authoring contract rules workflow help docs registry recipes elements controls how to",
				[MAX_RESULT_SIZE_META_KEY]: GUIDE_MAX_RESULT_CHARS,
			},
		},
		async ({ topic, designFileId, systemName, library, name, project }) =>
			withPolicyErrorHandling(project, async (context) => {
				try {
					return createJsonResult(
						await getGuidePayload(context, {
							topic,
							designFileId,
							systemName,
							library,
							name,
						}),
					);
				} catch (error) {
					if (error instanceof UnknownGuideTopicError) {
						return createToolErrorResult(context, error.code, error.message, {
							availableTopics: error.availableTopics,
						});
					}
					throw error;
				}
			}),
	);
};
