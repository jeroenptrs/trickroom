import { type RefObject, useCallback, useEffect, useState } from "react";

export type ViewState = {
	x: number;
	y: number;
	scale: number;
};

const INITIAL_VIEW: ViewState = {
	x: -32,
	y: -64,
	scale: 1,
};

const ARTBOARD = {
	x: -32,
	y: -64,
	width: 1440,
	height: 960,
};

const MIN_SCALE = 0.25;
const MAX_SCALE = 2.5;

export function useStageNavigation(
	iframeRef: RefObject<HTMLIFrameElement | null>,
	didMount?: boolean,
) {
	const [view, setView] = useState(INITIAL_VIEW);

	const getFrameProperties = useCallback(() => {
		const iframe = iframeRef.current;
		if (!iframe) {
			return;
		}

		const document = iframe.contentDocument;
		const window = iframe.contentWindow;

		if (!document || !window) {
			return;
		}

		const viewport = document.getElementById("trickroom-viewport") ?? null;
		const world = (document.getElementsByClassName("frame-content").item(0) ??
			null) as HTMLDivElement | null;

		if (!viewport || !world) {
			return;
		}

		return {
			world,
			window,
			document,
			viewport,
		};
	}, [iframeRef]);

	useEffect(() => {
		const properties = getFrameProperties();
		if (!properties || !didMount) {
			return;
		}

		const { window, viewport, world } = properties;

		let cleanup: (() => void) | undefined;

		const onLoad = () => {
			let currentView = INITIAL_VIEW;
			let spacePressed = false;
			let isPanning = false;
			let pointerId: number | null = null;
			let panStartX = 0;
			let panStartY = 0;
			let startViewX = 0;
			let startViewY = 0;

			const applyCursorState = () => {
				viewport.classList.toggle("cursor-grab", spacePressed);
				viewport.classList.toggle("cursor-grabbing", isPanning);
			};

			const publishView = (nextView: ViewState) => {
				setView({ ...nextView, x: -nextView.x, y: -nextView.y });
			};

			const syncView = (nextView: ViewState) => {
				currentView = nextView;
				world.style.transform = `translate(${nextView.x}px, ${nextView.y}px) scale(${nextView.scale})`;
			};

			const commitView = (nextView: ViewState) => {
				syncView(nextView);
				publishView(nextView);
			};

			const centerArtboard = () => {
				const { clientWidth, clientHeight } = viewport;
				const nextScale = 1;
				const x =
					clientWidth / 2 - (ARTBOARD.x + ARTBOARD.width / 2) * nextScale;
				const y =
					clientHeight / 2 - (ARTBOARD.y + ARTBOARD.height / 2) * nextScale;

				commitView({ x, y, scale: nextScale });
			};

			const zoomAtPoint = (
				clientX: number,
				clientY: number,
				nextScale: number,
			) => {
				const clampedScale = Math.max(
					MIN_SCALE,
					Math.min(MAX_SCALE, nextScale),
				);
				const worldX = (clientX - currentView.x) / currentView.scale;
				const worldY = (clientY - currentView.y) / currentView.scale;
				const x = clientX - worldX * clampedScale;
				const y = clientY - worldY * clampedScale;

				commitView({ x, y, scale: clampedScale });
			};

			const onKeyDown = (event: KeyboardEvent) => {
				if (event.code === "Space" && !event.repeat) {
					event.preventDefault();
					spacePressed = true;
					applyCursorState();
				}
			};

			const onKeyUp = (event: KeyboardEvent) => {
				if (event.code === "Space") {
					spacePressed = false;
					applyCursorState();
				}
			};

			const endPan = () => {
				isPanning = false;
				pointerId = null;
				applyCursorState();

				// Keep high-frequency pan updates out of React; the iframe transform is
				// applied imperatively above. Remove this split if React-rendered overlays
				// need live x/y during pan, or replace it with an imperative canvas
				// subscription so the app root still does not re-render per pointer event.
				publishView(currentView);
			};

			const onPointerDown = (event: PointerEvent) => {
				const shouldPan =
					event.button === 1 || (event.button === 0 && spacePressed);

				if (!shouldPan) {
					return;
				}

				event.preventDefault();
				// viewport.focus();
				pointerId = event.pointerId;
				isPanning = true;
				panStartX = event.clientX;
				panStartY = event.clientY;
				startViewX = currentView.x;
				startViewY = currentView.y;
				viewport.setPointerCapture(event.pointerId);
				applyCursorState();
			};

			const onPointerMove = (event: PointerEvent) => {
				if (!isPanning || pointerId !== event.pointerId) {
					return;
				}

				syncView({
					...currentView,
					x: startViewX + (event.clientX - panStartX),
					y: startViewY + (event.clientY - panStartY),
				});
			};

			const onPointerUp = (event: PointerEvent) => {
				if (pointerId === event.pointerId) {
					viewport.releasePointerCapture(event.pointerId);
					endPan();
				}
			};

			const onWheel = (event: WheelEvent) => {
				event.preventDefault();

				if (event.ctrlKey || event.metaKey) {
					const zoomFactor = Math.exp(-event.deltaY * 0.0015);
					zoomAtPoint(
						event.clientX,
						event.clientY,
						currentView.scale * zoomFactor,
					);
					return;
				}

				syncView({
					...currentView,
					x: currentView.x - event.deltaX,
					y: currentView.y - event.deltaY,
				});
			};

			centerArtboard();
			applyCursorState();
			// viewport.focus();

			window.addEventListener("keydown", onKeyDown);
			window.addEventListener("keyup", onKeyUp);
			window.addEventListener("blur", endPan);
			// window.addEventListener("resize", centerArtboard);
			viewport.addEventListener("pointerdown", onPointerDown);
			viewport.addEventListener("pointermove", onPointerMove);
			viewport.addEventListener("pointerup", onPointerUp);
			viewport.addEventListener("pointercancel", endPan);
			viewport.addEventListener("wheel", onWheel, { passive: false });

			cleanup = () => {
				window.removeEventListener("keydown", onKeyDown);
				window.removeEventListener("keyup", onKeyUp);
				window.removeEventListener("blur", endPan);
				// window.removeEventListener("resize", centerArtboard);
				viewport.removeEventListener("pointerdown", onPointerDown);
				viewport.removeEventListener("pointermove", onPointerMove);
				viewport.removeEventListener("pointerup", onPointerUp);
				viewport.removeEventListener("pointercancel", endPan);
				viewport.removeEventListener("wheel", onWheel);
			};
		};

		// iframe.addEventListener("load", onLoad);
		if (didMount) {
			onLoad();
		}

		return () => {
			// iframe.removeEventListener("load", onLoad);
			cleanup?.();
		};
	}, [didMount, getFrameProperties]);

	return view;
}
