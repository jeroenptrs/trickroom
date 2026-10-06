import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
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
import { parseLintReport } from "./report";
import {
	variantsFileOrphanedRule,
	variantsFileStaleRule,
} from "./rules/code/variants-file";
import { createLintRuleRegistry } from "./rules/registry";
import { type RunLintInput, runLint as runLintWithEveryKind } from "./run-lint";

// The engine is tested with the codegen kinds only, so finding lists stay
// exact; every other kind has its own tests next to it in rules/.
const engineRegistry = createLintRuleRegistry([
	variantsFileStaleRule,
	variantsFileOrphanedRule,
]);
const runLint = (input: RunLintInput) =>
	runLintWithEveryKind({ registry: engineRegistry, ...input });

describe("runLint", () => {
	const projects: CodegenTestProject[] = [];
	afterEach(async () => {
		await Promise.all(projects.splice(0).map((project) => project.cleanup()));
	});

	const button = publishedComponent("button", flatPayload("px-3"));
	const badge = publishedComponent("badge", flatPayload("px-1"));
	const card = publishedComponent("card", flatPayload("p-4"));

	const setup = async (options: { codegen?: boolean } = {}) => {
		const project = await createCodegenTestProject({
			codegen:
				options.codegen === false
					? undefined
					: { version: 1, outDir: "src/ui" },
			components: [button, badge],
		});
		projects.push(project);
		await mkdir(project.path("src/ui"), { recursive: true });
		await writeFile(
			project.path("src/ui/button.tsx"),
			'import { buttonVariants } from "./button.variants";\nexport const Button = (props: { className?: string }) => <button className={buttonVariants({ class: props.className })} />;\n',
		);
		await writeFile(
			project.path("src/app.tsx"),
			'import { Button } from "./ui/button";\nexport const App = () => <div className="p-2"><Button /><Button className="m-1" /></div>;\n',
		);
		return project;
	};

	const generate = async (project: CodegenTestProject) => {
		const read = await readProjectConfigReadOnly(project.root);
		const config = resolveCodegenConfig(read.config);
		if (config.status !== "configured")
			throw new Error("codegen not configured");
		const result = await runCodegen({
			projectRoot: project.root,
			config,
			mode: "write",
		});
		expect(result.status).toBe("ok");
	};

	const readReport = async (project: CodegenTestProject) =>
		parseLintReport(
			JSON.parse(
				await readFile(
					project.path(".trickroom/systems/core/lint-report.json"),
					"utf8",
				),
			),
		).report;

	it("finds a stale variants file, writes the baseline, passes a repeat and fails a regression in check mode", async () => {
		const project = await setup();
		await generate(project);
		await writeFile(
			project.path("src/ui/badge.variants.ts"),
			`${await readFile(project.path("src/ui/badge.variants.ts"), "utf8")}// edited\n`,
		);

		const first = await runLint({
			projectRoot: project.root,
			now: () => new Date("2026-03-01T10:00:00.000Z"),
		});
		expect(first.diagnostics).toEqual([]);
		expect(first).toMatchObject({
			status: "pass",
			mode: "write",
			system: { name: "Core" },
			baseline: "absent",
			reportPath: ".trickroom/systems/core/lint-report.json",
			written: true,
			ratchet: {
				status: "pass",
				baseline: null,
				regressions: [],
				breaches: [],
			},
		});
		const report = first.report;
		expect(report?.findings).toEqual([
			{
				rule: "code.variants-file-stale",
				severity: "error",
				side: "code",
				component: "badge",
				message: expect.stringContaining(
					'Component "badge" is stale: the file body was edited',
				),
				location: {
					kind: "code",
					file: "src/ui/badge.variants.ts",
					line: 1,
					column: 1,
				},
			},
		]);
		expect(report?.summary).toEqual({
			code: {
				findings: { errors: 1, warnings: 0, info: 0 },
				rules: {
					"code.variants-file-orphaned": { errors: 0, warnings: 0, info: 0 },
					"code.variants-file-stale": { errors: 1, warnings: 0, info: 0 },
				},
				scanned: 4,
			},
			design: null,
		});
		expect(report?.components).toEqual([
			{
				slug: "badge",
				componentId: badge.componentId,
				name: "badge",
				published: true,
				generated: false,
				bound: false,
				usedInApp: false,
				usedInDesigns: null,
				wrappers: [],
				usages: 0,
			},
			{
				slug: "button",
				componentId: button.componentId,
				name: "button",
				published: true,
				generated: true,
				bound: true,
				usedInApp: true,
				usedInDesigns: null,
				wrappers: ["src/ui/button.tsx"],
				usages: 2,
			},
		]);
		expect(report?.files).toEqual([
			{
				file: "src/app.tsx",
				role: null,
				component: null,
				usages: 2,
				findings: { errors: 0, warnings: 0, info: 0 },
			},
			{
				file: "src/ui/badge.variants.ts",
				role: "generated",
				component: "badge",
				usages: 0,
				findings: { errors: 1, warnings: 0, info: 0 },
			},
			{
				file: "src/ui/button.tsx",
				role: "wrapper",
				component: "button",
				usages: 0,
				findings: { errors: 0, warnings: 0, info: 0 },
			},
			{
				file: "src/ui/button.variants.ts",
				role: "generated",
				component: "button",
				usages: 0,
				findings: { errors: 0, warnings: 0, info: 0 },
			},
		]);
		expect(report?.ratchetBaseline).toEqual({
			generatedAt: "2026-03-01T10:00:00.000Z",
			numbers: expect.objectContaining({
				"code.errors": 1,
				"coverage.bound": 1,
				"rule.code.variants-file-stale": 1,
			}),
		});
		expect(await readReport(project)).toEqual(report);

		const second = await runLint({ projectRoot: project.root, check: true });
		expect(second).toMatchObject({
			status: "pass",
			mode: "check",
			baseline: "present",
			written: false,
			ratchet: { baseline: { generatedAt: "2026-03-01T10:00:00.000Z" } },
		});

		await project.writeComponents([button, badge, card]);
		const before = await stat(
			project.path(".trickroom/systems/core/lint-report.json"),
		);
		const third = await runLint({ projectRoot: project.root, check: true });
		expect(third.status).toBe("fail");
		expect(third.written).toBe(false);
		expect(third.ratchet?.regressions).toEqual([
			{ metric: "code.errors", baseline: 1, current: 2 },
			{ metric: "rule.code.variants-file-stale", baseline: 1, current: 2 },
		]);
		expect(third.report?.status).toBe("fail");
		expect(
			(await stat(project.path(".trickroom/systems/core/lint-report.json")))
				.mtimeMs,
		).toBe(before.mtimeMs);

		// On demand (the dashboard): the failing report is written, the baseline kept.
		const fourth = await runLint({
			projectRoot: project.root,
			write: "always",
		});
		expect(fourth).toMatchObject({ status: "fail", written: true });
		expect((await readReport(project))?.ratchet).toMatchObject({
			status: "fail",
			baseline: { generatedAt: "2026-03-01T10:00:00.000Z" },
			regressions: [
				{ metric: "code.errors", baseline: 1, current: 2 },
				{ metric: "rule.code.variants-file-stale", baseline: 1, current: 2 },
			],
		});
		expect((await readReport(project))?.ratchetBaseline).toEqual(
			report?.ratchetBaseline,
		);
		const fifth = await runLint({ projectRoot: project.root, check: true });
		expect(fifth.ratchet?.regressions.map((entry) => entry.metric)).toEqual([
			"code.errors",
			"rule.code.variants-file-stale",
		]);

		// Regenerating clears it, and the baseline moves on; the stored
		// report keeps the comparison it improved on.
		await generate(project);
		const sixth = await runLint({ projectRoot: project.root });
		expect(sixth).toMatchObject({ status: "pass", written: true });
		expect(sixth.report?.summary.code.findings).toEqual({
			errors: 0,
			warnings: 0,
			info: 0,
		});
		const stored = await readReport(project);
		expect(stored?.ratchetBaseline.numbers["code.errors"]).toBe(0);
		expect(stored?.ratchet).toEqual(sixth.ratchet);
		expect(stored?.ratchet.baseline).toEqual({
			generatedAt: "2026-03-01T10:00:00.000Z",
			numbers: report?.ratchetBaseline.numbers,
		});
		expect(stored?.ratchet.baseline?.numbers["code.errors"]).toBe(1);
		expect(stored?.ratchet.numbers["code.errors"]).toBe(0);
	});

	it("applies lint.json: severities, thresholds, disabled rules and wrapper overrides", async () => {
		const project = await setup();
		await writeFile(
			project.path(".trickroom/systems/core/lint.json"),
			JSON.stringify({
				version: 1,
				rules: {
					"code.variants-file-stale": { severity: "warning" },
					"code.variants-file-orphaned": { enabled: false },
				},
				components: { badge: { module: "src/ui/button.tsx" } },
				thresholds: { code: { warnings: 1 } },
			}),
		);
		const result = await runLint({ projectRoot: project.root, check: true });
		expect(result.status).toBe("fail");
		expect(result.report?.config.present).toBe(true);
		expect(result.report?.summary.code.findings).toEqual({
			errors: 0,
			warnings: 2,
			info: 0,
		});
		expect(Object.keys(result.report?.summary.code.rules ?? {})).toEqual([
			"code.variants-file-stale",
		]);
		expect(result.ratchet?.breaches).toEqual([
			{ metric: "code.warnings", kind: "max", limit: 1, current: 2 },
		]);
		expect(
			result.report?.components.find((component) => component.slug === "badge"),
		).toMatchObject({ bound: true, wrappers: ["src/ui/button.tsx"] });

		await writeFile(
			project.path(".trickroom/systems/core/lint.json"),
			JSON.stringify({ version: 1, rules: { "code.nope": {} } }),
		);
		const invalid = await runLint({ projectRoot: project.root, check: true });
		expect(invalid.status).toBe("error");
		expect(invalid.diagnostics).toEqual([
			{
				code: "INVALID_LINT_CONFIG",
				severity: "error",
				message: expect.stringContaining(
					'rules["code.nope"] names an unknown rule kind',
				),
			},
		]);
	});

	it("warns about a configured wrapper that was not scanned and counts it as unbound", async () => {
		const project = await setup();
		await writeFile(
			project.path(".trickroom/systems/core/lint.json"),
			JSON.stringify({
				version: 1,
				components: { badge: { module: "src/does-not-exist.tsx" } },
				thresholds: { coverage: { bound: 1 } },
			}),
		);
		const result = await runLint({ projectRoot: project.root, check: true });
		expect(result.status).toBe("fail");
		expect(result.diagnostics).toEqual([
			{
				code: "WRAPPER_MODULE_NOT_SCANNED",
				severity: "warning",
				message: expect.stringContaining(
					'lint.json names src/does-not-exist.tsx as the wrapper of "badge"',
				),
				path: "src/does-not-exist.tsx",
			},
		]);
		expect(
			result.report?.components.find((component) => component.slug === "badge"),
		).toMatchObject({ bound: false, wrappers: [] });
		expect(result.ratchet?.breaches).toEqual([
			{ metric: "coverage.bound", kind: "min", limit: 1, current: 0 },
		]);
	});

	it("notes an unconfigured codegen block and scans src by default", async () => {
		const project = await setup({ codegen: false });
		const result = await runLint({ projectRoot: project.root, check: true });
		expect(result.status).toBe("pass");
		expect(result.report?.findings).toEqual([
			{
				rule: "code.variants-file-stale",
				severity: "info",
				side: "code",
				message: expect.stringContaining("Codegen is not configured"),
				location: null,
			},
		]);
		expect(
			result.report?.components.map((component) => [
				component.slug,
				component.generated,
				component.bound,
			]),
		).toEqual([
			["badge", null, false],
			["button", null, false],
		]);
		expect(result.report?.summary.code.scanned).toBe(2);
	});

	it("selects the system and reports project problems", async () => {
		const project = await setup();
		expect(
			(await runLint({ projectRoot: project.path("src"), check: true }))
				.diagnostics[0]?.code,
		).toBe("NOT_A_PROJECT");
		expect(
			(
				await runLint({
					projectRoot: project.root,
					system: "nope",
					check: true,
				})
			).diagnostics[0]?.code,
		).toBe("SYSTEM_NOT_FOUND");
		expect(
			(
				await runLint({
					projectRoot: project.root,
					system: "core",
					check: true,
				})
			).system?.name,
		).toBe("Core");

		await writeFile(
			project.path(".trickroom/config.json"),
			JSON.stringify({ name: "No default" }),
		);
		const only = await runLint({ projectRoot: project.root, check: true });
		expect(only.system?.name).toBe("Core");
		expect(only.report?.findings[0]?.severity).toBe("info");

		await mkdir(project.path(".trickroom/systems/other"), { recursive: true });
		await writeFile(
			project.path(".trickroom/systems/other/system.json"),
			JSON.stringify({
				version: 1,
				systemId: "sys_00000000-0000-4000-8000-000000000002",
				systemName: "Other",
			}),
		);
		const ambiguous = await runLint({ projectRoot: project.root, check: true });
		expect(ambiguous.diagnostics[0]).toMatchObject({
			code: "NO_SYSTEM",
			message: expect.stringContaining('"Core"'),
		});
	});

	it("treats an unreadable committed report as no baseline, and reports what it cannot foresee", async () => {
		const project = await setup();
		await mkdir(project.path(".trickroom/systems/core/lint-report.json"));
		const result = await runLint({ projectRoot: project.root, check: true });
		expect(result.status).toBe("pass");
		expect(result.baseline).toBe("invalid");
		expect(result.diagnostics).toEqual([
			{
				code: "INVALID_BASELINE",
				severity: "warning",
				message: expect.stringContaining("could not be read"),
				path: ".trickroom/systems/core/lint-report.json",
			},
		]);
		expect(result.ratchet?.baseline).toBeNull();

		// Two system folders with the same identity: the store throws.
		await mkdir(project.path(".trickroom/systems/twin"), { recursive: true });
		await writeFile(
			project.path(".trickroom/systems/twin/system.json"),
			JSON.stringify({
				version: 1,
				systemId: CODEGEN_TEST_SYSTEM_ID,
				systemName: "Twin",
			}),
		);
		const failed = await runLint({ projectRoot: project.root, check: true });
		expect(failed.status).toBe("error");
		expect(failed.report).toBeNull();
		expect(failed.diagnostics).toEqual([
			{
				code: "RUN_FAILED",
				severity: "error",
				message: expect.stringMatching(
					/^Lint could not complete \(DUPLICATE_SYSTEM_ID\): /u,
				),
			},
		]);
	});

	it("never writes in check mode and leaves the project otherwise untouched", async () => {
		const project = await setup();
		// A manifest the store would normalise on a non-read-only read.
		await writeFile(
			project.path(".trickroom/systems/core/system.json"),
			`${JSON.stringify({ version: 1, systemId: CODEGEN_TEST_SYSTEM_ID, systemName: " Core ", cssPath: "./src/styles.css" }, null, "\t")}\n`,
		);
		await writeFile(
			project.path(".trickroom/systems/core/tokens.json"),
			JSON.stringify({
				version: 3,
				metadata: {
					cssPath: "./src/styles.css",
					syncedAt: "2026-01-01T00:00:00.000Z",
					tailwindBaselineVersion: "test",
					reviewRequired: false,
				},
				domains: {},
				customProperties: {},
				customUtilities: [],
			}),
		);
		const before = await project.snapshotMtimes();
		await new Promise((resolve) => setTimeout(resolve, 20));
		await runLint({ projectRoot: project.root, check: true });
		expect(await project.snapshotMtimes()).toEqual(before);
		const written = await runLint({ projectRoot: project.root });
		expect(written.written).toBe(true);
		const after = await project.snapshotMtimes();
		const changed = Object.keys(after).filter(
			(file) => after[file] !== before[file],
		);
		expect(changed.sort()).toEqual([
			".trickroom/systems/core",
			".trickroom/systems/core/lint-report.json",
		]);
	});
});
