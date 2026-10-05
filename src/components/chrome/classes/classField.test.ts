import { describe, expect, it } from "vitest";
import {
	applyClassCompletion,
	createClassCatalogIndex,
	getClassCompletions,
	getClassFieldCommit,
	getTokenAtCursor,
	getUninspectedClasses,
	isCatalogClass,
	normalizeClassName,
	replaceClassToken,
	splitVariantPrefix,
} from "./classField";

const index = createClassCatalogIndex({
	classes: [
		"-mt-2",
		"bg-brand",
		"bg-brand-muted",
		"bg-red-50",
		"bg-red-500",
		"text-red-500",
		"flex",
		"flex-col",
		"hidden",
		"mt-2",
		"p-4",
	],
	variants: ["hover", "focus", "md", "dark", "group-hover", "max-md"],
});

describe("getTokenAtCursor", () => {
	it("finds the token the caret touches, including at its edges", () => {
		const value = "flex  bg-red-500 p-4";
		expect(getTokenAtCursor(value, 0)).toEqual({
			value: "flex",
			start: 0,
			end: 4,
		});
		expect(getTokenAtCursor(value, 4).value).toBe("flex");
		expect(getTokenAtCursor(value, 10).value).toBe("bg-red-500");
		expect(getTokenAtCursor(value, value.length).value).toBe("p-4");
	});

	it("returns an empty token in whitespace so completions insert", () => {
		expect(getTokenAtCursor("flex   p-4", 5)).toEqual({
			value: "",
			start: 5,
			end: 5,
		});
	});
});

describe("splitVariantPrefix", () => {
	it("splits variants at top-level colons only", () => {
		expect(splitVariantPrefix("md:hover:bg-red")).toEqual({
			prefix: "md:hover:",
			variants: ["md", "hover"],
			utility: "bg-red",
		});
		expect(splitVariantPrefix("[&:hover]:bg-[url(a:b)]")).toEqual({
			prefix: "[&:hover]:",
			variants: ["[&:hover]"],
			utility: "bg-[url(a:b)]",
		});
		expect(splitVariantPrefix("md:!p-4").prefix).toBe("md:!");
	});
});

describe("getClassCompletions", () => {
	it("completes theme utilities by prefix, shortest first", () => {
		expect(getClassCompletions(index, "bg-br").map((c) => c.value)).toEqual([
			"bg-brand",
			"bg-brand-muted",
		]);
	});

	it("keeps the variant prefix and important marker on completions", () => {
		expect(getClassCompletions(index, "md:hover:fl")[0]).toEqual({
			value: "md:hover:flex",
			label: "flex",
			kind: "utility",
		});
		expect(getClassCompletions(index, "!fl")[0]?.value).toBe("!flex");
	});

	it("offers variants as `name:` completions", () => {
		const completions = getClassCompletions(index, "ho");
		expect(completions[0]).toEqual({
			value: "hover:",
			label: "hover:",
			kind: "variant",
		});
		expect(getClassCompletions(index, "dark:gr").map((c) => c.value)).toContain(
			"dark:group-hover:",
		);
	});

	it("matches later segments so a color name finds its utilities", () => {
		expect(getClassCompletions(index, "red").map((c) => c.value)).toEqual([
			"bg-red-50",
			"bg-red-500",
			"text-red-500",
		]);
	});

	it("hides negative utilities until `-` is typed", () => {
		expect(getClassCompletions(index, "mt").map((c) => c.value)).toEqual([
			"mt-2",
		]);
		expect(getClassCompletions(index, "-mt").map((c) => c.value)).toEqual([
			"-mt-2",
		]);
	});

	it("does not complete empty tokens or arbitrary values", () => {
		expect(getClassCompletions(index, "")).toEqual([]);
		expect(getClassCompletions(index, "hover:")).toEqual([]);
		expect(getClassCompletions(index, "bg-[#f")).toEqual([]);
	});

	it("respects the limit", () => {
		expect(getClassCompletions(index, "b", 2)).toHaveLength(2);
	});
});

describe("applyClassCompletion", () => {
	it("replaces only the token at the caret and moves the caret after it", () => {
		const value = "flex md:bg-re p-4";
		const token = getTokenAtCursor(value, 12);
		expect(applyClassCompletion(value, token, "md:bg-red-500")).toEqual({
			value: "flex md:bg-red-500 p-4",
			cursor: 18,
		});
	});

	it("inserts at an empty token", () => {
		const token = getTokenAtCursor("flex ", 5);
		expect(applyClassCompletion("flex ", token, "p-4")).toEqual({
			value: "flex p-4",
			cursor: 8,
		});
	});
});

describe("commit and revert", () => {
	it("normalizes whitespace, including newlines, on commit", () => {
		expect(normalizeClassName("  flex\n\tp-4   mt-2 ")).toBe("flex p-4 mt-2");
		expect(getClassFieldCommit("flex\np-4  hidden", "flex p-4")).toBe(
			"flex p-4 hidden",
		);
	});

	it("writes nothing when the draft only differs in whitespace", () => {
		expect(getClassFieldCommit("flex\n p-4 ", "flex p-4")).toBeNull();
		expect(getClassFieldCommit("", "")).toBeNull();
	});

	it("can clear every class", () => {
		expect(getClassFieldCommit("   ", "flex")).toBe("");
	});
});

describe("unknown class detection", () => {
	it("vouches for plain catalog classes with known variants", () => {
		expect(isCatalogClass(index, "md:hover:bg-red-500")).toBe(true);
		expect(isCatalogClass(index, "p-4!")).toBe(true);
		expect(isCatalogClass(index, "!p-4")).toBe(true);
		expect(isCatalogClass(index, "wobble:p-4")).toBe(false);
		expect(isCatalogClass(index, "bg-red-500/50")).toBe(false);
	});

	it("sends only the tokens the catalog can't decide to the server", () => {
		expect(
			getUninspectedClasses(
				index,
				"flex bg-brnd hover:p-4 bg-[#123] bg-brnd w-[3px]",
			),
		).toEqual(["bg-[#123]", "bg-brnd", "w-[3px]"]);
		expect(getUninspectedClasses(null, "flex p-4")).toEqual(["flex", "p-4"]);
	});

	it("replaces or removes a whole flagged token", () => {
		expect(replaceClassToken("flex bg-brnd p-4", "bg-brnd", "bg-brand")).toBe(
			"flex bg-brand p-4",
		);
		expect(replaceClassToken("p-4 flex p-6", "p-4", "")).toBe("flex p-6");
		expect(replaceClassToken("bg-red-5 bg-red-50", "bg-red-5", "x")).toBe(
			"x bg-red-50",
		);
	});
});
