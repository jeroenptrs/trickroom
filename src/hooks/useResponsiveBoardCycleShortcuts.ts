import {
	type Dispatch,
	type RefObject,
	type SetStateAction,
	useCallback,
	useEffect,
} from "react";
import {
	cycleResponsiveStageBoard,
	getResponsiveBoardCycleDirectionFromKey,
	type ResponsiveStageMode,
} from "../components/responsive-stage-context";
import { isEditableShortcutTarget } from "../utils/editor-shortcuts";

type ResponsiveBoardCycleShortcutOptions = {
	mode: ResponsiveStageMode;
	rootIds: readonly string[];
	setActiveBoardId: Dispatch<SetStateAction<string | null>>;
	iframeRef: RefObject<HTMLIFrameElement | null>;
	didMount: boolean;
};

export function useResponsiveBoardCycleShortcuts({
	mode,
	rootIds,
	setActiveBoardId,
	iframeRef,
	didMount,
}: ResponsiveBoardCycleShortcutOptions) {
	const enabled = mode === "responsive";

	const onKeyDown = useCallback(
		(event: KeyboardEvent) => {
			if (!enabled) {
				return;
			}

			const direction = getResponsiveBoardCycleDirectionFromKey(event);
			if (!direction) {
				return;
			}

			if (isEditableShortcutTarget(event.target)) {
				return;
			}

			event.preventDefault();
			setActiveBoardId((currentBoardId) =>
				cycleResponsiveStageBoard(rootIds, currentBoardId, direction),
			);
		},
		[enabled, rootIds, setActiveBoardId],
	);

	useEffect(() => {
		if (!enabled || !didMount) {
			return;
		}

		const targets: Window[] = [window];
		const iframeWindow = iframeRef.current?.contentWindow;
		if (iframeWindow) {
			targets.push(iframeWindow);
		}

		for (const target of targets) {
			target.addEventListener("keydown", onKeyDown);
		}

		return () => {
			for (const target of targets) {
				target.removeEventListener("keydown", onKeyDown);
			}
		};
	}, [didMount, enabled, iframeRef, onKeyDown]);
}
