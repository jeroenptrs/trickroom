import { useEffect, useRef } from "react";
import { useFrame } from "react-frame-component";
import { isStageStylesReady } from "../../hooks/useStageNavigation";
import {
	attachStageInteraction,
	createStageNodeLookup,
	type StageSelectionSource,
} from "./stage-interaction";
import {
	applyStageOverlayBox,
	applyStageOverlayLabelScale,
	isSameStageOverlayGeometry,
	measureStageOverlayBox,
	STAGE_CHROME_ATTRIBUTE,
	STAGE_HIGHLIGHT_CYAN,
	type StageOverlayGeometry,
	stageOverlayLabelStyle,
	stageOverlayOriginStyle,
} from "./stage-overlay";

type OverlayBox = {
	box: HTMLElement;
	label: HTMLElement;
	border: number;
	id: string | null;
	geometry: StageOverlayGeometry | null;
};

function hideBox(overlay: OverlayBox) {
	if (overlay.id === null && overlay.geometry === null) {
		return;
	}
	overlay.box.style.display = "none";
	overlay.id = null;
	overlay.geometry = null;
}

/**
 * The stage's selection and hover outlines, and the pointer and keyboard
 * wiring behind them (see `attachStageInteraction`). Render it once inside
 * the stage frame. The selection outline follows its layer every animation
 * frame while something is selected or hovered, as the change highlight
 * does, and idles otherwise; geometry is read in the frame, never in render,
 * and styles are only written when it moved.
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

		const lookup = createStageNodeLookup(frameDocument);
		const selection: OverlayBox = {
			box: selectionBox,
			label: selectionLabel,
			border: 2,
			id: null,
			geometry: null,
		};
		const hover: OverlayBox = {
			box: hoverBox,
			label: hoverLabel,
			border: 1,
			id: null,
			geometry: null,
		};
		let hoverId: string | null = null;
		let frame = 0;

		const paint = (overlay: OverlayBox, id: string | null) => {
			const element = id && source.has(id) ? lookup(id) : null;
			if (!id || !element || !isStageStylesReady(frameDocument)) {
				hideBox(overlay);
				return;
			}
			const name = source.getName(id);
			if (overlay.label.textContent !== name) {
				overlay.label.textContent = name;
			}
			const geometry = measureStageOverlayBox(origin, element);
			if (
				overlay.id === id &&
				isSameStageOverlayGeometry(overlay.geometry, geometry)
			) {
				return;
			}
			overlay.id = id;
			overlay.geometry = geometry;
			applyStageOverlayBox(overlay.box, geometry, overlay.border);
			applyStageOverlayLabelScale(overlay.label, geometry.scale);
		};

		const step = () => {
			frame = 0;
			const selectedId = source.getSelectedId();
			paint(selection, selectedId);
			paint(hover, hoverId === selectedId ? null : hoverId);
			if (selectedId || hoverId) {
				frame = frameWindow.requestAnimationFrame(step);
			}
		};

		const schedule = () => {
			if (!frame) {
				frame = frameWindow.requestAnimationFrame(step);
			}
		};

		const detach = attachStageInteraction({
			document: frameDocument,
			window: frameWindow,
			source,
			host: frameWindow.frameElement?.ownerDocument ?? null,
			onHoverChange: (id) => {
				hoverId = id;
				schedule();
			},
		});
		const unsubscribe = source.subscribe(schedule);
		schedule();

		return () => {
			detach();
			unsubscribe();
			frameWindow.cancelAnimationFrame(frame);
			hideBox(selection);
			hideBox(hover);
		};
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
