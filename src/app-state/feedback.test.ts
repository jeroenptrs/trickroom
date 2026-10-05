import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import * as nodeModule from "node:module";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	appendCallLogEntry,
	appendFeedbackEntry,
	buildFeedbackEntry,
	FEEDBACK_LIMITS,
	type FeedbackEntry,
	getCallLogFilePath,
	getFeedbackDir,
	getFeedbackFilePath,
	readFeedbackJsonLines,
	type ToolCallRecord,
} from "./feedback";

const call = (
	tool: string,
	t = "2026-10-04T10:00:00.000Z",
): ToolCallRecord => ({
	t,
	tool,
	outcome: "ok",
	ms: 12,
	inChars: 40,
	outChars: 900,
});

const serverFields = (
	overrides: Partial<Parameters<typeof buildFeedbackEntry>[1]> = {},
) => ({
	id: "f1",
	t: "2026-10-04T10:00:00.000Z",
	trickroomVersion: "0.1.0",
	sessionId: "s1",
	recentCalls: [call("design_read")],
	...overrides,
});

describe("feedback storage", () => {
	const homes: string[] = [];

	afterEach(async () => {
		await Promise.all(
			homes.splice(0).map((home) => rm(home, { force: true, recursive: true })),
		);
	});

	const createHome = async () => {
		const home = await mkdtemp(path.join(os.tmpdir(), "trickroom-feedback-"));
		homes.push(home);
		return home;
	};

	it("builds a versioned entry and folds the summary to one line", () => {
		const entry = buildFeedbackEntry(
			{
				summary: "  design_apply\nrejected   my batch ",
				category: "confusing",
				tools: "design_apply",
				details: "  tried to move a layer  ",
				expected: "",
			},
			serverFields(),
		);
		expect(entry).toEqual({
			v: 1,
			id: "f1",
			t: "2026-10-04T10:00:00.000Z",
			trickroomVersion: "0.1.0",
			sessionId: "s1",
			summary: "design_apply rejected my batch",
			category: "confusing",
			tools: ["design_apply"],
			details: "tried to move a layer",
			recentCalls: [call("design_read")],
		});
	});

	it("cuts fields over their limit and names them", () => {
		const entry = buildFeedbackEntry(
			{
				summary: "x".repeat(500),
				details: "d".repeat(10_000),
				tools: Array.from({ length: 15 }, (_, index) => `tool_${index}`),
			},
			serverFields(),
		);
		expect(entry.summary).toHaveLength(FEEDBACK_LIMITS.summary);
		expect(entry.details).toHaveLength(FEEDBACK_LIMITS.details);
		expect(entry.tools).toHaveLength(FEEDBACK_LIMITS.tools);
		expect(entry.truncated).toEqual(["summary", "tools", "details"]);
	});

	it("keeps the whole line under the entry cap, even with escaped text", () => {
		// Control characters cost six characters each in JSON.
		const entry = buildFeedbackEntry(
			{
				summary: "big",
				details: "\u0001".repeat(FEEDBACK_LIMITS.details),
				expected: "\u0001".repeat(FEEDBACK_LIMITS.expected),
				suggestion: "\u0001".repeat(FEEDBACK_LIMITS.suggestion),
			},
			serverFields({
				recentCalls: Array.from({ length: 10 }, () => call("design_read")),
			}),
		);
		expect(JSON.stringify(entry).length).toBeLessThanOrEqual(
			FEEDBACK_LIMITS.entry,
		);
		expect(entry.truncated).toContain("details");
		expect(entry.recentCalls).toHaveLength(10);
	});

	it("appends one line per entry to a month file with private permissions", async () => {
		const home = await createHome();
		const october = buildFeedbackEntry({ summary: "one" }, serverFields());
		const november = buildFeedbackEntry(
			{ summary: "two" },
			serverFields({ id: "f2", t: "2026-11-01T00:00:01.000Z" }),
		);
		const octoberFile = await appendFeedbackEntry(october, home);
		await appendFeedbackEntry({ ...october, id: "f3", summary: "three" }, home);
		const novemberFile = await appendFeedbackEntry(november, home);

		expect(path.basename(octoberFile)).toBe("feedback-2026-10.jsonl");
		expect(path.basename(novemberFile)).toBe("feedback-2026-11.jsonl");
		expect(octoberFile).toBe(
			getFeedbackFilePath(home, new Date("2026-10-31T23:59:59.999Z")),
		);
		const lines = (await readFile(octoberFile, "utf8")).split("\n");
		expect(lines.map((line) => line && JSON.parse(line).id)).toEqual([
			"f1",
			"f3",
			"",
		]);
		if (process.platform !== "win32") {
			expect((await stat(getFeedbackDir(home))).mode & 0o777).toBe(0o700);
			expect((await stat(octoberFile)).mode & 0o777).toBe(0o600);
		}
	});

	it("reads entries since a date across months and skips broken lines", async () => {
		const home = await createHome();
		const entry = (id: string, t: string) =>
			buildFeedbackEntry({ summary: id }, serverFields({ id, t }));
		await appendFeedbackEntry(entry("aug", "2026-08-30T00:00:00.000Z"), home);
		await appendFeedbackEntry(entry("sep", "2026-09-20T00:00:00.000Z"), home);
		await appendFeedbackEntry(entry("oct", "2026-10-02T00:00:00.000Z"), home);
		const octoberFile = getFeedbackFilePath(home, new Date("2026-10-02"));
		await writeFile(
			octoberFile,
			`${await readFile(octoberFile, "utf8")}{"v":1,"t":"2026-10-03T00:0\n{"v":2,"t":"2026-10-03T00:00:00.000Z"}\n`,
		);

		const read = await readFeedbackJsonLines<FeedbackEntry>(
			"feedback",
			new Date("2026-09-04T00:00:00.000Z"),
			home,
		);
		expect(read.entries.map((value) => value.id)).toEqual(["sep", "oct"]);
		expect(read.skippedLines).toBe(2);
		expect(read.files.map((file) => path.basename(file))).toEqual([
			"feedback-2026-09.jsonl",
			"feedback-2026-10.jsonl",
		]);
	});

	it("returns nothing when the feedback folder does not exist", async () => {
		const home = await createHome();
		const read = await readFeedbackJsonLines("calls", new Date(0), home);
		expect(read).toEqual({ entries: [], skippedLines: 0, files: [] });
	});

	it("writes call log entries to their own month file", async () => {
		const home = await createHome();
		await appendCallLogEntry(
			{ v: 1, sessionId: "s1", client: "test", ...call("guide") },
			home,
		);
		const text = await readFile(
			getCallLogFilePath(home, new Date("2026-10-04")),
			"utf8",
		);
		expect(JSON.parse(text)).toMatchObject({ tool: "guide", client: "test" });
	});

	it.skipIf(!("registerHooks" in nodeModule))(
		"keeps lines whole when several processes append at once",
		async () => {
			const home = await createHome();
			const file = path.join(home, "feedback", "concurrent.jsonl");
			const modulePath = path.join(import.meta.dirname, "feedback.ts");
			// Each child loads this module with Node's type stripping; the hook
			// resolves its extensionless relative imports to .ts files.
			const childScript = `
import { registerHooks } from "node:module";
registerHooks({
	resolve(specifier, context, next) {
		try { return next(specifier, context); }
		catch (error) {
			if (specifier.startsWith(".")) return next(specifier + ".ts", context);
			throw error;
		}
	},
});
const { appendJsonLine } = await import(${JSON.stringify(modulePath)});
const [file, writer, count] = process.argv.slice(1);
const padding = writer.repeat(9000);
await Promise.all(Array.from({ length: Number(count) }, (_, index) =>
	appendJsonLine(file, { writer, index, padding })));
`;
			const writers = ["a", "b", "c", "d", "e", "f"];
			const perWriter = 40;
			await Promise.all(
				writers.map(
					(writer) =>
						new Promise<void>((resolve, reject) => {
							const child = spawn(
								process.execPath,
								[
									"--no-warnings",
									"--input-type=module",
									"-e",
									childScript,
									file,
									writer,
									String(perWriter),
								],
								{ stdio: ["ignore", "ignore", "pipe"] },
							);
							let stderr = "";
							child.stderr.on("data", (chunk) => {
								stderr += String(chunk);
							});
							child.on("error", reject);
							child.on("exit", (code) =>
								code === 0
									? resolve()
									: reject(new Error(`writer ${writer} failed: ${stderr}`)),
							);
						}),
				),
			);

			const lines = (await readFile(file, "utf8")).split("\n");
			expect(lines.pop()).toBe("");
			expect(lines).toHaveLength(writers.length * perWriter);
			const seen = new Map<string, number>();
			for (const line of lines) {
				const value = JSON.parse(line) as {
					writer: string;
					padding: string;
				};
				expect(value.padding).toBe(value.writer.repeat(9000));
				seen.set(value.writer, (seen.get(value.writer) ?? 0) + 1);
			}
			expect(Object.fromEntries(seen)).toEqual(
				Object.fromEntries(writers.map((writer) => [writer, perWriter])),
			);
		},
		30_000,
	);
});
