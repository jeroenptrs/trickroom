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
			description: `Report friction with these MCP tools to the Trickroom developers: a tool that blocked or misled you, an error you could not act on, unusable output, a wrong result, or a missing capability. Not for design content questions. Only summary is required; your last ${FEEDBACK_RECENT_CALLS} calls this session (tool, outcome, duration, sizes; never arguments or results) are attached, so do not repeat them. Stored on this machine for review; nothing is sent anywhere. Leave out secrets and design content.`,
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
						"confusing: unclear schema, name or message; wrong_result: looked right but was not; docs: guide or description wrong.",
					),
				severity: z
					.enum(FEEDBACK_SEVERITIES)
					.optional()
					.describe("blocker: could not finish; friction: found a workaround."),
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
				suggestion: z.string().optional().describe("What would have helped."),
			},
			annotations: mutationAnnotations,
			_meta: {
				[SEARCH_HINT_META_KEY]:
					"feedback report bug issue problem friction broken confusing improve",
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
