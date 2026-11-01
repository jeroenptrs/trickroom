import type { LibraryRegistry, RecipeRegistry, Registry } from "../../types";
import type { ChartsComponents } from "./components";

/** Shown on a new chart, so it renders something a designer can replace. */
const SAMPLE_CHART_DATA = JSON.stringify({
	columns: ["t", "Series 1"],
	rows: [
		[1767225600000, 32],
		[1767229200000, 41],
		[1767232800000, 38],
		[1767236400000, 52],
		[1767240000000, 47],
		[1767243600000, 61],
		[1767247200000, 58],
	],
});

const SAMPLE_MAP_DATA = JSON.stringify({
	columns: ["country", "value"],
	rows: [
		["Belgium", 640],
		["Germany", 320],
		["France", 210],
		["United States of America", 120],
		["Brazil", 6],
	],
});

/**
 * Size stays out of the base classes: a stored `h-8` would lose to a base
 * `h-40`, because Tailwind sorts by value and not by layer. New elements get
 * their size as authored classes in `defaultProps`, and `min-h-8` keeps a
 * chart without any size visible.
 */
const BASE_CLASS_NAME = "block min-h-8 min-w-0";

export const components = {
	chart: {
		role: "leaf",
		label: "Chart",
		description:
			"Line, area, bar, or sparkline plot. Size it with classes: it fills its box. Colours come from the --chart-* variables of the linked system's CSS.",
		baseClassName: BASE_CLASS_NAME,
		defaultProps: {
			className: "h-40 w-full",
			form: "line",
			data: SAMPLE_CHART_DATA,
		},
		controls: {
			form: {
				label: "Form",
				input: "select",
				prop: "form",
				valueType: "string",
				defaultValue: "line",
				options: [
					{ label: "Line", value: "line" },
					{ label: "Area", value: "area" },
					{ label: "Bars", value: "bar" },
					{ label: "Stacked", value: "stacked-bar" },
					{ label: "Monthly", value: "monthly-bar" },
					{ label: "Spark", value: "sparkline" },
				],
			},
			data: {
				label: "Data",
				description:
					'JSON: { "columns": ["t", "cpu"], "rows": [[1767225600000, 42]] }. The first column is the x value: epoch ms, an ISO date, or a category. The other columns are series, and null leaves a gap.',
				input: "textarea",
				prop: "data",
				format: "chart",
				valueType: "string",
			},
			limits: {
				label: "Limits",
				description:
					'JSON: dashed reference lines, such as [{ "value": 90 }, { "value": 70, "tone": "warning" }].',
				input: "textarea",
				prop: "limits",
				format: "chart",
				valueType: "string",
				defaultValue: "",
			},
			markers: {
				label: "Markers",
				description:
					"JSON: x values that get a dotted event rule, such as [1767236400000].",
				input: "text",
				prop: "markers",
				format: "chart",
				valueType: "string",
				defaultValue: "",
			},
			curve: {
				label: "Curve",
				description: "Monotone for averages, linear for sampled values.",
				input: "select",
				prop: "curve",
				valueType: "string",
				defaultValue: "monotone",
				options: [
					{ label: "Monotone", value: "monotone" },
					{ label: "Linear", value: "linear" },
				],
			},
			fill: {
				label: "Area fill",
				description: "The area form's fill.",
				input: "select",
				prop: "fill",
				valueType: "string",
				defaultValue: "flat",
				options: [
					{ label: "Flat", value: "flat" },
					{ label: "Gradient", value: "gradient" },
				],
			},
			yMax: {
				label: "Y maximum",
				description: "0 rounds up from the data and the limits.",
				input: "number",
				prop: "yMax",
				valueType: "number",
				defaultValue: 0,
			},
			yPrefix: {
				label: "Y prefix",
				input: "text",
				prop: "yPrefix",
				valueType: "string",
				defaultValue: "",
			},
			ySuffix: {
				label: "Y suffix",
				input: "text",
				prop: "ySuffix",
				valueType: "string",
				defaultValue: "",
			},
			yAxis: {
				label: "Y axis",
				description: "Off drops the Y axis and the grid, for a strip plot.",
				input: "switch",
				prop: "yAxis",
				valueType: "boolean",
				defaultValue: true,
			},
			partial: {
				label: "Open last period",
				description: "The monthly form draws the last bar lighter.",
				input: "switch",
				prop: "partial",
				valueType: "boolean",
				defaultValue: false,
			},
			colors: {
				label: "Series colours",
				description:
					"Space-separated CSS colours per series. Empty uses --chart-series-1 and up.",
				input: "text",
				prop: "colors",
				valueType: "string",
				defaultValue: "",
			},
			ariaLabel: {
				label: "Accessible label",
				input: "text",
				prop: "aria-label",
				valueType: "string",
				defaultValue: "",
			},
		},
	},
	map: {
		role: "leaf",
		label: "World map",
		description:
			"Choropleth of countries. Size it with classes: it fills its box. Colours come from the --map-* variables of the linked system's CSS.",
		baseClassName: BASE_CLASS_NAME,
		defaultProps: {
			className: "aspect-2/1 w-full",
			data: SAMPLE_MAP_DATA,
		},
		controls: {
			data: {
				label: "Data",
				description:
					'JSON: { "columns": ["country", "value"], "rows": [["Belgium", 640]] }. Countries match on the world-atlas name or numeric id.',
				input: "textarea",
				prop: "data",
				format: "map",
				valueType: "string",
			},
			points: {
				label: "Points",
				description:
					'JSON: dots for places too small for the map, such as [{ "lon": 103.8, "lat": 1.35, "value": 18 }].',
				input: "textarea",
				prop: "points",
				format: "map",
				valueType: "string",
				defaultValue: "",
			},
			view: {
				label: "View",
				input: "select",
				prop: "view",
				valueType: "string",
				defaultValue: "world",
				options: [
					{ label: "World", value: "world" },
					{ label: "Europe", value: "europe" },
				],
			},
			bounds: {
				label: "Bounds",
				description:
					"West south east north in degrees. Overrides the view, such as -12 34 32 72.",
				input: "text",
				prop: "bounds",
				format: "map",
				valueType: "string",
				defaultValue: "",
			},
			steps: {
				label: "Colour steps",
				description:
					"Up to four ascending upper bounds, which split values over --map-1 to --map-5.",
				input: "text",
				prop: "steps",
				format: "map",
				valueType: "string",
				defaultValue: "10 50 150 400",
			},
			ariaLabel: {
				label: "Accessible label",
				input: "text",
				prop: "aria-label",
				valueType: "string",
				defaultValue: "",
			},
		},
	},
} satisfies Registry<ChartsComponents>;

export const recipes = {} satisfies RecipeRegistry;

export default {
	components,
	recipes,
} satisfies LibraryRegistry<ChartsComponents>;
