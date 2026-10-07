import { mkdir, readFile, writeFile } from "node:fs/promises";
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
});
