import { ScrollArea } from "@base-ui/react/scroll-area";
import {
	type ComponentPropsWithoutRef,
	createContext,
	forwardRef,
	useContext,
} from "react";
import { renderFallback } from "./render-fallback";

type ScrollAreaRootProps = ComponentPropsWithoutRef<typeof ScrollArea.Root>;
type ScrollAreaViewportProps = ComponentPropsWithoutRef<
	typeof ScrollArea.Viewport
>;
type ScrollAreaContentProps = ComponentPropsWithoutRef<
	typeof ScrollArea.Content
>;
type ScrollAreaScrollbarProps = ComponentPropsWithoutRef<
	typeof ScrollArea.Scrollbar
>;
type ScrollAreaThumbProps = ComponentPropsWithoutRef<typeof ScrollArea.Thumb>;
type ScrollAreaCornerProps = ComponentPropsWithoutRef<typeof ScrollArea.Corner>;

const ScrollAreaRootRenderContext = createContext(false);
const ScrollAreaViewportRenderContext = createContext(false);
const ScrollAreaScrollbarRenderContext = createContext(false);

export const ScrollAreaRoot = forwardRef<HTMLDivElement, ScrollAreaRootProps>(
	function ScrollAreaRoot(props, ref) {
		return (
			<ScrollAreaRootRenderContext.Provider value={true}>
				<ScrollArea.Root {...props} ref={ref} />
			</ScrollAreaRootRenderContext.Provider>
		);
	},
);

export const ScrollAreaViewport = forwardRef<
	HTMLDivElement,
	ScrollAreaViewportProps
>(function ScrollAreaViewport(props, ref) {
	const isInsideScrollAreaRoot = useContext(ScrollAreaRootRenderContext);

	if (isInsideScrollAreaRoot) {
		return (
			<ScrollAreaViewportRenderContext.Provider value={true}>
				<ScrollArea.Viewport {...props} ref={ref} />
			</ScrollAreaViewportRenderContext.Provider>
		);
	}

	return (
		<ScrollAreaViewportRenderContext.Provider value={true}>
			{renderFallback("div", props, ref)}
		</ScrollAreaViewportRenderContext.Provider>
	);
});

export const ScrollAreaContent = forwardRef<
	HTMLDivElement,
	ScrollAreaContentProps
>(function ScrollAreaContent(props, ref) {
	const isInsideScrollAreaRoot = useContext(ScrollAreaRootRenderContext);
	const isInsideScrollAreaViewport = useContext(
		ScrollAreaViewportRenderContext,
	);

	if (isInsideScrollAreaRoot && isInsideScrollAreaViewport) {
		return <ScrollArea.Content {...props} ref={ref} />;
	}

	return renderFallback("div", props, ref);
});

export const ScrollAreaScrollbar = forwardRef<
	HTMLDivElement,
	ScrollAreaScrollbarProps
>(function ScrollAreaScrollbar(props, ref) {
	const isInsideScrollAreaRoot = useContext(ScrollAreaRootRenderContext);

	if (isInsideScrollAreaRoot) {
		return (
			<ScrollAreaScrollbarRenderContext.Provider value={true}>
				<ScrollArea.Scrollbar {...props} ref={ref} />
			</ScrollAreaScrollbarRenderContext.Provider>
		);
	}

	return (
		<ScrollAreaScrollbarRenderContext.Provider value={true}>
			{renderFallback("div", props, ref, ["orientation"])}
		</ScrollAreaScrollbarRenderContext.Provider>
	);
});

export const ScrollAreaThumb = forwardRef<HTMLDivElement, ScrollAreaThumbProps>(
	function ScrollAreaThumb(props, ref) {
		const isInsideScrollAreaRoot = useContext(ScrollAreaRootRenderContext);
		const isInsideScrollAreaScrollbar = useContext(
			ScrollAreaScrollbarRenderContext,
		);

		if (isInsideScrollAreaRoot && isInsideScrollAreaScrollbar) {
			return <ScrollArea.Thumb {...props} ref={ref} />;
		}

		return renderFallback("div", props, ref);
	},
);

export const ScrollAreaCorner = forwardRef<
	HTMLDivElement,
	ScrollAreaCornerProps
>(function ScrollAreaCorner(props, ref) {
	const isInsideScrollAreaRoot = useContext(ScrollAreaRootRenderContext);

	if (isInsideScrollAreaRoot) {
		return <ScrollArea.Corner {...props} ref={ref} />;
	}

	return renderFallback("div", props, ref);
});
