import { mkdir, readFile, writeFile } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { resolveCodegenConfig } from "../codegen/config";
import { runCodegen } from "../codegen/run-codegen";
import {
	CODEGEN_TEST_SYSTEM_ID,
	type CodegenTestProject,
	createCodegenTestProject,
	flatPayload,
	publishedComponent,
} from "../codegen/test-support";
import { readProjectConfigReadOnly } from "../project";
import { parseLintArgs, runLintCli } from "./lint";

describe("trickroom lint", () => {
	const projects: CodegenTestProject[] = [];
	afterEach(async () => {
		await Promise.all(projects.splice(0).map((project) => project.cleanup()));
	});

	const button = publishedComponent("button", flatPayload("px-3"));
	const badge = publishedComponent("badge", flatPayload("px-1"));

	const setup = async () => {
		const project = await createCodegenTestProject({
			codegen: { version: 1, outDir: "src/ui" },
			components: [button, badge],
		});
		projects.push(project);
		const read = await readProjectConfigReadOnly(project.root);
		const config = resolveCodegenConfig(read.config);
		if (config.status !== "configured") throw new Error("unconfigured");
		await runCodegen({ projectRoot: project.root, config, mode: "write" });
		return project;
	};

	const run = async (args: string[]) => {
		const stdout: string[] = [];
		const stderr: string[] = [];
		const code = await runLintCli(args, {
			stdout: (line) => stdout.push(line),
			stderr: (line) => stderr.push(line),
		});
		return { code, stdout: stdout.join("\n"), stderr: stderr.join("\n") };
	};

	it("parses its options", () => {
		expect(
			parseLintArgs(["app", "--check", "--json", "--system=core"], "/work"),
		).toEqual({
			projectRoot: "/work/app",
			check: true,
			json: true,
			system: "core",
			adopt: [],
		});
		expect(
			parseLintArgs(
				[
					"--adopt",
					"code.redundant-class",
					"--adopt=design.unknown-class-token",
				],
				"/work",
			).adopt,
		).toEqual(["code.redundant-class", "design.unknown-class-token"]);
		expect(() => parseLintArgs(["--adopt"])).toThrow(
			"--adopt needs a rule kind id",
		);
		expect(() => parseLintArgs(["--adopt", "all"])).toThrow(
			"--adopt all is not allowed",
		);
		expect(parseLintArgs(["--system", "Core"], "/work")).toMatchObject({
			projectRoot: "/work",
			system: "Core",
		});
		expect(() => parseLintArgs(["--system"])).toThrow(
			"--system needs a system id or name",
		);
		expect(() => parseLintArgs(["--system", "--check"])).toThrow(
			"--system needs",
		);
		expect(() => parseLintArgs(["--force"])).toThrow("Unknown option --force");
		expect(() => parseLintArgs(["a", "b"])).toThrow("at most one project");
	});

	it("exits 0 on a pass and writes the report, 1 on a ratchet failure, and prints findings grouped by side and rule", async () => {
		const project = await setup();
		const clean = await run([project.root]);
		expect(clean.code).toBe(0);
		expect(clean.stdout).toContain(
			"Code (2 files scanned): 0 errors, 0 warnings",
		);
		expect(clean.stdout).toContain(
			'Lint passed for system "Core" (no baseline yet). Report written to .trickroom/systems/core/lint-report.json.',
		);

		await writeFile(
			project.path("src/ui/badge.variants.ts"),
			`${await readFile(project.path("src/ui/badge.variants.ts"), "utf8")}// edited\n`,
		);
		const checked = await run([project.root, "--check"]);
		expect(checked.code).toBe(1);
		expect(checked.stdout).toContain(
			"Code (2 files scanned): 1 error, 0 warnings",
		);
		expect(checked.stdout).toContain(
			'  code.variants-file-stale\n    error   src/ui/badge.variants.ts:1:1  Component "badge" is stale',
		);
		expect(checked.stdout).toContain("worse: code.errors 0 -> 1");
		expect(checked.stdout).toContain(
			'Lint failed for system "Core": 3 numbers worse than the baseline',
		);
		expect(checked.stdout).not.toContain("Report written");
	});

	it("lists the kinds it adopts into the baseline on --check and on a run", async () => {
		const project = await setup();
		await writeFile(
			project.path("src/ui/badge.variants.ts"),
			`${await readFile(project.path("src/ui/badge.variants.ts"), "utf8")}// edited\n`,
		);
		expect((await run([project.root])).code).toBe(0);
		// The baseline as a Trickroom before code.variants-file-stale shipped
		// would have written it.
		const reportPath = project.path(".trickroom/systems/core/lint-report.json");
		const stored = JSON.parse(await readFile(reportPath, "utf8"));
		const baseline = stored.ratchetBaseline;
		baseline.kinds = baseline.kinds.filter(
			(kind: string) => kind !== "code.variants-file-stale",
		);
		delete baseline.numbers["rule.code.variants-file-stale"];
		baseline.numbers["code.errors"] = 0;
		await writeFile(reportPath, JSON.stringify(stored));

		const checked = await run([project.root, "--check"]);
		expect(checked.code).toBe(0);
		expect(checked.stdout).toContain(
			"adopted: rule.code.variants-file-stale 1 (new rule kind)",
		);
		expect(checked.stdout).not.toContain("worse:");
		expect(checked.stdout).toContain(
			"Nothing written (--check). 1 new rule kind adopted into the baseline once lint runs without --check.",
		);

		const written = await run([project.root]);
		expect(written.code).toBe(0);
		expect(written.stdout).toContain(
			"adopted: rule.code.variants-file-stale 1 (new rule kind)",
		);
		expect(written.stdout).toContain(
			"Report written to .trickroom/systems/core/lint-report.json. 1 new rule kind adopted into the baseline.",
		);

		const again = await run([project.root, "--check"]);
		expect(again.code).toBe(0);
		expect(again.stdout).not.toContain("adopted");
	});

	it("adopts a named kind that got worse with --adopt, and refuses it with --check", async () => {
		const project = await setup();
		expect((await run([project.root])).code).toBe(0);
		await writeFile(
			project.path("src/ui/badge.variants.ts"),
			`${await readFile(project.path("src/ui/badge.variants.ts"), "utf8")}// edited\n`,
		);
		const refused = await run([
			project.root,
			"--check",
			"--adopt",
			"code.variants-file-stale",
		]);
		expect(refused.code).toBe(2);
		expect(refused.stderr).toContain("cannot run with --check");

		const unknown = await run([project.root, "--adopt", "code.nope"]);
		expect(unknown.code).toBe(2);
		expect(unknown.stderr).toContain('"code.nope": not a rule kind id');

		// Coverage got worse too (badge is no longer generated), so adopting
		// the stale kind alone still fails.
		const partial = await run([
			project.root,
			"--adopt",
			"code.variants-file-stale",
		]);
		expect(partial.code).toBe(1);
		expect(partial.stdout).toContain(
			"adopted: rule.code.variants-file-stale 0 -> 1 (--adopt)",
		);
		expect(partial.stdout).toContain("worse: coverage.generated 2 -> 1");
		expect(partial.stdout).not.toContain("worse: code.errors");

		await writeFile(
			project.path("src/ui/badge.variants.ts"),
			(
				await readFile(project.path("src/ui/badge.variants.ts"), "utf8")
			).replace("// edited\n", ""),
		);
		const passing = await run([
			project.root,
			"--adopt",
			"code.variants-file-stale",
		]);
		expect(passing.code).toBe(0);
		expect(passing.stdout).toContain(
			"adopted: rule.code.variants-file-stale 0 -> 0 (--adopt)",
		);
		expect(passing.stdout).toContain(
			"1 rule kind named with --adopt adopted into the baseline.",
		);
	});

	it("prints the run result JSON alone with --json", async () => {
		const project = await setup();
		const { code, stdout, stderr } = await run([
			project.root,
			"--json",
			"--check",
		]);
		expect(code).toBe(0);
		expect(stderr).toBe("");
		const result = JSON.parse(stdout);
		expect(result).toMatchObject({
			status: "pass",
			mode: "check",
			system: { name: "Core" },
			written: false,
			ratchet: { status: "pass", baseline: null },
			report: { version: 1, summary: { code: { scanned: 2 } } },
		});
	});

	it("exits 2 for a missing project, an unknown system, an invalid lint.json and bad arguments", async () => {
		const project = await setup();
		expect((await run([project.path("src")])).code).toBe(2);
		const unknown = await run([project.root, "--system", "nope", "--json"]);
		expect(unknown.code).toBe(2);
		expect(JSON.parse(unknown.stdout).diagnostics[0].code).toBe(
			"SYSTEM_NOT_FOUND",
		);
		await writeFile(
			project.path(".trickroom/systems/core/lint.json"),
			"{ nope",
		);
		const invalid = await run([project.root]);
		expect(invalid.code).toBe(2);
		expect(invalid.stderr).toContain("lint.json is not valid JSON");
		expect(invalid.stderr).toContain("nothing written");
		expect((await run(["--nope"])).code).toBe(2);
	});

	it("keeps --json output and exit 2 when the run fails unexpectedly", async () => {
		const project = await setup();
		await mkdir(project.path(".trickroom/systems/twin"), { recursive: true });
		await writeFile(
			project.path(".trickroom/systems/twin/system.json"),
			JSON.stringify({
				version: 1,
				systemId: CODEGEN_TEST_SYSTEM_ID,
				systemName: "Twin",
			}),
		);
		const { code, stdout, stderr } = await run([
			project.root,
			"--check",
			"--json",
		]);
		expect(code).toBe(2);
		expect(stderr).toBe("");
		expect(JSON.parse(stdout)).toMatchObject({
			status: "error",
			diagnostics: [{ code: "RUN_FAILED" }],
		});
	});
});
