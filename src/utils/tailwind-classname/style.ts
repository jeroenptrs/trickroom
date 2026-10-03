import type { ParsedClass } from "./parse";

export type StyleUtilityDomain =
	| "layout"
	| "size"
	| "typography"
	| "border"
	| "background"
	| "focus"
	| "effects"
	| "position"
	| "transform"
	| "motion"
	| "vector"
	| "interaction"
	| "structure"
	| "mask";

export type StyleProperty = `${StyleUtilityDomain}.${string}`;

export type StyleValue =
	| { kind: "none" }
	| { kind: "keyword"; value: string }
	| { kind: "scale"; value: string }
	| { kind: "arbitrary"; value: string }
	| { kind: "custom-property"; value: string };

export type StyleIntent = {
	kind: "style";
	domain: StyleUtilityDomain;
	property: StyleProperty;
	value: StyleValue;
	negative: boolean;
};

type StyleSpec = {
	domain: StyleUtilityDomain;
	property: string;
	value?: string;
};

type FunctionalStyleSpec = StyleSpec & {
	root: string;
	allowBare?: boolean;
};

const spec = (
	domain: StyleUtilityDomain,
	property: string,
	value?: string,
): StyleSpec => ({ domain, property, value });

const functional = (
	root: string,
	domain: StyleUtilityDomain,
	property: string,
	options: { allowBare?: boolean } = {},
): FunctionalStyleSpec => ({ root, domain, property, ...options });

const DISPLAY = [
	"block",
	"inline-block",
	"inline",
	"flex",
	"inline-flex",
	"grid",
	"inline-grid",
	"contents",
	"flow-root",
	"hidden",
	"table",
	"inline-table",
	"table-caption",
	"table-cell",
	"table-column",
	"table-column-group",
	"table-footer-group",
	"table-header-group",
	"table-row-group",
	"table-row",
	"list-item",
] as const;

const POSITION = ["static", "fixed", "absolute", "relative", "sticky"] as const;

const TEXT_ALIGN = ["left", "center", "right", "justify", "start", "end"];
const TEXT_WRAP = ["wrap", "nowrap", "balance", "pretty"];
const FONT_WEIGHT = [
	"thin",
	"extralight",
	"light",
	"normal",
	"medium",
	"semibold",
	"bold",
	"extrabold",
	"black",
];
const BORDER_STYLES = ["solid", "dashed", "dotted", "double", "hidden", "none"];
const OUTLINE_STYLES = [
	"solid",
	"dashed",
	"dotted",
	"double",
	"hidden",
	"none",
];

const STATIC_SPECS: ReadonlyMap<string, StyleSpec> = new Map([
	...DISPLAY.map((value) => [value, spec("layout", "display", value)] as const),
	...POSITION.map(
		(value) => [value, spec("position", "position", value)] as const,
	),
	["flex-row", spec("layout", "flex-direction", "row")],
	["flex-row-reverse", spec("layout", "flex-direction", "row-reverse")],
	["flex-col", spec("layout", "flex-direction", "col")],
	["flex-col-reverse", spec("layout", "flex-direction", "col-reverse")],
	["flex-nowrap", spec("layout", "flex-wrap", "nowrap")],
	["flex-wrap", spec("layout", "flex-wrap", "wrap")],
	["flex-wrap-reverse", spec("layout", "flex-wrap", "wrap-reverse")],
	["grow", spec("size", "grow", "1")],
	["grow-0", spec("size", "grow", "0")],
	["shrink", spec("size", "shrink", "1")],
	["shrink-0", spec("size", "shrink", "0")],
	["italic", spec("typography", "font-style", "italic")],
	["not-italic", spec("typography", "font-style", "not-italic")],
	["uppercase", spec("typography", "text-transform", "uppercase")],
	["lowercase", spec("typography", "text-transform", "lowercase")],
	["capitalize", spec("typography", "text-transform", "capitalize")],
	["normal-case", spec("typography", "text-transform", "normal-case")],
	["underline", spec("typography", "text-decoration-line", "underline")],
	["overline", spec("typography", "text-decoration-line", "overline")],
	["line-through", spec("typography", "text-decoration-line", "line-through")],
	["no-underline", spec("typography", "text-decoration-line", "none")],
	["truncate", spec("typography", "text-overflow", "truncate")],
	["text-ellipsis", spec("typography", "text-overflow", "ellipsis")],
	["text-clip", spec("typography", "text-overflow", "clip")],
	["border", spec("border", "border-width", "DEFAULT")],
	...BORDER_STYLES.map(
		(value) =>
			[`border-${value}`, spec("border", "border-style", value)] as const,
	),
	["rounded", spec("border", "radius", "DEFAULT")],
	["divide-x", spec("border", "divide-x-width", "DEFAULT")],
	["divide-y", spec("border", "divide-y-width", "DEFAULT")],
	["divide-x-reverse", spec("border", "divide-x-reverse", "reverse")],
	["divide-y-reverse", spec("border", "divide-y-reverse", "reverse")],
	["ring", spec("focus", "ring-width", "DEFAULT")],
	["ring-inset", spec("focus", "ring-inset", "inset")],
	["outline", spec("focus", "outline-width", "DEFAULT")],
	...OUTLINE_STYLES.map(
		(value) =>
			[`outline-${value}`, spec("focus", "outline-style", value)] as const,
	),
	["shadow", spec("effects", "shadow", "DEFAULT")],
	["inset-shadow", spec("effects", "inset-shadow", "DEFAULT")],
	["text-shadow", spec("effects", "text-shadow", "DEFAULT")],
	["blur", spec("effects", "blur", "DEFAULT")],
	["backdrop-blur", spec("effects", "backdrop-blur", "DEFAULT")],
	["filter", spec("effects", "filter", "filter")],
	["filter-none", spec("effects", "filter", "none")],
	["backdrop-filter", spec("effects", "backdrop-filter", "filter")],
	["backdrop-filter-none", spec("effects", "backdrop-filter", "none")],
	["transform", spec("transform", "transform-mode", "transform")],
	["transform-gpu", spec("transform", "transform-mode", "gpu")],
	["transform-cpu", spec("transform", "transform-mode", "cpu")],
	["transform-none", spec("transform", "transform-mode", "none")],
	["transition", spec("motion", "transition-property", "DEFAULT")],
	["transition-none", spec("motion", "transition-property", "none")],
	["transition-all", spec("motion", "transition-property", "all")],
	["transition-colors", spec("motion", "transition-property", "colors")],
	["transition-opacity", spec("motion", "transition-property", "opacity")],
	["transition-shadow", spec("motion", "transition-property", "shadow")],
	["transition-transform", spec("motion", "transition-property", "transform")],
	["fill-none", spec("vector", "fill", "none")],
	["stroke-none", spec("vector", "stroke", "none")],
	["pointer-events-none", spec("interaction", "pointer-events", "none")],
	["pointer-events-auto", spec("interaction", "pointer-events", "auto")],
	["select-none", spec("interaction", "user-select", "none")],
	["select-text", spec("interaction", "user-select", "text")],
	["select-all", spec("interaction", "user-select", "all")],
	["select-auto", spec("interaction", "user-select", "auto")],
	["resize", spec("interaction", "resize", "both")],
	["resize-none", spec("interaction", "resize", "none")],
	["resize-x", spec("interaction", "resize", "x")],
	["resize-y", spec("interaction", "resize", "y")],
	["appearance-none", spec("interaction", "appearance", "none")],
	["appearance-auto", spec("interaction", "appearance", "auto")],
	["scroll-auto", spec("interaction", "scroll-behavior", "auto")],
	["scroll-smooth", spec("interaction", "scroll-behavior", "smooth")],
	["snap-none", spec("interaction", "scroll-snap-type", "none")],
	["snap-x", spec("interaction", "scroll-snap-axis", "x")],
	["snap-y", spec("interaction", "scroll-snap-axis", "y")],
	["snap-both", spec("interaction", "scroll-snap-axis", "both")],
	[
		"snap-mandatory",
		spec("interaction", "scroll-snap-strictness", "mandatory"),
	],
	[
		"snap-proximity",
		spec("interaction", "scroll-snap-strictness", "proximity"),
	],
	["snap-start", spec("interaction", "scroll-snap-align", "start")],
	["snap-end", spec("interaction", "scroll-snap-align", "end")],
	["snap-center", spec("interaction", "scroll-snap-align", "center")],
	["snap-align-none", spec("interaction", "scroll-snap-align", "none")],
	["snap-normal", spec("interaction", "scroll-snap-stop", "normal")],
	["snap-always", spec("interaction", "scroll-snap-stop", "always")],
	["box-border", spec("structure", "box-sizing", "border")],
	["box-content", spec("structure", "box-sizing", "content")],
	["box-decoration-slice", spec("structure", "box-decoration-break", "slice")],
	["box-decoration-clone", spec("structure", "box-decoration-break", "clone")],
	["visible", spec("structure", "visibility", "visible")],
	["invisible", spec("structure", "visibility", "invisible")],
	["collapse", spec("structure", "visibility", "collapse")],
	["list-none", spec("structure", "list-style-type", "none")],
	["list-disc", spec("structure", "list-style-type", "disc")],
	["list-decimal", spec("structure", "list-style-type", "decimal")],
	["list-inside", spec("structure", "list-style-position", "inside")],
	["list-outside", spec("structure", "list-style-position", "outside")],
	["table-auto", spec("structure", "table-layout", "auto")],
	["table-fixed", spec("structure", "table-layout", "fixed")],
	["border-collapse", spec("structure", "border-collapse", "collapse")],
	["border-separate", spec("structure", "border-collapse", "separate")],
	["isolate", spec("position", "isolation", "isolate")],
	["isolation-auto", spec("position", "isolation", "auto")],
	["mask-none", spec("mask", "mask-image", "none")],
	["mask-alpha", spec("mask", "mask-mode", "alpha")],
	["mask-luminance", spec("mask", "mask-mode", "luminance")],
]);

const FUNCTIONAL_SPECS: readonly FunctionalStyleSpec[] = [
	functional("items", "layout", "align-items"),
	functional("justify", "layout", "justify-content"),
	functional("place-items", "layout", "place-items"),
	functional("place-content", "layout", "place-content"),
	functional("place-self", "layout", "place-self"),
	functional("self", "layout", "align-self"),
	functional("overflow-x", "layout", "overflow-x"),
	functional("overflow-y", "layout", "overflow-y"),
	functional("overflow", "layout", "overflow"),
	functional("grid-cols", "layout", "grid-template-columns"),
	functional("grid-rows", "layout", "grid-template-rows"),
	functional("grid-flow", "layout", "grid-auto-flow"),
	functional("auto-cols", "layout", "grid-auto-columns"),
	functional("auto-rows", "layout", "grid-auto-rows"),
	functional("col-span", "layout", "grid-column-span"),
	functional("col-start", "layout", "grid-column-start"),
	functional("col-end", "layout", "grid-column-end"),
	functional("row-span", "layout", "grid-row-span"),
	functional("row-start", "layout", "grid-row-start"),
	functional("row-end", "layout", "grid-row-end"),
	functional("order", "layout", "order"),
	functional("w", "size", "width"),
	functional("h", "size", "height"),
	functional("size", "size", "size"),
	functional("min-w", "size", "min-width"),
	functional("max-w", "size", "max-width"),
	functional("min-h", "size", "min-height"),
	functional("max-h", "size", "max-height"),
	functional("aspect", "size", "aspect-ratio"),
	functional("basis", "size", "flex-basis"),
	functional("flex", "size", "flex"),
	functional("grow", "size", "grow", { allowBare: true }),
	functional("shrink", "size", "shrink", { allowBare: true }),
	functional("font", "typography", "font"),
	functional("text", "typography", "text"),
	functional("leading", "typography", "line-height"),
	functional("tracking", "typography", "letter-spacing"),
	functional("decoration", "typography", "text-decoration"),
	functional("decoration-from-font", "typography", "text-decoration-thickness"),
	functional("underline-offset", "typography", "underline-offset"),
	functional("line-clamp", "typography", "line-clamp"),
	functional("whitespace", "typography", "white-space"),
	functional("break", "typography", "word-break"),
	functional("wrap", "typography", "text-wrap"),
	functional("hyphens", "typography", "hyphens"),
	functional("border-spacing-x", "structure", "border-spacing-x"),
	functional("border-spacing-y", "structure", "border-spacing-y"),
	functional("border-spacing", "structure", "border-spacing"),
	functional("border-x", "border", "border-x-width", { allowBare: true }),
	functional("border-y", "border", "border-y-width", { allowBare: true }),
	functional("border-s", "border", "border-start-width", { allowBare: true }),
	functional("border-e", "border", "border-end-width", { allowBare: true }),
	functional("border-t", "border", "border-top-width", { allowBare: true }),
	functional("border-r", "border", "border-right-width", { allowBare: true }),
	functional("border-b", "border", "border-bottom-width", { allowBare: true }),
	functional("border-l", "border", "border-left-width", { allowBare: true }),
	functional("border", "border", "border-width", { allowBare: true }),
	functional("rounded-tl", "border", "radius-top-left"),
	functional("rounded-tr", "border", "radius-top-right"),
	functional("rounded-br", "border", "radius-bottom-right"),
	functional("rounded-bl", "border", "radius-bottom-left"),
	functional("rounded-t", "border", "radius-top"),
	functional("rounded-r", "border", "radius-right"),
	functional("rounded-b", "border", "radius-bottom"),
	functional("rounded-l", "border", "radius-left"),
	functional("rounded-s", "border", "radius-start"),
	functional("rounded-e", "border", "radius-end"),
	functional("rounded", "border", "radius", { allowBare: true }),
	functional("divide-x", "border", "divide-x-width", { allowBare: true }),
	functional("divide-y", "border", "divide-y-width", { allowBare: true }),
	functional("divide", "border", "divide-style"),
	functional("bg-linear", "background", "background-gradient"),
	functional("bg-radial", "background", "background-gradient", {
		allowBare: true,
	}),
	functional("bg-conic", "background", "background-gradient", {
		allowBare: true,
	}),
	functional("bg-origin", "background", "background-origin"),
	functional("bg-clip", "background", "background-clip"),
	functional("bg-blend", "background", "background-blend-mode"),
	functional("bg", "background", "background"),
	functional("from", "background", "gradient-from-position"),
	functional("via", "background", "gradient-via-position"),
	functional("to", "background", "gradient-to-position"),
	functional("ring-offset", "focus", "ring-offset"),
	functional("ring", "focus", "ring-width", { allowBare: true }),
	functional("outline-offset", "focus", "outline-offset"),
	functional("outline", "focus", "outline-width", { allowBare: true }),
	functional("opacity", "effects", "opacity"),
	functional("shadow", "effects", "shadow", { allowBare: true }),
	functional("inset-shadow", "effects", "inset-shadow", { allowBare: true }),
	functional("drop-shadow", "effects", "drop-shadow"),
	functional("text-shadow", "effects", "text-shadow"),
	functional("blur", "effects", "blur", { allowBare: true }),
	functional("backdrop-blur", "effects", "backdrop-blur", { allowBare: true }),
	functional("mix-blend", "effects", "mix-blend-mode"),
	functional("brightness", "effects", "brightness"),
	functional("contrast", "effects", "contrast"),
	functional("grayscale", "effects", "grayscale", { allowBare: true }),
	functional("hue-rotate", "effects", "hue-rotate"),
	functional("invert", "effects", "invert", { allowBare: true }),
	functional("saturate", "effects", "saturate"),
	functional("sepia", "effects", "sepia", { allowBare: true }),
	functional("inset-x", "position", "inset-x"),
	functional("inset-y", "position", "inset-y"),
	functional("inset", "position", "inset"),
	functional("top", "position", "top"),
	functional("right", "position", "right"),
	functional("bottom", "position", "bottom"),
	functional("left", "position", "left"),
	functional("start", "position", "inset-inline-start"),
	functional("end", "position", "inset-inline-end"),
	functional("z", "position", "z-index"),
	functional("object", "position", "object"),
	functional("translate-x", "transform", "translate-x"),
	functional("translate-y", "transform", "translate-y"),
	functional("translate-z", "transform", "translate-z"),
	functional("translate", "transform", "translate"),
	functional("rotate-x", "transform", "rotate-x"),
	functional("rotate-y", "transform", "rotate-y"),
	functional("rotate-z", "transform", "rotate-z"),
	functional("rotate", "transform", "rotate"),
	functional("scale-x", "transform", "scale-x"),
	functional("scale-y", "transform", "scale-y"),
	functional("scale-z", "transform", "scale-z"),
	functional("scale", "transform", "scale"),
	functional("skew-x", "transform", "skew-x"),
	functional("skew-y", "transform", "skew-y"),
	functional("skew", "transform", "skew"),
	functional("origin", "transform", "transform-origin"),
	functional("perspective-origin", "transform", "perspective-origin"),
	functional("perspective", "transform", "perspective"),
	functional("duration", "motion", "duration"),
	functional("delay", "motion", "delay"),
	functional("ease", "motion", "easing"),
	functional("animate", "motion", "animation"),
	functional("stroke", "vector", "stroke-width"),
	functional("cursor", "interaction", "cursor"),
	functional("accent", "interaction", "accent"),
	functional("caret", "interaction", "caret"),
	functional("scroll-mx", "interaction", "scroll-margin-x"),
	functional("scroll-my", "interaction", "scroll-margin-y"),
	functional("scroll-ms", "interaction", "scroll-margin-start"),
	functional("scroll-me", "interaction", "scroll-margin-end"),
	functional("scroll-mt", "interaction", "scroll-margin-top"),
	functional("scroll-mr", "interaction", "scroll-margin-right"),
	functional("scroll-mb", "interaction", "scroll-margin-bottom"),
	functional("scroll-ml", "interaction", "scroll-margin-left"),
	functional("scroll-m", "interaction", "scroll-margin"),
	functional("scroll-px", "interaction", "scroll-padding-x"),
	functional("scroll-py", "interaction", "scroll-padding-y"),
	functional("scroll-ps", "interaction", "scroll-padding-start"),
	functional("scroll-pe", "interaction", "scroll-padding-end"),
	functional("scroll-pt", "interaction", "scroll-padding-top"),
	functional("scroll-pr", "interaction", "scroll-padding-right"),
	functional("scroll-pb", "interaction", "scroll-padding-bottom"),
	functional("scroll-pl", "interaction", "scroll-padding-left"),
	functional("scroll-p", "interaction", "scroll-padding"),
	functional("touch", "interaction", "touch-action"),
	functional("will-change", "interaction", "will-change"),
	functional("float", "structure", "float"),
	functional("clear", "structure", "clear"),
	functional("columns", "structure", "columns"),
	functional("break-before", "structure", "break-before"),
	functional("break-after", "structure", "break-after"),
	functional("break-inside", "structure", "break-inside"),
	functional("list-image", "structure", "list-image"),
	functional("caption", "structure", "caption-side"),
	functional("mask-linear-from", "mask", "mask-linear-from"),
	functional("mask-linear-to", "mask", "mask-linear-to"),
	functional("mask-linear", "mask", "mask-linear"),
	functional("mask-radial-from", "mask", "mask-radial-from"),
	functional("mask-radial-to", "mask", "mask-radial-to"),
	functional("mask-radial-at", "mask", "mask-radial-position"),
	functional("mask-radial", "mask", "mask-radial"),
	functional("mask-conic-from", "mask", "mask-conic-from"),
	functional("mask-conic-to", "mask", "mask-conic-to"),
	functional("mask-conic", "mask", "mask-conic"),
	functional("mask-origin", "mask", "mask-origin"),
	functional("mask-clip", "mask", "mask-clip"),
	functional("mask-composite", "mask", "mask-composite"),
	functional("mask-position", "mask", "mask-position"),
	functional("mask-size", "mask", "mask-size"),
	functional("mask-repeat", "mask", "mask-repeat"),
	functional("mask", "mask", "mask"),
].sort((left, right) => right.root.length - left.root.length);

export function classifyStyleParsedClass(
	parsed: ParsedClass,
): StyleIntent | null {
	if (parsed.prefix === "" && parsed.arbitrary) {
		return null;
	}

	const staticSpec = STATIC_SPECS.get(parsed.utility);
	if (staticSpec) {
		return intentFromSpec(staticSpec, staticSpec.value ?? null, parsed);
	}

	if (
		parsed.prefix === "font" &&
		parsed.value &&
		FONT_WEIGHT.includes(parsed.value)
	) {
		return intentFromSpec(
			spec("typography", "font-weight", parsed.value),
			parsed.value,
			parsed,
		);
	}

	if (parsed.utility.startsWith("text-shadow-")) {
		return intentFromSpec(
			spec("effects", "text-shadow"),
			parsed.utility.slice("text-shadow-".length),
			parsed,
		);
	}

	if (parsed.prefix === "text" && parsed.value) {
		if (TEXT_ALIGN.includes(parsed.value)) {
			return intentFromSpec(
				spec("typography", "text-align", parsed.value),
				parsed.value,
				parsed,
			);
		}
		if (TEXT_WRAP.includes(parsed.value)) {
			return intentFromSpec(
				spec("typography", "text-wrap", parsed.value),
				parsed.value,
				parsed,
			);
		}
		return intentFromSpec(
			spec("typography", "font-size", parsed.value),
			parsed.value,
			parsed,
		);
	}

	if (parsed.prefix === "content" && parsed.value) {
		if (parsed.arbitrary || parsed.value.startsWith("(")) {
			return intentFromSpec(
				spec("structure", "content", parsed.value),
				parsed.value,
				parsed,
			);
		}
		return intentFromSpec(
			spec("layout", "align-content", parsed.value),
			parsed.value,
			parsed,
		);
	}

	if (parsed.prefix === "object" && parsed.value) {
		const property = [
			"contain",
			"cover",
			"fill",
			"none",
			"scale-down",
		].includes(parsed.value)
			? "object-fit"
			: "object-position";
		return intentFromSpec(
			spec("position", property, parsed.value),
			parsed.value,
			parsed,
		);
	}

	if (parsed.prefix === "bg" && parsed.value) {
		const property = classifyBackgroundProperty(parsed.value);
		if (property) {
			return intentFromSpec(
				spec("background", property, parsed.value),
				parsed.value,
				parsed,
			);
		}
	}

	if (parsed.prefix === "mask" && parsed.value) {
		const property = classifyMaskProperty(parsed.value);
		return intentFromSpec(
			spec("mask", property, parsed.value),
			parsed.value,
			parsed,
		);
	}

	for (const functionalSpec of FUNCTIONAL_SPECS) {
		const value = getFunctionalValue(parsed.utility, functionalSpec);
		if (value !== undefined) {
			return intentFromSpec(functionalSpec, value, parsed);
		}
	}

	return null;
}

function classifyBackgroundProperty(value: string): string | null {
	if (["auto", "cover", "contain"].includes(value)) return "background-size";
	if (
		[
			"repeat",
			"no-repeat",
			"repeat-x",
			"repeat-y",
			"repeat-round",
			"repeat-space",
		].includes(value)
	)
		return "background-repeat";
	if (["fixed", "local", "scroll"].includes(value))
		return "background-attachment";
	if (
		[
			"bottom",
			"center",
			"left",
			"right",
			"top",
			"left-bottom",
			"left-top",
			"right-bottom",
			"right-top",
		].includes(value)
	)
		return "background-position";
	if (value.startsWith("origin-")) return "background-origin";
	if (value.startsWith("clip-")) return "background-clip";
	if (value.startsWith("blend-")) return "background-blend-mode";
	if (value.startsWith("linear-") || value === "radial" || value === "conic")
		return "background-gradient";
	if (value.startsWith("[") || value.startsWith("(")) return "background-image";
	return null;
}

function classifyMaskProperty(value: string): string {
	if (["alpha", "luminance"].includes(value)) return "mask-mode";
	if (["center", "top", "bottom", "left", "right"].includes(value))
		return "mask-position";
	if (["auto", "cover", "contain"].includes(value)) return "mask-size";
	if (value.startsWith("origin-")) return "mask-origin";
	if (value.startsWith("clip-")) return "mask-clip";
	if (["add", "subtract", "intersect", "exclude"].includes(value))
		return "mask-composite";
	if (value.includes("repeat")) return "mask-repeat";
	if (
		value.startsWith("linear") ||
		value.startsWith("radial") ||
		value.startsWith("conic")
	)
		return "mask-image";
	return "mask";
}

function getFunctionalValue(
	utility: string,
	spec: FunctionalStyleSpec,
): string | null | undefined {
	if (utility === spec.root) {
		return spec.allowBare ? null : undefined;
	}

	const head = `${spec.root}-`;
	if (!utility.startsWith(head)) {
		return undefined;
	}

	return utility.slice(head.length);
}

function intentFromSpec(
	styleSpec: StyleSpec,
	rawValue: string | null,
	parsed: ParsedClass,
): StyleIntent {
	const value = parseStyleValue(rawValue);
	return {
		kind: "style",
		domain: styleSpec.domain,
		property: `${styleSpec.domain}.${styleSpec.property}`,
		value,
		negative: parsed.negative,
	};
}

function parseStyleValue(rawValue: string | null): StyleValue {
	if (rawValue === null || rawValue.length === 0) {
		return { kind: "none" };
	}

	if (rawValue.startsWith("[") && rawValue.endsWith("]")) {
		return { kind: "arbitrary", value: rawValue };
	}

	if (rawValue.startsWith("(") && rawValue.endsWith(")")) {
		return { kind: "custom-property", value: rawValue };
	}

	if (/^-?\d+(\.\d+)?(\/\d+(\.\d+)?)?%?$/.test(rawValue)) {
		return { kind: "scale", value: rawValue };
	}

	return { kind: "keyword", value: rawValue };
}
