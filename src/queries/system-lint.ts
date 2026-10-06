import { type QueryClient, queryOptions } from "@tanstack/react-query";
import type { LintConfig } from "../lint/config";
import type { LintRatchetResult } from "../lint/ratchet";
import type { LintReport } from "../lint/report";
import type { LintRunDiagnostic } from "../lint/run-lint";
import type { SystemLintConfigResponse } from "../routes/system-lint";
import { HttpError, readJsonOrThrow } from "../utils/readJsonOrThrow";
import { type ProjectQueryScope, withProjectQueryScope } from "./project-scope";

/**
 * The lint report of a system, as the dashboard reads it (docs/lint.md).
 * The report query 404s until a run wrote one; `runSystemLint` asks the
 * server to run the engine and write it, and a file event on
 * `lint-report.json` refreshes the query. The config query reads
 * `lint.json` with the rule kind catalogue; `saveSystemLintConfig` writes it.
 */

export type { SystemLintConfigResponse };

export type SystemLintReportResponse = {
	systemId: string;
	systemName: string;
	report: LintReport;
	/** The contract the system has now; a different hash means a stale report. */
	current?: { contractHash: string | null };
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
export const SYSTEM_LINT_CONFIG_QUERY_PREFIX = "trickroom-system-lint-config";

/** A failed lint request, with what the server said was wrong. */
export class SystemLintRequestError extends HttpError {
	code: string | null;
	issues: string[];
	diagnostics: LintRunDiagnostic[];

	constructor(
		message: string,
		status: number,
		body: {
			code?: unknown;
			issues?: unknown;
			diagnostics?: unknown;
		} | null,
	) {
		super(message, status);
		this.name = "SystemLintRequestError";
		this.code = typeof body?.code === "string" ? body.code : null;
		this.issues = Array.isArray(body?.issues)
			? body.issues.filter(
					(issue): issue is string => typeof issue === "string",
				)
			: [];
		this.diagnostics = Array.isArray(body?.diagnostics)
			? (body.diagnostics as LintRunDiagnostic[])
			: [];
	}
}

const readLintJsonOrThrow = async <T>(response: Response): Promise<T> => {
	if (!response.ok) {
		const body = (await response.json().catch(() => null)) as {
			error?: unknown;
			code?: unknown;
			issues?: unknown;
			diagnostics?: unknown;
		} | null;
		throw new SystemLintRequestError(
			typeof body?.error === "string"
				? body.error
				: `Request failed with status ${response.status}`,
			response.status,
			body,
		);
	}
	return (await response.json()) as T;
};

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

/**
 * Run the engine on the server and write the report; a mutation function.
 * A run that cannot complete throws a `SystemLintRequestError` carrying the
 * diagnostics.
 */
export const runSystemLint = async (systemId: string) => {
	const response = await fetch(lintUrl(systemId), { method: "POST" });
	return readLintJsonOrThrow<SystemLintRunResponse>(response);
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

export const systemLintConfigQueryKey = (
	systemId: string,
	projectScope?: ProjectQueryScope,
) =>
	withProjectQueryScope(
		[SYSTEM_LINT_CONFIG_QUERY_PREFIX, systemId],
		projectScope,
	);

export const systemLintConfigQueryOptions = (
	systemId: string,
	projectScope?: ProjectQueryScope,
) =>
	queryOptions({
		queryKey: systemLintConfigQueryKey(systemId, projectScope),
		queryFn: async () =>
			readJsonOrThrow<SystemLintConfigResponse>(
				await fetch(`${lintUrl(systemId)}/config`),
			),
	});

/**
 * Write `lint.json`; a mutation function. `revision` is the one the edit
 * started from (null when the file was absent): the server refuses with 409
 * `LINT_CONFIG_CONFLICT` when the file changed since, and with 422
 * `LINT_CONFIG_INVALID` and the engine's `issues` when the config is invalid.
 */
export const saveSystemLintConfig = async (
	systemId: string,
	input: { config: LintConfig; revision: string | null },
) => {
	const response = await fetch(`${lintUrl(systemId)}/config`, {
		method: "PUT",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(input),
	});
	return readLintJsonOrThrow<SystemLintConfigResponse>(response);
};
