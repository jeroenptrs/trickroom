import { afterEach, describe, expect, it } from "vitest";
import { publishedComponent } from "../../../codegen/test-support";
import { unknownClassTokenRule } from "./class-tokens";
import { redundantClassRule } from "./redundant-class";
import {
	buttonPayload,
	cardPayload,
	createFixtures,
	describeFindings,
} from "./test-support";

const fixtures = createFixtures();
afterEach(fixtures.cleanup);

const button = () => publishedComponent("button", buttonPayload());
const card = () => publishedComponent("card", cardPayload());

const BUTTON_WRAPPER = [
	'import { buttonVariants } from "./button.variants";',
	'import { cn } from "./cn";',
	'export const Button = (props: { className?: string; variant?: string }) => <button className={cn(buttonVariants(props), props.className, "bg-brandx-500")} />;',
	"",
].join("\n");

const TOKENS = {
	color: ["brand-500", "white", "red-500"],
	spacing: ["DEFAULT"],
	radius: ["md"],
};

/** A stand-in for the compiled build: knows a few static utilities. */
const inspect = (candidate: string) =>
	["flex", "inline-flex", "rounded-full", "hidden"].includes(
		candidate.replace(/^.*:/u, ""),
	);

describe("code.unknown-class-token", () => {
	const files = {
		"src/ui/cn.ts": "export const cn = (...v: unknown[]) => v.join(' ');\n",
		"src/ui/button.tsx": BUTTON_WRAPPER,
		"src/app.tsx": [
			'import { Button } from "./ui/button";',
			'import { cn } from "./ui/cn";',
			"declare const n: number;",
			"export const App = () => (",
			'\t<div className="flex p-2 bg-brand-500 text-[#ff0000]">',
			// biome-ignore lint/suspicious/noTemplateCurlyInString: fixture source with a template literal
			'\t\t<Button variant="primary" className={cn("rounded-xl", `md:bg-ink-100 q-${n}`)} />',
			'\t\t<p className="prose hover:flexx" />',
			"\t</div>",
			");",
			"",
		].join("\n"),
		"src/lib/other.ts":
			'export const x = cn("bg-other-1");\ndeclare const cn: (v: string) => string;\n',
	};

	it("reports unknown tokens, arbitrary values and unknown utilities, located on the class, skipping template fragments", async () => {
		const fixture = await fixtures.create({ components: [button()], files });
		const findings = await fixture.run(unknownClassTokenRule, {
			tokens: TOKENS,
			inspect,
		});
		expect(
			describeFindings(findings).map((line) => line.split(" Use a token")[0]),
		).toEqual([
			'src/app.tsx:5:40 Class "text-[#ff0000]" uses arbitrary color value [#ff0000].',
			'src/app.tsx:6:44 Class "rounded-xl" references unavailable radius token "xl". Did you mean "rounded-md"?',
			'src/app.tsx:7:17 Class "prose" is not recognized as a supported Tailwind utility.',
			'src/app.tsx:7:23 Class "hover:flexx" is not recognized as a supported Tailwind utility.',
			'src/lib/other.ts:1:22 Class "bg-other-1" references unavailable color token "other-1".',
			'src/ui/button.tsx:3:139 Class "bg-brandx-500" references unavailable color token "brandx-500". Did you mean "bg-brand-500"?',
		]);
		expect(findings.at(-1)?.component).toBe("button");
		expect(findings[0].component).toBeUndefined();
	});

	it("honours allow globs and the scope option", async () => {
		const fixture = await fixtures.create({ components: [button()], files });
		const run = (options: Record<string, unknown>) =>
			fixture
				.run(unknownClassTokenRule, { tokens: TOKENS, inspect, options })
				.then((findings) =>
					findings.map((finding) =>
						finding.location?.kind === "code"
							? `${finding.location.file} ${finding.message.split(" ")[1]}`
							: `note ${finding.message}`,
					),
				);
		expect(
			await run({
				allow: ["prose", "flexx", "*-[*]", "bg-other-*"],
				scope: "all",
			}),
		).toEqual([
			'src/app.tsx "rounded-xl"',
			'src/ui/button.tsx "bg-brandx-500"',
		]);
		expect(await run({ scope: "wrappers" })).toEqual([
			'src/ui/button.tsx "bg-brandx-500"',
		]);
		expect(await run({ scope: "usages" })).toHaveLength(4);
		expect(await run({ scope: "everywhere", allow: "x", extra: 1 })).toEqual([
			expect.stringContaining(
				'note lint.json rules["code.unknown-class-token"].options: "extra" is not an option',
			),
			...(await run({})),
		]);
	});

	it("locates a class written twice in one string at each occurrence", async () => {
		const fixture = await fixtures.create({
			components: [button()],
			files: {
				"src/app.tsx":
					'export const App = () => <p className="text-[#f00] p-2 text-[#f00]" />;\n',
			},
		});
		const findings = await fixture.run(unknownClassTokenRule, {
			tokens: TOKENS,
			inspect,
		});
		expect(
			describeFindings(findings).map((line) => line.split(" Class")[0]),
		).toEqual(["src/app.tsx:1:40", "src/app.tsx:1:56"]);
	});

	it("checks only utilities without a token snapshot, and notes when it can check nothing", async () => {
		const fixture = await fixtures.create({ components: [button()], files });
		const utilitiesOnly = await fixture.run(unknownClassTokenRule, { inspect });
		expect(
			utilitiesOnly.map((finding) => finding.message.split(" ")[1]),
		).toEqual(['"prose"', '"hover:flexx"']);
		const nothing = await fixture.run(unknownClassTokenRule);
		expect(nothing).toEqual([
			expect.objectContaining({ severity: "info", location: null }),
		]);
	});
});

describe("code.redundant-class", () => {
	it("reports classes that do not change the merged output, skipping attributes a later spread may override and shadowed names", async () => {
		const fixture = await fixtures.create({
			components: [button(), card()],
			files: {
				"src/ui/cn.ts": "export const cn = (...v: unknown[]) => v.join(' ');\n",
				"src/ui/button.tsx": BUTTON_WRAPPER,
				"src/ui/card.tsx": [
					'import { cardVariants } from "./card.variants";',
					"export const Card = (props: { className?: string; tone?: string; children?: unknown }) => <div className={cardVariants(props).root({ class: props.className })} />;",
					"export const CardTitle = (props: { className?: string }) => <h2 className={props.className} />;",
					"",
				].join("\n"),
				"src/app.tsx": [
					'import { Button } from "./ui/button";',
					'import { Card, CardTitle } from "./ui/card";',
					'import { cn } from "./ui/cn";',
					"declare const v: string;",
					"declare const rest: Record<string, unknown>;",
					"export const App = () => (",
					'\t<Card className="p-4 bg-white">',
					'\t\t<CardTitle className="font-bold" />',
					'\t\t<Card tone="loud" className="bg-white bg-red-500"><Button variant="ghost" className="rounded-md" /></Card>',
					'\t\t<Button variant={v} size="sm" className={cn("px-3 text-sm", "bg-transparent")} />',
					'\t\t<Button variant="primary" disabled className="opacity-50 h-10" {...rest} />',
					'\t\t<Button variant="primary" disabled {...rest} className="opacity-50 px-3" />',
					'\t\t{((Button: any) => <Button variant="primary" className="px-3" />)(null)}',
					'\t\t<Button variant="ghost" className="p-4 px-3 rounded-md" />',
					"\t</Card>",
					");",
					"",
				].join("\n"),
			},
		});
		const findings = await fixture.run(redundantClassRule);
		expect(describeFindings(findings)).toEqual([
			'src/app.tsx:7:19 <Card className> repeats "p-4", which "card" already applies through its base classes. Remove it from className.',
			'src/app.tsx:7:23 <Card className> repeats "bg-white", which "card" already applies through the default tone="plain". Remove it from className.',
			// bg-red-500 (from tone="loud") is not reported: removing it would let the bg-white before it win.
			'src/app.tsx:9:88 <Button className> repeats "rounded-md", which "button" already applies through its base classes. Remove it from className.',
			'src/app.tsx:10:53 <Button className> repeats "text-sm", which "button" already applies through size="sm". Remove it from className.',
			// Not px-3 on line 12: the spread may supply size="sm", whose px-6 it overrides.
			'src/app.tsx:14:47 <Button className> repeats "rounded-md", which "button" already applies through its base classes. Remove it from className.',
		]);
	});
	it("judges a class under every value a dynamic axis may take, and skips classes next to non-literal parts", async () => {
		const fixture = await fixtures.create({
			components: [button()],
			files: {
				"src/ui/cn.ts": "export const cn = (...v: unknown[]) => v.join(' ');\n",
				"src/ui/button.tsx": BUTTON_WRAPPER,
				"src/app.tsx": [
					'import { Button } from "./ui/button";',
					'import { cn } from "./ui/cn";',
					"declare const size: string;",
					"declare const extra: string;",
					"declare const rest: Record<string, unknown>;",
					"export const App = () => (",
					"\t<>",
					'\t\t<Button variant="ghost" size={size} className="px-3 rounded-md" />',
					'\t\t<Button variant="ghost" {...rest} className="px-3 inline-flex" />',
					'\t\t<Button variant="ghost" className={cn(extra, "px-3 rounded-md")} />',
					'\t\t<Button variant="ghost" size="md" className={cn("px-3", "rounded-md")} />',
					"\t</>",
					");",
					"",
				].join("\n"),
			},
		});
		expect(describeFindings(await fixture.run(redundantClassRule))).toEqual([
			'src/app.tsx:8:55 <Button className> repeats "rounded-md", which "button" already applies through its base classes. Remove it from className.',
			'src/app.tsx:9:53 <Button className> repeats "inline-flex", which "button" already applies through its base classes. Remove it from className.',
			'src/app.tsx:11:52 <Button className> repeats "px-3", which "button" already applies through its base classes. Remove it from className.',
			'src/app.tsx:11:60 <Button className> repeats "rounded-md", which "button" already applies through its base classes. Remove it from className.',
		]);
	});

	it("locates a class written twice in one className at each occurrence", async () => {
		const fixture = await fixtures.create({
			components: [button()],
			files: {
				"src/ui/cn.ts": "export const cn = (...v: unknown[]) => v.join(' ');\n",
				"src/ui/button.tsx": BUTTON_WRAPPER,
				"src/app.tsx": [
					'import { Button } from "./ui/button";',
					'export const App = () => <Button variant="ghost" className="px-3 text-left px-3" />;',
					"",
				].join("\n"),
			},
		});
		expect(
			describeFindings(await fixture.run(redundantClassRule)).map(
				(line) => line.split(" <Button")[0],
			),
		).toEqual(["src/app.tsx:2:61", "src/app.tsx:2:76"]);
	});

	it("reads a className that follows a JSX element in an earlier attribute", async () => {
		const fixture = await fixtures.create({
			components: [button()],
			files: {
				"src/ui/cn.ts": "export const cn = (...v: unknown[]) => v.join(' ');\n",
				"src/ui/button.tsx": BUTTON_WRAPPER,
				"src/app.tsx": [
					'import { Button } from "./ui/button";',
					'export const App = () => <Button variant="ghost" title={<span />} className="rounded-md" />;',
					"",
				].join("\n"),
			},
		});
		expect(
			describeFindings(await fixture.run(redundantClassRule)).map(
				(line) => line.split(" <Button")[0],
			),
		).toEqual(["src/app.tsx:2:78"]);
	});

	it("judges conditional class strings in every scenario where they apply", async () => {
		const fixture = await fixtures.create({
			components: [button()],
			files: {
				"src/ui/cn.ts": "export const cn = (...v: unknown[]) => v.join(' ');\n",
				"src/ui/button.tsx": BUTTON_WRAPPER,
				"src/app.tsx": [
					'import { Button } from "./ui/button";',
					'import { cn } from "./ui/cn";',
					"declare const dense: boolean;",
					"declare const compact: boolean;",
					"declare const active: boolean;",
					"export const App = () => (",
					"\t<>",
					// px-3 restores the base padding after p-0 when dense: not redundant.
					'\t\t<Button variant="ghost" className={dense ? "p-0 px-3" : "px-1"} />',
					'\t\t<Button variant="ghost" className={cn("p-0 px-3", compact && "px-1")} />',
					'\t\t<Button variant="ghost" className={cn("p-0 px-3", { "px-1": compact })} />',
					// Redundant whether or not the condition holds.
					'\t\t<Button variant="ghost" className={cn("rounded-md", active && "px-3")} />',
					"\t</>",
					");",
					"",
				].join("\n"),
			},
		});
		expect(describeFindings(await fixture.run(redundantClassRule))).toEqual([
			'src/app.tsx:11:42 <Button className> repeats "rounded-md", which "button" already applies through its base classes. Remove it from className.',
			'src/app.tsx:11:66 <Button className> repeats "px-3", which "button" already applies through its base classes. Remove it from className.',
		]);
	});
});
