import { describe, expect, it } from "vitest";
import type { CodegenRunResult } from "../../codegen/run-codegen";
import {
	variantsFileOrphanedRule,
	variantsFileStaleRule,
} from "./code/variants-file";
import {
	createLintRuleRegistry,
	LINT_RULE_KINDS,
	lintRuleRegistry,
} from "./index";
import type { LintRuleContext } from "./types";

const context = (codegen: CodegenRunResult | null): LintRuleContext =>
	({ codegen }) as unknown as LintRuleContext;

const codegenResult = (
	overrides: Partial<CodegenRunResult>,
): CodegenRunResult => ({
	status: "drift",
	mode: "check",
	source: "published",
	system: { id: "sys_1", name: "Core" },
	outDir: "src/ui",
	components: [],
	orphaned: [],
	diagnostics: [],
	written: [],
	...overrides,
});

describe("rule registry", () => {
	it("registers the shipped kinds with well-formed ids", () => {
		expect(lintRuleRegistry.kinds).toBe(LINT_RULE_KINDS);
		expect([...lintRuleRegistry.ids]).toEqual([
			"code.variants-file-stale",
			"code.variants-file-orphaned",
			"design.unknown-class-token",
			"design.design-only-class-target",
			"design.unknown-variant-value",
		]);
		expect(
			lintRuleRegistry.get("code.variants-file-stale")?.defaultSeverity,
		).toBe("error");
		expect(lintRuleRegistry.get("nope")).toBeNull();
		for (const kind of LINT_RULE_KINDS) {
			expect(kind.description.length).toBeGreaterThan(20);
		}
	});

	it("rejects malformed and duplicate ids", () => {
		const base = {
			side: "code" as const,
			defaultSeverity: "error" as const,
			description: "x",
			run: () => [],
		};
		expect(() => createLintRuleRegistry([{ ...base, id: "Code.X" }])).toThrow(
			"must look like",
		);
		expect(() => createLintRuleRegistry([{ ...base, id: "design.x" }])).toThrow(
			"prefix must match",
		);
		expect(() =>
			createLintRuleRegistry([
				{ ...base, id: "code.x" },
				{ ...base, id: "code.x" },
			]),
		).toThrow("registered twice");
	});
});

describe("code.variants-file-stale", () => {
	it("notes an unconfigured project as information", () => {
		expect(variantsFileStaleRule.run(context(null))).toEqual([
			{
				severity: "info",
				message: expect.stringContaining("Codegen is not configured"),
				location: null,
			},
		]);
	});

	it("turns codegen statuses and errors into findings", () => {
		const findings = variantsFileStaleRule.run(
			context(
				codegenResult({
					components: [
						{
							slug: "ok",
							componentId: "c1",
							file: "src/ui/ok.variants.ts",
							status: "ok",
							source: "published",
							shape: "flat",
							publishedVersion: "1",
							sourceHash: "h",
							onDisk: null,
						},
						{
							slug: "badge",
							componentId: "c2",
							file: "src/ui/badge.variants.ts",
							status: "missing",
							source: "published",
							shape: "flat",
							publishedVersion: "1",
							sourceHash: "h",
							onDisk: null,
						},
						{
							slug: "button",
							componentId: "c3",
							file: "src/ui/button.variants.ts",
							status: "stale",
							reason: "source-changed",
							message:
								"Generated from published version 1; the component is at 2.",
							source: "published",
							shape: "flat",
							publishedVersion: "2",
							sourceHash: "h",
							onDisk: null,
						},
						{
							slug: "card",
							componentId: "c4",
							file: "src/ui/card.variants.ts",
							status: "stale",
							reason: "not-generated",
							source: "published",
							shape: "flat",
							publishedVersion: "1",
							sourceHash: "h",
							onDisk: null,
						},
						{
							slug: "chip",
							componentId: "c5",
							file: "src/ui/chip.variants.ts",
							status: "error",
							message: "formatter died",
							source: "published",
							shape: "flat",
							publishedVersion: "1",
							sourceHash: "h",
							onDisk: null,
						},
					],
					diagnostics: [
						{
							code: "FORMATTER_FAILED",
							severity: "error",
							message: "formatter died",
							slug: "chip",
							path: "src/ui/chip.variants.ts",
						},
						{
							code: "COMPONENT_MANIFEST_DIAGNOSTIC",
							severity: "warning",
							message: "ignored",
						},
					],
				}),
			),
		);
		expect(findings).toEqual([
			{
				message: "Codegen check failed: formatter died",
				location: { kind: "code", file: "src/ui/chip.variants.ts" },
				component: "chip",
			},
			{
				message:
					'Component "badge" has no generated variants file. Run "trickroom codegen" to regenerate.',
				location: {
					kind: "code",
					file: "src/ui/badge.variants.ts",
					line: 1,
					column: 1,
				},
				component: "badge",
			},
			{
				message:
					'Component "button" is stale: the component changed since the file was generated (Generated from published version 1; the component is at 2.). Run "trickroom codegen" to regenerate.',
				location: {
					kind: "code",
					file: "src/ui/button.variants.ts",
					line: 1,
					column: 1,
				},
				component: "button",
			},
			{
				message:
					'Component "card" is stale: the file at its path has no Trickroom codegen header. Run "trickroom codegen" to regenerate.',
				location: {
					kind: "code",
					file: "src/ui/card.variants.ts",
					line: 1,
					column: 1,
				},
				component: "card",
			},
			{
				message:
					'Component "chip" could not be checked (formatter died). Run "trickroom codegen" to regenerate.',
				location: {
					kind: "code",
					file: "src/ui/chip.variants.ts",
					line: 1,
					column: 1,
				},
				component: "chip",
			},
		]);
	});
});

describe("code.variants-file-orphaned", () => {
	it("reports every orphaned file and nothing without codegen", () => {
		expect(variantsFileOrphanedRule.run(context(null))).toEqual([]);
		expect(
			variantsFileOrphanedRule.run(
				context(codegenResult({ orphaned: ["src/ui/old.variants.ts"] })),
			),
		).toEqual([
			{
				message: expect.stringContaining(
					"src/ui/old.variants.ts was generated for this system",
				),
				location: {
					kind: "code",
					file: "src/ui/old.variants.ts",
					line: 1,
					column: 1,
				},
			},
		]);
	});
});
