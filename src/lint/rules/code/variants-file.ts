import type { LintRuleFinding, LintRuleKind } from "../types";

/**
 * The codegen check as diagnostics: every selected component's variants
 * file, and the tailwind-merge config when `codegen.twMerge` is set, is
 * `ok`, and no generated file of the system is orphaned. Built on
 * `runCodegen` in check mode (the runner provides the result). A project
 * without a `codegen` block gets one informational finding and no
 * violations.
 */

const describeComponentStatus = (
	status: "missing" | "stale" | "error",
	reason?: string,
) => {
	if (status === "missing") return "has no generated variants file";
	if (status === "error") return "could not be checked";
	switch (reason) {
		case "source-changed":
			return "is stale: the component changed since the file was generated";
		case "body-edited":
			return "is stale: the file body was edited or reformatted";
		case "not-generated":
			return "is stale: the file at its path has no Trickroom codegen header";
		default:
			return "is stale";
	}
};

/** The run's message says what changed, so a source change is just stale. */
const describeTwMergeStatus = (
	status: "missing" | "stale" | "error",
	reason?: string,
) => {
	if (status === "missing") return "is missing";
	if (status === "stale" && reason === "source-changed") return "is stale";
	return describeComponentStatus(status, reason);
};

export const CODEGEN_NOT_CONFIGURED_MESSAGE =
	"Codegen is not configured for this project, so variants files were not checked. The class rules still ran; the rules on wrappers, usages and variants imports find components in the code through their generated variants files. Add a codegen block to .trickroom/config.json to enable them (see docs/codegen.md).";

export const variantsFileStaleRule: LintRuleKind = {
	id: "code.variants-file-stale",
	side: "code",
	defaultSeverity: "error",
	description:
		"A published component's generated variants file is missing, stale or could not be checked (the codegen check).",
	run: ({ codegen }) => {
		if (codegen === null) {
			return [
				{
					severity: "info",
					message: CODEGEN_NOT_CONFIGURED_MESSAGE,
					location: null,
				},
			];
		}
		const findings: LintRuleFinding[] = [];
		for (const diagnostic of codegen.diagnostics) {
			if (diagnostic.severity !== "error") continue;
			findings.push({
				message: `Codegen check failed: ${diagnostic.message}`,
				location: diagnostic.path
					? { kind: "code", file: diagnostic.path }
					: null,
				...(diagnostic.slug ? { component: diagnostic.slug } : {}),
			});
		}
		for (const component of codegen.components) {
			if (component.status === "ok") continue;
			findings.push({
				message: `Component "${component.slug}" ${describeComponentStatus(component.status, component.reason)}${component.message ? ` (${component.message})` : ""}. Run "trickroom codegen" to regenerate.`,
				location: { kind: "code", file: component.file, line: 1, column: 1 },
				component: component.slug,
			});
		}
		const twMerge = codegen.twMerge;
		if (twMerge && twMerge.status !== "ok") {
			findings.push({
				message: `The tailwind-merge config ${twMerge.file} ${describeTwMergeStatus(twMerge.status, twMerge.reason)}${twMerge.message ? ` (${twMerge.message})` : ""}. Run "trickroom codegen" to regenerate.`,
				location: { kind: "code", file: twMerge.file, line: 1, column: 1 },
			});
		}
		return findings;
	},
};

export const variantsFileOrphanedRule: LintRuleKind = {
	id: "code.variants-file-orphaned",
	side: "code",
	defaultSeverity: "warning",
	description:
		"A file in the codegen outDir carries this system's header but no selected component generates it (renamed, deleted or excluded).",
	run: ({ codegen }) =>
		(codegen?.orphaned ?? []).map((file) => ({
			message: `${file} was generated for this system, but no selected component generates it any more. Delete it once nothing imports it.`,
			location: { kind: "code", file, line: 1, column: 1 },
		})),
};
