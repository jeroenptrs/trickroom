import { useQuery } from "@tanstack/react-query";
import { auditLogSummaryQueryOptions } from "../../queries/audit-log";
import { useProjectConfig, useProjectScope } from "../contexts";

export function AuditLogLink() {
	const config = useProjectConfig();
	const projectScope = useProjectScope();
	const auditEnabled =
		config.mcp?.enabled === true && config.mcp.auditLog === true;
	const auditLogQuery = useQuery({
		...auditLogSummaryQueryOptions(projectScope),
		enabled: auditEnabled,
	});

	if (!auditEnabled) {
		return null;
	}

	const countLabel = auditLogQuery.isPending
		? "..."
		: auditLogQuery.isError
			? "unavailable"
			: `${auditLogQuery.data.count} entries`;

	return (
		<div className="border-t border-slate-200 px-4 py-3">
			<div className="flex items-baseline justify-between gap-3">
				<div className="font-mono text-[10px] font-semibold uppercase tracking-wider text-slate-500">
					Audit log
				</div>
				<a
					href="/api/trickroom/audit-log/summary"
					target="_blank"
					rel="noreferrer"
					className="shrink-0 px-1 py-0.5 font-mono text-[11px] text-cyan-700 hover:text-cyan-500 focus-visible:bg-cyan-50 focus-visible:outline-none focus-visible:inset-shadow-[0_0_0_1px] focus-visible:inset-shadow-cyan-200 focus-visible:text-cyan-500"
				>
					{countLabel} -&gt;
				</a>
			</div>
		</div>
	);
}
