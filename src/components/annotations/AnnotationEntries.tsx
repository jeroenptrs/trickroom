import { Undo2 } from "lucide-react";
import type {
	AnnotationChangeRecord,
	AnnotationEntry,
	AnnotationView,
} from "../../services/annotations.types";
import {
	describeChangeLayers,
	type LayerNameLookup,
	nameLayersInText,
} from "../../utils/annotation-change-names";
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
	/** Reveals and flashes layers (all of a change's, or one of them). */
	onRevealLayers?: (layerIds: readonly string[]) => void;
	/** Restores the change's before state; absent where revert is not offered. */
	onRevert?: (entry: Extract<AnnotationEntry, { kind: "change" }>) => void;
	/** The entry whose revert is in flight. */
	revertingEntryId?: string | null;
	/** A layer's current name in the open design, or null when it is gone. */
	nameOfLayer?: LayerNameLookup;
	/**
	 * The names of the other annotations the same write addressed: a revert
	 * undoes that write for all of them.
	 */
	sharedWith?: (change: AnnotationChangeRecord) => readonly string[];
};

function EntryText({ children }: { children: string }) {
	return (
		<p className="whitespace-pre-wrap wrap-break-word text-xs">{children}</p>
	);
}

const focusRing =
	"focus-visible:outline-none focus-visible:inset-shadow-[0_0_0_1px] focus-visible:inset-shadow-cyan-500";

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
	const { onRevealLayers, nameOfLayer } = actions;
	// Revert state is kept while the annotation is live and the change has
	// not been reverted (WP2 drops it on resolve, dismiss and revert).
	const revertible =
		Boolean(change.before || change.draftBefore) &&
		!entry.revertedBy &&
		annotation.status !== "resolved" &&
		annotation.status !== "dismissed";
	const layers = describeChangeLayers(change, annotation, nameOfLayer);
	const present = layers
		.filter((layer) => layer.present)
		.map((layer) => layer.id);
	const named = (text: string) =>
		nameLayersInText(text, change, annotation, nameOfLayer);
	const summary =
		change.summary && change.summary !== entry.body ? change.summary : "";
	const hasDetails = Boolean(summary) || change.operations.length > 0;
	const shared = entry.revertedBy ? [] : (actions.sharedWith?.(change) ?? []);
	return (
		<div className="flex flex-col gap-1">
			{entry.body ? (
				<EntryText>
					{nameLayersInText(
						entry.body,
						change,
						annotation,
						nameOfLayer,
						"uuids",
					)}
				</EntryText>
			) : null}
			<div className="flex flex-col bg-slate-100">
				<div className="flex items-center gap-1">
					<button
						type="button"
						data-annotation-change={entry.id}
						className={`min-w-0 flex-1 px-2 py-1 text-left font-mono text-xs text-cyan-700 hover:bg-cyan-50 disabled:text-slate-500 disabled:hover:bg-transparent ${focusRing}`}
						title="Show the changed layers"
						onClick={() => onRevealLayers?.(present)}
						disabled={!onRevealLayers || present.length === 0}
					>
						{describeChangeCount(layers.length)}
						{entry.revertedBy ? " · reverted" : ""}
					</button>
					{revertible && actions.onRevert ? (
						<Button
							variant="ghost"
							className="flex shrink-0 items-center gap-1 px-2 py-1 text-xs"
							title={
								shared.length > 0
									? `Restore the layers as they were before this change, which also addressed ${shared.join(", ")}`
									: "Restore the layers as they were before this change"
							}
							disabled={actions.revertingEntryId === entry.id}
							onClick={() => actions.onRevert?.(entry)}
						>
							<Undo2 aria-hidden="true" className="size-3.5" />
							Revert
						</Button>
					) : null}
				</div>
				{layers.length > 0 ? (
					<ul
						className="flex flex-wrap gap-x-2 gap-y-0.5 px-2 pb-1.5"
						aria-label="Changed layers"
					>
						{layers.map((layer) => (
							<li key={layer.id} className="flex min-w-0">
								{layer.present && onRevealLayers ? (
									<button
										type="button"
										data-annotation-change-layer={layer.id}
										className={`truncate text-xs font-semibold text-slate-950 underline decoration-slate-300 underline-offset-2 hover:text-cyan-700 hover:decoration-cyan-400 ${focusRing}`}
										title={`Show ${layer.name}`}
										onClick={() => onRevealLayers([layer.id])}
									>
										{layer.name}
									</button>
								) : (
									<span
										className="truncate text-xs text-slate-500"
										title={
											layer.present
												? layer.name
												: `${layer.name} is no longer in the design`
										}
									>
										{layer.name}
									</span>
								)}
							</li>
						))}
					</ul>
				) : null}
				{shared.length > 0 ? (
					<p
						className="px-2 pb-1.5 text-xs text-slate-600"
						data-annotation-change-shared=""
					>
						Same change as {shared.join(", ")}: Revert undoes it there too.
					</p>
				) : null}
			</div>
			{hasDetails ? (
				<details className="text-xs text-slate-500">
					<summary className={`cursor-pointer select-none ${focusRing}`}>
						Details
					</summary>
					<div className="flex flex-col gap-1 pt-1">
						{summary ? <p title={summary}>{named(summary)}</p> : null}
						{change.operations.length > 0 ? (
							<ol className="flex flex-col gap-0.5 font-mono">
								{change.operations.map((operation, index) => (
									<li
										// Operations have no id; their order is the record's.
										// biome-ignore lint/suspicious/noArrayIndexKey: stable, never reordered.
										key={index}
										title={operation.summary}
									>
										{operation.operation}: {named(operation.summary)}
									</li>
								))}
							</ol>
						) : null}
					</div>
				</details>
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
