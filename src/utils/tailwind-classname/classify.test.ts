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

describe("classifyParsedClass — disambiguation against non-color siblings", () => {
	it("returns unknown for text-{size}", () => {
		expect(classify("text-sm")).toEqual({ kind: "unknown" });
		expect(classify("text-2xl")).toEqual({ kind: "unknown" });
	});

	it("returns unknown for text alignment", () => {
		expect(classify("text-center")).toEqual({ kind: "unknown" });
	});

	it("returns unknown for text wrap / overflow", () => {
		expect(classify("text-balance")).toEqual({ kind: "unknown" });
		expect(classify("text-ellipsis")).toEqual({ kind: "unknown" });
	});

	it("returns unknown for border widths and styles", () => {
		expect(classify("border-2")).toEqual({ kind: "unknown" });
		expect(classify("border-solid")).toEqual({ kind: "unknown" });
		expect(classify("border-collapse")).toEqual({ kind: "unknown" });
	});

	it("returns unknown for bare `border`", () => {
		expect(classify("border")).toEqual({ kind: "unknown" });
	});

	it("returns unknown for bg backgrounds that aren't colors", () => {
		expect(classify("bg-cover")).toEqual({ kind: "unknown" });
		expect(classify("bg-no-repeat")).toEqual({ kind: "unknown" });
		expect(classify("bg-fixed")).toEqual({ kind: "unknown" });
		expect(classify("bg-blend-multiply")).toEqual({ kind: "unknown" });
	});

	it("returns unknown for ring widths and bare ring", () => {
		expect(classify("ring")).toEqual({ kind: "unknown" });
		expect(classify("ring-2")).toEqual({ kind: "unknown" });
		expect(classify("ring-inset")).toEqual({ kind: "unknown" });
	});

	it("returns unknown for outline widths and styles", () => {
		expect(classify("outline")).toEqual({ kind: "unknown" });
		expect(classify("outline-2")).toEqual({ kind: "unknown" });
		expect(classify("outline-dashed")).toEqual({ kind: "unknown" });
	});

	it("returns unknown for shadow sizes and bare shadow", () => {
		expect(classify("shadow")).toEqual({ kind: "unknown" });
		expect(classify("shadow-lg")).toEqual({ kind: "unknown" });
		expect(classify("shadow-none")).toEqual({ kind: "unknown" });
	});

	it("returns unknown for divide-x / divide-y / divide widths", () => {
		expect(classify("divide-x")).toEqual({ kind: "unknown" });
		expect(classify("divide-y-2")).toEqual({ kind: "unknown" });
		expect(classify("divide-solid")).toEqual({ kind: "unknown" });
	});

	it("returns unknown for gradient stop percentages", () => {
		expect(classify("from-50%")).toEqual({ kind: "unknown" });
		expect(classify("via-25%")).toEqual({ kind: "unknown" });
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

	it("returns unknown for arbitrary values that don't look like colors", () => {
		expect(classify("bg-[url(/x.png)]")).toEqual({ kind: "unknown" });
		expect(classify("text-[16px]")).toEqual({ kind: "unknown" });
	});

	it("returns unknown for fully arbitrary utilities", () => {
		expect(classify("[mask:linear-gradient(red,blue)]")).toEqual({
			kind: "unknown",
		});
	});
});

describe("classifyParsedClass — unknown prefixes", () => {
	it("returns unknown for utilities outside the color registry", () => {
		expect(classify("flex")).toEqual({ kind: "unknown" });
		expect(classify("p-4")).toEqual({ kind: "unknown" });
		expect(classify("rounded-lg")).toEqual({ kind: "unknown" });
		expect(classify("custom-thing")).toEqual({ kind: "unknown" });
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
