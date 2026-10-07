import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
import { parseLintReport } from "./report";
import { createLintRuleRegistry } from "./rules/registry";
import type { LintRuleKind } from "./rules/types";
import { runLint } from "./run-lint";

// Two Node processes stand in for two `trickroom lint` runs (or a CLI run
// and the server). They load the real engine through Node's TypeScript
// type stripping; the hook only adds the extensions the source omits.
const runLintPath = fileURLToPath(new URL("./run-lint.ts", import.meta.url));
const registryPath = fileURLToPath(
	new URL("./rules/registry.ts", import.meta.url),
);

const resolveHook = `
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";

registerHooks({
	resolve(specifier, context, next) {
		if (specifier.startsWith(".") && context.parentURL?.startsWith("file:")) {
			const url = new URL(specifier, context.parentURL);
			const filePath = fileURLToPath(url);
			if (!existsSync(filePath) || !/\\.[cm]?[jt]s$/.test(filePath)) {
				for (const extension of [".ts", "/index.ts"]) {
					if (existsSync(filePath + extension)) {
						return next(url.href + extension, context);
					}
				}
			}
		}
		return next(specifier, context);
	},
});
`;

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

	it("never let a later writer raise the baseline an earlier one lowered", async () => {
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

		const temp = await mkdtemp(path.join(os.tmpdir(), "trickroom-lint-race-"));
		temps.push(temp);
		const barrier = path.join(temp, "barrier");
		await mkdir(barrier);
		const hookPath = path.join(temp, "hook.mjs");
		const interleavePath = path.join(temp, "interleave.mjs");
		const workerPath = path.join(temp, "worker.mjs");
		await writeFile(hookPath, resolveHook, "utf8");
		await writeFile(interleavePath, interleave, "utf8");
		await writeFile(workerPath, worker, "utf8");

		const run = (label: string, count: number, minute: string) => {
			const child = spawn(
				process.execPath,
				[
					"--no-warnings",
					"--import",
					pathToFileURL(hookPath).href,
					"--import",
					pathToFileURL(interleavePath).href,
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
		const committed = parseLintReport(
			JSON.parse(
				await readFile(
					project.path(".trickroom/systems/core/lint-report.json"),
					"utf8",
				),
			),
		).report;
		expect(committed?.ratchetBaseline.numbers["code.warnings"]).toBe(5);
	}, 60_000);
});
