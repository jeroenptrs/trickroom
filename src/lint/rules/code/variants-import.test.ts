import { writeFile } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { publishedComponent } from "../../../codegen/test-support";
import { runLint } from "../../run-lint";
import {
	buttonPayload,
	cardPayload,
	createFixtures,
	describeFindings,
} from "./test-support";
import {
	componentStylingRestrictedRule,
	variantsImportedOutsideComponentRule,
} from "./variants-import";

const fixtures = createFixtures();
afterEach(fixtures.cleanup);

const button = () => publishedComponent("button", buttonPayload());
const card = () => publishedComponent("card", cardPayload());

const BUTTON_WRAPPER = [
	'import { buttonVariants } from "./button.variants";',
	"export { buttonVariants };",
	'export const Button = () => <button className={buttonVariants({ variant: "primary" })} />;',
	"",
].join("\n");

describe("code.variants-imported-outside-component", () => {
	it("reports every other direct importer when lint.json names the wrapper", async () => {
		const fixture = await fixtures.create({
			components: [button()],
			files: {
				"src/ui/button.tsx": BUTTON_WRAPPER,
				"src/ui/link.tsx":
					'\nimport { buttonVariants } from "./button.variants";\nexport const Link = () => <a className={buttonVariants({ variant: "ghost" })} />;\n',
				"src/ui/types.ts":
					'import type { ButtonVariant } from "./button.variants";\nexport type T = ButtonVariant;\n',
				"src/ui/styles.ts":
					'export { buttonVariants } from "./button.variants";\n',
			},
			lint: { components: { button: { module: "src/ui/button.tsx" } } },
		});
		expect(
			describeFindings(await fixture.run(variantsImportedOutsideComponentRule)),
		).toEqual([
			'src/ui/link.tsx:2:1 src/ui/link.tsx imports src/ui/button.variants.ts directly, but lint.json names src/ui/button.tsx as the "button" component. Import the styling from the wrapper (re-export it there) instead.',
		]);
	});

	it("counts the modules a configured barrel re-exports as the component", async () => {
		const fixture = await fixtures.create({
			components: [button()],
			files: {
				"src/ui/index.ts": 'export { Button } from "./button";\n',
				"src/ui/button.tsx": BUTTON_WRAPPER,
				"src/ui/link.tsx":
					'import { buttonVariants } from "./button.variants";\nexport const Link = () => <a className={buttonVariants({ variant: "ghost" })} />;\n',
			},
			lint: { components: { button: { module: "src/ui/index.ts" } } },
		});
		expect(
			describeFindings(await fixture.run(variantsImportedOutsideComponentRule)),
		).toEqual([
			'src/ui/link.tsx:1:1 src/ui/link.tsx imports src/ui/button.variants.ts directly, but lint.json names src/ui/index.ts (implemented by src/ui/button.tsx) as the "button" component. Import the styling from the wrapper (re-export it there) instead.',
		]);
		const restricted = await fixture.run(componentStylingRestrictedRule, {
			options: { components: { button: { allowIn: [] } } },
		});
		expect(
			restricted.map((finding) =>
				finding.location?.kind === "code" ? finding.location.file : null,
			),
		).toEqual(["src/ui/link.tsx"]);
	});

	it("without configuration, keeps the importer named like the component", async () => {
		const fixture = await fixtures.create({
			components: [button(), card()],
			files: {
				"src/ui/button.tsx": BUTTON_WRAPPER,
				"src/ui/link.tsx":
					'import { buttonVariants } from "./button.variants";\nexport const Link = () => <a className={buttonVariants({ variant: "ghost" })} />;\n',
				"src/ui/card/index.tsx":
					'import { cardVariants } from "../card.variants";\nexport const Card = () => <div className={cardVariants().root()} />;\n',
			},
		});
		expect(
			describeFindings(await fixture.run(variantsImportedOutsideComponentRule)),
		).toEqual([
			expect.stringContaining(
				'src/ui/link.tsx:1:1 src/ui/link.tsx imports src/ui/button.variants.ts directly, but src/ui/button.tsx is the "button" component.',
			),
		]);
	});

	it("without configuration and no conventional name, reports each importer", async () => {
		const fixture = await fixtures.create({
			components: [button()],
			files: {
				"src/ui/a.tsx": BUTTON_WRAPPER,
				"src/ui/b.tsx": BUTTON_WRAPPER,
			},
		});
		const findings = await fixture.run(variantsImportedOutsideComponentRule);
		expect(findings.map((finding) => finding.location)).toEqual([
			{ kind: "code", file: "src/ui/a.tsx", line: 1, column: 1 },
			{ kind: "code", file: "src/ui/b.tsx", line: 1, column: 1 },
		]);
		expect(findings[0].message).toContain("set components.button.module");
	});
});

describe("code.component-styling-restricted", () => {
	const files = {
		"src/ui/button.tsx": BUTTON_WRAPPER,
		"src/ui/card.tsx": [
			'import { cardVariants } from "./card.variants";',
			"export { cardVariants };",
			"export const Card = () => <div className={cardVariants().root()} />;",
			"",
		].join("\n"),
		"src/features/menu.tsx": [
			'import { buttonVariants } from "../ui/button";',
			'import * as ui from "../ui/card";',
			"const styles = ui.cardVariants();",
			'export const Menu = () => <a className={buttonVariants({ variant: "ghost" }) + styles.title()} />;',
			"",
		].join("\n"),
		"src/features/pass.tsx": [
			'import { buttonVariants } from "../ui/button";',
			"export const pass = buttonVariants;",
			"",
		].join("\n"),
		"src/ui/toolbar.tsx": [
			'import { buttonVariants } from "./button";',
			'export const Toolbar = () => <a className={buttonVariants({ variant: "ghost" })} />;',
			"",
		].join("\n"),
	};

	it("does nothing without options", async () => {
		const fixture = await fixtures.create({
			components: [button(), card()],
			files,
		});
		expect(await fixture.run(componentStylingRestrictedRule)).toEqual([]);
	});

	it("reports uses outside allowIn, through re-exports and namespaces, never in the wrapper", async () => {
		const fixture = await fixtures.create({
			components: [button(), card()],
			files,
		});
		const findings = await fixture.run(componentStylingRestrictedRule, {
			options: {
				components: {
					button: { allowIn: ["src/ui/**"] },
					card: { allowIn: [] },
				},
			},
		});
		expect(describeFindings(findings)).toEqual([
			'src/features/menu.tsx:4:41 src/features/menu.tsx uses the styling of "button" (buttonVariants, 1 call), which this rule allows only in src/ui/** and the component\'s wrapper. Render the component instead, or add the file to allowIn.',
			'src/features/menu.tsx:3:16 src/features/menu.tsx uses the styling of "card" (cardVariants, 2 calls), which this rule allows only in the component\'s wrapper. Render the component instead, or add the file to allowIn.',
			'src/features/pass.tsx:1:1 src/features/pass.tsx uses the styling of "button" (buttonVariants, imported), which this rule allows only in src/ui/** and the component\'s wrapper. Render the component instead, or add the file to allowIn.',
		]);
	});

	it("notes invalid options instead of failing", async () => {
		const fixture = await fixtures.create({ components: [button()], files });
		const findings = await fixture.run(componentStylingRestrictedRule, {
			options: {
				components: { button: { allowIn: "src" }, ghost: { allowIn: [] } },
			},
		});
		expect(findings).toEqual([
			expect.objectContaining({
				severity: "info",
				message: expect.stringContaining(
					'components.button.allowIn must be a list of file globs; "button" is not restricted. components.ghost: the system has no component "ghost".',
				),
			}),
		]);
	});
});

describe("code rules through runLint", () => {
	it("runs every code kind with options from lint.json", async () => {
		const fixture = await fixtures.create({
			components: [button(), card()],
			files: {
				"src/ui/button.tsx": BUTTON_WRAPPER,
				"src/ui/card.tsx":
					'import { cardVariants } from "./card.variants";\nexport const Card = () => <div className={cardVariants().root()} />;\n',
				"src/app.tsx": [
					'import { Button } from "./ui/button";',
					'import { Card } from "./ui/card";',
					'export const App = () => <Card tone="loud"><Button variant="danger" className="inline-flex" /><Button /></Card>;',
					"",
				].join("\n"),
				"src/ui/stray.tsx":
					'import { cardVariants } from "./card.variants";\nexport const s = cardVariants({ tone: "plain" }).body();\n',
			},
		});
		await writeFile(
			fixture.project.path(".trickroom/systems/core/lint.json"),
			`${JSON.stringify({
				version: 1,
				rules: {
					"code.component-styling-restricted": {
						options: { components: { card: { allowIn: ["src/ui/card.tsx"] } } },
					},
				},
			})}\n`,
		);
		const result = await runLint({
			projectRoot: fixture.project.root,
			check: true,
		});
		expect(result.diagnostics).toEqual([]);
		const findings = result.report?.findings ?? [];
		expect(
			findings.map(
				(finding) =>
					`${finding.rule} ${finding.severity} ${finding.component ?? "-"} ${finding.location?.kind === "code" ? finding.location.file : "-"}`,
			),
		).toEqual([
			"code.component-styling-restricted warning card src/ui/stray.tsx",
			"code.redundant-class warning button src/app.tsx",
			"code.required-axis-missing error button src/app.tsx",
			// card.tsx, named like the component, is its wrapper; the body()
			// call in stray.tsx borrows the styling and does not count.
			"code.slot-not-called warning card src/ui/card.tsx",
			"code.slot-not-called warning card src/ui/card.tsx",
			"code.unknown-class-token info - -",
			"code.unknown-variant-value error button src/app.tsx",
			"code.variants-imported-outside-component error card src/ui/stray.tsx",
		]);
	});
});
