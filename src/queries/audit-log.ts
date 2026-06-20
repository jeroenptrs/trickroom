import { queryOptions } from "@tanstack/react-query";
import { readJsonOrThrow } from "../utils/readJsonOrThrow";
import { type ProjectQueryScope, withProjectQueryScope } from "./project-scope";

export type AuditLogSummary = {
	count: number;
	mostRecentAt: string | null;
};

export const auditLogSummaryQueryKey = ["trickroom-audit-log-summary"];

export const auditLogSummaryProjectQueryKey = (
	projectScope?: ProjectQueryScope,
) => withProjectQueryScope(auditLogSummaryQueryKey, projectScope);

const fetchAuditLogSummary = async () => {
	const response = await fetch("/api/trickroom/audit-log/summary");
	return readJsonOrThrow<AuditLogSummary>(response);
};

export const auditLogSummaryQueryOptions = (projectScope?: ProjectQueryScope) =>
	queryOptions({
		queryKey: auditLogSummaryProjectQueryKey(projectScope),
		queryFn: fetchAuditLogSummary,
	});
