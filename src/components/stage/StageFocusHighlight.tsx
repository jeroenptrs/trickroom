import { useEffect, useRef } from "react";
import { useFrame } from "react-frame-component";
import {
	findStageNodeElement,
	isStageStylesReady,
} from "../../hooks/useStageNavigation";
import { designStore } from "../../stores/design-store";
import { useStageReveal } from "../../stores/stage-view-store";

const HIGHLIGHT_MS = 1_800;
const FADE_MS = 300;
const WAIT_TIMEOUT_MS = 10_000;

// The stage iframe does not load the app's stylesheet, so the highlight is
// styled inline: square, cyan on slate, like the editor chrome.
const CYAN = "#22d3ee";
const SLATE = "#020617";

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
			box.style.display = "block";
			// The canvas scales the world with a transform; undo it so the
			// outline and label keep a constant on-screen size.
			const world = origin.parentElement;
			const scale =
				world && world.offsetWidth > 0
					? world.getBoundingClientRect().width / world.offsetWidth
					: 1;
			const originRect = origin.getBoundingClientRect();
			const rect = element.getBoundingClientRect();
			box.style.left = `${(rect.left - originRect.left) / scale}px`;
			box.style.top = `${(rect.top - originRect.top) / scale}px`;
			box.style.width = `${rect.width / scale}px`;
			box.style.height = `${rect.height / scale}px`;
			box.style.borderWidth = `${2 / scale}px`;
			box.style.boxShadow = `0 0 0 ${1 / scale}px ${SLATE}`;
			label.style.fontSize = `${10 / scale}px`;
			label.style.padding = `${2 / scale}px ${4 / scale}px`;
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
			style={{
				position: "absolute",
				left: 0,
				top: 0,
				width: 0,
				height: 0,
				pointerEvents: "none",
				zIndex: 2147483647,
			}}
		>
			<div
				ref={boxRef}
				style={{
					display: "none",
					position: "absolute",
					boxSizing: "border-box",
					borderStyle: "solid",
					borderColor: CYAN,
					backgroundColor: "rgb(34 211 238 / 0.08)",
				}}
			>
				<span
					ref={labelRef}
					style={{
						position: "absolute",
						left: 0,
						bottom: "100%",
						backgroundColor: SLATE,
						color: CYAN,
						fontFamily: '"IBM Plex Mono", ui-monospace, monospace',
						fontWeight: 500,
						letterSpacing: "0.05em",
						lineHeight: 1.4,
						textTransform: "uppercase",
						whiteSpace: "nowrap",
					}}
				/>
			</div>
		</div>
	);
}
