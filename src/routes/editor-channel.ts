import { Hono } from "hono";
import { jsonError } from "../server-utils";
import type { EditorContextResponse } from "../services/editor-channel.types";
import {
	type EditorSessions,
	parseEditorContextReport,
} from "../services/editor-sessions";

/**
 * Routes of the editor channel: browser tabs report what they show, local
 * clients such as the MCP server read it. Mounted under `/api/trickroom`.
 */
export const createEditorChannelRoutes = ({
	sessions,
	getActiveProjectId,
}: {
	sessions: EditorSessions;
	getActiveProjectId: () => Promise<string | null>;
}) => {
	const routes = new Hono();

	routes.get("/editor-context", async (c) => {
		const response: EditorContextResponse = {
			projectId: await getActiveProjectId(),
			...sessions.list(),
		};
		return c.json(response);
	});

	routes.post("/editor-context", async (c) => {
		const report = parseEditorContextReport(
			await c.req.json().catch(() => null),
		);
		if (!report) {
			return jsonError("Invalid editor context report.", 400);
		}

		sessions.report(report);
		return c.json({ ok: true });
	});

	return routes;
};
