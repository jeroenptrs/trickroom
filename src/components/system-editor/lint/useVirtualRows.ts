import { useVirtualizer } from "@tanstack/react-virtual";
import { type RefObject, useCallback, useEffect, useState } from "react";

const OVERSCAN = 12;

/**
 * A row virtualizer for a list inside the System editor workspace, which
 * scrolls as a whole: the list's offset inside the scroll element is its
 * scroll margin. `initialRect` lets the first render (and a server render in
 * tests) lay out a screenful of rows before the scroll element is measured.
 */
export function useVirtualRows({
	count,
	estimateSize,
	scrollElementRef,
	getItemKey,
	measure = false,
}: {
	count: number;
	estimateSize: number;
	scrollElementRef: RefObject<HTMLDivElement | null>;
	getItemKey: (index: number) => string;
	/** Measure each row's real height (rows that wrap). */
	measure?: boolean;
}) {
	const [container, setContainer] = useState<HTMLElement | null>(null);
	const containerRef = useCallback((node: HTMLElement | null) => {
		setContainer(node);
	}, []);
	const [scrollMargin, setScrollMargin] = useState(0);

	const virtualizer = useVirtualizer({
		count,
		getScrollElement: () => scrollElementRef.current,
		estimateSize: () => estimateSize,
		getItemKey,
		overscan: OVERSCAN,
		scrollMargin,
		initialRect: { width: 960, height: 720 },
		...(measure
			? {
					measureElement: (element: Element) =>
						element.getBoundingClientRect().height,
				}
			: {}),
	});

	useEffect(() => {
		const scrollElement = scrollElementRef.current;
		if (!container || !scrollElement) {
			return;
		}
		const update = () => {
			const offset =
				container.getBoundingClientRect().top -
				scrollElement.getBoundingClientRect().top +
				scrollElement.scrollTop;
			setScrollMargin((current) =>
				Math.abs(current - offset) < 1 ? current : offset,
			);
		};
		update();
		const observer = new ResizeObserver(update);
		observer.observe(scrollElement);
		if (scrollElement.firstElementChild) {
			observer.observe(scrollElement.firstElementChild);
		}
		return () => observer.disconnect();
	}, [container, scrollElementRef]);

	return { containerRef, virtualizer, scrollMargin };
}
