import {
	mkdir,
	mkdtemp,
	readFile,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
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
import { buildDesignTree } from "../components/system-editor/lint/lint-dashboard-model";
import { readProjectConfigReadOnly } from "../project";
import { createDesignFileService } from "../services/design-file-service";
import type { Node } from "../types";
import { getSystemComponentMarkerProps } from "../utils/system-component-markers";
import { parseLintReport } from "./report";
import { redundantClassRule } from "./rules/code/redundant-class";
import {
	variantsFileOrphanedRule,
	variantsFileStaleRule,
} from "./rules/code/variants-file";
import { designOnlyClassTargetRule } from "./rules/design/design-only-class-target";
import { designUnknownClassTokenRule } from "./rules/design/unknown-class-token";
import { designUnknownVariantValueRule } from "./rules/design/unknown-variant-value";
import { LINT_RULE_KIND_LEDGER_IDS } from "./rules/ledger";
import { createLintRuleRegistry } from "./rules/registry";
import type { LintRuleKind } from "./rules/types";
import {
	createTwMergeConfigLoader,
	type RunLintInput,
	runLint as runLintWithEveryKind,
} from "./run-lint";

// The engine is tested with the codegen kinds and the design kinds, so
// finding lists stay exact (the fixtures have no class or design problems
// beyond the ones a test sets up); the other code kinds have their own
// tests next to them in rules/.
const engineRegistry = createLintRuleRegistry([
	variantsFileStaleRule,
	variantsFileOrphanedRule,
	designUnknownClassTokenRule,
	designOnlyClassTargetRule,
	designUnknownVariantValueRule,
]);
const runLint = (input: RunLintInput) =>
	runLintWithEveryKind({ registry: engineRegistry, ...input });

/** The `kinds` a baseline records: the ledger plus the given ids, sorted. */
const knownKinds = (...extra: string[]) =>
	[...new Set([...LINT_RULE_KIND_LEDGER_IDS, ...extra])].sort();

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
			design: {
				findings: { errors: 0, warnings: 0, info: 0 },
				rules: {
					"design.design-only-class-target": {
						errors: 0,
						warnings: 0,
						info: 0,
					},
					"design.unknown-class-token": { errors: 0, warnings: 0, info: 0 },
					"design.unknown-variant-value": { errors: 0, warnings: 0, info: 0 },
				},
				scanned: 0,
			},
		});
		expect(report?.designs).toEqual([]);
		expect(report?.components).toEqual([
			{
				slug: "badge",
				componentId: badge.componentId,
				name: "badge",
				published: true,
				generated: false,
				bound: false,
				usedInApp: false,
				usedInDesigns: false,
				wrappers: [],
				usages: 0,
				designUsages: 0,
			},
			{
				slug: "button",
				componentId: button.componentId,
				name: "button",
				published: true,
				generated: true,
				bound: true,
				usedInApp: true,
				usedInDesigns: false,
				wrappers: ["src/ui/button.tsx"],
				usages: 2,
				designUsages: 0,
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
			// The ledger: every id ever shipped, not only this registry's.
			kinds: knownKinds(),
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
		expect(stored?.ratchet.baseline).toEqual(report?.ratchetBaseline);
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

	it("lints the designs linked to the system and fills the design side of the report", async () => {
		const chip = publishedComponent("chip", {
			...flatPayload("px-2"),
			variants: {
				axes: {
					size: { label: "Size", values: { sm: {}, lg: {} } },
				},
				compoundVariants: [],
			},
		});
		const project = await createCodegenTestProject({
			components: [chip, badge],
		});
		projects.push(project);
		const home = await mkdtemp(path.join(os.tmpdir(), "trickroom-home-"));
		const service = createDesignFileService(project.root, {
			trickroomHome: home,
		});
		const layer = (
			id: string,
			props: Record<string, unknown> = {},
			children: Node[] = [],
		): Node => ({
			id,
			props: {
				"data-trickroom-name": id,
				"data-trickroom-library": "trickroom",
				"data-trickroom-component": "container",
				...props,
			} as Node["props"],
			children,
		});
		const chipAt = (id: string, size: string) =>
			layer(id, {
				...getSystemComponentMarkerProps({
					systemId: CODEGEN_TEST_SYSTEM_ID,
					componentId: chip.componentId,
					instanceId: `inst_${id}`,
					version: "1",
					path: "root",
					isRoot: true,
					variantValues: { size },
				}),
			});
		try {
			await service.initializeDesignsDirectory();
			await service.writeDesignFile("d-shop", {
				name: "Shop",
				systemId: CODEGEN_TEST_SYSTEM_ID,
				boards: [
					layer("cart", {}, [chipAt("ok", "sm"), chipAt("bad", "xl")]),
					layer("checkout", {}, [chipAt("also-ok", "lg")]),
				],
			});
			await service.writeDesignFile("d-elsewhere", {
				name: "Elsewhere",
				systemId: "sys_00000000-0000-4000-8000-0000000000ff",
				boards: [layer("board", {}, [chipAt("ignored", "xl")])],
			});
		} finally {
			await rm(home, { recursive: true, force: true });
		}
		await writeFile(project.path(".trickroom/designs/d-broken.json"), "{");

		const result = await runLint({
			projectRoot: project.root,
			now: () => new Date("2026-03-01T10:00:00.000Z"),
		});
		expect(result.status).toBe("pass");
		expect(result.diagnostics).toEqual([
			{
				code: "DESIGN_UNREADABLE",
				severity: "warning",
				message: expect.stringContaining(
					'Design "d-broken" could not be read, so it was not linted',
				),
				path: ".trickroom/designs/d-broken",
			},
		]);
		const report = result.report;
		expect(report?.summary.design).toEqual({
			findings: { errors: 1, warnings: 0, info: 0 },
			rules: {
				"design.design-only-class-target": { errors: 0, warnings: 0, info: 0 },
				"design.unknown-class-token": { errors: 0, warnings: 0, info: 0 },
				"design.unknown-variant-value": { errors: 1, warnings: 0, info: 0 },
			},
			scanned: 1,
		});
		expect(
			report?.findings.filter((finding) => finding.side === "design"),
		).toEqual([
			{
				rule: "design.unknown-variant-value",
				severity: "error",
				side: "design",
				component: "chip",
				message:
					'Instance of "chip" sets "size" to "xl", which version 1 does not have. Pick one of "sm", "lg".',
				location: {
					kind: "design",
					design: "d-shop",
					board: "cart",
					element: "bad",
					path: "boards[0].children[1]",
				},
			},
		]);
		expect(report?.designs).toEqual([
			// What is on no board; the dashboard adds up a design's rows.
			{
				design: "d-shop",
				board: null,
				usages: 0,
				findings: { errors: 0, warnings: 0, info: 0 },
			},
			{
				design: "d-shop",
				board: "cart",
				usages: 2,
				findings: { errors: 1, warnings: 0, info: 0 },
			},
			{
				design: "d-shop",
				board: "checkout",
				usages: 1,
				findings: { errors: 0, warnings: 0, info: 0 },
			},
		]);
		// The dashboard adds up a design's rows: no double counting.
		const tree = buildDesignTree(report?.designs ?? []);
		expect(
			tree.children.map((design) => [
				design.name,
				design.usages,
				design.findings.errors,
				design.children.length,
			]),
		).toEqual([["d-shop", 3, 1, 2]]);
		expect(
			report?.components.map((component) => [
				component.slug,
				component.usedInDesigns,
				component.designUsages,
			]),
		).toEqual([
			["badge", false, 0],
			["chip", true, 3],
		]);
		expect(report?.ratchet.numbers).toMatchObject({
			"design.errors": 1,
			"design.warnings": 0,
			"coverage.usedInDesigns": 1,
			"rule.design.unknown-variant-value": 1,
		});
		// The committed report round-trips with the design side.
		expect(await readReport(project)).toEqual(report);
	});

	it("counts usages for coverage and the heat map the way the rules do, skipping shadowed names", async () => {
		const project = await setup();
		await generate(project);
		await writeFile(
			project.path("src/app.tsx"),
			[
				'import { Button } from "./ui/button";',
				// A parameter named Button: <Button /> is not the component.
				"export function App(Button: () => null) {",
				"\treturn <Button />;",
				"}",
				"",
			].join("\n"),
		);
		const result = await runLint({ projectRoot: project.root, check: true });
		expect(
			result.report?.components.find((entry) => entry.slug === "button"),
		).toMatchObject({ bound: true, usedInApp: false, usages: 0 });
		expect(
			result.report?.files.find((entry) => entry.file === "src/app.tsx"),
		).toBeUndefined();

		// The same file with the import in scope counts.
		await writeFile(
			project.path("src/app.tsx"),
			'import { Button } from "./ui/button";\nexport function App() {\n\treturn <Button />;\n}\n',
		);
		const used = await runLint({ projectRoot: project.root, check: true });
		expect(
			used.report?.components.find((entry) => entry.slug === "button"),
		).toMatchObject({ usedInApp: true, usages: 1 });
		expect(
			used.report?.files.find((entry) => entry.file === "src/app.tsx"),
		).toMatchObject({ usages: 1 });
	});

	it("reports a lint.json it cannot read as an invalid lint.json", async () => {
		const project = await setup({ codegen: false });
		await mkdir(project.path(".trickroom/systems/core/lint.json"));
		const result = await runLint({ projectRoot: project.root, check: true });
		expect(result.status).toBe("error");
		expect(result.diagnostics).toEqual([
			{
				code: "INVALID_LINT_CONFIG",
				severity: "error",
				message: expect.stringMatching(
					/^\.trickroom\/systems\/core\/lint\.json is invalid: lint\.json could not be read: .*EISDIR/u,
				),
			},
		]);
	});

	it("rejects invalid rule options as an invalid lint.json", async () => {
		const project = await setup({ codegen: false });
		await writeFile(
			project.path(".trickroom/systems/core/lint.json"),
			JSON.stringify({
				version: 1,
				rules: { "design.unknown-class-token": { options: { allow: "x" } } },
			}),
		);
		const result = await runLint({ projectRoot: project.root, check: true });
		expect(result.status).toBe("error");
		expect(result.diagnostics).toEqual([
			{
				code: "INVALID_LINT_CONFIG",
				severity: "error",
				message:
					'.trickroom/systems/core/lint.json is invalid: rules["design.unknown-class-token"].options.allow must be a list of strings.',
			},
		]);
	});
});

describe("runLint with codegen.twMerge", () => {
	const projects: CodegenTestProject[] = [];
	afterEach(async () => {
		await Promise.all(projects.splice(0).map((project) => project.cleanup()));
	});

	it("merges code.redundant-class with the derived config only when codegen.twMerge generates it", async () => {
		const tag = publishedComponent(
			"tag",
			flatPayload("text-label-sm text-royal-9"),
		);
		const lint = async (twMerge: boolean) => {
			const project = await createCodegenTestProject({
				codegen: {
					version: 1,
					outDir: "src/ui",
					...(twMerge ? { twMerge: {} } : {}),
				},
				components: [tag],
			});
			projects.push(project);
			await writeFile(
				project.path(".trickroom/systems/core/system.json"),
				`${JSON.stringify({ version: 1, systemId: CODEGEN_TEST_SYSTEM_ID, systemName: "Core", cssPath: "src/theme.css" }, null, "\t")}\n`,
			);
			await mkdir(project.path("src/ui"), { recursive: true });
			await writeFile(
				project.path("src/theme.css"),
				"@theme { --color-royal-9: oklch(54% 0.22 263); --db-label-sm: 0.875rem; }\n@utility text-label-* { font-size: --value(--db-label-*); line-height: 1.25; }\n",
			);
			await writeFile(
				project.path("src/ui/tag.tsx"),
				'import { tagVariants } from "./tag.variants";\nexport const Tag = (props: { className?: string }) => <span className={tagVariants({ class: props.className })} />;\n',
			);
			await writeFile(
				project.path("src/app.tsx"),
				'import { Tag } from "./ui/tag";\nexport const App = () => <Tag className="text-label-sm" />;\n',
			);
			const read = await readProjectConfigReadOnly(project.root);
			const config = resolveCodegenConfig(read.config);
			if (config.status !== "configured") throw new Error("unconfigured");
			await runCodegen({ projectRoot: project.root, config, mode: "write" });
			const result = await runLintWithEveryKind({
				registry: createLintRuleRegistry([redundantClassRule]),
				projectRoot: project.root,
				check: true,
			});
			return (result.report?.findings ?? []).map((finding) => finding.message);
		};
		expect(await lint(true)).toEqual([
			'<Tag className> repeats "text-label-sm", which "tag" already applies through its base classes. Remove it from className.',
		]);
		// Stock tailwind-merge takes text-label-sm for a colour the base replaces.
		expect(await lint(false)).toEqual([]);
	});
});

describe("runLint adopting newly shipped kinds", () => {
	const projects: CodegenTestProject[] = [];
	afterEach(async () => {
		await Promise.all(projects.splice(0).map((project) => project.cleanup()));
	});

	// A kind shipped after the baseline was written: `warnings` warnings
	// and `errors` errors on src/app.tsx.
	const fresh = { warnings: 2, errors: 1 };
	const freshRule: LintRuleKind = {
		id: "code.fresh",
		side: "code",
		defaultSeverity: "warning",
		description: "A kind newer than the baseline.",
		run: ({ rule }) =>
			Array.from(
				{ length: rule.severity === "error" ? fresh.errors : fresh.warnings },
				(_, index) => ({
					message: `fresh ${index}`,
					location: { kind: "code" as const, file: "src/app.tsx", line: 1 },
				}),
			),
	};
	// Errors and warnings at once: two instances would need two ids, so the
	// error half comes from a second kind.
	const freshErrorRule: LintRuleKind = {
		...freshRule,
		id: "code.fresh-error",
		defaultSeverity: "error",
	};
	const oldRegistry = createLintRuleRegistry([
		variantsFileStaleRule,
		variantsFileOrphanedRule,
	]);
	const newRegistry = createLintRuleRegistry([
		variantsFileStaleRule,
		variantsFileOrphanedRule,
		freshRule,
		freshErrorRule,
	]);

	const setup = async () => {
		fresh.warnings = 2;
		fresh.errors = 1;
		const project = await createCodegenTestProject({
			codegen: { version: 1, outDir: "src/ui" },
			components: [publishedComponent("button", flatPayload("px-3"))],
		});
		projects.push(project);
		await mkdir(project.path("src/ui"), { recursive: true });
		await writeFile(
			project.path("src/app.tsx"),
			"export const App = () => <div />;\n",
		);
		await generate(project);
		return project;
	};
	const generate = async (project: CodegenTestProject) => {
		const read = await readProjectConfigReadOnly(project.root);
		const config = resolveCodegenConfig(read.config);
		if (config.status !== "configured") throw new Error("unconfigured");
		await runCodegen({ projectRoot: project.root, config, mode: "write" });
	};
	const reportFile = (project: CodegenTestProject) =>
		project.path(".trickroom/systems/core/lint-report.json");
	const writeLintJson = (project: CodegenTestProject, rules: object) =>
		writeFile(
			project.path(".trickroom/systems/core/lint.json"),
			`${JSON.stringify({ version: 1, rules })}\n`,
		);

	it("adopts a kind the baseline predates, compares the rest as before, and records it on the next write", async () => {
		const project = await setup();
		const first = await runLintWithEveryKind({
			registry: oldRegistry,
			projectRoot: project.root,
		});
		expect(first.written).toBe(true);
		expect(first.report?.ratchetBaseline.kinds).toEqual(knownKinds());

		const checked = await runLintWithEveryKind({
			registry: newRegistry,
			projectRoot: project.root,
			check: true,
		});
		expect(checked.status).toBe("pass");
		expect(checked.ratchet?.regressions).toEqual([]);
		expect(checked.ratchet?.adopted).toEqual([
			{ metric: "rule.code.fresh", current: 2 },
			{ metric: "rule.code.fresh-error", current: 1 },
		]);
		// The baseline compared against has the adopted counts folded in.
		expect(checked.ratchet?.baseline?.numbers).toMatchObject({
			"code.errors": 1,
			"code.warnings": 2,
			"rule.code.fresh": 2,
			"rule.code.fresh-error": 1,
		});
		expect(checked.ratchet?.numbers).toMatchObject({
			"code.errors": 1,
			"code.warnings": 2,
		});

		// An old kind that got worse still fails, with the aggregate compared
		// without the adopted counts.
		await writeFile(
			project.path("src/ui/button.variants.ts"),
			`${await readFile(project.path("src/ui/button.variants.ts"), "utf8")}// edited\n`,
		);
		const worse = await runLintWithEveryKind({
			registry: newRegistry,
			projectRoot: project.root,
		});
		expect(worse.status).toBe("fail");
		expect(worse.written).toBe(false);
		expect(worse.ratchet?.regressions).toEqual([
			{ metric: "code.errors", baseline: 1, current: 2 },
			{ metric: "coverage.generated", baseline: 1, current: 0 },
			{ metric: "rule.code.variants-file-stale", baseline: 0, current: 1 },
		]);
		expect(worse.ratchet?.adopted).toHaveLength(2);
		await generate(project);

		const written = await runLintWithEveryKind({
			registry: newRegistry,
			projectRoot: project.root,
		});
		expect(written).toMatchObject({ status: "pass", written: true });
		expect(written.report?.ratchetBaseline).toMatchObject({
			kinds: knownKinds("code.fresh", "code.fresh-error"),
			numbers: { "rule.code.fresh": 2, "code.warnings": 2 },
		});

		const again = await runLintWithEveryKind({
			registry: newRegistry,
			projectRoot: project.root,
			check: true,
		});
		expect(again.status).toBe("pass");
		expect(again.ratchet?.adopted).toEqual([]);
		fresh.warnings = 3;
		const freshWorse = await runLintWithEveryKind({
			registry: newRegistry,
			projectRoot: project.root,
			check: true,
		});
		expect(freshWorse.ratchet?.regressions).toEqual([
			{ metric: "code.warnings", baseline: 2, current: 3 },
			{ metric: "rule.code.fresh", baseline: 2, current: 3 },
		]);
	});

	it("compares a kind switched off and on again as usual", async () => {
		const project = await setup();
		await writeLintJson(project, { "code.fresh": { enabled: false } });
		const off = await runLintWithEveryKind({
			registry: newRegistry,
			projectRoot: project.root,
		});
		expect(off.written).toBe(true);
		expect(off.report?.ratchetBaseline.kinds).toContain("code.fresh");
		expect(off.report?.ratchetBaseline.numbers).not.toHaveProperty(
			"rule.code.fresh",
		);

		await writeLintJson(project, {});
		const on = await runLintWithEveryKind({
			registry: newRegistry,
			projectRoot: project.root,
			check: true,
		});
		expect(on.status).toBe("fail");
		expect(on.ratchet?.adopted).toEqual([]);
		expect(on.ratchet?.regressions).toEqual([
			{ metric: "code.warnings", baseline: 0, current: 2 },
			{ metric: "rule.code.fresh", baseline: 0, current: 2 },
		]);
	});

	it("never adopts a kind again once a baseline knew it: removed and restored, or after a downgrade and upgrade", async () => {
		const project = await setup();
		fresh.warnings = 1;
		const known = await runLintWithEveryKind({
			registry: newRegistry,
			projectRoot: project.root,
		});
		expect(known.report?.ratchetBaseline.numbers["rule.code.fresh"]).toBe(1);

		// A Trickroom without the kind (one that removed it, or an older one
		// it is downgraded to) writes a passing baseline: the kind stays known.
		const without = await runLintWithEveryKind({
			registry: oldRegistry,
			projectRoot: project.root,
		});
		expect(without.written).toBe(true);
		expect(without.report?.ratchetBaseline.kinds).toEqual(
			knownKinds("code.fresh", "code.fresh-error"),
		);
		expect(without.report?.ratchetBaseline.numbers).not.toHaveProperty(
			"rule.code.fresh",
		);

		// The kind comes back with 100 findings: compared, not adopted.
		fresh.warnings = 100;
		const restored = await runLintWithEveryKind({
			registry: newRegistry,
			projectRoot: project.root,
			check: true,
		});
		expect(restored.status).toBe("fail");
		expect(restored.ratchet?.adopted).toEqual([]);
		expect(restored.ratchet?.regressions).toEqual([
			{ metric: "code.errors", baseline: 0, current: 1 },
			{ metric: "code.warnings", baseline: 0, current: 100 },
			{ metric: "rule.code.fresh", baseline: 0, current: 100 },
			{ metric: "rule.code.fresh-error", baseline: 0, current: 1 },
		]);
	});

	it("loses the toggle history when a Trickroom without kinds rewrites the baseline", async () => {
		const project = await setup();
		await writeLintJson(project, { "code.fresh": { enabled: false } });
		await runLintWithEveryKind({
			registry: newRegistry,
			projectRoot: project.root,
		});
		// A Trickroom from before kinds reads the report and writes its next
		// passing one without them (and without `adopted`).
		const stored = JSON.parse(await readFile(reportFile(project), "utf8"));
		expect(stored.ratchetBaseline.kinds).toContain("code.fresh");
		delete stored.ratchetBaseline.kinds;
		delete stored.ratchet.adopted;
		await writeFile(reportFile(project), JSON.stringify(stored));

		// Switched back on, the kind has no number in a legacy baseline, so
		// it is adopted: the documented gap.
		await writeLintJson(project, {});
		const on = await runLintWithEveryKind({
			registry: newRegistry,
			projectRoot: project.root,
			check: true,
		});
		expect(on.status).toBe("pass");
		expect(on.ratchet?.adopted).toEqual([
			{ metric: "rule.code.fresh", current: 2 },
		]);
	});

	it("takes the kinds without a number in a baseline written before kinds were recorded as new", async () => {
		const project = await setup();
		await writeLintJson(project, { "code.fresh-error": { enabled: false } });
		await runLintWithEveryKind({
			registry: newRegistry,
			projectRoot: project.root,
		});
		const stored = JSON.parse(await readFile(reportFile(project), "utf8"));
		// The baseline as a Trickroom before this field wrote it, and without
		// code.fresh, as if it shipped later.
		delete stored.ratchetBaseline.kinds;
		delete stored.ratchet.adopted;
		delete stored.ratchetBaseline.numbers["rule.code.fresh"];
		stored.ratchetBaseline.numbers["code.warnings"] = 0;
		await writeFile(reportFile(project), JSON.stringify(stored));

		await writeLintJson(project, {});
		const upgraded = await runLintWithEveryKind({
			registry: newRegistry,
			projectRoot: project.root,
			check: true,
		});
		expect(upgraded.baseline).toBe("present");
		expect(upgraded.status).toBe("pass");
		// Both have no number in the old baseline: code.fresh as a kind it
		// predates, code.fresh-error as one it had switched off.
		expect(upgraded.ratchet?.adopted).toEqual([
			{ metric: "rule.code.fresh", current: 2 },
			{ metric: "rule.code.fresh-error", current: 1 },
		]);
	});
});

describe("createTwMergeConfigLoader", () => {
	it("derives the merge config from the system CSS once, is stock without CSS, and reports a failure", async () => {
		const dir = await mkdtemp(
			path.join(os.tmpdir(), "trickroom-tw-merge-lint-"),
		);
		try {
			await writeFile(
				path.join(dir, "theme.css"),
				"@theme { --db-label-sm: 0.875rem; }\n@utility text-label-* { font-size: --value(--db-label-*); }\n",
			);
			await writeFile(
				path.join(dir, "broken.css"),
				"@utility broken { @apply not-a-utility; }\n",
			);
			const load = createTwMergeConfigLoader(dir, "theme.css");
			const loaded = await load();
			expect(loaded.status).toBe("derived");
			expect(
				loaded.status === "derived" &&
					loaded.config.extend.classGroups["@utility text-label-*"],
			).toEqual(["text-label-sm"]);
			expect(await load()).toBe(loaded);
			expect(await createTwMergeConfigLoader(dir, null)()).toEqual({
				status: "stock",
			});
			// The project's merge groups, and a failure when they do not fit.
			const grouped = await createTwMergeConfigLoader(dir, "theme.css", {
				labels: ["text-label-*"],
			})();
			expect(
				grouped.status === "derived" &&
					grouped.config.extend.classGroups["mergeGroups.labels"],
			).toEqual(["text-label-sm"]);
			expect(
				await createTwMergeConfigLoader(dir, "theme.css", {
					labels: ["text-caption-*"],
				})(),
			).toMatchObject({ status: "failed", message: expect.any(String) });
			expect(
				await createTwMergeConfigLoader(dir, "broken.css")(),
			).toMatchObject({ status: "failed" });
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});
