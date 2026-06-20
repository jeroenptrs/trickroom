import { describe, expect, it } from "vitest";
import { parseClassName } from "./parse";

describe("parseClassName", () => {
	it("returns an empty array for empty / whitespace-only input", () => {
		expect(parseClassName("")).toEqual([]);
		expect(parseClassName("   \n\t  ")).toEqual([]);
	});

	it("tokenizes whitespace-separated classes", () => {
		const result = parseClassName("flex bg-red-500 text-sm");
		expect(result.map((p) => p.raw)).toEqual([
			"flex",
			"bg-red-500",
			"text-sm",
		]);
	});

	it("parses a prefix-only utility like `flex`", () => {
		const [parsed] = parseClassName("flex");
		expect(parsed).toMatchObject({
			raw: "flex",
			modes: [],
			variants: [],
			important: false,
			negative: false,
			utility: "flex",
			prefix: "flex",
			value: null,
			arbitrary: false,
			opacity: null,
		});
	});

	it("splits prefix and value on the first unbracketed hyphen", () => {
		const [parsed] = parseClassName("bg-red-500");
		expect(parsed).toMatchObject({
			prefix: "bg",
			value: "red-500",
			utility: "bg-red-500",
			arbitrary: false,
		});
	});

	it("captures the opacity modifier from `/<value>`", () => {
		const [parsed] = parseClassName("bg-blue-500/50");
		expect(parsed).toMatchObject({
			utility: "bg-blue-500",
			prefix: "bg",
			value: "blue-500",
			opacity: "50",
		});
	});

	it("captures arbitrary opacity `/[0.5]`", () => {
		const [parsed] = parseClassName("bg-blue-500/[0.5]");
		expect(parsed.opacity).toBe("[0.5]");
		expect(parsed.utility).toBe("bg-blue-500");
	});

	it("recognizes the v4 important suffix", () => {
		const [parsed] = parseClassName("bg-red-500!");
		expect(parsed).toMatchObject({
			important: true,
			utility: "bg-red-500",
		});
	});

	it("handles negative utilities", () => {
		const [parsed] = parseClassName("-mt-4");
		expect(parsed).toMatchObject({
			negative: true,
			utility: "mt-4",
			prefix: "mt",
			value: "4",
		});
	});

	it("handles negative + important together (v4 suffix)", () => {
		const [parsed] = parseClassName("-mt-4!");
		expect(parsed).toMatchObject({
			important: true,
			negative: true,
			utility: "mt-4",
		});
	});

	it("splits modes from variants", () => {
		const [parsed] = parseClassName("md:dark:hover:bg-red-500");
		expect(parsed.modifiers).toEqual(["md", "dark", "hover"]);
		expect(parsed.modes).toEqual(["dark"]);
		expect(parsed.variants).toEqual(["md", "hover"]);
		expect(parsed.utility).toBe("bg-red-500");
	});

	it("preserves variant order with no modes", () => {
		const [parsed] = parseClassName("md:hover:bg-red-500");
		expect(parsed.modes).toEqual([]);
		expect(parsed.variants).toEqual(["md", "hover"]);
	});

	it("treats unknown variant tokens as variants, not modes", () => {
		const [parsed] = parseClassName("group-hover:peer-checked:bg-red-500");
		expect(parsed.variants).toEqual(["group-hover", "peer-checked"]);
		expect(parsed.modes).toEqual([]);
	});

	it("does not split colons inside arbitrary variants", () => {
		const [parsed] = parseClassName("data-[state=open]:bg-red-500");
		expect(parsed.variants).toEqual(["data-[state=open]"]);
		expect(parsed.utility).toBe("bg-red-500");
	});

	it("does not split colons inside child-selector variants", () => {
		const [parsed] = parseClassName("[&>div]:bg-red-500");
		expect(parsed.variants).toEqual(["[&>div]"]);
		expect(parsed.utility).toBe("bg-red-500");
	});

	it("flags arbitrary value utilities", () => {
		const [parsed] = parseClassName("bg-[#abc]");
		expect(parsed).toMatchObject({
			prefix: "bg",
			value: "[#abc]",
			arbitrary: true,
		});
	});

	it("does not split inside arbitrary values containing slashes or hyphens", () => {
		const [parsed] = parseClassName("bg-[url(/foo-bar/baz.png)]");
		expect(parsed.prefix).toBe("bg");
		expect(parsed.value).toBe("[url(/foo-bar/baz.png)]");
		expect(parsed.arbitrary).toBe(true);
		expect(parsed.opacity).toBeNull();
	});

	it("captures opacity after an arbitrary value", () => {
		const [parsed] = parseClassName("bg-[url(/x.png)]/75");
		expect(parsed.utility).toBe("bg-[url(/x.png)]");
		expect(parsed.opacity).toBe("75");
		expect(parsed.arbitrary).toBe(true);
	});

	it("parses a fully arbitrary utility", () => {
		const [parsed] = parseClassName("[mask:linear-gradient(red,blue)]");
		expect(parsed).toMatchObject({
			prefix: "",
			value: "[mask:linear-gradient(red,blue)]",
			arbitrary: true,
			utility: "[mask:linear-gradient(red,blue)]",
		});
	});

	it("preserves the original raw string", () => {
		const input = "md:dark:hover:bg-blue-500/50!";
		const [parsed] = parseClassName(input);
		expect(parsed.raw).toBe(input);
		expect(parsed.modes).toEqual(["dark"]);
		expect(parsed.variants).toEqual(["md", "hover"]);
		expect(parsed.important).toBe(true);
		expect(parsed.utility).toBe("bg-blue-500");
		expect(parsed.opacity).toBe("50");
	});

	it("accepts a custom mode set", () => {
		const [parsed] = parseClassName("light:hover:bg-red-500", {
			modes: ["light", "dark"],
		});
		expect(parsed.modes).toEqual(["light"]);
		expect(parsed.variants).toEqual(["hover"]);
	});

	it("with an empty mode set, treats every prefix as a variant", () => {
		const [parsed] = parseClassName("dark:hover:bg-red-500", { modes: [] });
		expect(parsed.modes).toEqual([]);
		expect(parsed.variants).toEqual(["dark", "hover"]);
	});

	it("handles multi-segment prefixes naively (classifier re-splits later)", () => {
		const [parsed] = parseClassName("border-t-blue-500");
		expect(parsed.prefix).toBe("border");
		expect(parsed.value).toBe("t-blue-500");
	});
});
