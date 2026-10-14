import {
	type Dispatch,
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
};

export function useResponsiveBoardCycleShortcuts({
	mode,
	rootIds,
	setActiveBoardId,
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

	// Key presses in the stage iframe reach the editor window too: the stage
	// forwards them (see forwardStageKeyDown), so one listener covers both.
	useEffect(() => {
		if (!enabled) {
			return;
		}

		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [enabled, onKeyDown]);
}
