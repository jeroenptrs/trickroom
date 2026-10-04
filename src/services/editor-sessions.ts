import type {
	EditorClientContext,
	EditorContextReport,
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

export const createEditorSessions = ({
	now = () => Date.now(),
}: {
	now?: () => number;
} = {}) => {
	const clients = new Map<string, EditorClient>();

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
	};
};
