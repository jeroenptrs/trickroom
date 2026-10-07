import { spawn } from "node:child_process";
import {
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	realpath,
	rm,
	writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
	type CodegenTestProject,
	createCodegenTestProject,
	flatPayload,
	publishedComponent,
} from "../codegen/test-support";
import { typeStrippingResolveHook } from "../test-utils/child-process-hooks";
import { parseLintReport } from "./report";
import { createLintRuleRegistry } from "./rules/registry";
import type { LintRuleKind } from "./rules/types";
import { runLint } from "./run-lint";

// Two Node processes stand in for two `trickroom lint` runs (or a CLI run
// and the server). They load the real engine through Node's TypeScript
// type stripping.
const runLintPath = fileURLToPath(new URL("./run-lint.ts", import.meta.url));
const registryPath = fileURLToPath(
	new URL("./rules/registry.ts", import.meta.url),
);

// Interleaves the two runs at the report: each waits after its first read
// of lint-report.json until both have read it (so both compare against the
// same baseline), and before renaming a file onto lint-report.json until
// both are there or a second has passed (a run holding the lock waits out
// the other, which cannot get there).
const interleave = `
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import path from "node:path";

const barrier = process.env.LINT_BARRIER_DIR;
const label = process.env.LINT_LABEL;
const promises = fs.promises;
const wait = async (stage, timeoutMs) => {
	await promises.writeFile(path.join(barrier, stage + "-" + label), "");
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const arrived = (await promises.readdir(barrier)).filter((name) =>
			name.startsWith(stage + "-"),
		);
		if (arrived.length >= 2) return;
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
};
const isReport = (target) => String(target).endsWith("lint-report.json");
let reads = 0;
const readFile = promises.readFile;
promises.readFile = async (...args) => {
	const result = await readFile(...args);
	if (isReport(args[0]) && ++reads === 1) await wait("read", 10000);
	return result;
};
const rename = promises.rename;
promises.rename = async (from, to) => {
	if (isReport(to)) await wait("rename", 1000);
	return rename(from, to);
};
syncBuiltinESMExports();
`;

const worker = `
const [runLintUrl, registryUrl, projectRoot, label, count, minute] = process.argv.slice(2);
const { runLint } = await import(runLintUrl);
const { createLintRuleRegistry } = await import(registryUrl);
const registry = createLintRuleRegistry([
	{
		id: "code.counted",
		side: "code",
		defaultSeverity: "warning",
		description: "Reports a set number of warnings.",
		run: () =>
			Array.from({ length: Number(count) }, (_, index) => ({
				message: "finding " + index,
				location: null,
			})),
	},
]);
const result = await runLint({
	projectRoot,
	registry,
	now: () => new Date("2026-10-07T10:" + minute + ":00.000Z"),
});
console.log(JSON.stringify({
	label,
	status: result.status,
	written: result.written,
	codes: result.diagnostics.map((entry) => entry.code),
	compared: result.ratchet?.baseline?.numbers["code.warnings"] ?? null,
}));
`;

// Three runs around a dead holder's lock (LOCK_PATH):
// - B reads the dead lock, then pauses until A is about to rename the
//   report into place (past its fencing check).
// - A first waits for B's read, then reclaims the lock and runs; before
//   renaming the report it waits (bounded) for C to have written.
// - C waits (bounded) for the lock slot to be emptied by someone other
//   than its owner, which a move-aside reclaimer did before restoring it.
const threeWay = `
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import path from "node:path";

const { LINT_BARRIER_DIR: barrier, LINT_LABEL: label, LOCK_PATH: lockPath, REPORT_PATH: reportPath } = process.env;
const promises = fs.promises;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const mark = (name) => promises.writeFile(path.join(barrier, name), "");
const until = async (name, timeoutMs) => {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline && !fs.existsSync(path.join(barrier, name))) await sleep(10);
};
const once = new Set();
const first = (key) => !once.has(key) && once.add(key);

const readFile = promises.readFile;
promises.readFile = async (...args) => {
	const result = await readFile(...args);
	if (label === "B" && String(args[0]) === lockPath && first("read")) {
		await mark("B-read-lock");
		await until("A-before-report-rename", 6000);
	}
	return result;
};
const open = promises.open;
promises.open = async (target, flags, ...rest) => {
	if (String(target) === lockPath && flags === "wx") {
		if (label === "A" && first("open")) await until("B-read-lock", 6000);
		if (label === "C" && first("open")) await until("B-emptied", 4000);
	}
	return open(target, flags, ...rest);
};
const rename = promises.rename;
promises.rename = async (from, to) => {
	if (String(to) === reportPath && label === "A") {
		await mark("A-before-report-rename");
		await until("C-done", 3000);
	}
	const result = await rename(from, to);
	if (String(to) === reportPath && label === "C") await mark("C-done");
	return result;
};
const link = promises.link;
promises.link = async (from, to) => {
	if (label === "B") {
		await mark("B-emptied");
		await until("C-done", 3000);
	}
	return link(from, to);
};
syncBuiltinESMExports();
`;

type WorkerResult = {
	label: string;
	status: string;
	written: boolean;
	codes: string[];
	compared: number | null;
};

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

describe("lint runs in separate processes", () => {
	const projects: CodegenTestProject[] = [];
	const temps: string[] = [];
	afterEach(async () => {
		await Promise.all(projects.splice(0).map((project) => project.cleanup()));
		await Promise.all(
			temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
		);
	});

	const DEAD_LOCK = "lint-report.json.lock";

	/** A project with a committed baseline of 10, and lint runs as processes. */
	const prepare = async (choreography: string) => {
		const project = await createCodegenTestProject({
			components: [publishedComponent("button", flatPayload("px-3"))],
		});
		projects.push(project);
		await mkdir(project.path("src"), { recursive: true });
		await writeFile(project.path("src/app.tsx"), "export const x = 1;\n");
		const baseline = await runLint({
			projectRoot: project.root,
			registry: countingRegistry(10),
			now: () => new Date("2026-10-07T10:00:00.000Z"),
		});
		expect(baseline.written).toBe(true);
		const systemDir = await realpath(project.path(".trickroom/systems/core"));

		const temp = await mkdtemp(path.join(os.tmpdir(), "trickroom-lint-race-"));
		temps.push(temp);
		const barrier = path.join(temp, "barrier");
		await mkdir(barrier);
		const hookPath = path.join(temp, "hook.mjs");
		const choreographyPath = path.join(temp, "choreography.mjs");
		const workerPath = path.join(temp, "worker.mjs");
		await writeFile(hookPath, typeStrippingResolveHook, "utf8");
		await writeFile(choreographyPath, choreography, "utf8");
		await writeFile(workerPath, worker, "utf8");

		const run = (label: string, count: number, minute: string) => {
			const child = spawn(
				process.execPath,
				[
					"--no-warnings",
					"--import",
					pathToFileURL(hookPath).href,
					"--import",
					pathToFileURL(choreographyPath).href,
					workerPath,
					pathToFileURL(runLintPath).href,
					pathToFileURL(registryPath).href,
					project.root,
					label,
					String(count),
					minute,
				],
				{
					stdio: ["ignore", "pipe", "pipe"],
					env: {
						...process.env,
						LINT_BARRIER_DIR: barrier,
						LINT_LABEL: label,
						LOCK_PATH: path.join(systemDir, DEAD_LOCK),
						REPORT_PATH: path.join(systemDir, "lint-report.json"),
					},
				},
			);
			let stdout = "";
			let stderr = "";
			child.stdout.on("data", (chunk) => {
				stdout += chunk;
			});
			child.stderr.on("data", (chunk) => {
				stderr += chunk;
			});
			return new Promise<WorkerResult>((resolve, reject) => {
				child.on("error", reject);
				child.on("exit", (code) => {
					if (code !== 0) {
						reject(new Error(`${label} exited ${code}: ${stderr}`));
						return;
					}
					resolve(JSON.parse(stdout.trim().split("\n").at(-1) ?? ""));
				});
			});
		};

		const committedWarnings = async () =>
			parseLintReport(
				JSON.parse(
					await readFile(path.join(systemDir, "lint-report.json"), "utf8"),
				),
			).report?.ratchetBaseline.numbers["code.warnings"];
		const lockFilesLeft = async () =>
			(await readdir(systemDir)).filter((name) => name.includes(".lock"));
		return { project, systemDir, run, committedWarnings, lockFilesLeft };
	};

	it("never let a later writer raise the baseline an earlier one lowered", async () => {
		const { run, committedWarnings } = await prepare(interleave);
		const [five, eight] = await Promise.all([
			run("five", 5, "01"),
			run("eight", 8, "02"),
		]);

		// Both compared against 10 first; whichever wrote second saw the
		// other's report under the lock.
		expect(five).toMatchObject({ status: "pass", written: true });
		if (eight.written) {
			// Eight wrote first; five then compared against 8 and replaced it.
			expect(five.compared).toBe(8);
		} else {
			expect(eight).toMatchObject({
				status: "fail",
				codes: ["BASELINE_MOVED"],
				compared: 5,
			});
		}
		expect(await committedWarnings()).toBe(5);
	}, 60_000);

	it("keeps the tighter baseline when a stale reclaimer meets a live owner and a fresh acquirer", async () => {
		const { systemDir, run, committedWarnings, lockFilesLeft } =
			await prepare(threeWay);
		// A run that died holding the lock.
		const dead = spawn(process.execPath, ["-e", ""]);
		await new Promise((resolve) => dead.on("exit", resolve));
		await writeFile(
			path.join(systemDir, DEAD_LOCK),
			JSON.stringify({
				pid: dead.pid,
				hostname: os.hostname(),
				token: "dead",
				acquiredAt: Date.now(),
			}),
		);

		// A (8) reclaims the dead lock after B (9) judged it, and pauses past
		// its fencing check; B goes on; C (5) tries to get in meanwhile.
		const results = await Promise.all([
			run("A", 8, "01"),
			run("B", 9, "02"),
			run("C", 5, "03"),
		]);
		expect(await committedWarnings()).toBe(5);
		const [a, , c] = results;
		expect(a).toMatchObject({ status: "pass", written: true });
		expect(c).toMatchObject({ status: "pass", written: true, compared: 8 });
		// Whoever did not write says why: the baseline moved, or the lock.
		for (const result of results.filter((entry) => !entry.written)) {
			expect(["BASELINE_MOVED", "REPORT_LOCKED"]).toContain(result.codes[0]);
		}
		expect(await lockFilesLeft()).toEqual([]);
	}, 60_000);
});
