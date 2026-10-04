import { readFileSync } from "node:fs";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
	CallToolRequestSchema,
	type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";
import {
	appendCallLogEntry,
	FEEDBACK_SCHEMA_VERSION,
	type ToolCallRecord,
} from "../app-state/feedback";
import {
	getTrickroomSettingsPath,
	isTrickroomSettings,
} from "../app-state/settings";
import { TOOL } from "./tool-names";

/**
 * Per-session record of recent tool calls: tool name, outcome, duration and
 * sizes, never arguments or results. `feedback_submit` attaches the last few
 * to a report, the optional call log appends each one to disk, and a second
 * consecutive failure of the same tool gets a `feedbackHint`.
 */

const HISTORY_SIZE = 20;
export const FEEDBACK_RECENT_CALLS = 10;
const MAX_TOOL_NAME = 64;

export const FEEDBACK_HINT = `Second failure in a row from this tool. If the tool rather than your input is at fault (unclear schema, misleading error, missing capability), tell the Trickroom developers with ${TOOL.feedbackSubmit}; your recent calls are attached automatically.`;

export type ToolCallHistory = {
	/** Record a finished call; true when its result should carry the hint. */
	record: (record: ToolCallRecord) => boolean;
	/** The last `limit` calls, oldest first. */
	recent: (limit?: number) => ToolCallRecord[];
};

export const createToolCallHistory = (
	onRecord?: (record: ToolCallRecord) => void,
): ToolCallHistory => {
	const calls: ToolCallRecord[] = [];
	const failureStreaks = new Map<string, number>();
	const hinted = new Set<string>();

	return {
		record: (record) => {
			calls.push(record);
			if (calls.length > HISTORY_SIZE) calls.shift();
			onRecord?.(record);

			if (record.outcome === "ok") {
				failureStreaks.delete(record.tool);
				return false;
			}
			const streak = (failureStreaks.get(record.tool) ?? 0) + 1;
			failureStreaks.set(record.tool, streak);
			// Once per tool and session, so repeated failures do not nag.
			if (
				streak < 2 ||
				hinted.has(record.tool) ||
				record.tool === TOOL.feedbackSubmit
			) {
				return false;
			}
			hinted.add(record.tool);
			return true;
		},
		recent: (limit = FEEDBACK_RECENT_CALLS) =>
			calls.slice(-limit).map((call) => ({ ...call })),
	};
};

const firstText = (result: CallToolResult) => {
	const block = result.content.find((entry) => entry.type === "text");
	return block?.type === "text" ? block.text : "";
};

const parseObject = (text: string): Record<string, unknown> | null => {
	if (!text.startsWith("{")) return null;
	try {
		const value = JSON.parse(text) as unknown;
		return typeof value === "object" && value !== null && !Array.isArray(value)
			? (value as Record<string, unknown>)
			: null;
	} catch {
		return null;
	}
};

/** Outcome and error code of a tool result, without keeping any of it. */
export const classifyToolResult = (
	result: CallToolResult,
): Pick<ToolCallRecord, "outcome" | "code"> => {
	if (!result.isError) return { outcome: "ok" };
	// SDK errors read "MCP error -32602: Input validation error: ...".
	const text = firstText(result).replace(/^MCP error -?\d+: /u, "");
	if (text.startsWith("Input validation error")) {
		return { outcome: "invalid_input" };
	}
	const payload = parseObject(text);
	const code = payload?.code ?? payload?.status;
	if (typeof code === "string" && code) {
		return { outcome: "error", code: code.slice(0, MAX_TOOL_NAME) };
	}
	if (/^Tool .+ not found$/u.test(text)) {
		return { outcome: "error", code: "unknown_tool" };
	}
	if (/^Tool .+ disabled$/u.test(text)) {
		return { outcome: "error", code: "tool_disabled" };
	}
	return { outcome: "error", code: "exception" };
};

/** Characters a client receives: text, and base64 data for images and audio. */
export const measureToolResult = (result: CallToolResult) =>
	result.content.reduce((total, block) => {
		if (block.type === "text") return total + block.text.length;
		if ("data" in block && typeof block.data === "string") {
			return total + block.data.length;
		}
		return total + JSON.stringify(block).length;
	}, 0);

/** The error result with `feedbackHint` added to its JSON, or as a last line. */
export const withFeedbackHint = (result: CallToolResult): CallToolResult => {
	const index = result.content.findIndex((entry) => entry.type === "text");
	const block = result.content[index];
	if (block?.type !== "text") {
		return {
			...result,
			content: [
				...result.content,
				{ type: "text", text: `feedbackHint: ${FEEDBACK_HINT}` },
			],
		};
	}
	const payload = parseObject(block.text);
	const text = payload
		? JSON.stringify({ ...payload, feedbackHint: FEEDBACK_HINT })
		: `${block.text}\n\nfeedbackHint: ${FEEDBACK_HINT}`;
	const content = [...result.content];
	content[index] = { ...block, text };
	return { ...result, content };
};

/**
 * Whether this session appends every call to the call log:
 * `TRICKROOM_MCP_CALL_LOG` (1/true or 0/false) wins, then `mcp.callLog` in
 * settings.json. Read once at startup; an unreadable file means off.
 */
export const isCallLogEnabled = (
	trickroomHome: string,
	env = process.env.TRICKROOM_MCP_CALL_LOG,
) => {
	const override = env?.trim().toLowerCase();
	if (override === "1" || override === "true") return true;
	if (override === "0" || override === "false") return false;
	try {
		const settings = JSON.parse(
			readFileSync(getTrickroomSettingsPath(trickroomHome), "utf8"),
		) as unknown;
		return isTrickroomSettings(settings) && settings.mcp.callLog === true;
	} catch {
		return false;
	}
};

/**
 * A sink that appends call records to the call log in call order. Write
 * failures are dropped: the log is a best-effort usage record and must never
 * fail a tool call.
 */
export const createCallLogWriter = ({
	trickroomHome,
	sessionId,
	getClientName,
}: {
	trickroomHome: string;
	sessionId: string;
	getClientName: () => string | undefined;
}) => {
	let queue: Promise<void> = Promise.resolve();
	const write = (record: ToolCallRecord) => {
		const client = getClientName();
		queue = queue
			.then(() =>
				appendCallLogEntry(
					{
						v: FEEDBACK_SCHEMA_VERSION,
						sessionId,
						...(client ? { client } : {}),
						...record,
					},
					trickroomHome,
				),
			)
			.catch(() => undefined);
	};
	return { write, flush: () => queue };
};

type CallToolHandler = (
	request: { params: { name: string; arguments?: Record<string, unknown> } },
	extra: unknown,
) => Promise<CallToolResult | Record<string, unknown>>;

/**
 * Record every tools/call, including the ones the SDK rejects before a tool
 * handler runs (unknown tool, invalid arguments). Call before the first
 * registerTool: McpServer installs its tools/call handler on the first
 * registration, through this method.
 */
export const installToolCallRecording = (
	server: McpServer,
	history: ToolCallHistory,
) => {
	const protocol = server.server;
	const setRequestHandler = protocol.setRequestHandler.bind(protocol);

	const recordCalls =
		(handler: CallToolHandler): CallToolHandler =>
		async (request, extra) => {
			const startedAt = new Date();
			const started = performance.now();
			const tool = String(request.params?.name ?? "").slice(0, MAX_TOOL_NAME);
			const inChars = JSON.stringify(request.params?.arguments ?? {}).length;
			const finish = (
				outcome: Pick<ToolCallRecord, "outcome" | "code">,
				outChars: number,
			) =>
				history.record({
					t: startedAt.toISOString(),
					tool,
					...outcome,
					ms: Math.round(performance.now() - started),
					inChars,
					outChars,
				});

			let result: Awaited<ReturnType<CallToolHandler>>;
			try {
				result = await handler(request, extra);
			} catch (error) {
				finish({ outcome: "error", code: "exception" }, 0);
				throw error;
			}
			// Task results (CreateTaskResult) carry no content to classify.
			if (!Array.isArray(result.content)) return result;
			const toolResult = result as CallToolResult;
			const hint = finish(
				classifyToolResult(toolResult),
				measureToolResult(toolResult),
			);
			return hint ? withFeedbackHint(toolResult) : toolResult;
		};

	protocol.setRequestHandler = ((schema: unknown, handler: CallToolHandler) =>
		setRequestHandler(
			schema as typeof CallToolRequestSchema,
			(schema === CallToolRequestSchema
				? recordCalls(handler)
				: handler) as never,
		)) as typeof protocol.setRequestHandler;
};
