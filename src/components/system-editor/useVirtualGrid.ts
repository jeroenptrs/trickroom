import { useVirtualizer } from "@tanstack/react-virtual";
import { type RefObject, useCallback, useEffect, useState } from "react";

export const VIRTUAL_GRID_GAP = 12;
export const ASSET_GRID_MIN_COLUMN_WIDTH = 160;
export const ASSET_GRID_ROW_EXTRA_HEIGHT = 66;
export const ICON_GRID_MIN_COLUMN_WIDTH = 108;
export const ICON_GRID_ROW_HEIGHT = 116;
const VIRTUAL_GRID_OVERSCAN = 4;

export function getVirtualGridColumnCount(
	containerWidth: number,
	minColumnWidth: number,
) {
	if (containerWidth <= 0) {
		return 1;
	}

	return Math.max(
		1,
		Math.floor(
			(containerWidth + VIRTUAL_GRID_GAP) / (minColumnWidth + VIRTUAL_GRID_GAP),
		),
	);
}

export function useVirtualGrid<T>({
	items,
	minColumnWidth,
	estimateRowHeight,
	scrollElementRef,
	getItemKey,
}: {
	items: readonly T[];
	minColumnWidth: number;
	estimateRowHeight: (columnWidth: number) => number;
	scrollElementRef: RefObject<HTMLDivElement | null>;
	getItemKey: (item: T) => string;
}) {
	const [containerElement, setContainerElement] =
		useState<HTMLDivElement | null>(null);
	const containerRef = useCallback((node: HTMLDivElement | null) => {
		setContainerElement(node);
	}, []);
	const [containerWidth, setContainerWidth] = useState(0);
	const [scrollMargin, setScrollMargin] = useState(0);
	const columnCount = getVirtualGridColumnCount(containerWidth, minColumnWidth);
	const columnWidth =
		columnCount > 0
			? Math.max(
					minColumnWidth,
					(containerWidth - VIRTUAL_GRID_GAP * (columnCount - 1)) / columnCount,
				)
			: minColumnWidth;
	const rowHeight = estimateRowHeight(columnWidth);
	const rowCount = Math.ceil(items.length / columnCount);
	const rowVirtualizer = useVirtualizer({
		count: rowCount,
		getScrollElement: () => scrollElementRef.current,
		estimateSize: () => rowHeight + VIRTUAL_GRID_GAP,
		getItemKey: (index) => {
			const firstItem = items[index * columnCount];
			return firstItem ? getItemKey(firstItem) : index;
		},
		overscan: VIRTUAL_GRID_OVERSCAN,
		scrollMargin,
	});

	useEffect(() => {
		const container = containerElement;
		if (!container) {
			return;
		}

		const updateMeasurements = () => {
			setContainerWidth(container.clientWidth);
			setScrollMargin(container.offsetTop);
		};
		updateMeasurements();

		const resizeObserver = new ResizeObserver(updateMeasurements);
		resizeObserver.observe(container);
		return () => resizeObserver.disconnect();
	}, [containerElement]);

	return {
		columnCount,
		containerRef,
		rowHeight,
		rowVirtualizer,
		scrollMargin,
	};
}
