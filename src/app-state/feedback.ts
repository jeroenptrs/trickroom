import { mkdir, open, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { resolveTrickroomHome } from "./home";

/**
 * Agent feedback on the MCP tools, and the optional per-call log, stored as
 * append-only JSON Lines under `<TRICKROOM_HOME>/feedback/`, one file per
 * UTC month. Each line is written with one `write` on a file opened for
 * append, so several MCP processes can share a file without interleaving.
 * Nothing here leaves the machine. See docs/mcp.md#feedback.
 */

export const FEEDBACK_SCHEMA_VERSION = 1;

export const FEEDBACK_CATEGORIES = [
	"error",
	"confusing",
	"missing_capability",
	"output_too_large",
	"slow",
	"wrong_result",
	"docs",
	"idea",
] as const;
export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number];

export const FEEDBACK_SEVERITIES = ["blocker", "friction", "minor"] as const;
export type FeedbackSeverity = (typeof FEEDBACK_SEVERITIES)[number];

/** One tool call as the session history and the call log record it. */
export type ToolCallRecord = {
	/** ISO time the call started. */
	t: string;
	tool: string;
	/** invalid_input: the arguments failed the tool's input schema. */
	outcome: "ok" | "error" | "invalid_input";
	/** For errors: the result's code or status, or "exception". */
	code?: string;
	ms: number;
	/** Characters of the JSON arguments. */
	inChars: number;
	/** Characters of the result's text and image data. */
	outChars: number;
};

export type FeedbackClient = { name: string; version?: string };

export type FeedbackEntry = {
	v: typeof FEEDBACK_SCHEMA_VERSION;
	id: string;
	t: string;
	trickroomVersion: string;
	sessionId: string;
	client?: FeedbackClient;
	project?: { projectId?: string; locationId?: string };
	summary: string;
	category?: FeedbackCategory;
	severity?: FeedbackSeverity;
	tools?: string[];
	details?: string;
	expected?: string;
	suggestion?: string;
	/** The session's last calls before the report, oldest first. */
	recentCalls: ToolCallRecord[];
	/** Fields cut to fit the limits. */
	truncated?: string[];
};

export type CallLogEntry = ToolCallRecord & {
	v: typeof FEEDBACK_SCHEMA_VERSION;
	sessionId: string;
	client?: string;
};

export const FEEDBACK_LIMITS = {
	summary: 200,
	details: 4_000,
	expected: 1_000,
	suggestion: 1_000,
	tools: 10,
	toolName: 64,
	/** Whole JSON line, in characters. */
	entry: 12_000,
} as const;

export const getFeedbackDir = (trickroomHome = resolveTrickroomHome()) =>
	path.join(trickroomHome, "feedback");

const monthOf = (date: Date) => date.toISOString().slice(0, 7);

export const getFeedbackFilePath = (
	trickroomHome = resolveTrickroomHome(),
	date = new Date(),
) =>
	path.join(getFeedbackDir(trickroomHome), `feedback-${monthOf(date)}.jsonl`);

export const getCallLogFilePath = (
	trickroomHome = resolveTrickroomHome(),
	date = new Date(),
) => path.join(getFeedbackDir(trickroomHome), `calls-${monthOf(date)}.jsonl`);

/**
 * Append one JSON line with a single write. Lines stay whole when several
 * processes append to the same file: O_APPEND moves to the end and writes
 * the buffer in one step.
 */
export const appendJsonLine = async (filePath: string, value: unknown) => {
	const line = Buffer.from(`${JSON.stringify(value)}\n`, "utf8");
	await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
	const handle = await open(filePath, "a", 0o600);
	try {
		const { bytesWritten } = await handle.write(line);
		if (bytesWritten !== line.length) {
			throw new Error(
				`Short write to ${path.basename(filePath)} (${bytesWritten} of ${line.length} bytes).`,
			);
		}
	} finally {
		await handle.close();
	}
};

const truncateText = (text: string, max: number) =>
	text.length > max ? `${text.slice(0, max - 1)}…` : text;

export type FeedbackInput = {
	summary: string;
	category?: FeedbackCategory;
	severity?: FeedbackSeverity;
	tools?: string | string[];
	details?: string;
	expected?: string;
	suggestion?: string;
};

type TextField = "details" | "expected" | "suggestion";
const TEXT_FIELDS: readonly TextField[] = ["details", "expected", "suggestion"];

/**
 * Build a bounded entry: fields over their limit are cut (and named in
 * `truncated`), then the longest free-text field shrinks until the line fits.
 */
export const buildFeedbackEntry = (
	input: FeedbackInput,
	server: Omit<FeedbackEntry, "v" | keyof FeedbackInput | "truncated">,
): FeedbackEntry => {
	const truncated = new Set<string>();
	const cut = (field: string, text: string, max: number) => {
		if (text.length > max) truncated.add(field);
		return truncateText(text, max);
	};
	const summary = cut(
		"summary",
		input.summary.replace(/\s+/gu, " ").trim(),
		FEEDBACK_LIMITS.summary,
	);
	const toolList = (
		typeof input.tools === "string" ? [input.tools] : (input.tools ?? [])
	)
		.map((tool) => tool.trim())
		.filter(Boolean);
	if (toolList.length > FEEDBACK_LIMITS.tools) truncated.add("tools");
	const tools = [
		...new Set(
			toolList
				.slice(0, FEEDBACK_LIMITS.tools)
				.map((tool) => cut("tools", tool, FEEDBACK_LIMITS.toolName)),
		),
	];
	const text: Partial<Record<TextField, string>> = {};
	for (const field of TEXT_FIELDS) {
		const value = input[field]?.trim();
		if (value) text[field] = cut(field, value, FEEDBACK_LIMITS[field]);
	}

	let recentCalls = server.recentCalls;
	const build = (): FeedbackEntry => ({
		v: FEEDBACK_SCHEMA_VERSION,
		id: server.id,
		t: server.t,
		trickroomVersion: server.trickroomVersion,
		sessionId: server.sessionId,
		...(server.client ? { client: server.client } : {}),
		...(server.project ? { project: server.project } : {}),
		summary,
		...(input.category ? { category: input.category } : {}),
		...(input.severity ? { severity: input.severity } : {}),
		...(tools.length > 0 ? { tools } : {}),
		...text,
		recentCalls,
		...(truncated.size > 0 ? { truncated: [...truncated] } : {}),
	});

	let entry = build();
	let size = JSON.stringify(entry).length;
	while (size > FEEDBACK_LIMITS.entry) {
		const longest = TEXT_FIELDS.filter((field) => text[field]).sort(
			(a, b) => (text[b]?.length ?? 0) - (text[a]?.length ?? 0),
		)[0];
		const current = longest ? text[longest] : undefined;
		if (!longest || !current || current.length <= 1) {
			// Only the call history is left to shrink.
			if (recentCalls.length === 0) break;
			recentCalls = recentCalls.slice(1);
			truncated.add("recentCalls");
		} else {
			// JSON escaping can make a character cost up to six.
			const overflow = Math.ceil((size - FEEDBACK_LIMITS.entry) / 6) + 1;
			text[longest] = truncateText(
				current,
				Math.max(1, current.length - overflow),
			);
			truncated.add(longest);
		}
		entry = build();
		size = JSON.stringify(entry).length;
	}
	return entry;
};

export const appendFeedbackEntry = async (
	entry: FeedbackEntry,
	trickroomHome = resolveTrickroomHome(),
) => {
	const filePath = getFeedbackFilePath(trickroomHome, new Date(entry.t));
	await appendJsonLine(filePath, entry);
	return filePath;
};

export const appendCallLogEntry = (
	entry: CallLogEntry,
	trickroomHome = resolveTrickroomHome(),
) =>
	appendJsonLine(getCallLogFilePath(trickroomHome, new Date(entry.t)), entry);

export type JsonLinesRead<T> = {
	entries: T[];
	/** Lines that were not JSON objects of the expected version. */
	skippedLines: number;
	files: string[];
};

/**
 * Entries of `<prefix>-YYYY-MM.jsonl` files from `since` on, oldest file
 * first. Unparseable lines (a crash mid-write, a hand edit) are counted, not
 * fatal.
 */
export const readFeedbackJsonLines = async <T extends { v: number; t: string }>(
	prefix: "feedback" | "calls",
	since: Date,
	trickroomHome = resolveTrickroomHome(),
): Promise<JsonLinesRead<T>> => {
	const dir = getFeedbackDir(trickroomHome);
	const names = await readdir(dir).catch((error: NodeJS.ErrnoException) => {
		if (error.code === "ENOENT") return [] as string[];
		throw error;
	});
	const pattern = new RegExp(`^${prefix}-(\\d{4}-\\d{2})\\.jsonl$`, "u");
	const sinceMonth = monthOf(since);
	const files = names
		.filter((name) => {
			const month = pattern.exec(name)?.[1];
			return month !== undefined && month >= sinceMonth;
		})
		.sort()
		.map((name) => path.join(dir, name));

	const entries: T[] = [];
	let skippedLines = 0;
	const sinceIso = since.toISOString();
	for (const file of files) {
		const text = await readFile(file, "utf8");
		for (const line of text.split("\n")) {
			if (!line.trim()) continue;
			try {
				const value = JSON.parse(line) as T;
				if (
					typeof value !== "object" ||
					value === null ||
					value.v !== FEEDBACK_SCHEMA_VERSION ||
					typeof value.t !== "string"
				) {
					skippedLines += 1;
					continue;
				}
				if (value.t >= sinceIso) entries.push(value);
			} catch {
				skippedLines += 1;
			}
		}
	}
	return { entries, skippedLines, files };
};
