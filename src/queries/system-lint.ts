import { type QueryClient, queryOptions } from "@tanstack/react-query";
import type { LintRatchetResult } from "../lint/ratchet";
import type { LintReport } from "../lint/report";
import type { LintRunDiagnostic } from "../lint/run-lint";
import { readJsonOrThrow } from "../utils/readJsonOrThrow";
import { type ProjectQueryScope, withProjectQueryScope } from "./project-scope";

/**
 * The lint report of a system, as the dashboard reads it (docs/lint.md).
 * The report query 404s until a run wrote one; `runSystemLint` asks the
 * server to run the engine and write it, and a file event on
 * `lint-report.json` refreshes the query.
 */

export type SystemLintReportResponse = {
	systemId: string;
	systemName: string;
	report: LintReport;
};

export type SystemLintRunResponse = {
	systemId: string;
	systemName: string;
	status: "pass" | "fail";
	report: LintReport;
	ratchet: LintRatchetResult;
	written: boolean;
	diagnostics: LintRunDiagnostic[];
};

export const SYSTEM_LINT_QUERY_PREFIX = "trickroom-system-lint";

const lintUrl = (systemId: string) =>
	`/api/trickroom/systems/${encodeURIComponent(systemId)}/lint`;

const fetchSystemLintReport = async (systemId: string) => {
	const response = await fetch(lintUrl(systemId));
	return readJsonOrThrow<SystemLintReportResponse>(response);
};

export const systemLintQueryKey = (
	systemId: string,
	projectScope?: ProjectQueryScope,
) => withProjectQueryScope([SYSTEM_LINT_QUERY_PREFIX, systemId], projectScope);

export const systemLintQueryOptions = (
	systemId: string,
	projectScope?: ProjectQueryScope,
) =>
	queryOptions({
		queryKey: systemLintQueryKey(systemId, projectScope),
		queryFn: () => fetchSystemLintReport(systemId),
		retry: false,
	});

/** Run the engine on the server and write the report; a mutation function. */
export const runSystemLint = async (systemId: string) => {
	const response = await fetch(lintUrl(systemId), { method: "POST" });
	return readJsonOrThrow<SystemLintRunResponse>(response);
};

export const invalidateSystemLint = async (
	queryClient: QueryClient,
	systemId: string,
	projectScope?: ProjectQueryScope,
) => {
	await queryClient.invalidateQueries({
		queryKey: systemLintQueryKey(systemId, projectScope),
	});
};
