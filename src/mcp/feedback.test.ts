import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { FeedbackEntry, ToolCallRecord } from "../app-state/feedback";
import { createDefaultTrickroomSettings } from "../app-state/settings";
import {
	createToolCallHistory,
	FEEDBACK_HINT,
	isCallLogEnabled,
	withFeedbackHint,
} from "./call-history";
import type {
	TrickroomMcpServer,
	TrickroomMcpServerOptions,
} from "./server-types";
import {
	createTrickroomMcpProjectFixture,
	createTrickroomMcpTestClient,
	type TrickroomMcpClientSession,
	type TrickroomMcpProjectFixture,
	toolPayload,
	trickroomMcpTestDesignUuid,
} from "./test-support";

const record = (
	tool: string,
	outcome: ToolCallRecord["outcome"] = "ok",
	index = 0,
): ToolCallRecord => ({
	t: new Date(Date.UTC(2026, 9, 4, 10, 0, index)).toISOString(),
	tool,
	outcome,
	...(outcome === "error" ? { code: "INVALID_OPERATION" } : {}),
	ms: index,
	inChars: 10,
	outChars: 20,
});

describe("tool call history", () => {
	it("keeps the last calls in order and hands out copies", () => {
		const history = createToolCallHistory();
		for (let index = 0; index < 25; index += 1) {
			history.record(record(`tool_${index}`, "ok", index));
		}
		const recent = history.recent();
		expect(recent.map((call) => call.tool)).toEqual(
			Array.from({ length: 10 }, (_, index) => `tool_${index + 15}`),
		);
		expect(history.recent(30)).toHaveLength(20);
		recent[0].tool = "changed";
		expect(history.recent()[0].tool).toBe("tool_15");
	});

	it("hints on the second consecutive failure of a tool, once", () => {
		const history = createToolCallHistory();
		expect(history.record(record("design_apply", "invalid_input"))).toBe(false);
		// Other tools in between do not break the streak.
		expect(history.record(record("design_read"))).toBe(false);
		expect(history.record(record("design_apply", "error"))).toBe(true);
		expect(history.record(record("design_apply", "error"))).toBe(false);
		expect(history.record(record("design_read", "error"))).toBe(false);
		expect(history.record(record("design_read"))).toBe(false);
		expect(history.record(record("design_read", "error"))).toBe(false);
		expect(history.record(record("design_read", "error"))).toBe(true);
		expect(history.record(record("feedback_submit", "error"))).toBe(false);
		expect(history.record(record("feedback_submit", "error"))).toBe(false);
	});

	it("passes every record to the call log sink", () => {
		const seen: string[] = [];
		const history = createToolCallHistory((call) => seen.push(call.tool));
		history.record(record("guide"));
		history.record(record("design_read"));
		expect(seen).toEqual(["guide", "design_read"]);
	});

	it("adds the hint to JSON errors as a field and to text errors as a line", () => {
		const json = withFeedbackHint({
			content: [{ type: "text", text: '{"status":"INVALID_OPERATION"}' }],
			isError: true,
		});
		expect(JSON.parse((json.content[0] as { text: string }).text)).toEqual({
			status: "INVALID_OPERATION",
			feedbackHint: FEEDBACK_HINT,
		});
		const text = withFeedbackHint({
			content: [{ type: "text", text: "Input validation error: nope" }],
			isError: true,
		});
		expect((text.content[0] as { text: string }).text).toBe(
			`Input validation error: nope\n\nfeedbackHint: ${FEEDBACK_HINT}`,
		);
	});
});

describe("feedback_submit", () => {
	const homes: string[] = [];
	let fixture: TrickroomMcpProjectFixture | undefined;
	let session: TrickroomMcpClientSession | undefined;

	afterEach(async () => {
		await session?.close();
		await fixture?.cleanup();
		session = undefined;
		fixture = undefined;
		await Promise.all(
			homes.splice(0).map((home) => rm(home, { force: true, recursive: true })),
		);
	});

	const createHome = async () => {
		const home = await mkdtemp(path.join(os.tmpdir(), "trickroom-mcp-fb-"));
		homes.push(home);
		return home;
	};

	const start = async (
		trickroomHome: string,
		serverOptions: TrickroomMcpServerOptions = {},
	) => {
		fixture = await createTrickroomMcpProjectFixture();
		session = await createTrickroomMcpTestClient(
			{
				...(await fixture.readMcpContext()),
				trickroomHome,
				locationId: "loc_test",
			},
			{ serverOptions },
		);
		const { client } = session;
		return (name: string, args: Record<string, unknown> = {}) =>
			client.callTool({ name, arguments: args });
	};

	const readLines = async (home: string, prefix: string) => {
		const dir = path.join(home, "feedback");
		const names = (await readdir(dir).catch(() => [] as string[])).filter(
			(name) => name.startsWith(`${prefix}-`),
		);
		const lines: unknown[] = [];
		for (const name of names) {
			const text = await readFile(path.join(dir, name), "utf8");
			lines.push(
				...text
					.split("\n")
					.filter(Boolean)
					.map((line) => JSON.parse(line)),
			);
		}
		return lines;
	};

	it("stores a report with the session's recent calls and no arguments", async () => {
		const home = await createHome();
		const call = await start(home);
		const secret = "SECRET_CLASS_NAME_xyz";

		await call("design_read", {
			designFileId: trickroomMcpTestDesignUuid,
			view: "outline",
		});
		const first = await call("design_apply", {
			designFileId: trickroomMcpTestDesignUuid,
			operations: "not an array",
			className: secret,
		});
		expect(first.isError).toBe(true);
		expect(JSON.stringify(first.content)).not.toContain("feedbackHint");
		const second = await call("design_apply", {
			designFileId: trickroomMcpTestDesignUuid,
			expectedRevision: "stale",
			operations: [
				{
					operation: "updateElementProps",
					parameters: { elementId: "missing", className: secret },
				},
			],
		});
		expect(second.isError).toBe(true);
		expect(toolPayload(second).feedbackHint).toContain("feedback_submit");

		const result = await call("feedback_submit", {
			summary: "design_apply rejected operations\nas a string",
			category: "confusing",
			severity: "friction",
			tools: ["design_apply"],
			details: "Passed operations as a string first.",
		});
		expect(result.isError).toBeFalsy();
		const ack = toolPayload(result);
		expect(ack).toMatchObject({
			status: "recorded",
			id: expect.any(String),
			attachedCalls: 3,
		});
		expect(path.dirname(ack.storedIn)).toBe(path.join(home, "feedback"));

		const [entry, ...rest] = (await readLines(
			home,
			"feedback",
		)) as FeedbackEntry[];
		expect(rest).toEqual([]);
		expect(entry).toMatchObject({
			v: 1,
			id: ack.id,
			trickroomVersion: expect.any(String),
			sessionId: expect.any(String),
			client: { name: "trickroom-mcp-test", version: "0.1.0" },
			project: {
				projectId: fixture?.config.projectId,
				locationId: "loc_test",
			},
			summary: "design_apply rejected operations as a string",
			category: "confusing",
			severity: "friction",
			tools: ["design_apply"],
			details: "Passed operations as a string first.",
		});
		expect(
			entry.recentCalls.map(({ tool, outcome, code }) => ({
				tool,
				outcome,
				...(code ? { code } : {}),
			})),
		).toEqual([
			{ tool: "design_read", outcome: "ok" },
			{ tool: "design_apply", outcome: "invalid_input" },
			{
				tool: "design_apply",
				outcome: "error",
				code: expect.any(String),
			},
		]);
		for (const call of entry.recentCalls) {
			expect(call.ms).toBeGreaterThanOrEqual(0);
			expect(call.inChars).toBeGreaterThan(0);
			expect(call.outChars).toBeGreaterThan(0);
		}
		const raw = await readFile(ack.storedIn, "utf8");
		expect(raw).not.toContain(secret);
		expect(raw).not.toContain(fixture?.projectRoot ?? "?");
	});

	it("rejects a call without a summary", async () => {
		const call = await start(await createHome());
		const result = await call("feedback_submit", { category: "idea" });
		expect(result.isError).toBe(true);
		expect(JSON.stringify(result.content)).toContain("summary");
	});

	it("accepts a single tool name and reports truncated fields", async () => {
		const home = await createHome();
		const call = await start(home);
		const ack = toolPayload(
			await call("feedback_submit", {
				summary: "s".repeat(300),
				tools: "design_read",
			}),
		);
		expect(ack.truncated).toEqual(["summary"]);
		const [entry] = (await readLines(home, "feedback")) as FeedbackEntry[];
		expect(entry.tools).toEqual(["design_read"]);
		expect(entry.summary).toHaveLength(200);
	});

	it("answers with a one-line reason, not an error, when it cannot store", async () => {
		const home = await createHome();
		// A file where the feedback folder should be.
		await writeFile(path.join(home, "feedback"), "");
		const call = await start(home);
		const result = await call("feedback_submit", { summary: "hello" });
		expect(result.isError).toBeFalsy();
		const payload = toolPayload(result);
		expect(payload.status).toBe("not_recorded");
		expect(payload.message).not.toContain("\n");
		expect(payload.message).toMatch(/could not be stored/);
	});

	it("writes no call log unless it is enabled", async () => {
		const home = await createHome();
		const call = await start(home);
		await call("project_list");
		await call("guide", { designFileId: trickroomMcpTestDesignUuid });
		expect(await readLines(home, "calls")).toEqual([]);
	});

	it("appends every call to the call log when enabled", async () => {
		const home = await createHome();
		const call = await start(home, { callLog: true });
		await call("project_list");
		await call("design_read", { designFileId: "nope" });
		await call("no_such_tool");
		await (session?.server as TrickroomMcpServer | undefined)?.flushCallLog?.();
		const lines = (await readLines(home, "calls")) as Array<
			ToolCallRecord & { v: number; sessionId: string; client: string }
		>;
		expect(
			lines.map(({ tool, outcome, code }) => ({
				tool,
				outcome,
				...(code ? { code } : {}),
			})),
		).toEqual([
			{ tool: "project_list", outcome: "ok" },
			{ tool: "design_read", outcome: "invalid_input" },
			{ tool: "no_such_tool", outcome: "error", code: "unknown_tool" },
		]);
		expect(lines[0]).toMatchObject({
			v: 1,
			sessionId: expect.any(String),
			client: "trickroom-mcp-test",
		});
		expect(new Set(lines.map((line) => line.sessionId)).size).toBe(1);
	});

	it("reads the call log switch from settings, with an env override", async () => {
		const home = await createHome();
		expect(isCallLogEnabled(home, undefined)).toBe(false);
		const defaults = createDefaultTrickroomSettings();
		await writeFile(
			path.join(home, "settings.json"),
			JSON.stringify({ ...defaults, mcp: { ...defaults.mcp, callLog: true } }),
		);
		expect(isCallLogEnabled(home, undefined)).toBe(true);
		expect(isCallLogEnabled(home, "0")).toBe(false);
		await writeFile(path.join(home, "settings.json"), JSON.stringify(defaults));
		expect(isCallLogEnabled(home, "true")).toBe(true);
	});
});
