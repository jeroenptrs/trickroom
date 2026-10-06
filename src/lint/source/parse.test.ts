import { describe, expect, it } from "vitest";
import { formatCodegenHeader } from "../../codegen/header";
import { DEFAULT_CLASS_CALLS } from "../config";
import { parseSourceModule, traceCallOrigin } from "./parse";

const parse = (text: string, file = "src/x.tsx") =>
	parseSourceModule(file, text, { classCalls: DEFAULT_CLASS_CALLS });

describe("parseSourceModule", () => {
	it("models imports, exports and re-exports", () => {
		const module =
			parse(`import { buttonVariants, type ButtonSize } from "./button.variants";
import * as React from "react";
import Default from "../lib";
import "./side-effect.css";
export { buttonVariants } from "./button.variants";
export * from "./all";
export * as ns from "./ns";
export type { T } from "./types";
export { type Props, Badge } from "./badge";
export const Button = () => null;
export default Button;
const hidden = 1;
export { hidden as shown };
`);
		expect(module.errors).toEqual([]);
		expect(module.imports).toEqual([
			{
				specifier: "./button.variants",
				resolved: null,
				names: [
					{ imported: "buttonVariants", local: "buttonVariants", type: false },
					{ imported: "ButtonSize", local: "ButtonSize", type: true },
				],
				position: { line: 1, column: 1 },
			},
			{
				specifier: "react",
				resolved: null,
				names: [{ imported: "*", local: "React", type: false }],
				position: { line: 2, column: 1 },
			},
			{
				specifier: "../lib",
				resolved: null,
				names: [{ imported: "default", local: "Default", type: false }],
				position: { line: 3, column: 1 },
			},
			{
				specifier: "./side-effect.css",
				resolved: null,
				names: [],
				position: { line: 4, column: 1 },
			},
		]);
		expect(module.exports).toEqual([
			{ name: "Button", local: "Button", type: false },
			{ name: "default", local: "Button", type: false },
			{ name: "shown", local: "hidden", type: false },
		]);
		expect(module.reexports).toEqual([
			{
				specifier: "./button.variants",
				resolved: null,
				names: [
					{
						imported: "buttonVariants",
						exported: "buttonVariants",
						type: false,
					},
				],
				type: false,
				position: { line: 5, column: 1 },
			},
			{
				specifier: "./all",
				resolved: null,
				names: [{ imported: "*", exported: null, type: false }],
				type: false,
				position: { line: 6, column: 1 },
			},
			{
				specifier: "./ns",
				resolved: null,
				names: [{ imported: "*", exported: "ns", type: false }],
				type: false,
				position: { line: 7, column: 1 },
			},
			{
				specifier: "./types",
				resolved: null,
				names: [{ imported: "T", exported: "T", type: true }],
				type: true,
				position: { line: 8, column: 1 },
			},
			{
				specifier: "./badge",
				resolved: null,
				names: [
					{ imported: "Props", exported: "Props", type: true },
					{ imported: "Badge", exported: "Badge", type: false },
				],
				type: false,
				position: { line: 9, column: 1 },
			},
		]);
	});

	it("models JSX elements with literal attributes and marks the rest unknown", () => {
		const module = parse(`const size = "sm";
const view = (
	<Button variant="danger" tone={"soft"} count={2} disabled on={true} dyn={size} {...rest}>
		<UI.Badge.Dot />
		<svg:path />
		<div className="p-1" />
	</Button>
);`);
		expect(module.jsx.map((element) => element.name)).toEqual([
			"Button",
			"UI.Badge.Dot",
			"svg:path",
			"div",
		]);
		const button = module.jsx[0];
		expect(button).toMatchObject({
			root: "Button",
			members: [],
			spread: true,
			position: { line: 3, column: 2 },
		});
		expect(button.attributes).toEqual([
			{
				name: "variant",
				value: { kind: "string", value: "danger" },
				position: { line: 3, column: 10 },
			},
			{
				name: "tone",
				value: { kind: "string", value: "soft" },
				position: { line: 3, column: 27 },
			},
			{
				name: "count",
				value: { kind: "literal", value: 2 },
				position: { line: 3, column: 41 },
			},
			{
				name: "disabled",
				value: { kind: "literal", value: true },
				position: { line: 3, column: 51 },
			},
			{
				name: "on",
				value: { kind: "literal", value: true },
				position: { line: 3, column: 60 },
			},
			{
				name: "dyn",
				value: { kind: "unknown" },
				position: { line: 3, column: 70 },
			},
		]);
		expect(module.jsx[1]).toMatchObject({
			root: "UI",
			members: ["Badge", "Dot"],
		});
	});

	it("collects class strings from className and class calls, flagging dynamic parts", () => {
		const module = parse(`const a = <div className="p-1 flex" />;
const b = <div className={cn("p-2", active && "bg-red-500", cond ? "x" : "y", [\`q-\${n}\`, "z"])} />;
const c = <div className={styles.root} />;
const v = tv({ base: "px-1", slots: { title: "font-bold" }, variants: { size: { sm: "text-sm" } }, compoundVariants: [{ size: "sm", class: "ring" }] });
const d = clsx("m-1", other(), { "mt-1": active });
const e = <div className={twMerge("p-3", cn("p-4"))} />;`);
		expect(
			module.classStrings.map((entry) => [
				entry.value,
				entry.complete,
				entry.mixed,
				entry.origin.kind,
				entry.position.line,
			]),
		).toEqual([
			["p-1 flex", true, false, "jsx-attribute", 1],
			["p-2", true, true, "jsx-attribute", 2],
			["bg-red-500", true, true, "jsx-attribute", 2],
			["x", true, true, "jsx-attribute", 2],
			["y", true, true, "jsx-attribute", 2],
			["q-", false, true, "jsx-attribute", 2],
			["z", true, true, "jsx-attribute", 2],
			["px-1", true, false, "call", 4],
			["font-bold", true, false, "call", 4],
			["text-sm", true, false, "call", 4],
			["ring", true, false, "call", 4],
			["m-1", true, true, "call", 5],
			["mt-1", true, true, "call", 5],
			["p-3", true, false, "jsx-attribute", 6],
			["p-4", true, false, "jsx-attribute", 6],
		]);
		expect(module.classStrings[0].origin).toEqual({
			kind: "jsx-attribute",
			element: "div",
			attribute: "className",
		});
		expect(module.classStrings[7].origin).toEqual({
			kind: "call",
			callee: "tv",
		});
	});

	it("models call sites with literal object arguments and their completeness", () => {
		const module =
			parse(`const s = buttonVariants({ size: "sm", active: true, tone, class: cx("a") });
const spread = buttonVariants({ size: "sm", ...props, [key]: 1, "tone": "soft" });
const root = s.root({ class: "x" });
const t = s.title();
obj.deep.fn(1, "two");`);
		expect(module.calls.map((call) => call.callee)).toEqual([
			"buttonVariants",
			"cx",
			"buttonVariants",
			"s.root",
			"s.title",
			"obj.deep.fn",
		]);
		expect(module.calls[0]).toMatchObject({
			root: "buttonVariants",
			members: [],
			arguments: [
				{
					kind: "object",
					properties: {
						size: { kind: "string", value: "sm" },
						active: { kind: "literal", value: true },
						tone: { kind: "unknown" },
						class: { kind: "unknown" },
					},
					keys: ["size", "active", "tone", "class"],
					hasSpread: false,
					hasComputed: false,
				},
			],
		});
		expect(module.calls[2].arguments).toEqual([
			{
				kind: "object",
				properties: {
					size: { kind: "string", value: "sm" },
					tone: { kind: "string", value: "soft" },
				},
				keys: ["size", "tone"],
				members: [
					{ kind: "property", key: "size" },
					{ kind: "spread" },
					{ kind: "computed" },
					{ kind: "property", key: "tone" },
				],
				hasSpread: true,
				hasComputed: true,
			},
		]);
		expect(module.calls[3]).toMatchObject({
			callee: "s.root",
			root: "s",
			members: ["root"],
			arguments: [
				{
					kind: "object",
					properties: { class: { kind: "string", value: "x" } },
				},
			],
		});
		expect(module.calls[4]).toMatchObject({ arguments: [] });
		expect(module.calls[5].arguments).toEqual([
			{ kind: "literal", value: 1 },
			{ kind: "string", value: "two" },
		]);
	});

	it("traces call sites to the call their receiver came from", () => {
		const module = parse(`const a = buttonVariants({ size: "sm" });
const b = otherVariants();
const { root, title: t = x } = buttonVariants();
const [first] = list();
const r = badgeVariants().root;
const w = await loadVariants();
const plain = 1;
a.title();
b.title();
t();
r({ class: "x" });
w.root();
first.y();
plain.z();`);
		expect(module.declarations).toEqual([
			{
				name: "a",
				call: {
					callee: "buttonVariants",
					root: "buttonVariants",
					members: [],
					position: { line: 1, column: 11 },
				},
				path: [],
				position: { line: 1, column: 7 },
			},
			{
				name: "b",
				call: {
					callee: "otherVariants",
					root: "otherVariants",
					members: [],
					position: { line: 2, column: 11 },
				},
				path: [],
				position: { line: 2, column: 7 },
			},
			{
				name: "root",
				call: expect.objectContaining({ callee: "buttonVariants" }),
				path: ["root"],
				position: { line: 3, column: 9 },
			},
			{
				name: "t",
				call: expect.objectContaining({ callee: "buttonVariants" }),
				path: ["title"],
				position: { line: 3, column: 22 },
			},
			{
				name: "first",
				call: expect.objectContaining({ callee: "list" }),
				path: ["0"],
				position: { line: 4, column: 8 },
			},
			{
				name: "r",
				call: expect.objectContaining({ callee: "badgeVariants" }),
				path: ["root"],
				position: { line: 5, column: 7 },
			},
			{
				name: "w",
				call: expect.objectContaining({ callee: "loadVariants" }),
				path: [],
				position: { line: 6, column: 7 },
			},
		]);
		const trace = (callee: string) => {
			const call = module.calls.find((entry) => entry.callee === callee);
			if (!call) throw new Error(`no call ${callee}`);
			const origin = traceCallOrigin(module, call);
			return origin ? `${origin.call.callee} ${origin.path.join(".")}` : null;
		};
		expect(trace("a.title")).toBe("buttonVariants title");
		expect(trace("b.title")).toBe("otherVariants title");
		expect(trace("t")).toBe("buttonVariants title");
		expect(trace("r")).toBe("badgeVariants root");
		expect(trace("w.root")).toBe("loadVariants root");
		expect(trace("first.y")).toBe("list 0.y");
		expect(trace("plain.z")).toBeNull();

		// The swapped program is a different model.
		const swapped = parse(
			`const a = otherVariants();\nconst b = buttonVariants();\na.title();`,
		);
		expect(trace.call(null, "a.title")).toBe("buttonVariants title");
		const swappedCall = swapped.calls.find(
			(entry) => entry.callee === "a.title",
		);
		expect(
			swappedCall && traceCallOrigin(swapped, swappedCall)?.call.callee,
		).toBe("otherVariants");
	});

	it("detects generated variants files and reports syntax errors", () => {
		const header = formatCodegenHeader({
			version: 1,
			systemId: "sys_1",
			componentId: "cmp_1",
			slug: "button",
			source: "published",
			publishedVersion: "1",
			templateHash: "sha256:t",
			variantSchemaHash: "sha256:v",
			sourceHash: "sha256:s",
		});
		const generated = parse(
			`${header}\n\nimport { tv } from "./tv";\n\nexport const buttonVariants = tv({ base: "px-3" });\n`,
			"src/ui/button.variants.ts",
		);
		expect(generated.codegenHeader).toMatchObject({
			componentId: "cmp_1",
			slug: "button",
		});
		expect(generated.classStrings.map((entry) => entry.value)).toEqual([
			"px-3",
		]);
		expect(generated.lineCount).toBe(6);

		const broken = parse("const x = <div>\n");
		expect(broken.codegenHeader).toBeNull();
		expect(broken.errors.length).toBeGreaterThan(0);
		expect(broken.errors[0]).toMatch(/^\d+:\d+ /u);
	});
});
