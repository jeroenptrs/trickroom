import { useEffect, useRef } from "react";
import { useFrame } from "react-frame-component";
import type { StageSelectionSource } from "./stage-interaction";
import {
	STAGE_CHROME_ATTRIBUTE,
	STAGE_HIGHLIGHT_CYAN,
	stageOverlayLabelStyle,
	stageOverlayOriginStyle,
} from "./stage-overlay";
import { startStageSelectionOverlay } from "./stage-selection-overlay";

/**
 * The stage's selection and hover outlines, and the pointer and keyboard
 * wiring behind them (`startStageSelectionOverlay`). Render it once inside
 * the stage frame.
 */
export function StageSelectionLayer({
	source,
}: {
	source: StageSelectionSource;
}) {
	const { document: frameDocument, window: frameWindow } = useFrame();
	const originRef = useRef<HTMLDivElement>(null);
	const selectionBoxRef = useRef<HTMLDivElement>(null);
	const selectionLabelRef = useRef<HTMLSpanElement>(null);
	const hoverBoxRef = useRef<HTMLDivElement>(null);
	const hoverLabelRef = useRef<HTMLSpanElement>(null);

	useEffect(() => {
		const origin = originRef.current;
		const selectionBox = selectionBoxRef.current;
		const selectionLabel = selectionLabelRef.current;
		const hoverBox = hoverBoxRef.current;
		const hoverLabel = hoverLabelRef.current;
		if (
			!origin ||
			!selectionBox ||
			!selectionLabel ||
			!hoverBox ||
			!hoverLabel ||
			!frameDocument ||
			!frameWindow
		) {
			return;
		}

		return startStageSelectionOverlay({
			document: frameDocument,
			window: frameWindow,
			origin,
			selection: { box: selectionBox, label: selectionLabel },
			hover: { box: hoverBox, label: hoverLabel },
			source,
			host: frameWindow.frameElement?.ownerDocument ?? null,
		});
	}, [frameDocument, frameWindow, source]);

	return (
		<div
			ref={originRef}
			aria-hidden="true"
			data-trickroom-selection-layer=""
			{...{ [STAGE_CHROME_ATTRIBUTE]: "" }}
			style={{ ...stageOverlayOriginStyle, zIndex: 2147483645 }}
		>
			<div
				ref={hoverBoxRef}
				data-trickroom-hover-box=""
				style={{
					display: "none",
					position: "absolute",
					boxSizing: "border-box",
					borderStyle: "solid",
					borderColor: STAGE_HIGHLIGHT_CYAN,
				}}
			>
				<span ref={hoverLabelRef} style={stageOverlayLabelStyle} />
			</div>
			<div
				ref={selectionBoxRef}
				data-trickroom-selection-box=""
				style={{
					display: "none",
					position: "absolute",
					boxSizing: "border-box",
					borderStyle: "solid",
					borderColor: STAGE_HIGHLIGHT_CYAN,
				}}
			>
				<span ref={selectionLabelRef} style={stageOverlayLabelStyle} />
			</div>
		</div>
	);
}
