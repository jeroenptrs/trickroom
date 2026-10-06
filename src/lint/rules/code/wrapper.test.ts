import { afterEach, describe, expect, it } from "vitest";
import { publishedComponent } from "../../../codegen/test-support";
import {
	buttonPayload,
	cardPayload,
	createFixtures,
	describeFindings,
} from "./test-support";
import { slotNotCalledRule, wrapperMissingVariantsCallRule } from "./wrapper";

const fixtures = createFixtures();
afterEach(fixtures.cleanup);

const button = () => publishedComponent("button", buttonPayload());
const card = () => publishedComponent("card", cardPayload());

describe("code.wrapper-missing-variants-call", () => {
	it("passes a wrapper that calls the export, directly or through an alias", async () => {
		const fixture = await fixtures.create({
			components: [button(), card()],
			files: {
				"src/ui/button.tsx":
					'import { buttonVariants as bv } from "./button.variants";\nexport const Button = () => <button className={bv({ variant: "primary" })} />;\n',
				"src/ui/card.tsx":
					'import * as styles from "./card.variants";\nexport const Card = () => <div className={styles.cardVariants().root()} />;\n',
			},
		});
		expect(await fixture.run(wrapperMissingVariantsCallRule)).toEqual([]);
	});

	it("reports a wrapper that imports but never calls the export", async () => {
		const fixture = await fixtures.create({
			components: [button()],
			files: {
				"src/ui/button.tsx":
					'import { cn } from "./cn";\nimport { buttonVariants } from "./button.variants";\nexport const Button = () => <button className={cn("p-1")} />;\nexport { buttonVariants };\n',
				"src/ui/cn.ts": "export const cn = (...v: string[]) => v.join(' ');\n",
			},
		});
		const findings = await fixture.run(wrapperMissingVariantsCallRule);
		expect(describeFindings(findings)).toEqual([
			expect.stringMatching(
				/^src\/ui\/button\.tsx:2:1 src\/ui\/button\.tsx is the wrapper of "button" but never calls buttonVariants/u,
			),
		]);
		expect(findings[0].component).toBe("button");
	});

	it("does not count a shadowed name or a re-exporter", async () => {
		const fixture = await fixtures.create({
			components: [button()],
			files: {
				"src/ui/button.tsx":
					'import { buttonVariants } from "./button.variants";\nexport const Button = ({ buttonVariants }: { buttonVariants: () => string }) => <button className={buttonVariants()} />;\n',
				"src/ui/styles.ts":
					'export { buttonVariants } from "./button.variants";\n',
			},
		});
		const findings = await fixture.run(wrapperMissingVariantsCallRule);
		expect(findings.map((finding) => finding.location)).toEqual([
			{ kind: "code", file: "src/ui/button.tsx", line: 1, column: 1 },
		]);
	});

	it("reports a configured wrapper that never imports the export", async () => {
		const fixture = await fixtures.create({
			components: [button()],
			files: {
				"src/ui/index.ts": 'export { Button } from "./button";\n',
				"src/ui/button.tsx":
					'import { buttonVariants } from "./button.variants";\nexport const Button = () => <button className={buttonVariants({ variant: "ghost" })} />;\n',
			},
			lint: { components: { button: { module: "src/ui/index.ts" } } },
		});
		expect(
			describeFindings(await fixture.run(wrapperMissingVariantsCallRule)),
		).toEqual([
			expect.stringContaining(
				'src/ui/index.ts:1:1 src/ui/index.ts is configured as the wrapper of "button" in lint.json but never imports or calls buttonVariants',
			),
		]);
	});
});

describe("code.slot-not-called", () => {
	it("passes when every slot is invoked, through bindings, destructuring or the call result", async () => {
		const fixture = await fixtures.create({
			components: [card()],
			files: {
				"src/ui/card.tsx": [
					'import { cardVariants } from "./card.variants";',
					"export const Card = () => {",
					"\tconst styles = cardVariants();",
					"\tconst { body } = cardVariants();",
					"\treturn <div className={styles.root()}><h2 className={cardVariants().title()} /><p className={body()} /></div>;",
					"};",
					"",
				].join("\n"),
			},
		});
		expect(await fixture.run(slotNotCalledRule)).toEqual([]);
	});

	it("reports slots that are referenced but not invoked, across every wrapper", async () => {
		const fixture = await fixtures.create({
			components: [card()],
			files: {
				"src/ui/card.tsx": [
					'import { cardVariants } from "./card.variants";',
					"const styles = cardVariants();",
					"export const Card = () => <div className={styles.root()} data-x={styles.title} />;",
					"",
				].join("\n"),
			},
		});
		const findings = await fixture.run(slotNotCalledRule);
		expect(describeFindings(findings)).toEqual([
			expect.stringMatching(/^src\/ui\/card\.tsx:2:16 Slot "title" of "card"/u),
			expect.stringMatching(/^src\/ui\/card\.tsx:2:16 Slot "body" of "card"/u),
		]);
	});

	it("does not follow a shadowed binding to the variants call", async () => {
		const fixture = await fixtures.create({
			components: [card()],
			files: {
				"src/ui/card.tsx": [
					'import { cardVariants } from "./card.variants";',
					"const styles = cardVariants();",
					"export const Card = (styles: { root: () => string; title: () => string; body: () => string }) => <div className={styles.root() + styles.title() + styles.body()} />;",
					"",
				].join("\n"),
			},
		});
		expect(
			(await fixture.run(slotNotCalledRule)).map((finding) => finding.message),
		).toHaveLength(3);
	});

	it("skips flat components, unbound components and wrappers without a variants call", async () => {
		const fixture = await fixtures.create({
			components: [button(), card()],
			files: {
				"src/ui/button.tsx":
					'import { buttonVariants } from "./button.variants";\nexport const Button = () => <button className={buttonVariants({ variant: "primary" })} />;\n',
				"src/ui/card.tsx":
					'import { cardVariants } from "./card.variants";\nexport const Card = () => <div data-styles={cardVariants} />;\n',
			},
		});
		expect(await fixture.run(slotNotCalledRule)).toEqual([]);
	});
});
