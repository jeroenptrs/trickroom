import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { annotationListQueryOptions } from "../../queries/annotations";
import type {
	AnnotationContainer,
	AnnotationScope,
	AnnotationView,
} from "../../services/annotations.types";
import { getAnnotationPresentationState } from "../../utils/annotation-presentation";
import { useProjectScope } from "../contexts";
import {
	Disclosure,
	DisclosurePanel,
	DisclosureSummary,
	DisclosureTrigger,
} from "../ui/disclosure";
import { AnnotationThread } from "./AnnotationThread";

/**
 * Annotations made on other branches (or worktrees) of this project, listed
 * only when asked: a remark about another branch's state is not work here.
 * Each can be moved to the branch this checkout is on.
 */
export function OtherBranchesSection({
	container,
	scope,
	now,
	getTargetName,
}: {
	container: AnnotationContainer;
	/** This checkout's scope; null until the annotations are listed. */
	scope: AnnotationScope | null;
	now: number;
	getTargetName: (annotation: AnnotationView) => string;
}) {
	const projectScope = useProjectScope();
	const [open, setOpen] = useState(false);
	const [expanded, setExpanded] = useState<string | null>(null);
	const query = useQuery({
		...annotationListQueryOptions(container, "all", projectScope),
		enabled: open && scope !== null,
	});
	const others = (query.data?.annotations ?? []).filter(
		(annotation) => scope && annotation.branch !== scope.branch,
	);

	return (
		<Disclosure
			open={open}
			onOpenChange={setOpen}
			className="mt-2 border-t border-slate-200"
		>
			<DisclosureTrigger>
				Other branches
				<DisclosureSummary>
					{query.data ? (
						<span className="font-normal text-slate-500">{others.length}</span>
					) : null}
				</DisclosureSummary>
			</DisclosureTrigger>
			<DisclosurePanel className="px-0">
				{query.isPending ? (
					<p className="px-3 text-xs text-slate-500">Loading…</p>
				) : query.isError ? (
					<p className="px-3 text-xs text-red-900">
						Other branches could not be listed.
					</p>
				) : others.length === 0 ? (
					<p className="px-3 text-xs text-slate-500">
						No annotations on other branches.
					</p>
				) : (
					<div className="flex flex-col divide-y divide-slate-100">
						{others.map((annotation) => (
							<AnnotationThread
								key={annotation.id}
								annotation={annotation}
								state={getAnnotationPresentationState(
									annotation,
									annotation.detached === true,
								)}
								targetName={`${getTargetName(annotation)} · ${annotation.branch === "*" ? "no branch" : annotation.branch}`}
								expanded={expanded === annotation.id}
								onExpandedChange={(next) =>
									setExpanded(next ? annotation.id : null)
								}
								now={now}
								otherBranch
							/>
						))}
					</div>
				)}
			</DisclosurePanel>
		</Disclosure>
	);
}
