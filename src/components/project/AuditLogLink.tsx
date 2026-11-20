import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight } from "lucide-react";
import { auditLogSummaryQueryOptions } from "../../queries/audit-log";
import { withTabLocation } from "../../utils/tab-location";
import { useProjectConfig, useProjectScope } from "../contexts";
import { Button } from "../ui/button";
import { Skeleton } from "../ui/skeleton";
import { Text } from "../ui/text";
import { pluralize } from "./project-view-utils";

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

	return (
		<div className="border-t border-slate-200 px-4 py-3">
			<div
				className="flex items-baseline justify-between gap-3"
				aria-busy={auditLogQuery.isPending}
			>
				<Text variant="section-header">Audit log</Text>
				{auditLogQuery.isPending ? (
					<Skeleton className="h-4 w-20" />
				) : auditLogQuery.isError ? (
					<span className="flex items-center gap-2">
						<Text tone="danger" className="text-[11px]">
							Not loaded
						</Text>
						<Button
							variant="ghost"
							className="px-1 py-0.5 text-[11px]"
							disabled={auditLogQuery.isFetching}
							onClick={() => void auditLogQuery.refetch()}
						>
							Retry
						</Button>
					</span>
				) : (
					<a
						href={withTabLocation("/api/trickroom/audit-log/summary")}
						target="_blank"
						rel="noreferrer"
						className="flex shrink-0 items-center gap-1 px-1 py-0.5 font-mono text-[11px] text-cyan-700 hover:text-cyan-500 focus-visible:bg-cyan-50 focus-visible:outline-none focus-visible:inset-shadow-[0_0_0_1px] focus-visible:inset-shadow-cyan-200 focus-visible:text-cyan-500"
					>
						{auditLogQuery.data.count}{" "}
						{pluralize(auditLogQuery.data.count, "entry", "entries")}
						<ArrowUpRight className="size-3" aria-hidden="true" />
					</a>
				)}
			</div>
		</div>
	);
}
