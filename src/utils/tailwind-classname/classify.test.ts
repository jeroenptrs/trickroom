import { describe, expect, it } from "vitest";
import { classifyParsedClass } from "./classify";
import { parseClassName } from "./parse";

const TOKEN_SET = new Set([
	"red-500",
	"blue-500",
	"blue-600",
	"slate-200",
	"brand-primary",
	"gray-50",
]);

function classify(input: string, tokens: ReadonlySet<string> = TOKEN_SET) {
	const [parsed] = parseClassName(input);
	return classifyParsedClass(parsed, { colorTokens: tokens });
}

describe("classifyParsedClass — color recognition", () => {
	it("classifies bg-{color} as background color", () => {
		expect(classify("bg-blue-500")).toEqual({
			kind: "color",
			property: "background",
			token: "blue-500",
			arbitraryValue: null,
			keyword: null,
			resolved: true,
		});
	});

	it("classifies text-{color} as text color", () => {
		expect(classify("text-red-500")).toMatchObject({
			kind: "color",
			property: "text",
			token: "red-500",
			resolved: true,
		});
	});

	it("classifies border-{color} as border color", () => {
		expect(classify("border-slate-200")).toMatchObject({
			kind: "color",
			property: "border",
			token: "slate-200",
			resolved: true,
		});
	});

	it("classifies border-{side}-{color} keeping the color property", () => {
		expect(classify("border-t-blue-500")).toMatchObject({
			kind: "color",
			property: "border",
			token: "blue-500",
			resolved: true,
		});
	});

	it("classifies custom theme tokens like brand-primary", () => {
		expect(classify("bg-brand-primary")).toMatchObject({
			kind: "color",
			property: "background",
			token: "brand-primary",
			resolved: true,
		});
	});
});

describe("classifyParsedClass — non-color style siblings", () => {
	it("classifies text-{size}", () => {
		expect(classify("text-sm")).toMatchObject({
			kind: "style",
			domain: "typography",
			property: "typography.font-size",
		});
		expect(classify("text-2xl")).toMatchObject({
			kind: "style",
			property: "typography.font-size",
		});
	});

	it("classifies text alignment", () => {
		expect(classify("text-center")).toMatchObject({
			kind: "style",
			property: "typography.text-align",
		});
	});

	it("classifies text wrap / overflow", () => {
		expect(classify("text-balance")).toMatchObject({
			kind: "style",
			property: "typography.text-wrap",
		});
		expect(classify("text-ellipsis")).toMatchObject({
			kind: "style",
			property: "typography.text-overflow",
		});
	});

	it("classifies border widths, styles, and table border collapse", () => {
		expect(classify("border-2")).toMatchObject({
			kind: "style",
			property: "border.border-width",
		});
		expect(classify("border-solid")).toMatchObject({
			kind: "style",
			property: "border.border-style",
		});
		expect(classify("border-collapse")).toMatchObject({
			kind: "style",
			property: "structure.border-collapse",
		});
	});

	it("classifies bare `border`", () => {
		expect(classify("border")).toMatchObject({
			kind: "style",
			property: "border.border-width",
		});
	});

	it("classifies bg backgrounds that aren't colors", () => {
		expect(classify("bg-cover")).toMatchObject({
			kind: "style",
			property: "background.background-size",
		});
		expect(classify("bg-no-repeat")).toMatchObject({
			kind: "style",
			property: "background.background-repeat",
		});
		expect(classify("bg-fixed")).toMatchObject({
			kind: "style",
			property: "background.background-attachment",
		});
		expect(classify("bg-blend-multiply")).toMatchObject({
			kind: "style",
			property: "background.background-blend-mode",
		});
		expect(classify("bg-radial")).toMatchObject({
			kind: "style",
			property: "background.background-gradient",
		});
		expect(classify("bg-conic")).toMatchObject({
			kind: "style",
			property: "background.background-gradient",
		});
		expect(classify("bg-linear-to-r")).toMatchObject({
			kind: "style",
			property: "background.background-gradient",
		});
	});

	it("classifies ring widths and bare ring", () => {
		expect(classify("ring")).toMatchObject({
			kind: "style",
			property: "focus.ring-width",
		});
		expect(classify("ring-2")).toMatchObject({
			kind: "style",
			property: "focus.ring-width",
		});
		expect(classify("ring-inset")).toMatchObject({
			kind: "style",
			property: "focus.ring-inset",
		});
	});

	it("classifies ring offset widths separately from ring offset colors", () => {
		expect(classify("ring-offset-2")).toMatchObject({
			kind: "style",
			property: "focus.ring-offset",
		});
		expect(classify("ring-offset-blue-500")).toMatchObject({
			kind: "color",
			property: "ring-offset",
			token: "blue-500",
			resolved: true,
		});
		expect(classify("ring-offset-[oklch(50%_0.1_0)]")).toMatchObject({
			kind: "color",
			property: "ring-offset",
			arbitraryValue: "[oklch(50%_0.1_0)]",
		});
	});

	it("classifies outline widths and styles", () => {
		expect(classify("outline")).toMatchObject({
			kind: "style",
			property: "focus.outline-width",
		});
		expect(classify("outline-2")).toMatchObject({
			kind: "style",
			property: "focus.outline-width",
		});
		expect(classify("outline-dashed")).toMatchObject({
			kind: "style",
			property: "focus.outline-style",
		});
	});

	it("classifies shadow sizes and bare shadow", () => {
		expect(classify("shadow")).toMatchObject({
			kind: "style",
			property: "effects.shadow",
		});
		expect(classify("shadow-lg")).toMatchObject({
			kind: "style",
			property: "effects.shadow",
		});
		expect(classify("shadow-none")).toMatchObject({
			kind: "style",
			property: "effects.shadow",
		});
	});

	it("classifies text-shadow sizes separately from text-shadow colors", () => {
		expect(classify("text-shadow")).toMatchObject({
			kind: "style",
			property: "effects.text-shadow",
		});
		expect(classify("text-shadow-sm")).toMatchObject({
			kind: "style",
			property: "effects.text-shadow",
		});
		expect(classify("text-shadow-none")).toMatchObject({
			kind: "style",
			property: "effects.text-shadow",
		});
		expect(classify("text-shadow-blue-500")).toMatchObject({
			kind: "color",
			property: "text-shadow",
			token: "blue-500",
			resolved: true,
		});
		expect(classify("text-shadow-[0_1px_2px_red]")).toMatchObject({
			kind: "style",
			property: "effects.text-shadow",
		});
	});

	it("classifies divide-x / divide-y / divide widths", () => {
		expect(classify("divide-x")).toMatchObject({
			kind: "style",
			property: "border.divide-x-width",
		});
		expect(classify("divide-y-2")).toMatchObject({
			kind: "style",
			property: "border.divide-y-width",
		});
		expect(classify("divide-solid")).toMatchObject({
			kind: "style",
			property: "border.divide-style",
		});
		expect(classify("divide-x-reverse")).toMatchObject({
			kind: "style",
			property: "border.divide-x-reverse",
		});
		expect(classify("divide-y-reverse")).toMatchObject({
			kind: "style",
			property: "border.divide-y-reverse",
		});
	});

	it("classifies gradient stop percentages", () => {
		expect(classify("from-50%")).toMatchObject({
			kind: "style",
			property: "background.gradient-from-position",
		});
		expect(classify("via-25%")).toMatchObject({
			kind: "style",
			property: "background.gradient-via-position",
		});
	});

	it("classifies divide-{color} and shadow-{color} as colors", () => {
		expect(classify("divide-blue-500")).toMatchObject({
			kind: "color",
			property: "divide",
			token: "blue-500",
			resolved: true,
		});
		expect(classify("shadow-red-500")).toMatchObject({
			kind: "color",
			property: "shadow",
			token: "red-500",
			resolved: true,
		});
	});

	it("classifies multi-segment color prefixes like inset-shadow", () => {
		expect(classify("inset-shadow-slate-200")).toMatchObject({
			kind: "color",
			property: "inset-shadow",
			token: "slate-200",
			resolved: true,
		});
		expect(classify("focus:inset-shadow-blue-500")).toMatchObject({
			kind: "color",
			property: "inset-shadow",
			token: "blue-500",
			resolved: true,
		});
	});

	it("classifies arbitrary colors for multi-segment color prefixes", () => {
		expect(classify("inset-shadow-[#abc]")).toMatchObject({
			kind: "color",
			property: "inset-shadow",
			token: null,
			arbitraryValue: "[#abc]",
			resolved: true,
		});
		expect(classify("focus:inset-shadow-[oklch(50%_0.1_0)]")).toMatchObject({
			kind: "color",
			property: "inset-shadow",
			token: null,
			arbitraryValue: "[oklch(50%_0.1_0)]",
			resolved: true,
		});
	});

	it("classifies non-color inset-shadow utilities", () => {
		expect(classify("inset-shadow")).toMatchObject({
			kind: "style",
			property: "effects.inset-shadow",
		});
		expect(classify("inset-shadow-sm")).toMatchObject({
			kind: "style",
			property: "effects.inset-shadow",
		});
		expect(classify("inset-shadow-inner")).toMatchObject({
			kind: "style",
			property: "effects.inset-shadow",
		});
		expect(classify("inset-shadow-none")).toMatchObject({
			kind: "style",
			property: "effects.inset-shadow",
		});
	});

	it("classifies non-color arbitrary inset-shadow values", () => {
		expect(classify("inset-shadow-[0_0_0_1px]")).toMatchObject({
			kind: "style",
			property: "effects.inset-shadow",
		});
	});
});

describe("classifyParsedClass — universal keywords", () => {
	it("classifies bg-current / bg-transparent / bg-inherit", () => {
		for (const keyword of ["current", "transparent", "inherit"] as const) {
			expect(classify(`bg-${keyword}`)).toMatchObject({
				kind: "color",
				property: "background",
				token: null,
				keyword,
				resolved: true,
			});
		}
	});

	it("treats `black` and `white` as regular tokens (not universal keywords)", () => {
		// They live in the `--color-*` namespace as `--color-black` /
		// `--color-white`. Their resolution depends on the active token
		// set, just like `red-500`.
		const tokens = new Set(["black", "white"]);
		expect(classify("text-black", tokens)).toMatchObject({
			kind: "color",
			property: "text",
			token: "black",
			keyword: null,
			resolved: true,
		});
		expect(classify("bg-white", tokens)).toMatchObject({
			kind: "color",
			property: "background",
			token: "white",
			keyword: null,
			resolved: true,
		});
		// And when the user has removed them via `@theme { --color-black: initial }`
		// they should surface as stale.
		expect(classify("bg-black", new Set())).toMatchObject({
			kind: "color",
			token: "black",
			resolved: false,
		});
	});
});

describe("classifyParsedClass — stale tokens", () => {
	it("returns resolved=false for color-shaped values not in the token set", () => {
		expect(classify("bg-rose-999")).toMatchObject({
			kind: "color",
			property: "background",
			token: "rose-999",
			resolved: false,
		});
	});

	it("returns resolved=false for stale border tokens with sides", () => {
		expect(classify("border-x-emerald-12345")).toMatchObject({
			kind: "color",
			property: "border",
			token: "emerald-12345",
			resolved: false,
		});
	});

	it("respects the active token set", () => {
		const limited = new Set(["mint-500"]);
		expect(classify("bg-mint-500", limited)).toMatchObject({
			kind: "color",
			resolved: true,
		});
		expect(classify("bg-blue-500", limited)).toMatchObject({
			kind: "color",
			resolved: false,
		});
	});
});

describe("classifyParsedClass — arbitrary values", () => {
	it("classifies bg-[#abc] as a color", () => {
		expect(classify("bg-[#abc]")).toEqual({
			kind: "color",
			property: "background",
			token: null,
			arbitraryValue: "[#abc]",
			keyword: null,
			resolved: true,
		});
	});

	it("classifies arbitrary CSS color functions", () => {
		expect(classify("bg-[rgb(0,0,0)]")).toMatchObject({
			kind: "color",
			arbitraryValue: "[rgb(0,0,0)]",
			resolved: true,
		});
		expect(classify("text-[oklch(50%_0.1_0)]")).toMatchObject({
			kind: "color",
			property: "text",
			arbitraryValue: "[oklch(50%_0.1_0)]",
		});
	});

	it("classifies arbitrary var(...) as color", () => {
		expect(classify("bg-[var(--brand)]")).toMatchObject({
			kind: "color",
			property: "background",
			arbitraryValue: "[var(--brand)]",
		});
	});

	it("classifies arbitrary values that don't look like colors when a style domain owns them", () => {
		expect(classify("bg-[url(/x.png)]")).toMatchObject({
			kind: "style",
			property: "background.background-image",
		});
		expect(classify("text-[16px]")).toMatchObject({
			kind: "style",
			property: "typography.font-size",
		});
		expect(classify("content-['hi']")).toMatchObject({
			kind: "style",
			property: "structure.content",
		});
	});

	it("returns unknown for fully arbitrary utilities", () => {
		expect(classify("[mask:linear-gradient(red,blue)]")).toEqual({
			kind: "unknown",
		});
	});
});

describe("classifyParsedClass — unknown prefixes", () => {
	it("returns unknown only for utilities outside the modeled domains", () => {
		expect(classify("flex")).toMatchObject({
			kind: "style",
			property: "layout.display",
		});
		expect(classify("rounded-lg")).toMatchObject({
			kind: "style",
			property: "border.radius",
		});
		expect(classify("custom-thing")).toEqual({ kind: "unknown" });
	});
});

describe("classifyParsedClass — spacing recognition", () => {
	it("classifies padding utilities by axis", () => {
		expect(classify("p-4")).toEqual({
			kind: "spacing",
			property: "padding",
			value: { kind: "scale", value: "4" },
			negative: false,
		});
		expect(classify("px-2")).toMatchObject({
			kind: "spacing",
			property: "padding-x",
			value: { kind: "scale", value: "2" },
		});
		expect(classify("pt-[13px]")).toMatchObject({
			kind: "spacing",
			property: "padding-top",
			value: { kind: "arbitrary", value: "[13px]" },
		});
		expect(classify("pl-(--space-card)")).toMatchObject({
			kind: "spacing",
			property: "padding-left",
			value: { kind: "custom-property", value: "(--space-card)" },
		});
	});

	it("classifies margin utilities including auto and negative values", () => {
		expect(classify("m-auto")).toMatchObject({
			kind: "spacing",
			property: "margin",
			value: { kind: "keyword", keyword: "auto" },
		});
		expect(classify("mx-auto")).toMatchObject({
			kind: "spacing",
			property: "margin-x",
			value: { kind: "keyword", keyword: "auto" },
		});
		expect(classify("-mt-4")).toEqual({
			kind: "spacing",
			property: "margin-top",
			value: { kind: "scale", value: "4" },
			negative: true,
		});
	});

	it("classifies gap utilities by axis", () => {
		expect(classify("gap-4")).toMatchObject({
			kind: "spacing",
			property: "gap",
			value: { kind: "scale", value: "4" },
		});
		expect(classify("gap-x-2")).toMatchObject({
			kind: "spacing",
			property: "gap-x",
			value: { kind: "scale", value: "2" },
		});
		expect(classify("gap-y-[1.5rem]")).toMatchObject({
			kind: "spacing",
			property: "gap-y",
			value: { kind: "arbitrary", value: "[1.5rem]" },
		});
	});

	it("does not classify invalid spacing shapes", () => {
		expect(classify("-p-4")).toEqual({ kind: "unknown" });
		expect(classify("p-auto")).toEqual({ kind: "unknown" });
		expect(classify("gap-auto")).toEqual({ kind: "unknown" });
		expect(classify("gap-x")).toEqual({ kind: "unknown" });
	});
});

describe("classifyParsedClass — preserves classification through variants/modes", () => {
	it("classifies hover:bg-blue-500 as background color", () => {
		expect(classify("hover:bg-blue-500")).toMatchObject({
			kind: "color",
			property: "background",
			token: "blue-500",
			resolved: true,
		});
	});

	it("classifies dark:hover:!bg-red-500 as background color (v4 important suffix)", () => {
		expect(classify("dark:hover:bg-red-500!")).toMatchObject({
			kind: "color",
			property: "background",
			token: "red-500",
			resolved: true,
		});
	});
});
