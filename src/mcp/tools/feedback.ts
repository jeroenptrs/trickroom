import { randomUUID } from "node:crypto";
import path from "node:path";
import { z } from "zod";
import {
	appendFeedbackEntry,
	buildFeedbackEntry,
	FEEDBACK_CATEGORIES,
	FEEDBACK_LIMITS,
	FEEDBACK_SEVERITIES,
} from "../../app-state/feedback";
import { TRICKROOM_VERSION } from "../../app-state/version";
import { FEEDBACK_RECENT_CALLS } from "../call-history";
import { TOOL } from "../tool-names";
import { mutationAnnotations, SEARCH_HINT_META_KEY } from "./annotations";
import type { McpToolContext } from "./context";
import { createJsonResult } from "./results";

export const registerFeedbackTools = (ctx: McpToolContext) => {
	const { server, feedbackHome, sessionId, getClientInfo, callHistory } = ctx;

	server.registerTool(
		TOOL.feedbackSubmit,
		{
			title: "Submit Tool Feedback",
			description: `Tell the Trickroom developers about friction with these MCP tools: a tool that blocked or misled you, an error you could not act on, output too large to use, a result that looked right but was not, or a capability you needed and could not find. Not for questions about design content. Only summary is required. Your last ${FEEDBACK_RECENT_CALLS} tool calls in this session (tool, outcome, duration, sizes; never arguments or results) are attached automatically, so do not repeat them. The report is stored on this machine in the user's Trickroom home for review; nothing is sent anywhere. Leave out secrets, file contents and design content.`,
			inputSchema: {
				summary: z
					.string()
					.min(1)
					.describe(
						`One line: what went wrong or what you needed (up to ${FEEDBACK_LIMITS.summary} characters).`,
					),
				category: z
					.enum(FEEDBACK_CATEGORIES)
					.optional()
					.describe(
						"error: a tool failed; confusing: unclear schema, name or message; missing_capability; output_too_large; slow; wrong_result: looked right but was not; docs: guide or description wrong; idea.",
					),
				severity: z
					.enum(FEEDBACK_SEVERITIES)
					.optional()
					.describe(
						"blocker: you could not finish; friction: you found a workaround; minor.",
					),
				tools: z
					.union([z.string(), z.array(z.string())])
					.optional()
					.describe(`Tool names involved, e.g. ["${TOOL.designApply}"].`),
				details: z
					.string()
					.optional()
					.describe(
						`What you were trying to do and what happened (up to ${FEEDBACK_LIMITS.details} characters).`,
					),
				expected: z.string().optional().describe("What you expected instead."),
				suggestion: z
					.string()
					.optional()
					.describe("A fix or change that would have helped."),
			},
			annotations: mutationAnnotations,
			_meta: {
				[SEARCH_HINT_META_KEY]:
					"feedback report bug problem issue friction complaint broken confusing error tool improve suggestion",
			},
		},
		async (input) => {
			const selected = ctx.getSelectedContext();
			const client = getClientInfo();
			const recentCalls = callHistory.recent();
			const entry = buildFeedbackEntry(input, {
				id: randomUUID(),
				t: new Date().toISOString(),
				trickroomVersion: TRICKROOM_VERSION,
				sessionId,
				...(client?.name
					? {
							client: {
								name: client.name.slice(0, FEEDBACK_LIMITS.toolName),
								...(client.version
									? {
											version: client.version.slice(
												0,
												FEEDBACK_LIMITS.toolName,
											),
										}
									: {}),
							},
						}
					: {}),
				...(selected?.config.projectId || selected?.locationId
					? {
							project: {
								...(selected.config.projectId
									? { projectId: selected.config.projectId }
									: {}),
								...(selected.locationId
									? { locationId: selected.locationId }
									: {}),
							},
						}
					: {}),
				recentCalls,
			});

			try {
				const filePath = await appendFeedbackEntry(entry, feedbackHome);
				return createJsonResult({
					status: "recorded",
					id: entry.id,
					storedIn: filePath,
					attachedCalls: entry.recentCalls.length,
					...(entry.truncated
						? {
								truncated: entry.truncated,
								note: "Fields over their limit were shortened.",
							}
						: {}),
				});
			} catch (error) {
				const reason =
					error instanceof Error
						? ((error as NodeJS.ErrnoException).code ?? error.message)
						: String(error);
				return createJsonResult({
					status: "not_recorded",
					message: `Feedback could not be stored in ${path.join(feedbackHome, "feedback")} (${reason}). Nothing else is affected; carry on with your task.`,
				});
			}
		},
	);
};
