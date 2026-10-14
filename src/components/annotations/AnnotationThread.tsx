import { ChevronRight } from "lucide-react";
import {
	type KeyboardEvent,
	memo,
	type ReactNode,
	useEffect,
	useRef,
	useState,
} from "react";
import { toast } from "sonner";
import type {
	AnnotationChangeRecord,
	AnnotationView,
} from "../../services/annotations.types";
import {
	setReplyDraft,
	useAnnotationDraftsUnsupported,
	useReplyDraft,
} from "../../stores/annotation-draft-store";
import {
	type LayerNameLookup,
	resolveChangeLayerName,
} from "../../utils/annotation-change-names";
import {
	ANNOTATION_MARKER_LOOK,
	ANNOTATION_STATE_LABELS,
	type AnnotationPresentationState,
	formatAcknowledgement,
} from "../../utils/annotation-presentation";
import { AnnotationStatusChip } from "../ui/annotation-marker";
import { Button } from "../ui/button";
import { Input, TextareaField } from "../ui/input";
import { AnnotationEntries } from "./AnnotationEntries";
import {
	dismissAnnotation,
	moveAnnotationHere,
	reopenAnnotation,
	replyToAnnotation,
	resolveAnnotation,
	revertAnnotationChange,
} from "./annotation-actions";

export type AnnotationThreadProps = {
	annotation: AnnotationView;
	/** Its state against the editor's tree (`detached` is the editor's call). */
	state: AnnotationPresentationState;
	/** The target's name as the editor shows it. */
	targetName: string;
	/** Open: entries, actions and the reply composer show. */
	expanded: boolean;
	onExpandedChange: (expanded: boolean) => void;
	/** Scroll into view (a pin or the command menu opened it). */
	focused?: boolean;
	now: number;
	/** Reveals and flashes layers of a change record. */
	onRevealLayers?: (layerIds: readonly string[]) => void;
	/**
	 * A layer's current name in the open design (null when it is gone):
	 * change records and a refused revert name layers with it.
	 */
	nameOfLayer?: LayerNameLookup;
	/**
	 * The names of the other annotations a change record's write addressed
	 * too (a revert undoes it for them as well).
	 */
	sharedChangeNames?: (change: AnnotationChangeRecord) => readonly string[];
	/** "Re-anchor to <label>": the current selection, when it is another target. */
	reanchor?: { label: string; run: () => Promise<unknown> } | null;
	/**
	 * Offered once the designer resolved or accepted it ("Save as memory
	 * note"), with the annotation as resolved.
	 */
	onSaveMemory?: (annotation: AnnotationView) => Promise<unknown>;
	/** On another branch: only "Move here". */
	otherBranch?: boolean;
	/**
	 * Shown under the header, open or not: the component editor's chip of
	 * the variant configuration a pinned annotation is about.
	 */
	headerExtra?: ReactNode;
};

const actionButton = "px-2 py-1 text-xs";

function ReplyComposer({ annotation }: { annotation: AnnotationView }) {
	const draft = useReplyDraft(annotation.id);
	const unsupported = useAnnotationDraftsUnsupported();
	const [sending, setSending] = useState(false);
	const closed =
		annotation.status === "resolved" || annotation.status === "dismissed";
	const reopens =
		closed ||
		annotation.status === "addressed" ||
		annotation.status === "needs_input";

	const send = async () => {
		if (!draft.trim() || sending) return;
		setSending(true);
		await replyToAnnotation(annotation, draft);
		setSending(false);
	};

	const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
		if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
			event.preventDefault();
			void send();
		}
	};

	return (
		<div className="flex flex-col gap-1">
			<TextareaField
				label="Reply"
				description={
					unsupported
						? "Drafting is off in this tab: it holds drafts from a newer version of Trickroom."
						: reopens
							? "Replying opens it again for the agent."
							: undefined
				}
				disabled={unsupported}
				className="min-h-12"
				value={draft}
				placeholder="Reply…"
				onChange={(event) => setReplyDraft(annotation.id, event.target.value)}
				onKeyDown={onKeyDown}
			/>
			<div className="flex justify-end">
				<Button
					variant="filled"
					className={actionButton}
					disabled={!draft.trim() || sending}
					onClick={() => void send()}
					title="Send the reply (⌘ Enter)"
				>
					Reply
				</Button>
			</div>
		</div>
	);
}

function DismissForm({
	onDismiss,
	onCancel,
}: {
	onDismiss: (reason: string) => void;
	onCancel: () => void;
}) {
	const [reason, setReason] = useState("");
	const inputRef = useRef<HTMLInputElement>(null);
	useEffect(() => inputRef.current?.focus(), []);
	return (
		<form
			className="flex items-center gap-1"
			onSubmit={(event) => {
				event.preventDefault();
				if (reason.trim()) onDismiss(reason.trim());
			}}
		>
			<Input
				ref={inputRef}
				variant="outlined"
				aria-label="Why it is dismissed"
				placeholder="Why not?"
				value={reason}
				onChange={(event) => setReason(event.target.value)}
				onKeyDown={(event) => {
					if (event.key === "Escape") {
						event.stopPropagation();
						onCancel();
					}
				}}
			/>
			<Button
				type="submit"
				variant="outlined"
				className={actionButton}
				disabled={!reason.trim()}
			>
				Dismiss
			</Button>
			<Button
				type="button"
				variant="ghost"
				className={actionButton}
				onClick={onCancel}
			>
				Cancel
			</Button>
		</form>
	);
}

/**
 * One annotation: its target, state and entries, the reply composer and the
 * state controls. Shared by the design editor's Annotations tab and the
 * component editor's; what is editor-specific (revealing layers, the
 * selection to re-anchor to, the memory scope) comes in as props.
 */
export const AnnotationThread = memo(function AnnotationThread({
	annotation,
	state,
	targetName,
	expanded,
	onExpandedChange,
	focused = false,
	now,
	onRevealLayers,
	nameOfLayer,
	sharedChangeNames,
	reanchor,
	onSaveMemory,
	otherBranch = false,
	headerExtra,
}: AnnotationThreadProps) {
	const rootRef = useRef<HTMLElement>(null);
	const [dismissing, setDismissing] = useState(false);
	const [busy, setBusy] = useState(false);
	const [revertingEntryId, setRevertingEntryId] = useState<string | null>(null);
	const [savedMemory, setSavedMemory] = useState(false);

	useEffect(() => {
		if (focused) {
			rootRef.current?.scrollIntoView({ block: "nearest" });
		}
	}, [focused]);

	const run = async (action: () => Promise<unknown>) => {
		setBusy(true);
		try {
			return await action();
		} finally {
			setBusy(false);
		}
	};

	// Resolving offers to keep it as a memory note: in a toast, since a
	// resolved annotation may leave the list (closed ones show on request).
	const resolve = async () => {
		const result = await resolveAnnotation(annotation);
		if (!result) return;
		toast.success(agentResolved ? "Resolution accepted" : "Resolved", {
			id: `annotation-resolved-${annotation.id}`,
			duration: 10_000,
			...(onSaveMemory
				? {
						action: {
							label: "Save as memory note",
							onClick: () => void onSaveMemory(result.annotation),
						},
					}
				: {}),
		});
	};

	const closed =
		annotation.status === "resolved" || annotation.status === "dismissed";
	const agentResolved = state === "agent_resolved";
	const look = ANNOTATION_MARKER_LOOK[state];
	const remark = annotation.entries[0];
	const preview =
		remark && remark.kind === "remark" ? remark.body.split("\n", 1)[0] : "";

	return (
		<article
			ref={rootRef}
			data-annotation-id={annotation.id}
			data-state={state}
			className={`flex flex-col ${focused ? "bg-cyan-50" : ""}`}
		>
			<button
				type="button"
				aria-expanded={expanded}
				className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-slate-100 focus-visible:outline-none focus-visible:inset-shadow-[0_0_0_1px] focus-visible:inset-shadow-cyan-500"
				onClick={() => onExpandedChange(!expanded)}
			>
				<ChevronRight
					aria-hidden="true"
					className={`mt-0.5 size-3 shrink-0 text-slate-400 transition-transform ${expanded ? "rotate-90" : ""}`}
				/>
				<span className="flex min-w-0 flex-1 flex-col gap-0.5">
					<span className="flex items-center gap-2">
						<span className="min-w-0 flex-1 truncate text-xs font-semibold text-slate-950">
							{targetName}
						</span>
						<AnnotationStatusChip
							look={look}
							label={ANNOTATION_STATE_LABELS[state]}
							closed={closed && !agentResolved}
						/>
					</span>
					{!expanded && preview ? (
						<span className="truncate text-xs text-slate-600">{preview}</span>
					) : null}
				</span>
			</button>
			{headerExtra ? (
				<div className="flex flex-wrap gap-1 px-3 pb-2 pl-8">{headerExtra}</div>
			) : null}
			{expanded ? (
				<div className="flex flex-col gap-3 px-3 pb-3 pl-8">
					{annotation.acknowledgement ? (
						<p className="text-xs text-cyan-700">
							{formatAcknowledgement(annotation.acknowledgement, now)}
						</p>
					) : null}
					{otherBranch ? (
						<p className="text-xs text-slate-500">
							On branch{" "}
							<span className="font-mono">
								{annotation.branch === "*" ? "none" : annotation.branch}
							</span>
						</p>
					) : null}
					<AnnotationEntries
						annotation={annotation}
						actions={{
							onRevealLayers,
							nameOfLayer,
							onRevert: otherBranch
								? undefined
								: (entry) => {
										setRevertingEntryId(entry.id);
										void revertAnnotationChange(
											annotation,
											entry.id,
											(id) =>
												resolveChangeLayerName(id, annotation, nameOfLayer)
													.name,
										).finally(() => setRevertingEntryId(null));
									},
							revertingEntryId,
							sharedWith: sharedChangeNames,
						}}
					/>
					{otherBranch ? (
						<div className="flex flex-wrap gap-1">
							<Button
								variant="outlined"
								className={actionButton}
								disabled={busy}
								onClick={() => void run(() => moveAnnotationHere(annotation))}
								title="Move it to the branch this checkout is on"
							>
								Move here
							</Button>
						</div>
					) : dismissing ? (
						<DismissForm
							onCancel={() => setDismissing(false)}
							onDismiss={(reason) =>
								void run(async () => {
									if (await dismissAnnotation(annotation, reason)) {
										setDismissing(false);
									}
								})
							}
						/>
					) : (
						<div className="flex flex-wrap gap-1">
							{agentResolved ? (
								<Button
									variant="filled"
									className={actionButton}
									disabled={busy}
									title="Accept the agent's resolution"
									onClick={() => void run(resolve)}
								>
									Accept
								</Button>
							) : null}
							{!closed ? (
								<>
									<Button
										variant="outlined"
										className={actionButton}
										disabled={busy}
										onClick={() => void run(resolve)}
									>
										Resolve
									</Button>
									<Button
										variant="ghost"
										className={actionButton}
										disabled={busy}
										onClick={() => setDismissing(true)}
									>
										Dismiss
									</Button>
									{reanchor ? (
										<Button
											variant="ghost"
											className={actionButton}
											disabled={busy}
											title={`Anchor it to ${reanchor.label} instead`}
											onClick={() => void run(reanchor.run)}
										>
											Re-anchor to {reanchor.label}
										</Button>
									) : null}
								</>
							) : (
								<>
									<Button
										variant="ghost"
										className={actionButton}
										disabled={busy}
										onClick={() => void run(() => reopenAnnotation(annotation))}
									>
										Reopen
									</Button>
									{/* The toast after resolving is easy to miss, and bulk
									    resolves have none: a resolved thread keeps the offer. */}
									{annotation.status === "resolved" &&
									!agentResolved &&
									onSaveMemory ? (
										<Button
											variant="ghost"
											className={actionButton}
											disabled={busy || savedMemory}
											title="Add a memory note with the remark, the final reply and a reference to its target"
											onClick={() =>
												void run(async () => {
													if (await onSaveMemory(annotation)) {
														setSavedMemory(true);
													}
												})
											}
										>
											{savedMemory
												? "Saved as memory note"
												: "Save as memory note"}
										</Button>
									) : null}
								</>
							)}
						</div>
					)}
					{otherBranch ? null : <ReplyComposer annotation={annotation} />}
				</div>
			) : null}
		</article>
	);
});
