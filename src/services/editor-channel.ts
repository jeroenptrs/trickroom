import path from "node:path";
import {
	listServerDiscoveryRecords,
	removeServerDiscoveryRecordFile,
	type ServerDiscoveryRecord,
} from "../app-state/runtime-servers";
import { trickroomSessionHeaderName } from "../server-auth";
import type {
	EditorClientContext,
	EditorContextResponse,
	EditorFocusOutcome,
	EditorFocusResponse,
} from "./editor-channel.types";

// Local client of the editor channel, for processes other than the HTTP server
// (the MCP server). It finds running servers through their discovery records,
// asks the one serving the project, and always answers with a status instead
// of throwing: an agent's tool call must never fail or hang because no browser
// is open.

export type EditorChannelStatus =
	| "ok"
	| "no_server"
	| "no_browser"
	| "browser_on_other_project"
	| "stale"
	| "blocked_dirty";

export type EditorChannelServer = {
	pid: number;
	url: string;
	projectId: string | null;
	projectRoot: string | null;
	startedAt: string;
};

export type EditorChannelOptions = {
	/** Trickroom home holding `runtime/servers`; defaults to TRICKROOM_HOME. */
	home?: string;
	/** Per-request timeouts in milliseconds. */
	timeouts?: Partial<EditorChannelTimeouts>;
};

export type EditorChannelTimeouts = {
	health: number;
	context: number;
	/** Must exceed the server's wait for the tab's acknowledgement (2s). */
	focus: number;
};

const defaultTimeouts: EditorChannelTimeouts = {
	health: 750,
	context: 1_500,
	focus: 3_500,
};

export type EditorContextResult =
	| {
			status: "ok";
			server: EditorChannelServer;
			/** Tabs showing the project, most recently focused first. */
			clients: EditorClientContext[];
			/** The tab the human most likely looks at. */
			focused: EditorClientContext;
	  }
	| {
			status: Exclude<EditorChannelStatus, "ok" | "blocked_dirty">;
			message: string;
			server: EditorChannelServer | null;
			/** Projects other servers or tabs show, for `browser_on_other_project`. */
			otherProjects: Array<{
				projectId: string | null;
				projectRoot: string | null;
			}>;
	  };

export type EditorFocusInput = {
	projectId: string;
	designFileId: string;
	boardId?: string | null;
	elementId?: string | null;
	/** Target tab; defaults to the most recently focused tab on the project. */
	clientId?: string | null;
};

export type EditorFocusResult = {
	status: EditorChannelStatus;
	message: string | null;
	server: EditorChannelServer | null;
	clientId: string | null;
	/** How the tab handled the request when status is `ok`. */
	outcome: EditorFocusOutcome | null;
};

type LiveServer = {
	record: ServerDiscoveryRecord;
	/** The project the server reports as active right now. */
	projectId: string | null;
	projectRoot: string | null;
};

type ServerContext = {
	server: LiveServer;
	/** Null when the context request failed or timed out. */
	context: EditorContextResponse | null;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const readNullableString = (value: unknown) =>
	typeof value === "string" ? value : null;

const isProcessAlive = (pid: number) => {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		// EPERM: the process exists but belongs to another user.
		return isRecord(error) && error.code === "EPERM";
	}
};

const pidFromRecordPath = (filePath: string) => {
	const pid = Number.parseInt(path.basename(filePath, ".json"), 10);
	return Number.isInteger(pid) && pid > 0 ? pid : null;
};

const requestJson = async (
	record: ServerDiscoveryRecord,
	route: string,
	timeoutMs: number,
	init: { method?: string; body?: unknown } = {},
) => {
	const headers: Record<string, string> = {};
	if (record.token) {
		headers[trickroomSessionHeaderName] = record.token;
	}
	if (init.body !== undefined) {
		headers["content-type"] = "application/json";
	}
	const response = await fetch(new URL(route, record.url), {
		method: init.method ?? "GET",
		headers,
		body: init.body === undefined ? undefined : JSON.stringify(init.body),
		signal: AbortSignal.timeout(timeoutMs),
	});
	return { status: response.status, body: (await response.json()) as unknown };
};

const errorCode = (error: unknown) => {
	const cause = isRecord(error) ? error.cause : undefined;
	return isRecord(cause) && typeof cause.code === "string" ? cause.code : null;
};

type ProbeResult =
	| { kind: "live"; projectId: string | null; projectRoot: string | null }
	/** Nothing (or not this server) answers at the record's URL. */
	| { kind: "gone" }
	/** Did not answer in time; may be busy, so its record is kept. */
	| { kind: "unreachable" };

const probeServer = async (
	record: ServerDiscoveryRecord,
	timeoutMs: number,
): Promise<ProbeResult> => {
	try {
		const { status, body } = await requestJson(
			record,
			"api/trickroom/health",
			timeoutMs,
		);
		if (status !== 200 || !isRecord(body) || body.ok !== true) {
			// 403: another server (another token) now owns the port.
			return { kind: "gone" };
		}
		const active = isRecord(body.activeProject) ? body.activeProject : null;
		return {
			kind: "live",
			projectId:
				typeof active?.projectId === "string" && active.projectId
					? active.projectId
					: null,
			projectRoot:
				typeof active?.projectRoot === "string" ? active.projectRoot : null,
		};
	} catch (error) {
		return errorCode(error) === "ECONNREFUSED" || error instanceof SyntaxError
			? { kind: "gone" }
			: { kind: "unreachable" };
	}
};

/**
 * Lists servers that are running and answering. Records of dead processes and
 * of servers that no longer answer at their URL are deleted on the way.
 */
export const discoverEditorServers = async (
	options: EditorChannelOptions = {},
): Promise<LiveServer[]> => {
	const timeouts = { ...defaultTimeouts, ...options.timeouts };
	const entries = await listServerDiscoveryRecords(options.home);
	const results = await Promise.all(
		entries.map(async (entry): Promise<LiveServer | null> => {
			const pid = entry.record?.pid ?? pidFromRecordPath(entry.path);
			if (pid !== null && !isProcessAlive(pid)) {
				await removeServerDiscoveryRecordFile(entry.path);
				return null;
			}
			if (!entry.record) {
				return null;
			}
			const probe = await probeServer(entry.record, timeouts.health);
			if (probe.kind === "gone") {
				await removeServerDiscoveryRecordFile(entry.path);
				return null;
			}
			if (probe.kind === "unreachable") {
				return null;
			}
			return {
				record: entry.record,
				projectId: probe.projectId,
				projectRoot: probe.projectRoot,
			};
		}),
	);
	return results.filter((server) => server !== null);
};

const toServerInfo = (server: LiveServer): EditorChannelServer => ({
	pid: server.record.pid,
	url: server.record.url,
	projectId: server.projectId,
	projectRoot: server.projectRoot,
	startedAt: server.record.startedAt,
});

const fetchContext = async (
	server: LiveServer,
	timeoutMs: number,
): Promise<ServerContext> => {
	try {
		const { status, body } = await requestJson(
			server.record,
			"api/trickroom/editor-context",
			timeoutMs,
		);
		return {
			server,
			context: status === 200 ? parseContextResponse(body) : null,
		};
	} catch {
		return { server, context: null };
	}
};

const isClientContext = (value: unknown): value is EditorClientContext =>
	isRecord(value) &&
	typeof value.clientId === "string" &&
	(value.projectId === null || typeof value.projectId === "string") &&
	(value.focusedAt === null || typeof value.focusedAt === "string") &&
	typeof value.ageMs === "number";

const parseContextResponse = (value: unknown): EditorContextResponse | null => {
	if (!isRecord(value) || !Array.isArray(value.clients)) {
		return null;
	}
	return {
		projectId: readNullableString(value.projectId),
		clients: value.clients.filter(isClientContext),
		mostRecentlyFocusedClientId: readNullableString(
			value.mostRecentlyFocusedClientId,
		),
	};
};

const focusTime = (client: EditorClientContext) =>
	client.focusedAt ? Date.parse(client.focusedAt) : Number.NEGATIVE_INFINITY;

/** Most recently focused first; the latest report breaks ties. */
const byFocus = (a: EditorClientContext, b: EditorClientContext) =>
	focusTime(b) - focusTime(a) || a.ageMs - b.ageMs;

type Selection =
	| {
			status: "ok";
			server: LiveServer;
			clients: EditorClientContext[];
	  }
	| {
			status: Exclude<EditorChannelStatus, "ok" | "blocked_dirty">;
			message: string;
			server: LiveServer | null;
			otherProjects: Array<{
				projectId: string | null;
				projectRoot: string | null;
			}>;
	  };

/**
 * Picks the server and tabs for a project. Exported for tests: `contexts` are
 * the editor contexts of every live server.
 */
export const selectEditorServer = (
	projectId: string,
	contexts: ServerContext[],
	clientId?: string | null,
): Selection => {
	if (contexts.length === 0) {
		return {
			status: "no_server",
			message:
				"No Trickroom server is running. Start one with `trickroom serve` or `pnpm dev`.",
			server: null,
			otherProjects: [],
		};
	}

	const onProject = contexts.filter(
		({ server }) => server.projectId === projectId,
	);
	const otherProjects = (entries: ServerContext[]) => {
		const seen = new Map<
			string,
			{ projectId: string | null; projectRoot: string | null }
		>();
		for (const { server, context } of entries) {
			if (server.projectId !== projectId) {
				seen.set(`${server.projectId}`, {
					projectId: server.projectId,
					projectRoot: server.projectRoot,
				});
			}
			for (const client of context?.clients ?? []) {
				if (
					client.projectId !== projectId &&
					!seen.has(`${client.projectId}`)
				) {
					seen.set(`${client.projectId}`, {
						projectId: client.projectId,
						projectRoot: null,
					});
				}
			}
		}
		return [...seen.values()];
	};
	const hasTabs = (entries: ServerContext[]) =>
		entries.some(({ context }) => (context?.clients.length ?? 0) > 0);

	if (onProject.length === 0) {
		return hasTabs(contexts)
			? {
					status: "browser_on_other_project",
					message:
						"The browser shows another project. Ask the human to open this project in Trickroom; it is not switched automatically.",
					server: null,
					otherProjects: otherProjects(contexts),
				}
			: {
					status: "no_server",
					message: "No running Trickroom server has this project open.",
					server: null,
					otherProjects: otherProjects(contexts),
				};
	}

	const answering = onProject.filter(({ context }) => context !== null);
	if (answering.length === 0) {
		return {
			status: "stale",
			message: "The Trickroom server for this project did not answer in time.",
			server: onProject[0]?.server ?? null,
			otherProjects: [],
		};
	}

	const candidates = answering
		.map(({ server, context }) => ({
			server,
			clients: (context?.clients ?? [])
				.filter(
					(client) =>
						client.projectId === projectId &&
						(!clientId || client.clientId === clientId),
				)
				.sort(byFocus),
		}))
		.filter(({ clients }) => clients.length > 0)
		.sort((a, b) => byFocus(a.clients[0], b.clients[0]));

	const best = candidates[0];
	if (!best) {
		const server = answering[0]?.server ?? null;
		if (clientId) {
			return {
				status: "no_browser",
				message: `Browser tab "${clientId}" is not connected to this project.`,
				server,
				otherProjects: [],
			};
		}
		return hasTabs(answering)
			? {
					status: "browser_on_other_project",
					message:
						"The open browser tabs show another project; they are not switched automatically.",
					server,
					otherProjects: otherProjects(answering),
				}
			: {
					status: "no_browser",
					message:
						"The Trickroom server is running but no browser tab has the project open.",
					server,
					otherProjects: [],
				};
	}

	return { status: "ok", server: best.server, clients: best.clients };
};

const collectContexts = async (options: EditorChannelOptions) => {
	const timeouts = { ...defaultTimeouts, ...options.timeouts };
	const servers = await discoverEditorServers(options);
	return {
		timeouts,
		contexts: await Promise.all(
			servers.map((server) => fetchContext(server, timeouts.context)),
		),
	};
};

/** What the human is looking at in the project, if a browser has it open. */
export const getEditorContext = async (
	projectId: string,
	options: EditorChannelOptions = {},
): Promise<EditorContextResult> => {
	try {
		const { contexts } = await collectContexts(options);
		const selection = selectEditorServer(projectId, contexts);
		if (selection.status !== "ok") {
			return {
				...selection,
				server: selection.server ? toServerInfo(selection.server) : null,
			};
		}
		const [focused] = selection.clients;
		return {
			status: "ok",
			server: toServerInfo(selection.server),
			clients: selection.clients,
			focused,
		};
	} catch (error) {
		return {
			status: "no_server",
			message: `Could not read the Trickroom server records: ${error instanceof Error ? error.message : String(error)}`,
			server: null,
			otherProjects: [],
		};
	}
};

const isFocusStatus = (
	value: unknown,
): value is EditorFocusResponse["status"] =>
	value === "ok" ||
	value === "no_browser" ||
	value === "browser_on_other_project" ||
	value === "blocked_dirty" ||
	value === "stale";

const isFocusOutcome = (value: unknown): value is EditorFocusOutcome =>
	value === "revealed" || value === "navigated" || value === "queued";

/**
 * Asks the browser to show a design, optionally a board and a layer in it.
 * Goes to the given tab, or the most recently focused tab on the project.
 */
export const requestEditorFocus = async (
	input: EditorFocusInput,
	options: EditorChannelOptions = {},
): Promise<EditorFocusResult> => {
	const failed = (
		status: EditorChannelStatus,
		message: string,
		server: EditorChannelServer | null = null,
	): EditorFocusResult => ({
		status,
		message,
		server,
		clientId: null,
		outcome: null,
	});

	try {
		const { contexts, timeouts } = await collectContexts(options);
		const selection = selectEditorServer(
			input.projectId,
			contexts,
			input.clientId,
		);
		if (selection.status !== "ok") {
			return failed(
				selection.status,
				selection.message,
				selection.server ? toServerInfo(selection.server) : null,
			);
		}

		const server = toServerInfo(selection.server);
		const clientId = input.clientId ?? selection.clients[0]?.clientId ?? null;
		let response: unknown;
		try {
			response = (
				await requestJson(
					selection.server.record,
					"api/trickroom/editor-focus",
					timeouts.focus,
					{
						method: "POST",
						body: {
							projectId: input.projectId,
							designFileId: input.designFileId,
							boardId: input.boardId ?? null,
							elementId: input.elementId ?? null,
							clientId,
						},
					},
				)
			).body;
		} catch {
			return failed(
				"stale",
				"The Trickroom server did not answer the focus request in time.",
				server,
			);
		}

		if (!isRecord(response) || !isFocusStatus(response.status)) {
			return failed(
				"stale",
				isRecord(response) && typeof response.error === "string"
					? response.error
					: "The Trickroom server sent an unexpected focus response.",
				server,
			);
		}
		return {
			status: response.status,
			message: readNullableString(response.message),
			server,
			clientId: readNullableString(response.clientId),
			outcome: isFocusOutcome(response.outcome) ? response.outcome : null,
		};
	} catch (error) {
		return failed(
			"no_server",
			`Could not read the Trickroom server records: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
};
