import {
	type RefObject,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import type { ResponsiveStageMode } from "../components/responsive-stage-context";
import { designStore } from "../stores/design-store";

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

export type StageNavigationOptions = {
	mode: ResponsiveStageMode;
	activeBoardId: string | null;
	responsiveWidth: number;
};

type StageNavigationController = {
	centerResponsiveBoard: () => boolean;
	resetInteractionState: () => void;
};

const DEFAULT_STAGE_NAVIGATION_OPTIONS: StageNavigationOptions = {
	mode: "canvas",
	activeBoardId: null,
	responsiveWidth: 0,
};

export function shouldStartStagePan(
	mode: ResponsiveStageMode,
	button: number,
	spacePressed: boolean,
) {
	return mode === "canvas" && (button === 1 || (button === 0 && spacePressed));
}

export function shouldZoomStageFromWheel(
	mode: ResponsiveStageMode,
	event: Pick<WheelEvent, "ctrlKey" | "metaKey">,
) {
	return mode === "canvas" && (event.ctrlKey || event.metaKey);
}

export function findStageRootBoard(
	world: Element,
	activeBoardId: string | null,
) {
	const boards = Array.from(
		world.querySelectorAll<HTMLElement>("[data-trickroom-root-id]"),
	);

	if (activeBoardId) {
		return (
			boards.find(
				(board) =>
					board.getAttribute("data-trickroom-root-id") === activeBoardId,
			) ?? null
		);
	}

	return boards[0] ?? null;
}

export function useStageNavigation(
	iframeRef: RefObject<HTMLIFrameElement | null>,
	didMount?: boolean,
	options: StageNavigationOptions = DEFAULT_STAGE_NAVIGATION_OPTIONS,
) {
	const [view, setView] = useState(INITIAL_VIEW);
	const latestOptionsRef = useRef(options);
	const controllerRef = useRef<StageNavigationController | null>(null);
	const { activeBoardId, mode, responsiveWidth } = options;
	latestOptionsRef.current = options;

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

		const { window, viewport, world, document } = properties;

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

			const getNavigationOptions = () => latestOptionsRef.current;

			const isCanvasMode = () => getNavigationOptions().mode === "canvas";

			const applyCursorState = () => {
				viewport.classList.toggle(
					"cursor-grab",
					spacePressed && isCanvasMode(),
				);
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

			// Center the first board in the visible viewport at 100% (the iframe
			// already lives between the sidebars, so its client box is the visible
			// area). Returns false until a board is actually rendered with a
			// measurable size, so the caller can retry while the design hydrates.
			const fitFirstBoard = (): boolean => {
				const markedBoard = findStageRootBoard(world, null);
				const main = world.querySelector("main");
				const board =
					markedBoard ?? (main?.firstElementChild as HTMLElement | null);
				if (!board) {
					return false;
				}

				const boardRect = board.getBoundingClientRect();
				const worldRect = world.getBoundingClientRect();
				if (boardRect.width === 0 || boardRect.height === 0) {
					return false;
				}

				// getBoundingClientRect reflects the current transform; divide it back
				// out to recover untransformed world-space geometry.
				const offsetX = (boardRect.left - worldRect.left) / currentView.scale;
				const offsetY = (boardRect.top - worldRect.top) / currentView.scale;
				const boardWidth = boardRect.width / currentView.scale;
				const boardHeight = boardRect.height / currentView.scale;

				const { clientWidth, clientHeight } = viewport;

				// Always present a freshly loaded design at 100%; we only center the
				// first board in the viewport rather than zooming to fit it.
				const nextScale = 1;

				const x =
					(clientWidth - boardWidth * nextScale) / 2 - offsetX * nextScale;
				const y =
					(clientHeight - boardHeight * nextScale) / 2 - offsetY * nextScale;

				commitView({ x, y, scale: nextScale });
				return true;
			};

			const centerBoard = (board: HTMLElement): boolean => {
				const boardRect = board.getBoundingClientRect();
				const worldRect = world.getBoundingClientRect();
				if (boardRect.width === 0 || boardRect.height === 0) {
					return false;
				}

				const offsetX = (boardRect.left - worldRect.left) / currentView.scale;
				const offsetY = (boardRect.top - worldRect.top) / currentView.scale;
				const boardWidth = boardRect.width / currentView.scale;
				const boardHeight = boardRect.height / currentView.scale;
				const nextScale = 1;
				const { clientWidth, clientHeight } = viewport;
				const x =
					(clientWidth - boardWidth * nextScale) / 2 - offsetX * nextScale;
				const y =
					(clientHeight - boardHeight * nextScale) / 2 - offsetY * nextScale;

				commitView({ x, y, scale: nextScale });
				return true;
			};

			const centerResponsiveBoard = (): boolean => {
				const board = findStageRootBoard(
					world,
					getNavigationOptions().activeBoardId,
				);
				if (!board) {
					syncView({ ...currentView, scale: 1 });
					publishView({ ...currentView, scale: 1 });
					return false;
				}

				return centerBoard(board);
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
				if (!isCanvasMode()) {
					return;
				}

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
				if (!isPanning && pointerId === null) {
					applyCursorState();
					return;
				}

				isPanning = false;
				pointerId = null;
				applyCursorState();

				// Keep high-frequency pan updates out of React; the iframe transform is
				// applied imperatively above. Remove this split if React-rendered overlays
				// need live x/y during pan, or replace it with an imperative canvas
				// subscription so the app root still does not re-render per pointer event.
				publishView(currentView);
			};

			const resetInteractionState = () => {
				spacePressed = false;
				if (isPanning) {
					isPanning = false;
					pointerId = null;
					publishView(currentView);
				}
				applyCursorState();
			};

			const onPointerDown = (event: PointerEvent) => {
				if (
					!shouldStartStagePan(
						getNavigationOptions().mode,
						event.button,
						spacePressed,
					)
				) {
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
				if (shouldZoomStageFromWheel(getNavigationOptions().mode, event)) {
					event.preventDefault();
					const zoomFactor = Math.exp(-event.deltaY * 0.0015);
					zoomAtPoint(
						event.clientX,
						event.clientY,
						currentView.scale * zoomFactor,
					);
					return;
				}

				if (event.ctrlKey || event.metaKey) {
					event.preventDefault();
					return;
				}

				if (!isCanvasMode()) {
					return;
				}

				event.preventDefault();
				syncView({
					...currentView,
					x: currentView.x - event.deltaX,
					y: currentView.y - event.deltaY,
				});
			};

			// Fit once boards actually exist and have a measurable size. The store's
			// root count gates this so an empty design never starts observing
			// (centerArtboard stands). Once roots exist the board element still has to
			// (a) render into the iframe and (b) gain a real size after the compiled
			// Tailwind CSS/fonts land — both async and of unpredictable duration — so
			// we wait for the element via rAF, then for its layout via ResizeObserver,
			// and fit exactly once.
			let fitFrame = 0;
			let fitDone = false;
			let resizeObserver: ResizeObserver | undefined;
			let stylesReadyObserver: MutationObserver | undefined;

			centerArtboard();

			// In compiled Tailwind mode the shell hides content until the compiled
			// CSS lands (`data-trickroom-styles-ready`), but uses `visibility` so the
			// board still has a measurable — yet *unstyled* — size meanwhile. Fitting
			// against that size centers against the wrong dimensions, so we only
			// finalize the fit once styles are ready. Docs that never opt into
			// awaiting styles (e.g. the browser-runtime mode) are always "ready".
			const awaitsStyles = document.documentElement.hasAttribute(
				"data-trickroom-await-styles",
			);
			const stylesReady = () =>
				!awaitsStyles ||
				document.documentElement.hasAttribute("data-trickroom-styles-ready");

			const finishFit = () => {
				fitDone = true;
				resizeObserver?.disconnect();
				resizeObserver = undefined;
				stylesReadyObserver?.disconnect();
				stylesReadyObserver = undefined;
			};

			// Re-center against the current geometry, finalizing only once the board
			// has a real size AND styles are ready. Until then we keep re-fitting so
			// the canvas tracks the board as it lays out / styles in.
			const attemptFit = (): boolean => {
				if (fitDone) {
					return true;
				}
				const fitted = fitFirstBoard();
				if (fitted && stylesReady()) {
					finishFit();
					return true;
				}
				return false;
			};

			const startFitting = () => {
				if (fitDone) {
					return;
				}

				const board = findStageRootBoard(world, null);
				if (!board) {
					// The board hasn't been rendered into the iframe yet; check again
					// next frame.
					fitFrame = window.requestAnimationFrame(startFitting);
					return;
				}

				if (attemptFit()) {
					return;
				}

				// Board exists but isn't styled/laid out yet: re-fit as it gains a
				// real size...
				resizeObserver = new window.ResizeObserver(() => {
					attemptFit();
				});
				resizeObserver.observe(board);

				// ...and the moment compiled styles land (which may not change the
				// box size, so a ResizeObserver alone can miss it).
				if (awaitsStyles) {
					stylesReadyObserver = new window.MutationObserver(() => {
						attemptFit();
					});
					stylesReadyObserver.observe(document.documentElement, {
						attributes: true,
						attributeFilter: ["data-trickroom-styles-ready"],
					});
				}
			};

			let unsubscribeRoots: (() => void) | undefined;
			if (designStore.get().rootIds.length > 0) {
				startFitting();
			} else {
				// Hydration may lag the iframe mount; start fitting the moment the
				// first board lands in the store, then stop listening.
				const rootsSubscription = designStore.subscribe(() => {
					if (designStore.get().rootIds.length > 0) {
						unsubscribeRoots?.();
						unsubscribeRoots = undefined;
						startFitting();
					}
				});
				unsubscribeRoots = rootsSubscription.unsubscribe;
			}
			controllerRef.current = {
				centerResponsiveBoard,
				resetInteractionState,
			};
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
				if (fitFrame) {
					window.cancelAnimationFrame(fitFrame);
				}
				resizeObserver?.disconnect();
				stylesReadyObserver?.disconnect();
				unsubscribeRoots?.();
				if (
					controllerRef.current?.centerResponsiveBoard === centerResponsiveBoard
				) {
					controllerRef.current = null;
				}
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

	useEffect(() => {
		if (!didMount || mode !== "responsive") {
			return;
		}

		const properties = getFrameProperties();
		if (!properties) {
			return;
		}

		const { window, viewport, world, document } = properties;
		const controller = controllerRef.current;
		if (!controller) {
			return;
		}

		let animationFrame = 0;
		let boardFrame = 0;
		let boardResizeObserver: ResizeObserver | undefined;
		let viewportResizeObserver: ResizeObserver | undefined;
		let stylesReadyObserver: MutationObserver | undefined;

		const scheduleCenter = () => {
			if (animationFrame) {
				window.cancelAnimationFrame(animationFrame);
			}

			animationFrame = window.requestAnimationFrame(() => {
				animationFrame = 0;
				if (
					latestOptionsRef.current.mode !== "responsive" ||
					latestOptionsRef.current.activeBoardId !== activeBoardId ||
					latestOptionsRef.current.responsiveWidth !== responsiveWidth
				) {
					return;
				}
				controller.resetInteractionState();
				controller.centerResponsiveBoard();
			});
		};

		const observeActiveBoard = () => {
			const board = findStageRootBoard(world, activeBoardId);
			if (!board) {
				boardFrame = window.requestAnimationFrame(observeActiveBoard);
				return;
			}

			boardResizeObserver = new window.ResizeObserver(scheduleCenter);
			boardResizeObserver.observe(board);
			scheduleCenter();
		};

		observeActiveBoard();
		viewportResizeObserver = new window.ResizeObserver(scheduleCenter);
		viewportResizeObserver.observe(viewport);

		if (document.documentElement.hasAttribute("data-trickroom-await-styles")) {
			stylesReadyObserver = new window.MutationObserver(scheduleCenter);
			stylesReadyObserver.observe(document.documentElement, {
				attributes: true,
				attributeFilter: ["data-trickroom-styles-ready"],
			});
		}

		return () => {
			if (animationFrame) {
				window.cancelAnimationFrame(animationFrame);
			}
			if (boardFrame) {
				window.cancelAnimationFrame(boardFrame);
			}
			boardResizeObserver?.disconnect();
			viewportResizeObserver?.disconnect();
			stylesReadyObserver?.disconnect();
		};
	}, [activeBoardId, didMount, getFrameProperties, mode, responsiveWidth]);

	return view;
}
