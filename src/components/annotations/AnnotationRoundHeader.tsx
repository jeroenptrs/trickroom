import { useSelector } from "@tanstack/react-store";
import { Flag } from "lucide-react";
import { useEffect, useState } from "react";
import type { AnnotationSnapshotHint } from "../../queries/annotations";
import type { AnnotationContainer } from "../../services/annotations.types";
import type { AnnotationDraft } from "../../stores/annotation-draft-store";
import {
	clearCloseRoundRequest,
	editorAnnotationsStore,
	useOpenRound,
} from "../../stores/editor-annotations-store";
import { ConfirmationDialog } from "../ui/alert-dialog";
import { Button } from "../ui/button";
import { Text } from "../ui/text";
import {
	closeOpenRound,
	resolveAnnotations,
	sendAnnotationDrafts,
} from "./annotation-actions";

const noun = (count: number) => (count === 1 ? "annotation" : "annotations");

/**
 * The round at the top of an Annotations tab. With a round open: its
 * progress, **Send round**, **Accept all proposed** (when it has proposed
 * annotations) and **Close round**. With none open and drafts waiting:
 * **Send round** alone. Closing asks first when annotations stay open.
 * `drafts` are every draft of the design or component, not only the board
 * in view.
 */
export function AnnotationRoundHeader({
	container,
	drafts,
	getSnapshot,
}: {
	container: AnnotationContainer;
	drafts: readonly AnnotationDraft[];
	getSnapshot: () => AnnotationSnapshotHint;
}) {
	const open = useOpenRound();
	const closeRequested = useSelector(
		editorAnnotationsStore,
		(state) => state.closeRoundRequested,
	);
	const [sending, setSending] = useState(false);
	const [closing, setClosing] = useState(false);
	const [confirming, setConfirming] = useState(false);

	const remaining = open ? open.counts.total - open.counts.closed : 0;
	const closeRound = async () => {
		if (!open) return;
		setClosing(true);
		await closeOpenRound(container, open.round);
		setClosing(false);
		setConfirming(false);
	};
	const requestClose = () => {
		if (remaining > 0) setConfirming(true);
		else void closeRound();
	};

	// The command menu's "Close round".
	// biome-ignore lint/correctness/useExhaustiveDependencies: runs once per request.
	useEffect(() => {
		if (!closeRequested) return;
		clearCloseRoundRequest();
		if (open) requestClose();
	}, [closeRequested]);

	if (!open && drafts.length === 0) return null;

	const sendRound = (
		<Button
			variant="filled"
			className="px-2 py-1 text-xs"
			disabled={drafts.length === 0 || sending}
			onClick={() => {
				setSending(true);
				void sendAnnotationDrafts(drafts, getSnapshot()).finally(() =>
					setSending(false),
				);
			}}
			title={
				drafts.length === 0
					? "No drafts to send"
					: "Send every draft, on every board, into the round"
			}
		>
			{drafts.length > 0 ? `Send round (${drafts.length})` : "Send round"}
		</Button>
	);

	if (!open) {
		return (
			<div
				className="flex flex-wrap items-center gap-1 border-b border-slate-200 px-3 py-2"
				data-annotation-round=""
			>
				{sendRound}
			</div>
		);
	}

	const { counts, proposed } = open;
	return (
		<div
			className="flex flex-col gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2"
			data-annotation-round="open"
		>
			<Text
				variant="label"
				tone="foreground"
				render={<div />}
				data-annotation-round-progress=""
			>
				Round · {counts.closed} of {counts.total} closed
				{` · ${counts.humanWork} waiting on you`}
			</Text>
			<div className="flex flex-wrap gap-1">
				{sendRound}
				{proposed.length > 0 ? (
					<Button
						variant="outlined"
						className="px-2 py-1 text-xs"
						onClick={() =>
							void resolveAnnotations(container, proposed, "Accepted")
						}
						title="Accept every proposal an agent made in this round"
					>
						Accept all proposed ({proposed.length})
					</Button>
				) : null}
				<Button
					variant="outlined"
					className="px-2 py-1 text-xs"
					disabled={closing}
					onClick={requestClose}
					title="Close the round. The annotations in it keep their status."
				>
					Close round
				</Button>
			</div>
			<ConfirmationDialog
				open={confirming}
				onOpenChange={(next) => {
					if (!closing) setConfirming(next);
				}}
				title="Close round"
				description={`${remaining} ${noun(remaining)} ${remaining === 1 ? "stays" : "stay"} open. Close the round?`}
				icon={<Flag className="size-4" aria-hidden="true" />}
				actionIcon={<Flag className="size-3.5" aria-hidden="true" />}
				actionLabel={closing ? "Closing..." : "Close round"}
				actionDisabled={closing}
				onAction={() => void closeRound()}
			/>
		</div>
	);
}
