import { Undo2 } from "lucide-react";
import type {
	AnnotationEntry,
	AnnotationView,
} from "../../services/annotations.types";
import {
	describeAnnotationActor,
	describeChangeCount,
} from "../../utils/annotation-presentation";
import { Button } from "../ui/button";

const timeFormat = new Intl.DateTimeFormat(undefined, {
	hour: "2-digit",
	minute: "2-digit",
});

const formatTime = (at: string) => {
	const date = new Date(at);
	return Number.isNaN(date.getTime()) ? "" : timeFormat.format(date);
};

export type AnnotationChangeActions = {
	/** Reveals and flashes the layers a change record touched. */
	onReveal?: (entry: Extract<AnnotationEntry, { kind: "change" }>) => void;
	/** Restores the change's before state; absent where revert is not offered. */
	onRevert?: (entry: Extract<AnnotationEntry, { kind: "change" }>) => void;
	/** The entry whose revert is in flight. */
	revertingEntryId?: string | null;
};

function EntryText({ children }: { children: string }) {
	return <p className="whitespace-pre-wrap wrap-break-word text-xs">{children}</p>;
}

function ChangeRecord({
	entry,
	annotation,
	actions,
}: {
	entry: Extract<AnnotationEntry, { kind: "change" }>;
	annotation: AnnotationView;
	actions: AnnotationChangeActions;
}) {
	const { change } = entry;
	// Revert state is kept while the annotation is live and the change has
	// not been reverted (WP2 drops it on resolve, dismiss and revert).
	const revertible =
		Boolean(change.before) &&
		!entry.revertedBy &&
		annotation.status !== "resolved" &&
		annotation.status !== "dismissed";
	return (
		<div className="flex flex-col gap-1">
			{entry.body ? <EntryText>{entry.body}</EntryText> : null}
			<div className="flex items-center gap-1 bg-slate-100">
				<button
					type="button"
					data-annotation-change={entry.id}
					className="min-w-0 flex-1 px-2 py-1 text-left font-mono text-xs text-cyan-700 hover:bg-cyan-50 focus-visible:outline-none focus-visible:inset-shadow-[0_0_0_1px] focus-visible:inset-shadow-cyan-500"
					title={change.summary || "Show the changed layers"}
					onClick={() => actions.onReveal?.(entry)}
					disabled={!actions.onReveal}
				>
					{describeChangeCount(change.layerIds.length)}
					{entry.revertedBy ? " · reverted" : ""}
				</button>
				{revertible && actions.onRevert ? (
					<Button
						variant="ghost"
						className="px-2 py-1 text-xs"
						title="Restore the layers as they were before this change"
						disabled={actions.revertingEntryId === entry.id}
						onClick={() => actions.onRevert?.(entry)}
					>
						<Undo2 aria-hidden="true" className="size-3.5" />
						Revert
					</Button>
				) : null}
			</div>
			{change.summary && change.summary !== entry.body ? (
				<p className="text-xs text-slate-500">{change.summary}</p>
			) : null}
		</div>
	);
}

function entryLabel(entry: AnnotationEntry) {
	switch (entry.kind) {
		case "remark":
		case "reply":
			return null;
		case "question":
			return "Question";
		case "dismissal":
			return "Dismissed";
		case "resolution":
			return "Resolved";
		case "change":
			return "Change";
		case "revert":
			return "Reverted a change";
		case "reanchor":
			return "Re-anchored";
		case "move":
			return "Moved to this branch";
	}
}

function EntryBody({
	entry,
	annotation,
	actions,
}: {
	entry: AnnotationEntry;
	annotation: AnnotationView;
	actions: AnnotationChangeActions;
}) {
	switch (entry.kind) {
		case "remark":
		case "reply":
		case "question":
			return <EntryText>{entry.body}</EntryText>;
		case "dismissal":
			return <EntryText>{entry.reason}</EntryText>;
		case "resolution":
			return entry.summary ? <EntryText>{entry.summary}</EntryText> : null;
		case "change":
			return (
				<ChangeRecord entry={entry} annotation={annotation} actions={actions} />
			);
		case "move":
			return (
				<p className="text-xs text-slate-500">
					From {entry.from.branch === "*" ? "no branch" : entry.from.branch} to{" "}
					{entry.to.branch === "*" ? "no branch" : entry.to.branch}
				</p>
			);
		case "revert":
		case "reanchor":
			return null;
	}
}

/** A thread's entries in order: remarks, replies, questions, change records. */
export function AnnotationEntries({
	annotation,
	actions = {},
}: {
	annotation: AnnotationView;
	actions?: AnnotationChangeActions;
}) {
	return (
		<ol className="flex flex-col gap-3">
			{annotation.entries.map((entry) => {
				const label = entryLabel(entry);
				const agent = entry.by.role === "agent";
				return (
					<li
						key={entry.id}
						data-entry-kind={entry.kind}
						className={`flex flex-col gap-1 border-l-2 pl-2 ${agent ? "border-cyan-400" : "border-slate-300"}`}
					>
						<div className="flex items-baseline gap-2 text-xs text-slate-500">
							<span
								className={`font-semibold ${agent ? "text-cyan-700" : "text-slate-700"}`}
							>
								{describeAnnotationActor(entry.by)}
							</span>
							{label ? (
								<span className="font-mono uppercase tracking-wider">
									{label}
								</span>
							) : null}
							<span className="ml-auto shrink-0">{formatTime(entry.at)}</span>
						</div>
						<EntryBody
							entry={entry}
							annotation={annotation}
							actions={actions}
						/>
					</li>
				);
			})}
		</ol>
	);
}
