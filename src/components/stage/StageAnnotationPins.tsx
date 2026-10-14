import { useEffect, useRef } from "react";
import { useFrame } from "react-frame-component";
import {
	type StageAnnotationPin,
	startStageAnnotationPins,
} from "./stage-annotation-pins";
import { createStageNodeLookup } from "./stage-interaction";
import {
	STAGE_CHROME_ATTRIBUTE,
	stageOverlayOriginStyle,
} from "./stage-overlay";

/** Where a stage's pins come from and what a click on one does. */
export type StageAnnotationPinSource = {
	getPins: () => readonly StageAnnotationPin[];
	/** Calls `listener` after anything that may change or move the pins. */
	subscribe: (listener: () => void) => () => void;
	onPinClick: (pin: StageAnnotationPin) => void;
};

/**
 * The stage's annotation pins (`startStageAnnotationPins`): one layer per
 * stage, one pooled box per pin, no React tree per pin. Render it once
 * inside the stage frame, above the selection and change outlines.
 */
export function StageAnnotationPins({
	source,
}: {
	source: StageAnnotationPinSource;
}) {
	const { document: frameDocument, window: frameWindow } = useFrame();
	const originRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const origin = originRef.current;
		if (!origin || !frameDocument || !frameWindow) {
			return;
		}
		return startStageAnnotationPins({
			document: frameDocument,
			window: frameWindow,
			origin,
			getPins: source.getPins,
			lookup: createStageNodeLookup(frameDocument),
			subscribe: source.subscribe,
			onPinClick: source.onPinClick,
		});
	}, [frameDocument, frameWindow, source]);

	return (
		<div
			ref={originRef}
			data-trickroom-annotation-pins=""
			{...{ [STAGE_CHROME_ATTRIBUTE]: "" }}
			style={{ ...stageOverlayOriginStyle, zIndex: 2147483646 }}
		/>
	);
}
