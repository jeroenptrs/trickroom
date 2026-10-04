import { randomUUID } from "node:crypto";
import type {
	EditorClientContext,
	EditorContextReport,
	EditorFocusAck,
	EditorFocusEvent,
	EditorFocusOutcome,
	EditorFocusResponse,
	EditorFocusTarget,
	EditorStageMode,
} from "./editor-channel.types";

// In-memory registry of the browser tabs connected to one server. A tab exists
// while it holds at least one SSE stream; its context is whatever it last
// reported. Nothing is written to disk.

export type EditorEventSender = (event: string, data: string) => void;

type StoredContext = Omit<EditorContextReport, "sentAt" | "focusedAt"> & {
	/** Server-clock epoch ms, or null when the tab has not been focused. */
	focusedAt: number | null;
	reportedAt: number;
};

type EditorClient = {
	senders: Set<EditorEventSender>;
	context: StoredContext | null;
	lastSeenAt: number;
};

/** Reports from tabs that never open a stream are forgotten after this. */
const unconnectedClientTtlMs = 60_000;

const clientIdPattern = /^[A-Za-z0-9_-]{1,128}$/;

export const isEditorClientId = (value: unknown): value is string =>
	typeof value === "string" && clientIdPattern.test(value);

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const readNullableString = (value: unknown, maxLength = 512) =>
	typeof value === "string" && value.length > 0 && value.length <= maxLength
		? value
		: null;

const readNullableNumber = (value: unknown) =>
	typeof value === "number" && Number.isFinite(value) ? value : null;

const readStageMode = (value: unknown): EditorStageMode | null =>
	value === "canvas" || value === "responsive" ? value : null;

const isFocusAckStatus = (value: unknown): value is EditorFocusAck["status"] =>
	value === "ok" ||
	value === "blocked_dirty" ||
	value === "browser_on_other_project";

const isFocusOutcome = (value: unknown): value is EditorFocusOutcome =>
	value === "revealed" || value === "navigated" || value === "queued";

/** Validates a tab's acknowledgement of a focus request. */
export const parseEditorFocusAck = (value: unknown): EditorFocusAck | null => {
	if (
		!isRecord(value) ||
		!isEditorClientId(value.clientId) ||
		typeof value.requestId !== "string" ||
		!isFocusAckStatus(value.status)
	) {
		return null;
	}
	return {
		clientId: value.clientId,
		requestId: value.requestId,
		status: value.status,
		outcome: isFocusOutcome(value.outcome) ? value.outcome : null,
	};
};

/** Validates a tab's report; returns null when it is not one. */
export const parseEditorContextReport = (
	value: unknown,
): EditorContextReport | null => {
	if (!isRecord(value) || !isEditorClientId(value.clientId)) {
		return null;
	}
	const sentAt = readNullableNumber(value.sentAt);
	if (sentAt === null || typeof value.visible !== "boolean") {
		return null;
	}

	return {
		clientId: value.clientId,
		projectId: readNullableString(value.projectId),
		designFileId: readNullableString(value.designFileId),
		activeBoardId: readNullableString(value.activeBoardId),
		selectedId: readNullableString(value.selectedId),
		stageMode: readStageMode(value.stageMode),
		responsiveWidth: readNullableNumber(value.responsiveWidth),
		focusedAt: readNullableNumber(value.focusedAt),
		visible: value.visible,
		sentAt,
	};
};

export type EditorSessions = ReturnType<typeof createEditorSessions>;

/** How long a focus request waits for the tab to acknowledge it. */
export const editorFocusAckTimeoutMs = 2_000;

export const createEditorSessions = ({
	now = () => Date.now(),
	focusAckTimeoutMs = editorFocusAckTimeoutMs,
}: {
	now?: () => number;
	focusAckTimeoutMs?: number;
} = {}) => {
	const clients = new Map<string, EditorClient>();
	const pendingAcks = new Map<
		string,
		{ clientId: string; resolve: (ack: EditorFocusAck | null) => void }
	>();

	const pruneUnconnected = (at: number) => {
		for (const [clientId, client] of clients) {
			if (
				client.senders.size === 0 &&
				at - client.lastSeenAt > unconnectedClientTtlMs
			) {
				clients.delete(clientId);
			}
		}
	};

	const getOrCreate = (clientId: string) => {
		let client = clients.get(clientId);
		if (!client) {
			client = { senders: new Set(), context: null, lastSeenAt: now() };
			clients.set(clientId, client);
		}
		return client;
	};

	const toClientContext = (
		clientId: string,
		context: StoredContext,
		at: number,
	): EditorClientContext => ({
		clientId,
		projectId: context.projectId,
		designFileId: context.designFileId,
		activeBoardId: context.activeBoardId,
		selectedId: context.selectedId,
		stageMode: context.stageMode,
		responsiveWidth: context.responsiveWidth,
		visible: context.visible,
		focusedAt:
			context.focusedAt === null
				? null
				: new Date(context.focusedAt).toISOString(),
		reportedAt: new Date(context.reportedAt).toISOString(),
		ageMs: Math.max(0, at - context.reportedAt),
	});

	/** Connected tabs that have reported, most recently focused first. */
	const listConnected = () => {
		const at = now();
		pruneUnconnected(at);
		const connected: Array<{ clientId: string; context: StoredContext }> = [];
		for (const [clientId, client] of clients) {
			if (client.senders.size > 0 && client.context) {
				connected.push({ clientId, context: client.context });
			}
		}
		connected.sort(
			(a, b) =>
				(b.context.focusedAt ?? Number.NEGATIVE_INFINITY) -
					(a.context.focusedAt ?? Number.NEGATIVE_INFINITY) ||
				b.context.reportedAt - a.context.reportedAt,
		);
		return { at, connected };
	};

	return {
		/** Registers an SSE stream for a tab; call the result when it closes. */
		connect(clientId: string, send: EditorEventSender) {
			const client = getOrCreate(clientId);
			client.senders.add(send);
			client.lastSeenAt = now();
			return () => {
				client.senders.delete(send);
				if (client.senders.size === 0 && clients.get(clientId) === client) {
					clients.delete(clientId);
				}
			};
		},

		report(report: EditorContextReport) {
			const at = now();
			const client = getOrCreate(report.clientId);
			client.lastSeenAt = at;
			// Move the tab's focus time onto the server clock so tabs in different
			// browsers or machines compare fairly.
			const clockOffset = at - report.sentAt;
			client.context = {
				clientId: report.clientId,
				projectId: report.projectId,
				designFileId: report.designFileId,
				activeBoardId: report.activeBoardId,
				selectedId: report.selectedId,
				stageMode: report.stageMode,
				responsiveWidth: report.responsiveWidth,
				visible: report.visible,
				focusedAt:
					report.focusedAt === null ? null : report.focusedAt + clockOffset,
				reportedAt: at,
			};
		},

		list() {
			const { at, connected } = listConnected();
			return {
				clients: connected.map(({ clientId, context }) =>
					toClientContext(clientId, context, at),
				),
				mostRecentlyFocusedClientId: connected[0]?.clientId ?? null,
			};
		},

		/**
		 * Sends a `focus` event to one tab and waits for it to acknowledge. The
		 * target is `clientId` when given, otherwise the most recently focused
		 * tab showing `projectId`.
		 */
		async requestFocus({
			target,
			projectId,
			clientId,
		}: {
			target: EditorFocusTarget;
			projectId: string | null;
			clientId?: string | null;
		}): Promise<EditorFocusResponse> {
			const result = (
				status: EditorFocusResponse["status"],
				message: string | null,
				fields: Partial<EditorFocusResponse> = {},
			): EditorFocusResponse => ({
				status,
				clientId: null,
				requestId: null,
				outcome: null,
				message,
				...fields,
			});

			const { connected } = listConnected();
			if (connected.length === 0) {
				return result("no_browser", "No browser tab is connected.");
			}

			const onProject = connected.filter(
				(entry) => projectId === null || entry.context.projectId === projectId,
			);
			const chosen = clientId
				? connected.find((entry) => entry.clientId === clientId)
				: onProject[0];
			if (!chosen) {
				return clientId
					? result("no_browser", `Browser tab "${clientId}" is not connected.`)
					: result(
							"browser_on_other_project",
							"Every connected browser tab shows another project.",
						);
			}
			if (projectId !== null && chosen.context.projectId !== projectId) {
				return result(
					"browser_on_other_project",
					"The browser tab shows another project.",
					{ clientId: chosen.clientId },
				);
			}

			const client = clients.get(chosen.clientId);
			if (!client) {
				return result("no_browser", "The browser tab disconnected.");
			}

			const requestId = randomUUID();
			const event: EditorFocusEvent = { ...target, requestId, projectId };
			const ack = await new Promise<EditorFocusAck | null>((resolve) => {
				const timer = setTimeout(() => {
					pendingAcks.delete(requestId);
					resolve(null);
				}, focusAckTimeoutMs);
				pendingAcks.set(requestId, {
					clientId: chosen.clientId,
					resolve: (value) => {
						clearTimeout(timer);
						pendingAcks.delete(requestId);
						resolve(value);
					},
				});
				for (const send of client.senders) {
					send("focus", JSON.stringify(event));
				}
			});

			if (!ack) {
				return result(
					"stale",
					"The browser tab did not respond to the focus request.",
					{ clientId: chosen.clientId, requestId },
				);
			}
			return result(
				ack.status,
				ack.status === "blocked_dirty"
					? "The browser tab has unsaved changes or a pending conflict in another design."
					: ack.status === "browser_on_other_project"
						? "The browser tab shows another project."
						: null,
				{ clientId: chosen.clientId, requestId, outcome: ack.outcome },
			);
		},

		/** Resolves a pending focus request; false when it is unknown or expired. */
		acknowledgeFocus(ack: EditorFocusAck) {
			const pending = pendingAcks.get(ack.requestId);
			if (!pending || pending.clientId !== ack.clientId) {
				return false;
			}
			pending.resolve(ack);
			return true;
		},
	};
};
