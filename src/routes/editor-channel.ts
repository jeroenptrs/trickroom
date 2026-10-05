import { Hono } from "hono";
import { isRecord, jsonError } from "../server-utils";
import type {
	EditorContextResponse,
	EditorFocusRequest,
	EditorFocusResponse,
} from "../services/editor-channel.types";
import {
	type EditorSessions,
	isEditorClientId,
	parseEditorContextReport,
	parseEditorFocusAck,
} from "../services/editor-sessions";

const readId = (value: unknown) =>
	typeof value === "string" && value.trim().length > 0 && value.length <= 512
		? value.trim()
		: null;

const parseFocusRequest = (value: unknown): EditorFocusRequest | null => {
	if (!isRecord(value)) {
		return null;
	}
	const designFileId = readId(value.designFileId);
	if (!designFileId) {
		return null;
	}
	if (
		value.clientId !== undefined &&
		value.clientId !== null &&
		!isEditorClientId(value.clientId)
	) {
		return null;
	}
	return {
		designFileId,
		boardId: readId(value.boardId),
		elementId: readId(value.elementId),
		clientId: isEditorClientId(value.clientId) ? value.clientId : null,
		projectId: readId(value.projectId),
	};
};

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

	routes.post("/editor-focus", async (c) => {
		const request = parseFocusRequest(await c.req.json().catch(() => null));
		if (!request) {
			return jsonError(
				"Invalid focus request: designFileId is required; boardId, elementId, clientId and projectId are optional.",
				400,
			);
		}

		const activeProjectId = await getActiveProjectId();
		if (request.projectId && request.projectId !== activeProjectId) {
			const response: EditorFocusResponse = {
				status: "browser_on_other_project",
				clientId: null,
				requestId: null,
				outcome: null,
				message:
					"The server's active project is another project; the browser was not switched.",
			};
			return c.json(response);
		}

		const response = await sessions.requestFocus({
			target: {
				designFileId: request.designFileId,
				boardId: request.boardId,
				elementId: request.elementId,
			},
			projectId: request.projectId ?? activeProjectId,
			clientId: request.clientId,
		});
		return c.json(response);
	});

	routes.post("/editor-focus/ack", async (c) => {
		const ack = parseEditorFocusAck(await c.req.json().catch(() => null));
		if (!ack) {
			return jsonError("Invalid focus acknowledgement.", 400);
		}
		return c.json({ ok: sessions.acknowledgeFocus(ack) });
	});

	return routes;
};
