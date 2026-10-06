import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import type { LintRunFinding } from "../../lint/run-rules";
import {
	type DesignFileLintResponse,
	designLintQueryOptions,
} from "../../queries/design-lint";
import { useProjectScope } from "../contexts";
import { Alert } from "../ui/alert";

/**
 * The design-side lint findings in the design inspector: the same rules,
 * `lint.json` and messages an agent gets from `design_validate`, read from
 * the saved design (they follow autosave).
 */

const EMPTY: LintRunFinding[] = [];

function useDesignLint(designId: string | undefined) {
	const projectScope = useProjectScope();
	return useQuery({
		...designLintQueryOptions(designId ?? "", projectScope),
		enabled: Boolean(designId),
	}).data;
}

const isOnElement = (finding: LintRunFinding, elementId: string) =>
	finding.location?.kind === "design" && finding.location.element === elementId;

/** Findings located on one element of the design. */
export function useElementLintFindings(
	designId: string | undefined,
	elementId: string | null,
): LintRunFinding[] {
	const data = useDesignLint(designId);
	return useMemo(
		() =>
			data && elementId
				? data.findings.filter((finding) => isOnElement(finding, elementId))
				: EMPTY,
		[data, elementId],
	);
}

const toneOf = (severity: LintRunFinding["severity"]) =>
	severity === "error" ? "danger" : severity === "warning" ? "warning" : "info";

export function DesignLintFindingList({
	findings,
}: {
	findings: readonly LintRunFinding[];
}) {
	return (
		<ul className="flex flex-col gap-2">
			{findings.map((finding, index) => (
				<li
					// Findings have no id; their order is stable per response.
					// biome-ignore lint/suspicious/noArrayIndexKey: see above
					key={`${finding.rule}:${index}`}
					className="flex flex-col gap-0.5"
				>
					<Alert variant="inline" tone={toneOf(finding.severity)}>
						{finding.message}
					</Alert>
					<span className="pl-5 font-mono text-[10px] text-slate-500">
						{finding.rule}
					</span>
				</li>
			))}
		</ul>
	);
}

const summarize = (data: DesignFileLintResponse) => {
	let errors = 0;
	let warnings = 0;
	for (const finding of data.findings) {
		if (finding.severity === "error") errors += 1;
		else if (finding.severity === "warning") warnings += 1;
	}
	return { errors, warnings };
};

/**
 * The design's totals, the findings that sit on no element (a placed
 * component's definition) and anything that kept a rule from running.
 */
export function DesignLintSummary({ designId }: { designId: string }) {
	const data = useDesignLint(designId);
	if (!data?.system) return null;
	const { errors, warnings } = summarize(data);
	const unplaced = data.findings.filter(
		(finding) => finding.location?.kind !== "design",
	);
	return (
		<div className="flex flex-col gap-2">
			<div className="flex items-center justify-between text-[11px] font-semibold text-slate-700">
				<span>Lint</span>
				<span className="font-mono font-normal text-slate-500">
					{errors} errors · {warnings} warnings
				</span>
			</div>
			{unplaced.length > 0 ? (
				<DesignLintFindingList findings={unplaced} />
			) : null}
			{data.diagnostics.map((diagnostic) => (
				<Alert key={diagnostic.message} variant="inline" tone="warning">
					{diagnostic.message}
				</Alert>
			))}
		</div>
	);
}
