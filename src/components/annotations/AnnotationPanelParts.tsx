import { type ReactNode, useState } from "react";
import type { AnnotationSnapshotHint } from "../../queries/annotations";
import type {
	AnnotationContainer,
	AnnotationView,
} from "../../services/annotations.types";
import {
	type AnnotationDraft,
	discardAnnotationDrafts,
} from "../../stores/annotation-draft-store";
import { AnnotationMarker } from "../ui/annotation-marker";
import { Button } from "../ui/button";
import { Text } from "../ui/text";
import {
	resolveAnnotations,
	sendAnnotationDraft,
	sendAnnotationDrafts,
} from "./annotation-actions";

// The pieces of an Annotations tab both editors share: a titled section,
// a draft row, and the bulk actions bar.

export function AnnotationSection({
	title,
	count,
	children,
}: {
	title: string;
	count?: number;
	children: ReactNode;
}) {
	return (
		<section className="flex flex-col">
			<Text
				variant="section-header"
				render={<div />}
				className="flex items-center gap-2 px-3 pt-3 pb-1"
			>
				{title}
				{count ? <span>{count}</span> : null}
			</Text>
			<div className="flex flex-col divide-y divide-slate-100">{children}</div>
		</section>
	);
}

export function AnnotationDraftRow({
	draft,
	name,
	onSelect,
	getSnapshot,
}: {
	draft: AnnotationDraft;
	name: string;
	onSelect: () => void;
	/** How the designer is looking at it, sent with the annotation. */
	getSnapshot: () => AnnotationSnapshotHint;
}) {
	const [sending, setSending] = useState(false);
	return (
		<div className="flex items-start gap-2 px-3 py-2" data-annotation-draft="">
			<AnnotationMarker look="draft" size="dot" className="mt-1" />
			<button
				type="button"
				className="flex min-w-0 flex-1 flex-col text-left focus-visible:outline-none focus-visible:inset-shadow-[0_0_0_1px] focus-visible:inset-shadow-cyan-500"
				onClick={onSelect}
				title={`Select ${name}`}
			>
				<span className="truncate text-xs font-semibold text-slate-950">
					{name}
				</span>
				<span className="truncate text-xs text-slate-600">{draft.body}</span>
			</button>
			<Button
				variant="ghost"
				className="px-2 py-1 text-xs"
				disabled={sending}
				onClick={() => discardAnnotationDrafts([draft.key])}
			>
				Discard
			</Button>
			<Button
				variant="outlined"
				className="px-2 py-1 text-xs"
				disabled={sending}
				onClick={() => {
					setSending(true);
					void sendAnnotationDraft(draft, getSnapshot()).finally(() =>
						setSending(false),
					);
				}}
			>
				Send
			</Button>
		</div>
	);
}

/**
 * "Send all drafts", "Resolve all addressed" and "Accept all
 * agent-resolved" for what is in scope (a board, a design, a component).
 */
export function AnnotationBulkActions({
	container,
	drafts,
	addressed,
	agentResolved,
	scopeLabel,
	getSnapshot,
}: {
	container: AnnotationContainer;
	drafts: readonly AnnotationDraft[];
	addressed: readonly AnnotationView[];
	agentResolved: readonly AnnotationView[];
	/** "on this board", "in this design", "in this component". */
	scopeLabel: string;
	getSnapshot: () => AnnotationSnapshotHint;
}) {
	const [sendingDrafts, setSendingDrafts] = useState(false);
	if (
		addressed.length === 0 &&
		agentResolved.length === 0 &&
		drafts.length <= 1
	) {
		return null;
	}
	return (
		<div className="flex flex-wrap gap-1 border-b border-slate-200 px-3 py-2">
			{drafts.length > 1 ? (
				<Button
					variant="filled"
					className="px-2 py-1 text-xs"
					disabled={sendingDrafts}
					onClick={() => {
						setSendingDrafts(true);
						void sendAnnotationDrafts(drafts, getSnapshot()).finally(() =>
							setSendingDrafts(false),
						);
					}}
					title={`Send every draft ${scopeLabel}`}
				>
					Send all drafts ({drafts.length})
				</Button>
			) : null}
			{addressed.length > 0 ? (
				<Button
					variant="outlined"
					className="px-2 py-1 text-xs"
					onClick={() =>
						void resolveAnnotations(container, addressed, "Resolved")
					}
					title={`Resolve every addressed annotation ${scopeLabel}`}
				>
					Resolve all addressed ({addressed.length})
				</Button>
			) : null}
			{agentResolved.length > 0 ? (
				<Button
					variant="outlined"
					className="px-2 py-1 text-xs"
					onClick={() =>
						void resolveAnnotations(container, agentResolved, "Accepted")
					}
					title={`Accept every resolution an agent made ${scopeLabel}`}
				>
					Accept all agent-resolved ({agentResolved.length})
				</Button>
			) : null}
		</div>
	);
}
