import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	appendCallLogEntry,
	appendFeedbackEntry,
	buildFeedbackEntry,
	type FeedbackInput,
	type ToolCallRecord,
} from "../app-state/feedback";
import { parseFeedbackArgs, parseSince, runFeedback } from "./feedback";

const NOW = new Date("2026-10-04T12:00:00.000Z");

const call = (
	tool: string,
	outcome: ToolCallRecord["outcome"] = "ok",
	extra: Partial<ToolCallRecord> = {},
): ToolCallRecord => ({
	t: "2026-10-04T10:00:00.000Z",
	tool,
	outcome,
	ms: 20,
	inChars: 120,
	outChars: 4_200,
	...extra,
});

describe("trickroom feedback", () => {
	const homes: string[] = [];

	afterEach(async () => {
		await Promise.all(
			homes.splice(0).map((home) => rm(home, { force: true, recursive: true })),
		);
	});

	const createHome = async () => {
		const home = await mkdtemp(path.join(os.tmpdir(), "trickroom-cli-fb-"));
		homes.push(home);
		await writeFile(
			path.join(home, "projects.json"),
			JSON.stringify({
				schemaVersion: 1,
				locations: [
					{
						locationId: "loc_1",
						projectId: "proj_1",
						root: "/work/app",
						name: "Shop",
						lastOpenedAt: "2026-10-01T00:00:00.000Z",
					},
				],
			}),
		);
		return home;
	};

	const report = async (
		home: string,
		id: string,
		t: string,
		input: FeedbackInput,
		recentCalls: ToolCallRecord[] = [],
	) =>
		appendFeedbackEntry(
			buildFeedbackEntry(input, {
				id,
				t,
				trickroomVersion: "0.1.0",
				sessionId: `session-${id}`,
				client: { name: "claude-code", version: "2.1.0" },
				project: { projectId: "proj_1", locationId: "loc_1" },
				recentCalls,
			}),
			home,
		);

	const run = async (home: string, args: string[]) => {
		const out: string[] = [];
		const err: string[] = [];
		const code = await runFeedback(
			args,
			{ stdout: (line) => out.push(line), stderr: (line) => err.push(line) },
			{ trickroomHome: home, now: NOW },
		);
		return { code, out: out.join("\n"), err: err.join("\n") };
	};

	const seed = async (home: string) => {
		await report(home, "old", "2026-08-01T00:00:00.000Z", {
			summary: "too old to show",
			category: "idea",
		});
		await report(
			home,
			"apply",
			"2026-10-03T09:00:00.000Z",
			{
				summary: "design_apply rejected a valid-looking batch",
				category: "confusing",
				severity: "friction",
				tools: ["design_apply"],
				details: "Passed operations as a string.",
				expected: "A hint that operations is an array.",
			},
			[
				call("design_read"),
				call("design_apply", "invalid_input", { ms: 2, outChars: 310 }),
				call("design_apply", "error", { code: "REVISION_MISMATCH" }),
			],
		);
		await report(home, "read", "2026-09-20T09:00:00.000Z", {
			summary: "design_read outline was 140k characters",
			category: "output_too_large",
			severity: "blocker",
			tools: "design_read",
		});
	};

	it("summarises the period and lists entries newest first", async () => {
		const home = await createHome();
		await seed(home);
		const { code, out } = await run(home, []);
		expect(code).toBe(0);
		expect(out).toContain("# Trickroom MCP feedback since 2026-09-04 (30d)");
		expect(out).toContain("2 reports from 2 sessions.");
		expect(out).toContain("- By category: confusing 1, output_too_large 1");
		expect(out).toContain("- By severity: blocker 1, friction 1");
		expect(out).toContain("- By tool: design_apply 1, design_read 1");
		expect(out).not.toContain("too old to show");
		expect(out.indexOf("## 2026-10-03 09:00Z")).toBeLessThan(
			out.indexOf("## 2026-09-20 09:00Z"),
		);
		expect(out).toContain(
			"## 2026-10-03 09:00Z · confusing · friction · design_apply",
		);
		expect(out).toContain(
			"- client: claude-code 2.1.0 · project: Shop (loc_1) · trickroom 0.1.0 · session session-",
		);
		expect(out).toContain(
			"- recent calls: design_read ok 20ms 120→4.2k › design_apply invalid_input 2ms 120→310 › design_apply REVISION_MISMATCH 20ms 120→4.2k",
		);
	});

	it("filters by tool and category", async () => {
		const home = await createHome();
		await seed(home);
		const byTool = await run(home, ["--tool", "design_read"]);
		expect(byTool.out).toContain("1 report from 1 session.");
		expect(byTool.out).toContain("design_read outline was 140k characters");
		const byCategory = await run(home, ["--category=confusing"]);
		expect(byCategory.out).toContain("1 report");
		expect(byCategory.out).toContain("design_apply rejected");
		const wider = await run(home, ["--since", "2026-07-01"]);
		expect(wider.out).toContain("too old to show");
	});

	it("prints raw entries as JSON", async () => {
		const home = await createHome();
		await seed(home);
		const { out } = await run(home, ["--json"]);
		const parsed = JSON.parse(out);
		expect(parsed.entries.map((entry: { id: string }) => entry.id)).toEqual([
			"apply",
			"read",
		]);
		expect(parsed.entries[0]).toMatchObject({ v: 1, category: "confusing" });
	});

	it("summarises the call log per tool", async () => {
		const home = await createHome();
		const durations = [10, 20, 30, 40, 400];
		for (const [index, ms] of durations.entries()) {
			await appendCallLogEntry(
				{
					v: 1,
					sessionId: index < 3 ? "s1" : "s2",
					...call("design_read", index === 4 ? "error" : "ok", {
						ms,
						outChars: 1_000 * (index + 1),
						...(index === 4 ? { code: "NODE_NOT_FOUND" } : {}),
					}),
				},
				home,
			);
		}
		await appendCallLogEntry(
			{ v: 1, sessionId: "s1", ...call("guide", "invalid_input") },
			home,
		);
		const { out } = await run(home, ["--calls"]);
		expect(out).toContain("6 calls from 2 sessions.");
		expect(out).toContain(
			"| design_read | 5 | 1 (20%) | 0 | 30 | 400 | 3.0k | 5.0k | NODE_NOT_FOUND 1 |",
		);
		expect(out).toContain(
			"| guide | 1 | 1 (100%) | 1 | 20 | 20 | 4.2k | 4.2k | invalid_input 1 |",
		);
		const json = JSON.parse((await run(home, ["--calls", "--json"])).out);
		expect(json.calls[0]).toMatchObject({
			tool: "design_read",
			calls: 5,
			errors: 1,
			medianMs: 30,
			p95Ms: 400,
		});
	});

	it("explains how to turn on the call log when there is none", async () => {
		const home = await createHome();
		const { code, out } = await run(home, ["--calls"]);
		expect(code).toBe(0);
		expect(out).toContain("0 reports from 0 sessions.");
		expect(out).toContain('set "callLog": true under "mcp"');
	});

	it("rejects unknown flags, categories and periods", async () => {
		const home = await createHome();
		expect((await run(home, ["--verbose"])).err).toContain(
			"Unknown argument --verbose",
		);
		expect((await run(home, ["--category", "bug"])).code).toBe(1);
		expect((await run(home, ["--since", "last week"])).err).toContain(
			"Cannot read --since",
		);
		expect(() => parseFeedbackArgs(["--tool"])).toThrow("needs a value");
	});

	it("reads relative and absolute periods", () => {
		expect(parseSince("2w", NOW).toISOString()).toBe(
			"2026-09-20T12:00:00.000Z",
		);
		expect(parseSince("12h", NOW).toISOString()).toBe(
			"2026-10-04T00:00:00.000Z",
		);
		expect(parseSince("2026-09-01", NOW).toISOString()).toBe(
			"2026-09-01T00:00:00.000Z",
		);
	});
});
