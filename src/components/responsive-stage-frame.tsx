import {
	type ReactNode,
	type PointerEvent as ReactPointerEvent,
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import type { ResolvedBreakpoint } from "../utils/resolved-breakpoints";
import {
	clampResponsiveStageWidth,
	useResponsiveStage,
} from "./responsive-stage-context";
import {
	getResponsiveStageViewportHeight,
	getResponsiveStageWheelZoom,
	getZoomAnchoredScroll,
	isForwardedStageWheel,
	normalizeStageWheelDelta,
	useResponsiveStageZoom,
} from "./responsive-stage-zoom";

type ResponsiveStageFrameWrapperProps = {
	children: ReactNode;
};

export type ResponsiveStageFrameSide = "left" | "right";

type DragState = {
	side: ResponsiveStageFrameSide;
	startClientX: number;
	startWidth: number;
	previewScale: number;
};

const FRAME_GUTTER_PX = 80;
// Matches the responsive layout's pt-20 (room for the ruler) + pb-6.
const FRAME_VERTICAL_PADDING_PX = 104;
const MIN_PREVIEW_SCALE = 0.25;
const RULER_STEP_PX = 50;
const RULER_LABEL_STEP_PX = 200;

export function getDraggedResponsiveStageWidth(
	startWidth: number,
	startClientX: number,
	clientX: number,
	side: ResponsiveStageFrameSide,
	previewScale = 1,
) {
	const direction = side === "right" ? 1 : -1;
	const scale =
		Number.isFinite(previewScale) && previewScale > 0 ? previewScale : 1;
	return clampResponsiveStageWidth(
		startWidth + ((clientX - startClientX) / scale) * direction,
	);
}

export function getResponsiveStagePreviewScale(
	responsiveWidth: number,
	availableWidth: number,
	gutterPx = FRAME_GUTTER_PX,
) {
	if (responsiveWidth <= 0 || availableWidth <= 0) {
		return 1;
	}

	const availableFrameWidth = Math.max(0, availableWidth - gutterPx);
	const rawScale = availableFrameWidth / responsiveWidth;
	return Math.min(1, Math.max(MIN_PREVIEW_SCALE, rawScale));
}

export function getActiveResponsiveBreakpoint(
	breakpoints: readonly ResolvedBreakpoint[],
	responsiveWidth: number,
) {
	return (
		breakpoints
			.filter((breakpoint) => breakpoint.px !== null)
			.filter((breakpoint) => (breakpoint.px ?? 0) <= responsiveWidth)
			.sort((a, b) => (b.px ?? 0) - (a.px ?? 0))[0] ?? null
	);
}

export function getResponsiveStageRulerTicks(responsiveWidth: number) {
	const width = clampResponsiveStageWidth(responsiveWidth);
	const ticks: { px: number; major: boolean; label: string | null }[] = [];

	for (let px = 0; px <= width; px += RULER_STEP_PX) {
		const major = px % RULER_LABEL_STEP_PX === 0;
		ticks.push({ px, major, label: major ? String(px) : null });
	}

	if (ticks[ticks.length - 1]?.px !== width) {
		ticks.push({ px: width, major: true, label: String(width) });
	}

	return ticks;
}

type FrameLayout = {
	slot: { left: number; top: number };
	scale: number;
};

export function ResponsiveStageFrameWrapper({
	children,
}: ResponsiveStageFrameWrapperProps) {
	const { mode, responsiveWidth, controls, breakpoints } = useResponsiveStage();
	const { zoom, setZoom, setFitScale } = useResponsiveStageZoom();
	const outerRef = useRef<HTMLDivElement>(null);
	const slotRef = useRef<HTMLDivElement>(null);
	const dragStateRef = useRef<DragState | null>(null);
	const [draggingSide, setDraggingSide] =
		useState<ResponsiveStageFrameSide | null>(null);
	const [availableSize, setAvailableSize] = useState({ width: 0, height: 0 });
	const isResponsive = mode === "responsive";
	const fitScale = getResponsiveStagePreviewScale(
		responsiveWidth,
		availableSize.width,
	);
	const previewScale = zoom === "fit" ? fitScale : zoom;
	const viewportHeight = getResponsiveStageViewportHeight(
		availableSize.height - FRAME_VERTICAL_PADDING_PX,
		fitScale,
	);
	const scaledWidth = Math.round(responsiveWidth * previewScale);
	const scaledHeight = Math.round(viewportHeight * previewScale);
	const activeBreakpoint = getActiveResponsiveBreakpoint(
		breakpoints,
		responsiveWidth,
	);
	const parsedBreakpoints = breakpoints.filter(
		(breakpoint): breakpoint is ResolvedBreakpoint & { px: number } =>
			breakpoint.px !== null,
	);
	const rulerTicks = useMemo(
		() => getResponsiveStageRulerTicks(responsiveWidth),
		[responsiveWidth],
	);
	// Zoom bookkeeping for anchoring: the scale wheel events build on before
	// React re-renders, the point to keep still, and the last committed layout
	// and scroll position of the outer scroller.
	const scaleRef = useRef(previewScale);
	scaleRef.current = previewScale;
	const pendingScaleRef = useRef<number | null>(null);
	const pendingAnchorRef = useRef<{ x: number; y: number } | null>(null);
	const layoutRef = useRef<FrameLayout | null>(null);
	const scrollRef = useRef({ left: 0, top: 0 });

	useEffect(() => {
		setFitScale(fitScale);
	}, [fitScale, setFitScale]);

	useEffect(() => {
		const element = outerRef.current;
		if (!element) {
			return;
		}

		const updateAvailableSize = () => {
			setAvailableSize((current) =>
				current.width === element.clientWidth &&
				current.height === element.clientHeight
					? current
					: { width: element.clientWidth, height: element.clientHeight },
			);
		};

		updateAvailableSize();
		const ResizeObserverCtor = window.ResizeObserver;
		if (!ResizeObserverCtor) {
			return;
		}

		const observer = new ResizeObserverCtor(updateAvailableSize);
		observer.observe(element);
		return () => observer.disconnect();
	}, []);

	useEffect(() => {
		const outer = outerRef.current;
		if (!outer || !isResponsive) {
			return;
		}

		const onScroll = () => {
			scrollRef.current = { left: outer.scrollLeft, top: outer.scrollTop };
		};
		// Handles Ctrl/Cmd+wheel over the gutter and wheel events the stage
		// forwards from inside the iframe (see useStageNavigation).
		const onWheel = (event: WheelEvent) => {
			const delta = normalizeStageWheelDelta(event, outer.clientHeight);
			if (event.ctrlKey || event.metaKey) {
				event.preventDefault();
				const currentScale = pendingScaleRef.current ?? scaleRef.current;
				const nextScale = getResponsiveStageWheelZoom(currentScale, delta.y);
				if (nextScale === currentScale) {
					return;
				}

				const rect = outer.getBoundingClientRect();
				pendingScaleRef.current = nextScale;
				pendingAnchorRef.current = {
					x: event.clientX - rect.left,
					y: event.clientY - rect.top,
				};
				setZoom(nextScale);
				return;
			}

			if (isForwardedStageWheel(event)) {
				outer.scrollBy({ left: delta.x, top: delta.y });
			}
		};

		outer.addEventListener("scroll", onScroll, { passive: true });
		outer.addEventListener("wheel", onWheel, { passive: false });
		return () => {
			outer.removeEventListener("scroll", onScroll);
			outer.removeEventListener("wheel", onWheel);
		};
	}, [isResponsive, setZoom]);

	// Keep the point under the cursor (wheel) or the middle of the visible area
	// (toolbar) in place when the scale changes.
	// biome-ignore lint/correctness/useExhaustiveDependencies: re-measure whenever the frame geometry changes
	useLayoutEffect(() => {
		const outer = outerRef.current;
		const slot = slotRef.current;
		if (!isResponsive || !outer || !slot) {
			layoutRef.current = null;
			return;
		}

		const outerRect = outer.getBoundingClientRect();
		const slotRect = slot.getBoundingClientRect();
		const slotOffset = {
			left: slotRect.left - outerRect.left + outer.scrollLeft,
			top: slotRect.top - outerRect.top + outer.scrollTop,
		};
		const previous = layoutRef.current;
		if (previous && previous.scale !== previewScale) {
			const next = getZoomAnchoredScroll({
				anchor: pendingAnchorRef.current ?? {
					x: outer.clientWidth / 2,
					y: outer.clientHeight / 2,
				},
				previousScroll: scrollRef.current,
				previousSlot: previous.slot,
				previousScale: previous.scale,
				nextSlot: slotOffset,
				nextScale: previewScale,
			});
			outer.scrollLeft = next.left;
			outer.scrollTop = next.top;
		}

		pendingAnchorRef.current = null;
		pendingScaleRef.current = null;
		layoutRef.current = { slot: slotOffset, scale: previewScale };
		scrollRef.current = { left: outer.scrollLeft, top: outer.scrollTop };
	}, [availableSize, isResponsive, previewScale, responsiveWidth]);

	const startDrag = useCallback(
		(side: ResponsiveStageFrameSide, event: ReactPointerEvent<HTMLElement>) => {
			event.preventDefault();
			event.currentTarget.setPointerCapture(event.pointerId);
			dragStateRef.current = {
				side,
				startClientX: event.clientX,
				startWidth: responsiveWidth,
				previewScale,
			};
			setDraggingSide(side);
		},
		[previewScale, responsiveWidth],
	);
	const startDragLeft = useCallback(
		(event: ReactPointerEvent<HTMLElement>) => startDrag("left", event),
		[startDrag],
	);
	const startDragRight = useCallback(
		(event: ReactPointerEvent<HTMLElement>) => startDrag("right", event),
		[startDrag],
	);

	const updateDrag = useCallback(
		(event: ReactPointerEvent<HTMLElement>) => {
			const dragState = dragStateRef.current;
			if (!dragState) {
				return;
			}

			controls.setResponsiveWidth(
				getDraggedResponsiveStageWidth(
					dragState.startWidth,
					dragState.startClientX,
					event.clientX,
					dragState.side,
					dragState.previewScale,
				),
			);
		},
		[controls],
	);

	const finishDrag = useCallback((event: ReactPointerEvent<HTMLElement>) => {
		if (event.currentTarget.hasPointerCapture(event.pointerId)) {
			event.currentTarget.releasePointerCapture(event.pointerId);
		}
		dragStateRef.current = null;
		setDraggingSide(null);
	}, []);

	const frameOuterClassName = isResponsive
		? "absolute inset-0 overflow-auto bg-slate-100"
		: "absolute inset-0 overflow-hidden";
	const frameLayoutClassName = isResponsive
		? "relative flex min-h-full items-start justify-center px-10 pt-20 pb-6"
		: "absolute inset-0";
	const frameSlotClassName = isResponsive
		? "relative shrink-0"
		: "absolute inset-0";
	const frameContentClassName = isResponsive
		? "relative shrink-0 origin-top-left bg-white shadow-sm ring-1 ring-slate-200"
		: "absolute inset-0";
	const frameLayoutStyle = isResponsive
		? { minWidth: scaledWidth + FRAME_GUTTER_PX }
		: undefined;
	const frameSlotStyle = isResponsive
		? { width: scaledWidth, height: scaledHeight }
		: undefined;
	const frameContentStyle = isResponsive
		? {
				width: responsiveWidth,
				height: viewportHeight,
				transform: previewScale !== 1 ? `scale(${previewScale})` : undefined,
			}
		: undefined;

	return (
		<div
			ref={outerRef}
			className={frameOuterClassName}
			{...(isResponsive ? { "data-responsive-stage-frame": "" } : {})}
		>
			<div className={frameLayoutClassName} style={frameLayoutStyle}>
				<div
					ref={slotRef}
					className={frameSlotClassName}
					style={frameSlotStyle}
				>
					<div
						className={[
							"absolute -top-14 left-0 right-0 flex flex-col gap-1 text-[10px] text-slate-500",
							isResponsive ? "" : "hidden",
						].join(" ")}
						aria-hidden={!isResponsive}
					>
						<button
							type="button"
							className="mx-auto flex h-6 cursor-ew-resize touch-none items-center gap-2 border-none bg-white px-2 py-0 text-[10px] font-medium text-slate-600 shadow-sm ring-1 ring-slate-200 focus-visible:outline-none focus-visible:ring-cyan-500"
							onPointerDown={startDragRight}
							onPointerMove={updateDrag}
							onPointerUp={finishDrag}
							onPointerCancel={finishDrag}
							title="Drag to resize viewport width"
							aria-label="Drag to resize viewport width"
						>
							<span className="tabular-nums">{responsiveWidth}px</span>
							{previewScale !== 1 ? (
								<span className="text-slate-400">
									Preview {Math.round(previewScale * 100)}%
								</span>
							) : null}
						</button>
						<div className="relative h-2 rounded bg-slate-200">
							<div
								className="absolute inset-y-0 left-0 rounded bg-cyan-200"
								style={{
									width: `${
										activeBreakpoint?.px
											? Math.min(
													100,
													(activeBreakpoint.px / responsiveWidth) * 100,
												)
											: 0
									}%`,
								}}
							/>
							{parsedBreakpoints.map((breakpoint) => (
								<span
									key={breakpoint.name}
									className="absolute top-0 bottom-0 w-px bg-slate-500"
									style={{
										left: `${Math.min(
											100,
											(breakpoint.px / responsiveWidth) * 100,
										)}%`,
									}}
									title={`${breakpoint.name} ${Math.round(breakpoint.px)}px`}
								/>
							))}
						</div>
						<div className="relative h-4">
							{rulerTicks.map((tick) => (
								<span
									key={tick.px}
									className="absolute top-0 flex flex-col items-center"
									style={{ left: `${(tick.px / responsiveWidth) * 100}%` }}
								>
									<span
										className={
											tick.major
												? "h-2 w-px bg-slate-400"
												: "h-1 w-px bg-slate-300"
										}
									/>
									{tick.label ? (
										<span className="mt-0.5 tabular-nums text-slate-400">
											{tick.label}
										</span>
									) : null}
								</span>
							))}
						</div>
					</div>
					<div className={frameContentClassName} style={frameContentStyle}>
						{children}
					</div>
					{/* Overlay and handles live in the unscaled slot so they keep a
					    constant size at any zoom. */}
					{isResponsive && draggingSide ? (
						<div
							className="absolute inset-0 z-20 cursor-ew-resize bg-transparent"
							aria-hidden
						/>
					) : null}
					{isResponsive
						? (["left", "right"] as const).map((side) => {
								const handlePointerDown =
									side === "left" ? startDragLeft : startDragRight;
								return (
									<button
										key={side}
										type="button"
										className={[
											"absolute top-0 bottom-0 z-30 w-4 cursor-ew-resize touch-none border-none bg-transparent p-0",
											"before:absolute before:top-0 before:bottom-0 before:w-px before:bg-cyan-500/0",
											"hover:before:bg-cyan-500 focus-visible:outline-none focus-visible:before:bg-cyan-500",
											side === "left"
												? "-left-4 before:right-1"
												: "-right-4 before:left-1",
											draggingSide === side ? "before:bg-cyan-500" : "",
										].join(" ")}
										data-responsive-stage-resize-handle={side}
										aria-label={`Resize responsive frame ${side} edge`}
										onPointerDown={handlePointerDown}
										onPointerMove={updateDrag}
										onPointerUp={finishDrag}
										onPointerCancel={finishDrag}
										title="Drag to resize viewport width"
									/>
								);
							})
						: null}
				</div>
			</div>
		</div>
	);
}
