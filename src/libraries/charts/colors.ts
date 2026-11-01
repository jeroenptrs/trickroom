/**
 * The colour contract with the linked design system. Trickroom reads these CSS
 * variables and ships no palette of its own: the fallbacks only keep a chart
 * legible in a system that defines none. SVG presentation attributes resolve
 * `var()`, so a `.dark` ancestor recolours a chart with no re-render.
 */

const SERIES_FALLBACKS = [
	"#2563eb",
	"#059669",
	"#7c3aed",
	"#d97706",
	"#0891b2",
	"#475569",
];

export const chartSeriesColor = (index: number): string => {
	const slot = index % SERIES_FALLBACKS.length;
	return `var(--chart-series-${slot + 1}, ${SERIES_FALLBACKS[slot]})`;
};

export const CHART_AXIS = "var(--chart-axis, #6b7280)";
export const CHART_GRID = "var(--chart-grid, #e5e7eb)";
export const CHART_LIMIT = "var(--chart-limit, #dc2626)";
export const CHART_LIMIT_WARNING = "var(--chart-limit-warning, #d97706)";
export const CHART_SURFACE = "var(--chart-surface, transparent)";
export const CHART_PARTIAL = "var(--chart-partial, #bfdbfe)";

const MAP_FALLBACKS = [
	"#e5e7eb",
	"#dbeafe",
	"#bfdbfe",
	"#93c5fd",
	"#3b82f6",
	"#1e3a8a",
];

export const mapStepColor = (step: number): string =>
	`var(--map-${step}, ${MAP_FALLBACKS[step] ?? MAP_FALLBACKS[0]})`;

export const MAP_LINE = "var(--map-line, #ffffff)";
export const MAP_SURFACE = "var(--map-surface, #ffffff)";
