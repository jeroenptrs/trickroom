import {
	type KeyboardEvent,
	type ReactNode,
	useEffect,
	useRef,
	useState,
} from "react";
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
 * "Pin to current configuration" (component nodes): the composer's target
 * carries the variant values in view when pinned, and the remark is about
 * that configuration only.
 */
export type AnnotationComposerPin = {
	/** The variant values in view; null when none is selected. */
	inView: Record<string, string> | null;
	/** Shows a pinned configuration (a chip that switches to it). */
	renderPinned: (variants: Record<string, string>) => ReactNode;
};

const variantsOf = (target: AnnotationTarget | undefined) =>
	target?.kind === "componentNode" ? (target.variants ?? null) : null;

const withPin = (
	target: AnnotationTarget,
	variants: Record<string, string> | null,
): AnnotationTarget => {
	if (target.kind !== "componentNode") return target;
	const { variants: _variants, ...node } = target;
	return variants ? { ...node, variants } : node;
};

/**
 * Writes a new annotation on `target`. What is typed is a draft: it stays
 * in this tab (and survives a reload) and reaches disk, and an agent, only
 * on Send. Shared by the design and component editors; the component
 * editor adds `pin`.
 */
export function AnnotationComposer({
	target: anchor,
	targetLabel,
	getSnapshot,
	focusRequest = 0,
	pin,
}: {
	target: AnnotationTarget;
	targetLabel: string;
	/** How the designer is looking at it, sent with the annotation. */
	getSnapshot?: () => AnnotationSnapshotHint;
	/** Focuses the field whenever it changes (not on mount at 0). */
	focusRequest?: number;
	pin?: AnnotationComposerPin;
}) {
	const key = annotationTargetKey(anchor);
	const draft = useAnnotationDraft(key);
	const unsupported = useAnnotationDraftsUnsupported();
	const [sending, setSending] = useState(false);
	// A pin chosen before anything is typed (no draft yet); the draft's
	// target carries it from the first keystroke.
	const [pendingPin, setPendingPin] = useState<{
		key: string;
		variants: Record<string, string>;
	} | null>(null);
	const fieldRef = useRef<HTMLDivElement>(null);
	const body = draft?.body ?? "";
	const pinned = draft
		? variantsOf(draft.target)
		: pendingPin?.key === key
			? pendingPin.variants
			: null;
	const target = withPin(anchor, pinned);

	useEffect(() => {
		if (focusRequest > 0) {
			fieldRef.current?.querySelector("textarea")?.focus();
		}
	}, [focusRequest]);

	const setPinned = (variants: Record<string, string> | null) => {
		if (draft) {
			setAnnotationDraft(withPin(anchor, variants), draft.body);
		}
		setPendingPin(variants ? { key, variants } : null);
	};

	const send = async () => {
		if (!body.trim() || sending) return;
		setSending(true);
		await sendAnnotationDraft({ key, target, body }, getSnapshot?.());
		setSending(false);
		setPendingPin(null);
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
			{pin ? (
				<div
					className="flex flex-wrap items-center gap-1"
					data-annotation-pin-control=""
				>
					{pinned ? (
						<>
							{pin.renderPinned(pinned)}
							<Button
								variant="ghost"
								className="px-2 py-1 text-xs"
								disabled={unsupported}
								onClick={() => setPinned(null)}
								title="Make it about every configuration"
							>
								Unpin
							</Button>
						</>
					) : (
						<Button
							variant="outlined"
							className="px-2 py-1 text-xs"
							disabled={unsupported || !pin.inView}
							aria-pressed={false}
							onClick={() => setPinned(pin.inView)}
							title={
								pin.inView
									? "Make it about the variant values in view only"
									: "Select variant values under Style target to pin to them"
							}
						>
							Pin to current configuration
						</Button>
					)}
				</div>
			) : null}
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
