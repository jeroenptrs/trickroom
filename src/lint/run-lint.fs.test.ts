import { spawn } from "node:child_process";
import {
	mkdir,
	readdir,
	readFile,
	stat,
	unlink,
	utimes,
	writeFile,
} from "node:fs/promises";
import os from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	type CodegenTestProject,
	createCodegenTestProject,
	flatPayload,
	publishedComponent,
} from "../codegen/test-support";
import { parseLintReport, serializeLintReport } from "./report";
import { variantsFileStaleRule } from "./rules/code/variants-file";
import { createLintRuleRegistry } from "./rules/registry";
import type { LintRuleKind } from "./rules/types";
import { type RunLintInput, runLint as runLintWithEveryKind } from "./run-lint";

/**
 * What a lint run does when the filesystem misbehaves under it: folders it
 * cannot read, and other runs writing the report while it runs. The
 * failures are injected, since a test running as root cannot take its own
 * read permission away.
 */

const injected = vi.hoisted(() => ({
	/** Absolute directory path -> the error code `readdir` fails with. */
	readdirFailures: new Map<string, string>(),
	/** Runs once, right after the next read of a file with this path. */
	afterRead: new Map<string, () => Promise<void>>(),
	/** Runs once, right after the report's temp file is written. */
	afterReportTempWrite: null as (() => Promise<void>) | null,
}));

vi.mock("node:fs/promises", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:fs/promises")>();
	return {
		...actual,
		readdir: (async (...args: Parameters<typeof actual.readdir>) => {
			const code = injected.readdirFailures.get(String(args[0]));
			if (code) {
				throw Object.assign(
					new Error(`${code}: injected, scandir '${String(args[0])}'`),
					{ code },
				);
			}
			return actual.readdir(...args);
		}) as typeof actual.readdir,
		readFile: (async (...args: Parameters<typeof actual.readFile>) => {
			const result = await actual.readFile(...args);
			const hook = injected.afterRead.get(String(args[0]));
			if (hook) {
				injected.afterRead.delete(String(args[0]));
				await hook();
			}
			return result;
		}) as typeof actual.readFile,
		writeFile: (async (...args: Parameters<typeof actual.writeFile>) => {
			const result = await actual.writeFile(...args);
			const hook = injected.afterReportTempWrite;
			if (
				hook &&
				/lint-report\.json\.\d+\.[^/\\]+\.tmp$/u.test(String(args[0]))
			) {
				injected.afterReportTempWrite = null;
				await hook();
			}
			return result;
		}) as typeof actual.writeFile,
	};
});

const registry = createLintRuleRegistry([variantsFileStaleRule]);
const runLint = (input: RunLintInput) =>
	runLintWithEveryKind({ registry, ...input });

const REPORT = ".trickroom/systems/core/lint-report.json";

/** A registry whose one kind reports `count` warnings. */
const countingRegistry = (count: number) => {
	const kind: LintRuleKind = {
		id: "code.counted",
		side: "code",
		defaultSeverity: "warning",
		description: "Reports a set number of warnings.",
		run: () =>
			Array.from({ length: count }, (_, index) => ({
				message: `finding ${index}`,
				location: null,
			})),
	};
	return createLintRuleRegistry([kind]);
};

const at = (minute: number) => () =>
	new Date(`2026-10-07T10:${String(minute).padStart(2, "0")}:00.000Z`);

describe("runLint on a misbehaving filesystem", () => {
	const projects: CodegenTestProject[] = [];
	afterEach(async () => {
		injected.readdirFailures.clear();
		injected.afterRead.clear();
		injected.afterReportTempWrite = null;
		await Promise.all(projects.splice(0).map((project) => project.cleanup()));
	});

	const setup = async () => {
		const project = await createCodegenTestProject({
			components: [publishedComponent("button", flatPayload("px-3"))],
		});
		projects.push(project);
		await mkdir(project.path("src/ui"), { recursive: true });
		await writeFile(
			project.path("src/ui/button.tsx"),
			"export const Button = () => <button />;\n",
		);
		await writeFile(
			project.path("src/app.tsx"),
			'import { Button } from "./ui/button";\nexport const App = () => <Button />;\n',
		);
		return project;
	};

	it("fails the run, writing nothing, when a source folder or the designs folder cannot be read", async () => {
		const project = await setup();
		const first = await runLint({ projectRoot: project.root });
		expect(first.written).toBe(true);
		const committed = await readFile(project.path(REPORT), "utf8");

		injected.readdirFailures.set(project.path("src/ui"), "EACCES");
		const sources = await runLint({ projectRoot: project.root });
		expect(sources).toMatchObject({
			status: "error",
			written: false,
			report: null,
		});
		expect(sources.diagnostics).toEqual([
			{
				code: "SOURCES_UNREADABLE",
				severity: "error",
				message: expect.stringContaining("src/ui"),
				path: "src/ui",
			},
		]);
		expect(await readFile(project.path(REPORT), "utf8")).toBe(committed);

		injected.readdirFailures.clear();
		injected.readdirFailures.set(project.path(".trickroom/designs"), "EACCES");
		const designs = await runLint({ projectRoot: project.root });
		expect(designs).toMatchObject({ status: "error", written: false });
		expect(designs.diagnostics).toEqual([
			{
				code: "DESIGNS_UNREADABLE",
				severity: "error",
				message: expect.stringContaining("EACCES"),
				path: ".trickroom/designs",
			},
		]);
		expect(await readFile(project.path(REPORT), "utf8")).toBe(committed);
	});

	it("warns about an include root that does not exist", async () => {
		const project = await setup();
		await writeFile(
			project.path(".trickroom/systems/core/lint.json"),
			JSON.stringify({
				version: 1,
				source: { include: ["src/**", "packages/app/src/**"] },
			}),
		);
		const result = await runLint({ projectRoot: project.root, check: true });
		expect(result.status).toBe("pass");
		expect(result.diagnostics).toEqual([
			{
				code: "SOURCE_ROOT_MISSING",
				severity: "warning",
				message: expect.stringContaining("packages/app/src does not exist"),
				path: "packages/app/src",
			},
		]);
	});

	const committedWarnings = async (project: CodegenTestProject) =>
		parseLintReport(JSON.parse(await readFile(project.path(REPORT), "utf8")))
			.report?.ratchetBaseline.numbers["code.warnings"];

	it("serializes runs on one report, so a later run never raises the baseline an earlier one lowered", async () => {
		const project = await setup();
		const baseline = await runLintWithEveryKind({
			projectRoot: project.root,
			registry: countingRegistry(10),
			now: at(0),
		});
		expect(baseline.written).toBe(true);

		const [five, eight] = await Promise.all([
			runLintWithEveryKind({
				projectRoot: project.root,
				registry: countingRegistry(5),
				now: at(1),
			}),
			runLintWithEveryKind({
				projectRoot: project.root,
				registry: countingRegistry(8),
				now: at(2),
			}),
		]);
		// Which one gets in first is up to the scheduler; the second compared
		// against the first one's numbers, never against the stale 10.
		const compared = (run: typeof five) =>
			run.ratchet?.baseline?.numbers["code.warnings"];
		if (eight.written) {
			expect([compared(eight), compared(five)]).toEqual([10, 8]);
			expect(five).toMatchObject({ status: "pass", written: true });
		} else {
			expect([compared(five), compared(eight)]).toEqual([10, 5]);
			expect(five).toMatchObject({ status: "pass", written: true });
			expect(eight).toMatchObject({ status: "fail", written: false });
		}
		expect(await committedWarnings(project)).toBe(5);
	});

	it("re-ratchets against a baseline another process wrote during the run, and writes only if it still passes", async () => {
		const project = await setup();
		const ten = await runLintWithEveryKind({
			projectRoot: project.root,
			registry: countingRegistry(10),
			now: at(0),
		});
		if (!ten.report) throw new Error("no report");
		const tenReport = ten.report;
		// What another process would write: a passing run with 5.
		const other = await runLintWithEveryKind({
			projectRoot: project.root,
			registry: countingRegistry(5),
			now: at(1),
			check: true,
		});
		if (!other.report) throw new Error("no report");
		const otherReport = other.report;
		const replaceReport = async () => {
			await writeFile(project.path(REPORT), serializeLintReport(otherReport));
		};

		// It lands after this run read the baseline of 10 and before it writes.
		injected.afterRead.set(project.path(REPORT), replaceReport);
		const eight = await runLintWithEveryKind({
			projectRoot: project.root,
			registry: countingRegistry(8),
			now: at(2),
		});
		expect(eight).toMatchObject({ status: "fail", written: false });
		expect(eight.ratchet?.baseline?.generatedAt).toBe(
			"2026-10-07T10:01:00.000Z",
		);
		expect(eight.ratchet?.regressions).toContainEqual({
			metric: "code.warnings",
			baseline: 5,
			current: 8,
		});
		expect(eight.report?.ratchetBaseline.generatedAt).toBe(
			"2026-10-07T10:01:00.000Z",
		);
		expect(eight.diagnostics).toEqual([
			{
				code: "BASELINE_MOVED",
				severity: "error",
				message: expect.stringContaining("code.warnings 5 -> 8"),
				path: REPORT,
			},
		]);
		expect(await committedWarnings(project)).toBe(5);

		// A run that still passes against the moved baseline is written,
		// compared against what it replaces.
		await writeFile(project.path(REPORT), serializeLintReport(tenReport));
		injected.afterRead.set(project.path(REPORT), replaceReport);
		const four = await runLintWithEveryKind({
			projectRoot: project.root,
			registry: countingRegistry(4),
			now: at(4),
		});
		expect(four).toMatchObject({ status: "pass", written: true });
		expect(four.diagnostics).toEqual([]);
		expect(four.ratchet?.baseline?.generatedAt).toBe(
			"2026-10-07T10:01:00.000Z",
		);
		expect(await committedWarnings(project)).toBe(4);
	});

	it("compares a kind it would adopt against a moved baseline that already adopted it", async () => {
		const project = await setup();
		// The committed baseline predates code.counted.
		const before = await runLint({ projectRoot: project.root, now: at(0) });
		expect(before.written).toBe(true);
		expect(before.report?.ratchetBaseline.kinds).not.toContain("code.counted");
		const withCounted = (count: number) =>
			createLintRuleRegistry([
				variantsFileStaleRule,
				...countingRegistry(count).kinds,
			]);
		const beforeReport = before.report;
		if (!beforeReport) throw new Error("no report");
		// Another process upgraded first and adopted code.counted at 2.
		const other = await runLintWithEveryKind({
			projectRoot: project.root,
			registry: withCounted(2),
			now: at(1),
			check: true,
		});
		expect(other.ratchet?.adopted).toEqual([
			{ metric: "rule.code.counted", current: 2, reason: "new-kind" },
		]);
		const otherReport = other.report;
		if (!otherReport) throw new Error("no report");
		const replaceReport = async () => {
			await writeFile(project.path(REPORT), serializeLintReport(otherReport));
		};

		// This run read the old baseline and would adopt 3; against the moved
		// one the kind is known, so 3 is worse than 2 and nothing is written.
		injected.afterRead.set(project.path(REPORT), replaceReport);
		const three = await runLintWithEveryKind({
			projectRoot: project.root,
			registry: withCounted(3),
			now: at(2),
		});
		expect(three).toMatchObject({ status: "fail", written: false });
		expect(three.ratchet?.adopted).toEqual([]);
		expect(three.ratchet?.regressions).toContainEqual({
			metric: "rule.code.counted",
			baseline: 2,
			current: 3,
		});
		expect(three.diagnostics).toEqual([
			{
				code: "BASELINE_MOVED",
				severity: "error",
				message: expect.stringContaining("rule.code.counted 2 -> 3"),
				path: REPORT,
			},
		]);
		expect(await committedWarnings(project)).toBe(2);

		// With the same count it passes against the moved baseline, adopting
		// nothing, and is written.
		await writeFile(project.path(REPORT), serializeLintReport(beforeReport));
		injected.afterRead.set(project.path(REPORT), replaceReport);
		const two = await runLintWithEveryKind({
			projectRoot: project.root,
			registry: withCounted(2),
			now: at(3),
		});
		expect(two).toMatchObject({ status: "pass", written: true });
		expect(two.ratchet?.adopted).toEqual([]);
		expect(two.ratchet?.baseline?.generatedAt).toBe("2026-10-07T10:01:00.000Z");
		expect(two.report?.ratchetBaseline.kinds).toContain("code.counted");
	});

	const LOCK = `${REPORT}.lock`;
	const exists = (file: string) =>
		stat(file).then(
			() => true,
			() => false,
		);

	const findDeadPid = async () => {
		// A process that has exited and been reaped leaves its pid unused.
		const child = spawn(process.execPath, ["-e", ""]);
		await new Promise((resolve) => child.on("exit", resolve));
		return child.pid as number;
	};

	it("fails with REPORT_LOCKED while a live run holds the report lock, however old, and reclaims an abandoned one", async () => {
		const project = await setup();
		await runLint({ projectRoot: project.root });
		const committed = await readFile(project.path(REPORT), "utf8");
		expect(await exists(project.path(LOCK))).toBe(false);
		const holder = (pid: number, acquiredAt: number) =>
			JSON.stringify({
				pid,
				hostname: os.hostname(),
				token: "other-run",
				acquiredAt,
				designPath: project.path(REPORT),
			});

		// A live holder (this process): just taken, or held for a minute.
		for (const acquiredAt of [Date.now(), Date.now() - 60_000]) {
			const held = holder(process.pid, acquiredAt);
			await writeFile(project.path(LOCK), held);
			const locked = await runLint({ projectRoot: project.root });
			expect(locked).toMatchObject({ status: "error", written: false });
			expect(locked.diagnostics).toEqual([
				{
					code: "REPORT_LOCKED",
					severity: "error",
					message: expect.stringContaining("locked by another lint run"),
					path: REPORT,
				},
			]);
			expect(await readFile(project.path(REPORT), "utf8")).toBe(committed);
			expect(await readFile(project.path(LOCK), "utf8")).toBe(held);
		}

		// A holder that has exited: reclaimed at once, whatever its age.
		await writeFile(
			project.path(LOCK),
			holder(await findDeadPid(), Date.now()),
		);
		const reclaimed = await runLint({
			projectRoot: project.root,
			now: () => new Date("2026-10-07T11:00:00.000Z"),
		});
		expect(reclaimed).toMatchObject({ status: "pass", written: true });
		expect(reclaimed.diagnostics).toEqual([]);
		expect(await exists(project.path(LOCK))).toBe(false);
		expect(await readFile(project.path(REPORT), "utf8")).toContain(
			"2026-10-07T11:00:00.000Z",
		);

		// No readable pid (a run that crashed while creating it): only age
		// tells, after 30 seconds.
		await writeFile(project.path(LOCK), "");
		const past = new Date(Date.now() - 31_000);
		await utimes(project.path(LOCK), past, past);
		const aged = await runLint({ projectRoot: project.root });
		expect(aged).toMatchObject({ status: "pass", written: true });
		expect(await exists(project.path(LOCK))).toBe(false);
	}, 30_000);

	it("writes nothing when the lock stops being its own before the report is renamed", async () => {
		const project = await setup();
		await runLint({ projectRoot: project.root });
		const committed = await readFile(project.path(REPORT), "utf8");
		const systemDir = project.path(".trickroom/systems/core");

		// Another run's lock replaced this run's (as a reclaimer could), or
		// the lock is gone, between acquisition and the rename.
		const foreign = JSON.stringify({
			pid: process.pid,
			hostname: os.hostname(),
			token: "someone-else",
			acquiredAt: Date.now(),
		});
		for (const tamper of [
			() => writeFile(project.path(LOCK), foreign),
			() => unlink(project.path(LOCK)),
		]) {
			injected.afterReportTempWrite = tamper;
			const result = await runLint({ projectRoot: project.root });
			expect(result).toMatchObject({ status: "error", written: false });
			expect(result.diagnostics).toEqual([
				{
					code: "REPORT_LOCKED",
					severity: "error",
					message: expect.stringContaining("lost its lock"),
					path: REPORT,
				},
			]);
			expect(await readFile(project.path(REPORT), "utf8")).toBe(committed);
			expect(
				(await readdir(systemDir)).filter((name) => name.endsWith(".tmp")),
			).toEqual([]);
			await unlink(project.path(LOCK)).catch(() => undefined);
		}
	});
});
