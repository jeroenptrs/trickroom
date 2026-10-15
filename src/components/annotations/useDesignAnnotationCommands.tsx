import { useSelector } from "@tanstack/react-store";
import { Flag, MessageSquarePlus, Send, SkipForward } from "lucide-react";
import { useCallback, useMemo } from "react";
import { isLiveAnnotationStatus } from "../../services/annotation-model";
import {
	type AnnotationDraft,
	getAnnotationDrafts,
	useAnnotationDrafts,
} from "../../stores/annotation-draft-store";
import {
	editorAnnotationsStore,
	requestAnnotationComposer,
	requestCloseRound,
	useOpenRound,
} from "../../stores/editor-annotations-store";
import { setEditorPanelOpen } from "../../stores/editor-chrome-store";
import type { EditorRootCommandGroup } from "../chrome/AddLayerCommandMenu";
import { sendAnnotationDrafts } from "./annotation-actions";
import { getDesignSnapshotHint } from "./DesignAnnotationsPanel";
import { openNextDesignAnnotation } from "./design-annotation-navigation";

const iconClass = "size-4 shrink-0 text-slate-500";

/** The command menu's annotation entries for the open design. */
export function useDesignAnnotationCommands(
	designId: string,
): EditorRootCommandGroup {
	const isDesignDraft = useCallback(
		(draft: AnnotationDraft) =>
			draft.target.kind !== "componentNode" &&
			draft.target.designId === designId,
		[designId],
	);
	const draftCount = useAnnotationDrafts(isDesignDraft).length;
	const liveCount = useSelector(
		editorAnnotationsStore,
		(state) =>
			Object.values(state.byId).filter((annotation) =>
				isLiveAnnotationStatus(annotation.status),
			).length,
	);

	const hasOpenRound = useOpenRound() !== null;

	return useMemo(
		() => ({
			label: "Annotations",
			commands: [
				{
					value: "annotations:new",
					label: "New annotation",
					secondary: "On the selection, or the design",
					keywords: ["annotate", "annotation", "remark", "agent"],
					icon: <MessageSquarePlus aria-hidden="true" className={iconClass} />,
					onSelect: () => {
						setEditorPanelOpen("design", "inspector", true);
						requestAnnotationComposer();
					},
					focusAfterClose: () =>
						document.querySelector<HTMLElement>(
							"[data-annotation-composer] textarea",
						),
				},
				{
					value: "annotations:send-round",
					label: draftCount > 0 ? `Send round (${draftCount})` : "Send round",
					secondary: "Every draft in the design, into the round",
					keywords: ["annotation", "round", "send", "drafts", "batch"],
					icon: <Send aria-hidden="true" className={iconClass} />,
					disabled: draftCount === 0,
					disabledReason: "No annotation drafts in this design",
					onSelect: () => {
						void sendAnnotationDrafts(
							getAnnotationDrafts().filter(isDesignDraft),
							getDesignSnapshotHint(),
						);
					},
				},
				{
					value: "annotations:close-round",
					label: "Close round",
					keywords: ["annotation", "round", "close", "finish", "done"],
					icon: <Flag aria-hidden="true" className={iconClass} />,
					disabled: !hasOpenRound,
					disabledReason: "No round is open in this design",
					onSelect: () => {
						setEditorPanelOpen("design", "inspector", true);
						requestCloseRound();
					},
				},
				{
					value: "annotations:next",
					label: "Next open annotation",
					keywords: ["annotation", "next", "open", "review"],
					icon: <SkipForward aria-hidden="true" className={iconClass} />,
					disabled: liveCount === 0,
					disabledReason: "No open annotations in this design",
					onSelect: () => {
						openNextDesignAnnotation();
					},
				},
			],
		}),
		[draftCount, hasOpenRound, isDesignDraft, liveCount],
	);
}
