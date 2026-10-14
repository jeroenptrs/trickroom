import { useEffect, useRef } from "react";
import { useFrame } from "react-frame-component";
import {
	findStageNodeElement,
	isStageStylesReady,
} from "../../hooks/useStageNavigation";
import { designStore } from "../../stores/design-store";
import { useStageReveal } from "../../stores/stage-view-store";
import {
	applyStageOverlayLabelScale,
	placeStageOverlayBox,
	STAGE_CHROME_ATTRIBUTE,
	STAGE_HIGHLIGHT_CYAN,
	stageOverlayLabelStyle,
	stageOverlayOriginStyle,
} from "./stage-overlay";

const HIGHLIGHT_MS = 1_800;
const FADE_MS = 300;
const WAIT_TIMEOUT_MS = 10_000;

/**
 * Briefly outlines the element a deep link or agent focus request pointed at,
 * with its layer name, so the human sees what changed. Render-only: it lives
 * in the stage document and follows the element while the canvas moves.
 */
export function StageFocusHighlight() {
	const reveal = useStageReveal();
	const { document: frameDocument, window: frameWindow } = useFrame();
	const originRef = useRef<HTMLDivElement>(null);
	const boxRef = useRef<HTMLDivElement>(null);
	const labelRef = useRef<HTMLSpanElement>(null);

	useEffect(() => {
		const origin = originRef.current;
		const box = boxRef.current;
		const label = labelRef.current;
		if (
			!reveal ||
			!origin ||
			!box ||
			!label ||
			!frameDocument ||
			!frameWindow
		) {
			return;
		}

		const now = () => frameWindow.performance.now();
		const startedAt = now();
		let shownAt: number | null = null;
		let frame = 0;

		const hide = () => {
			box.style.display = "none";
		};

		const place = (element: HTMLElement, elapsed: number) => {
			const scale = placeStageOverlayBox(origin, box, element);
			applyStageOverlayLabelScale(label, scale);
			box.style.opacity = String(
				Math.min(1, elapsed / FADE_MS, (HIGHLIGHT_MS - elapsed) / FADE_MS),
			);
		};

		const step = () => {
			const element = findStageNodeElement(
				frameDocument,
				reveal.elementId,
				designStore.get().entitiesById,
			);
			const time = now();
			if (shownAt === null) {
				if (!element || !isStageStylesReady(frameDocument)) {
					if (time - startedAt < WAIT_TIMEOUT_MS) {
						frame = frameWindow.requestAnimationFrame(step);
					}
					return;
				}
				shownAt = time;
				label.textContent =
					designStore.get().entitiesById[reveal.elementId]?.props[
						"data-trickroom-name"
					] ?? "Layer";
			}
			const elapsed = time - shownAt;
			if (!element || elapsed >= HIGHLIGHT_MS) {
				hide();
				return;
			}
			place(element, elapsed);
			frame = frameWindow.requestAnimationFrame(step);
		};

		frame = frameWindow.requestAnimationFrame(step);
		return () => {
			frameWindow.cancelAnimationFrame(frame);
			hide();
		};
	}, [frameDocument, frameWindow, reveal]);

	// The zero-size origin is the positioned ancestor the box is placed from,
	// so the math does not depend on how the stage document positions things.
	return (
		<div
			ref={originRef}
			aria-hidden="true"
			data-trickroom-focus-highlight=""
			{...{ [STAGE_CHROME_ATTRIBUTE]: "" }}
			style={{ ...stageOverlayOriginStyle, zIndex: 2147483647 }}
		>
			<div
				ref={boxRef}
				style={{
					display: "none",
					position: "absolute",
					boxSizing: "border-box",
					borderStyle: "solid",
					borderColor: STAGE_HIGHLIGHT_CYAN,
					backgroundColor: "rgb(34 211 238 / 0.08)",
				}}
			>
				<span ref={labelRef} style={stageOverlayLabelStyle} />
			</div>
		</div>
	);
}
