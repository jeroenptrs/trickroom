import { describe, expect, it } from "vitest";
import {
	applyColorChange,
	applyColorClear,
} from "./colorPropertiesController";

const TOKENS = new Set([
	"red-500",
	"blue-500",
	"slate-200",
	"brand-primary",
]);
const opts = { colorTokens: TOKENS };

describe("applyColorChange — integration glue", () => {
	it("sets a background color on an empty className", () => {
		expect(
			applyColorChange("", opts, {
				property: "background",
				value: { kind: "token", token: "blue-500" },
			}),
		).toBe("bg-blue-500");
	});

	it("replaces an existing background color in place", () => {
		expect(
			applyColorChange("flex bg-red-500 text-sm", opts, {
				property: "background",
				value: { kind: "token", token: "blue-500" },
			}),
		).toBe("flex bg-blue-500 text-sm");
	});

	it("appends when no class for the property exists yet", () => {
		expect(
			applyColorChange("flex text-sm", opts, {
				property: "background",
				value: { kind: "token", token: "blue-500" },
			}),
		).toBe("flex text-sm bg-blue-500");
	});

	it("replaces only the targeted variant slot", () => {
		expect(
			applyColorChange("bg-red-500 hover:bg-blue-500", opts, {
				property: "background",
				variants: ["hover"],
				value: { kind: "token", token: "slate-200" },
			}),
		).toBe("bg-red-500 hover:bg-slate-200");
	});

	it("emits universal keywords", () => {
		expect(
			applyColorChange("", opts, {
				property: "text",
				value: { kind: "keyword", keyword: "current" },
			}),
		).toBe("text-current");
	});

	it("preserves non-color classes byte-for-byte", () => {
		const input =
			"data-[state=open]:p-4 [mask:linear-gradient(red,blue)] bg-red-500";
		expect(
			applyColorChange(input, opts, {
				property: "background",
				value: { kind: "token", token: "blue-500" },
			}),
		).toBe(
			"data-[state=open]:p-4 [mask:linear-gradient(red,blue)] bg-blue-500",
		);
	});
});

describe("applyColorClear — integration glue", () => {
	it("removes the targeted color class", () => {
		expect(
			applyColorClear("flex bg-red-500 text-sm", opts, {
				property: "background",
			}),
		).toBe("flex text-sm");
	});

	it("removes only the targeted variant slot", () => {
		expect(
			applyColorClear("bg-red-500 hover:bg-blue-500", opts, {
				property: "background",
				variants: ["hover"],
			}),
		).toBe("bg-red-500");
	});

	it("is a no-op when no matching class exists", () => {
		expect(
			applyColorClear("flex text-sm", opts, {
				property: "background",
			}),
		).toBe("flex text-sm");
	});

	it("can clear stale tokens", () => {
		expect(
			applyColorClear("bg-rose-999 text-sm", opts, {
				property: "background",
			}),
		).toBe("text-sm");
	});
});

describe("integration — switching the resolved-token set", () => {
	const limitedTokens = new Set(["mint-500"]);
	const limitedOpts = { colorTokens: limitedTokens };

	it("classifies the same className differently depending on the resolved set", () => {
		// `bg-blue-500` resolves under `opts` (blue-500 is in the set)
		// but is stale under `limitedOpts`. Either way, clearing returns
		// the same className.
		expect(
			applyColorClear("flex bg-blue-500 text-sm", opts, {
				property: "background",
			}),
		).toBe("flex text-sm");
		expect(
			applyColorClear("flex bg-blue-500 text-sm", limitedOpts, {
				property: "background",
			}),
		).toBe("flex text-sm");
	});

	it("setColor writes the token name unchanged regardless of resolution", () => {
		// Setting a token that the active set does not resolve still
		// produces the class — it'll just render with the warning swatch
		// in the picker.
		expect(
			applyColorChange("", limitedOpts, {
				property: "background",
				value: { kind: "token", token: "blue-500" },
			}),
		).toBe("bg-blue-500");
	});
});
