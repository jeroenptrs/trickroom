import { readFile } from "node:fs/promises";
import path from "node:path";
import {
	type CallLogEntry,
	FEEDBACK_CATEGORIES,
	type FeedbackEntry,
	getFeedbackDir,
	readFeedbackJsonLines,
	type ToolCallRecord,
} from "../app-state/feedback";
import { resolveTrickroomHome } from "../app-state/home";

/**
 * `trickroom feedback [--since 30d] [--tool <name>] [--category <c>] [--calls]
 * [--json]`: reads the feedback agents sent with feedback_submit (and, with
 * --calls, the optional call log) from the Trickroom home and prints a
 * summary meant for pasting into an agent conversation. It only reads.
 */

const USAGE =
	"Usage: trickroom feedback [--since 30d|2w|YYYY-MM-DD] [--tool <name>] [--category <category>] [--calls] [--json]";

export type FeedbackCliOptions = {
	since: Date;
	sinceLabel: string;
	tool?: string;
	category?: string;
	calls: boolean;
	json: boolean;
};

const DAY_MS = 24 * 60 * 60 * 1000;

export const parseSince = (value: string, now = new Date()): Date => {
	const relative = /^(\d+)([hdw])$/u.exec(value.trim());
	if (relative) {
		const unit = { h: DAY_MS / 24, d: DAY_MS, w: 7 * DAY_MS }[
			relative[2] as "h" | "d" | "w"
		];
		return new Date(now.getTime() - Number(relative[1]) * unit);
	}
	if (/^\d{4}-\d{2}-\d{2}(T.*)?$/u.test(value.trim())) {
		const date = new Date(value.trim());
		if (!Number.isNaN(date.getTime())) return date;
	}
	throw new Error(
		`Cannot read --since ${JSON.stringify(value)}: use 30d, 2w, 12h or a date like 2026-09-01.`,
	);
};

export const parseFeedbackArgs = (
	args: readonly string[],
	now = new Date(),
): FeedbackCliOptions => {
	const options: FeedbackCliOptions = {
		since: parseSince("30d", now),
		sinceLabel: "30d",
		calls: false,
		json: false,
	};
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		const [flag, inline] = arg.includes("=")
			? [arg.slice(0, arg.indexOf("=")), arg.slice(arg.indexOf("=") + 1)]
			: [arg, undefined];
		const value = () => {
			const next = inline ?? args[++index];
			if (next === undefined || next.startsWith("--")) {
				throw new Error(`${flag} needs a value. ${USAGE}`);
			}
			return next;
		};
		switch (flag) {
			case "--since": {
				const since = value();
				options.since = parseSince(since, now);
				options.sinceLabel = since;
				break;
			}
			case "--tool":
				options.tool = value();
				break;
			case "--category": {
				const category = value();
				if (!(FEEDBACK_CATEGORIES as readonly string[]).includes(category)) {
					throw new Error(
						`Unknown category ${JSON.stringify(category)}: use one of ${FEEDBACK_CATEGORIES.join(", ")}.`,
					);
				}
				options.category = category;
				break;
			}
			case "--calls":
				options.calls = true;
				break;
			case "--json":
				options.json = true;
				break;
			default:
				throw new Error(`Unknown argument ${arg}. ${USAGE}`);
		}
	}
	return options;
};

const plural = (count: number, noun: string) =>
	`${count} ${noun}${count === 1 ? "" : "s"}`;

const formatChars = (chars: number) =>
	chars < 1_000
		? String(chars)
		: chars < 1_000_000
			? `${(chars / 1_000).toFixed(chars < 10_000 ? 1 : 0)}k`
			: `${(chars / 1_000_000).toFixed(1)}M`;

const formatTime = (iso: string) => `${iso.slice(0, 16).replace("T", " ")}Z`;

const countBy = (values: readonly string[]) => {
	const counts = new Map<string, number>();
	for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
	return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
};

const formatCounts = (counts: [string, number][]) =>
	counts.length === 0
		? "none"
		: counts.map(([key, count]) => `${key} ${count}`).join(", ");

const describeCall = (call: ToolCallRecord) =>
	[
		call.tool,
		call.outcome === "error" ? (call.code ?? "error") : call.outcome,
		`${call.ms}ms`,
		`${formatChars(call.inChars)}→${formatChars(call.outChars)}`,
	].join(" ");

/** Feedback about `tool`: named in tools, or a failed call in the history. */
const mentionsTool = (entry: FeedbackEntry, tool: string) =>
	entry.tools?.includes(tool) ||
	entry.recentCalls?.some(
		(call) => call.tool === tool && call.outcome !== "ok",
	);

const quantile = (sorted: readonly number[], q: number) =>
	sorted.length === 0
		? 0
		: sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)];

export type ToolCallStats = {
	tool: string;
	calls: number;
	errors: number;
	invalidInput: number;
	errorRate: number;
	medianMs: number;
	p95Ms: number;
	medianOutChars: number;
	maxOutChars: number;
	topErrors: [string, number][];
};

export const summarizeCalls = (
	calls: readonly ToolCallRecord[],
): ToolCallStats[] => {
	const byTool = new Map<string, ToolCallRecord[]>();
	for (const call of calls) {
		byTool.set(call.tool, [...(byTool.get(call.tool) ?? []), call]);
	}
	return [...byTool]
		.map(([tool, records]) => {
			const ms = records.map((record) => record.ms).sort((a, b) => a - b);
			const out = records
				.map((record) => record.outChars)
				.sort((a, b) => a - b);
			const failed = records.filter((record) => record.outcome !== "ok");
			return {
				tool,
				calls: records.length,
				errors: failed.length,
				invalidInput: failed.filter(
					(record) => record.outcome === "invalid_input",
				).length,
				errorRate: failed.length / records.length,
				medianMs: quantile(ms, 0.5),
				p95Ms: quantile(ms, 0.95),
				medianOutChars: quantile(out, 0.5),
				maxOutChars: out[out.length - 1] ?? 0,
				topErrors: countBy(
					failed.map((record) =>
						record.outcome === "invalid_input"
							? "invalid_input"
							: (record.code ?? "error"),
					),
				).slice(0, 3),
			};
		})
		.sort((a, b) => b.calls - a.calls || a.tool.localeCompare(b.tool));
};

type Io = { stdout: (line: string) => void; stderr: (line: string) => void };

export const runFeedback = async (
	args: readonly string[],
	io: Io = {
		stdout: (line) => process.stdout.write(`${line}\n`),
		stderr: (line) => process.stderr.write(`${line}\n`),
	},
	{
		trickroomHome = resolveTrickroomHome(),
		now = new Date(),
	}: { trickroomHome?: string; now?: Date } = {},
): Promise<number> => {
	let options: FeedbackCliOptions;
	try {
		options = parseFeedbackArgs(args, now);
	} catch (error) {
		io.stderr(error instanceof Error ? error.message : String(error));
		return 1;
	}

	const feedbackDir = getFeedbackDir(trickroomHome);
	const read = await readFeedbackJsonLines<FeedbackEntry>(
		"feedback",
		options.since,
		trickroomHome,
	);
	const entries = read.entries
		.filter(
			(entry) =>
				(!options.tool || mentionsTool(entry, options.tool)) &&
				(!options.category || entry.category === options.category),
		)
		.sort((a, b) => b.t.localeCompare(a.t));
	const callRead = options.calls
		? await readFeedbackJsonLines<CallLogEntry>(
				"calls",
				options.since,
				trickroomHome,
			)
		: null;
	const calls = (callRead?.entries ?? []).filter(
		(call) => !options.tool || call.tool === options.tool,
	);
	const callStats = callRead ? summarizeCalls(calls) : null;

	if (options.json) {
		io.stdout(
			JSON.stringify(
				{
					since: options.since.toISOString(),
					feedbackDir,
					entries,
					...(read.skippedLines > 0 ? { skippedLines: read.skippedLines } : {}),
					...(callStats ? { calls: callStats } : {}),
				},
				null,
				"\t",
			),
		);
		return 0;
	}

	// Reads projects.json raw (see app-state/project-registry.ts): importing
	// that module pulls the library registry into this bundle, and only
	// names are needed.
	const projectNames = new Map<string, string>();
	try {
		const registry = JSON.parse(
			await readFile(path.join(trickroomHome, "projects.json"), "utf8"),
		) as { locations?: { locationId?: unknown; name?: unknown }[] };
		for (const location of registry.locations ?? []) {
			if (
				typeof location.locationId === "string" &&
				typeof location.name === "string"
			) {
				projectNames.set(location.locationId, location.name);
			}
		}
	} catch {
		// Without a readable registry, entries show their ids.
	}
	const describeProject = (project: FeedbackEntry["project"]) => {
		if (!project) return "none";
		const name = project.locationId
			? projectNames.get(project.locationId)
			: undefined;
		const id = project.locationId ?? project.projectId ?? "";
		return name ? `${name} (${id})` : id;
	};

	const filters = [
		options.tool ? `tool ${options.tool}` : null,
		options.category ? `category ${options.category}` : null,
	].filter(Boolean);
	const lines: string[] = [
		`# Trickroom MCP feedback since ${options.since.toISOString().slice(0, 10)} (${options.sinceLabel})${filters.length ? `, ${filters.join(", ")}` : ""}`,
		"",
		`${plural(entries.length, "report")} from ${plural(new Set(entries.map((entry) => entry.sessionId)).size, "session")}. Source: ${feedbackDir}${read.skippedLines > 0 ? ` (${read.skippedLines} unreadable lines skipped)` : ""}.`,
	];
	if (entries.length > 0) {
		lines.push(
			"",
			`- By category: ${formatCounts(countBy(entries.map((entry) => entry.category ?? "unset")))}`,
			`- By severity: ${formatCounts(countBy(entries.map((entry) => entry.severity ?? "unset")))}`,
			`- By tool: ${formatCounts(countBy(entries.flatMap((entry) => entry.tools ?? ["unset"])))}`,
			`- By client: ${formatCounts(countBy(entries.map((entry) => entry.client?.name ?? "unknown")))}`,
		);
	}

	if (callStats) {
		lines.push("", "## Tool calls", "");
		if (callRead?.files.length === 0) {
			lines.push(
				`No call log in ${feedbackDir}. It is off by default: set "callLog": true under "mcp" in ${trickroomHome}/settings.json, or start MCP with TRICKROOM_MCP_CALL_LOG=1.`,
			);
		} else {
			const sessions = new Set(calls.map((call) => call.sessionId)).size;
			lines.push(
				`${plural(calls.length, "call")} from ${plural(sessions, "session")}.`,
				"",
				"| tool | calls | errors | invalid input | median ms | p95 ms | median out | max out | top errors |",
				"| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
				...callStats.map(
					(stat) =>
						`| ${stat.tool} | ${stat.calls} | ${stat.errors} (${Math.round(stat.errorRate * 100)}%) | ${stat.invalidInput} | ${stat.medianMs} | ${stat.p95Ms} | ${formatChars(stat.medianOutChars)} | ${formatChars(stat.maxOutChars)} | ${stat.topErrors.map(([code, count]) => `${code} ${count}`).join(", ")} |`,
				),
			);
		}
	}

	for (const entry of entries) {
		const heading = [
			formatTime(entry.t),
			entry.category ?? "uncategorized",
			entry.severity,
			entry.tools?.join(", "),
		]
			.filter(Boolean)
			.join(" · ");
		lines.push("", `## ${heading}`, "", entry.summary, "");
		if (entry.details) lines.push(`- details: ${entry.details}`);
		if (entry.expected) lines.push(`- expected: ${entry.expected}`);
		if (entry.suggestion) lines.push(`- suggestion: ${entry.suggestion}`);
		lines.push(
			`- client: ${entry.client ? [entry.client.name, entry.client.version].filter(Boolean).join(" ") : "unknown"} · project: ${describeProject(entry.project)} · trickroom ${entry.trickroomVersion} · session ${entry.sessionId.slice(0, 8)}`,
			`- recent calls: ${entry.recentCalls?.length ? entry.recentCalls.map(describeCall).join(" › ") : "none"}`,
		);
		if (entry.truncated?.length) {
			lines.push(`- truncated: ${entry.truncated.join(", ")}`);
		}
		lines.push(`- id: ${entry.id}`);
	}

	io.stdout(lines.join("\n"));
	return 0;
};

/** Entry for `bin/trickroom.js feedback`. */
export const main = (args: readonly string[]) => runFeedback(args);
