import { afterEach, describe, expect, it } from "vitest";
import { publishedComponent } from "../../../codegen/test-support";
import {
	codeClassRestrictedRule,
	codeMissingDarkVariantRule,
	codeTextPatternRule,
} from "./guidelines";
import {
	buttonPayload,
	createFixtures,
	describeFindings,
} from "./test-support";

const fixtures = createFixtures();
afterEach(fixtures.cleanup);

const button = () => publishedComponent("button", buttonPayload());

const APP = [
	'import { cn } from "./cn";',
	"declare const busy: boolean;",
	"declare const t: (key: string) => string;",
	"// Sorry, this comment is never checked!",
	"export const App = () => (",
	'\t<main className="bg-pale-1 dark:bg-paledark-1 text-title-lg text-pale-dim">',
	"\t\t<h1>Profile &middot; Settings</h1>",
	'\t\t<p title="Are you sure?" data-x="Sorry">{busy ? "Loading..." : "Saved"}</p>',
	'\t\t<input placeholder="Search…" aria-label={t("close")} />',
	"\t\t<span>",
	"\t\t\t3 – 5 items",
	"\t\t</span>",
	'\t\t<a className={cn("hover:underline", busy ? "text-title-sm" : "text-pale-dim")}>Saved successfully!</a>',
	'\t\t<div className={cn("hover:bg-pale-3", busy && "dark:bg-paledark-3")} />',
	'\t\t<div className="hover:bg-pale-3 hover:dark:bg-paledark-3 border-t-pale-6 bg-pale-app" />',
	'\t\t<div className={busy ? "text-penn-12" : "dark:text-penndark-12"} />',
	'\t\t<div className={cn("text-penn-12", busy && "dark:text-penndark-12")} />',
	"\t</main>",
	");",
	"",
].join("\n");

const files = {
	"src/ui/cn.ts": "export const cn = (...v: unknown[]) => v.join(' ');\n",
	"src/app.tsx": APP,
	"src/ui/link.tsx":
		'export const Link = () => <a className="hover:underline text-pale-dim">Go!</a>;\n',
	"src/legacy/old.tsx": "export const Old = () => <p>Sorry!</p>;\n",
};

const PATTERNS = [
	{ pattern: "·", message: "No middle dots as separators." },
	{ pattern: "—", message: "No em dashes." },
	{ pattern: "→", message: "No arrows in text." },
	{
		pattern: "\\d\\s*–\\s*\\d",
		regex: true,
		message: "Write ranges as 3 to 5.",
	},
	{
		pattern: "\\bsuccessfully\\b",
		regex: true,
		flags: "i",
		message: "Cut it.",
	},
	{ pattern: "^Sorry", regex: true, message: "Do not apologise." },
	{ pattern: "Are you sure", message: "Say what happens." },
	{ pattern: "Loading\\.\\.\\.", regex: true, message: "Use a skeleton." },
	{ pattern: "!$", regex: true, message: "No exclamation marks." },
];

describe("code.text-pattern", () => {
	it("checks JSX text and text attributes, not comments, other attributes or excluded files", async () => {
		const fixture = await fixtures.create({ components: [button()], files });
		const findings = await fixture.run(codeTextPatternRule, {
			options: { patterns: PATTERNS, exclude: ["src/legacy/**"] },
		});
		expect(describeFindings(findings)).toEqual([
			'src/app.tsx:7:7 No middle dots as separators. Found "·" in "Profile · Settings".',
			'src/app.tsx:8:13 Say what happens. Found "Are you sure" in "Are you sure?".',
			'src/app.tsx:8:52 Use a skeleton. Found "Loading..." in "Loading...".',
			'src/app.tsx:11:4 Write ranges as 3 to 5. Found "3 – 5" in "3 – 5 items".',
			'src/app.tsx:13:82 Cut it. Found "successfully" in "Saved successfully!".',
			'src/app.tsx:13:82 No exclamation marks. Found "!" in "Saved successfully!".',
			'src/ui/link.tsx:1:72 No exclamation marks. Found "!" in "Go!".',
		]);
		expect(findings[0].details).toEqual({ pattern: "·", match: "·" });
	});

	it("checks only the configured attributes", async () => {
		const fixture = await fixtures.create({ components: [button()], files });
		const findings = await fixture.run(codeTextPatternRule, {
			options: {
				patterns: [{ pattern: "^Sorry", regex: true, message: "No." }],
				attributes: ["data-x"],
			},
		});
		expect(describeFindings(findings)).toEqual([
			'src/app.tsx:8:36 No. Found "Sorry" in "Sorry".',
			'src/legacy/old.tsx:1:29 No. Found "Sorry" in "Sorry!".',
		]);
	});

	it("does nothing until patterns are configured", async () => {
		const fixture = await fixtures.create({ components: [button()], files });
		expect(await fixture.run(codeTextPatternRule)).toEqual([]);
	});
});

describe("code.class-restricted", () => {
	it("reports forbidden classes per class string, with when, branches and allowIn", async () => {
		const fixture = await fixtures.create({ components: [button()], files });
		const findings = await fixture.run(codeClassRestrictedRule, {
			options: {
				restrictions: [
					{
						classes: ["text-pale-dim", "text-penn-11"],
						when: ["text-title-*"],
						message: "Titles never dim.",
					},
					{
						classes: ["hover:underline"],
						message: "Rows use a hover background, not an underline.",
						allowIn: ["src/ui/link.tsx"],
					},
				],
			},
		});
		// The conditional's two sides never render together, so line 13's
		// text-pale-dim is not next to text-title-sm.
		expect(describeFindings(findings)).toEqual([
			'src/app.tsx:6:62 Class "text-pale-dim" next to "text-title-lg": Titles never dim.',
			'src/app.tsx:13:21 Class "hover:underline": Rows use a hover background, not an underline.',
		]);
	});

	it("does nothing until restrictions are configured", async () => {
		const fixture = await fixtures.create({ components: [button()], files });
		expect(await fixture.run(codeClassRestrictedRule)).toEqual([]);
	});
});

describe("code.missing-dark-variant", () => {
	it("reports configured colours without a dark twin for the same property and variants", async () => {
		const fixture = await fixtures.create({ components: [button()], files });
		const findings = await fixture.run(codeMissingDarkVariantRule, {
			options: {
				colors: ["pale-*", "penn-*"],
				allow: ["bg-pale-app", "text-pale-dim"],
			},
		});
		// Line 14's twin lacks hover:, so it answers nothing; line 15's
		// hover twin is written in the other variant order. Line 16's twin is
		// on the other side of the conditional, line 17's may render with it.
		expect(
			describeFindings(findings).map((line) => line.split(" Add a")[0]),
		).toEqual([
			'src/app.tsx:14:23 Class "hover:bg-pale-3" has no dark counterpart for the same property in this class string.',
			'src/app.tsx:15:60 Class "border-t-pale-6" has no dark counterpart for the same property in this class string.',
			'src/app.tsx:16:27 Class "text-penn-12" has no dark counterpart for the same property in this class string.',
		]);
		expect(findings[0].message).toContain("Add a dark:hover:bg-* class");
		expect(findings[1].details).toEqual({
			classToken: "border-t-pale-6",
			expected: "dark:border-t-*",
		});
	});

	it("does nothing until colours are configured", async () => {
		const fixture = await fixtures.create({ components: [button()], files });
		expect(await fixture.run(codeMissingDarkVariantRule)).toEqual([]);
	});
});
