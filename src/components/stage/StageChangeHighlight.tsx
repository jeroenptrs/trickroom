import { useEffect, useRef } from "react";
import { useFrame } from "react-frame-component";
import { useExternalChangeFlash } from "../../stores/external-change-store";
import {
	placeStageOverlayBox,
	STAGE_HIGHLIGHT_CYAN,
} from "./StageFocusHighlight";

const HIGHLIGHT_MS = 1_800;
const FADE_MS = 300;
/** Outlines drawn at most; a large change still reads from a few boxes. */
const MAX_BOXES = 40;

/**
 * Briefly outlines the layers an external write changed (an agent, another
 * tab) when their board is in view: dashed, so it reads differently from the
 * focus highlight. Render-only, in the stage document; it follows the
 * elements while the canvas moves.
 */
export function StageChangeHighlight() {
	const flash = useExternalChangeFlash();
	const { document: frameDocument, window: frameWindow } = useFrame();
	const originRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const origin = originRef.current;
		if (!flash || !origin || !frameDocument || !frameWindow) {
			return;
		}
		const ids = flash.layerIds.slice(0, MAX_BOXES);
		const boxes = ids.map(() => {
			const box = frameDocument.createElement("div");
			Object.assign(box.style, {
				display: "none",
				position: "absolute",
				boxSizing: "border-box",
				borderStyle: "dashed",
				borderColor: STAGE_HIGHLIGHT_CYAN,
				backgroundColor: "rgb(34 211 238 / 0.12)",
			});
			box.setAttribute("data-trickroom-change-box", "");
			origin.appendChild(box);
			return box;
		});

		const startedAt = frameWindow.performance.now();
		let frame = 0;
		const step = () => {
			const elapsed = frameWindow.performance.now() - startedAt;
			if (elapsed >= HIGHLIGHT_MS) {
				for (const box of boxes) box.style.display = "none";
				return;
			}
			const opacity = String(
				Math.min(1, elapsed / FADE_MS, (HIGHLIGHT_MS - elapsed) / FADE_MS),
			);
			ids.forEach((id, index) => {
				const box = boxes[index] as HTMLDivElement;
				// Only layers that render an element of their own: outlining an
				// ancestor instead would point at the wrong thing.
				const element = frameDocument.querySelector<HTMLElement>(
					`[data-trickroom-node-id="${CSS.escape(id)}"]`,
				);
				if (!element) {
					box.style.display = "none";
					return;
				}
				placeStageOverlayBox(origin, box, element);
				box.style.opacity = opacity;
			});
			frame = frameWindow.requestAnimationFrame(step);
		};
		frame = frameWindow.requestAnimationFrame(step);

		return () => {
			frameWindow.cancelAnimationFrame(frame);
			for (const box of boxes) box.remove();
		};
	}, [flash, frameDocument, frameWindow]);

	return (
		<div
			ref={originRef}
			aria-hidden="true"
			data-trickroom-change-highlight=""
			style={{
				position: "absolute",
				left: 0,
				top: 0,
				width: 0,
				height: 0,
				pointerEvents: "none",
				zIndex: 2147483646,
			}}
		/>
	);
}
