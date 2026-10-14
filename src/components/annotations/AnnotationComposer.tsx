import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import type { AnnotationSnapshotHint } from "../../queries/annotations";
import type { AnnotationTarget } from "../../services/annotations.types";
import {
	discardAnnotationDrafts,
	setAnnotationDraft,
	useAnnotationDraft,
	useAnnotationDraftsUnsupported,
} from "../../stores/annotation-draft-store";
import { annotationTargetKey } from "../../utils/annotation-presentation";
import { Button } from "../ui/button";
import { TextareaField } from "../ui/input";
import { sendAnnotationDraft } from "./annotation-actions";

/**
 * Writes a new annotation on `target`. What is typed is a draft: it stays
 * in this tab (and survives a reload) and reaches disk, and an agent, only
 * on Send. Shared by the design and component editors.
 */
export function AnnotationComposer({
	target,
	targetLabel,
	getSnapshot,
	focusRequest = 0,
}: {
	target: AnnotationTarget;
	targetLabel: string;
	/** How the designer is looking at it, sent with the annotation. */
	getSnapshot?: () => AnnotationSnapshotHint;
	/** Focuses the field whenever it changes (not on mount at 0). */
	focusRequest?: number;
}) {
	const key = annotationTargetKey(target);
	const draft = useAnnotationDraft(key);
	const unsupported = useAnnotationDraftsUnsupported();
	const [sending, setSending] = useState(false);
	const fieldRef = useRef<HTMLDivElement>(null);
	const body = draft?.body ?? "";

	useEffect(() => {
		if (focusRequest > 0) {
			fieldRef.current?.querySelector("textarea")?.focus();
		}
	}, [focusRequest]);

	const send = async () => {
		if (!body.trim() || sending) return;
		setSending(true);
		await sendAnnotationDraft({ key, target, body }, getSnapshot?.());
		setSending(false);
	};

	const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
		if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
			event.preventDefault();
			void send();
		}
	};

	return (
		<div
			ref={fieldRef}
			className="flex flex-col gap-1"
			data-annotation-composer=""
		>
			<TextareaField
				label={`New annotation on ${targetLabel}`}
				description={
					unsupported
						? "Drafting is off in this tab: it holds drafts from a newer version of Trickroom. Open the design in a new tab to write annotations."
						: "A draft stays in this tab until you send it."
				}
				disabled={unsupported}
				className="min-h-16"
				value={body}
				placeholder="What should change?"
				onChange={(event) => setAnnotationDraft(target, event.target.value)}
				onKeyDown={onKeyDown}
			/>
			<div className="flex justify-end gap-1">
				{body ? (
					<Button
						variant="ghost"
						className="px-2 py-1 text-xs"
						disabled={sending}
						onClick={() => discardAnnotationDrafts([key])}
					>
						Discard
					</Button>
				) : null}
				<Button
					variant="filled"
					className="px-2 py-1 text-xs"
					disabled={!body.trim() || sending}
					onClick={() => void send()}
					title="Send it to the agent (⌘ Enter)"
				>
					Send
				</Button>
			</div>
		</div>
	);
}
