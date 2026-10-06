import { afterEach, describe, expect, it } from "vitest";
import { publishedComponent } from "../../../codegen/test-support";
import {
	buttonPayload,
	cardPayload,
	createFixtures,
	describeFindings,
} from "./test-support";
import {
	requiredAxisMissingRule,
	unknownVariantValueRule,
} from "./variant-values";

const fixtures = createFixtures();
afterEach(fixtures.cleanup);

const button = () => publishedComponent("button", buttonPayload());
const card = () => publishedComponent("card", cardPayload());

const BUTTON_WRAPPER = [
	'import { buttonVariants } from "./button.variants";',
	"export { buttonVariants };",
	"export const Button = (props: Record<string, unknown>) => <button className={buttonVariants(props)} />;",
	"export const ButtonIcon = (props: Record<string, unknown>) => <span {...props} />;",
	"",
].join("\n");

describe("code.unknown-variant-value", () => {
	it("reports literal JSX values the axis does not have, and skips dynamic ones", async () => {
		const fixture = await fixtures.create({
			components: [button()],
			files: {
				"src/ui/button.tsx": BUTTON_WRAPPER,
				"src/app.tsx": [
					'import { Button, ButtonIcon } from "./ui/button";',
					"declare const size: string;",
					"export const App = () => (",
					"\t<>",
					'\t\t<Button variant="danger" size={size} disabled />',
					'\t\t<Button variant={"primary"} size="xl" disabled={false} title="x" />',
					'\t\t<Button variant="ghost" disabled="maybe" />',
					'\t\t<ButtonIcon variant="whatever" />',
					"\t</>",
					");",
					"",
				].join("\n"),
			},
		});
		const findings = await fixture.run(unknownVariantValueRule);
		expect(describeFindings(findings)).toEqual([
			'src/app.tsx:5:11 <Button variant="danger"> passes a value axis "variant" of "button" does not have (expected "primary", "ghost"). Use one of those, or add the value to the component in the system.',
			'src/app.tsx:6:31 <Button size="xl"> passes a value axis "size" of "button" does not have (expected "sm", "md"). Use one of those, or add the value to the component in the system.',
			'src/app.tsx:7:27 <Button disabled="maybe"> passes a value axis "disabled" of "button" does not have (expected true or false). Use one of those, or add the value to the component in the system.',
		]);
		expect(findings.every((finding) => finding.component === "button")).toBe(
			true,
		);
	});

	it("skips a literal a later spread may override, but not one after the spread", async () => {
		const fixture = await fixtures.create({
			components: [button()],
			files: {
				"src/ui/button.tsx": BUTTON_WRAPPER,
				"src/app.tsx": [
					'import { Button } from "./ui/button";',
					'declare const props: { variant: "ghost"; disabled: false };',
					"export const App = () => (",
					"\t<>",
					'\t\t<Button variant="wrong" disabled="maybe" className="opacity-50" {...props} />',
					'\t\t<Button {...props} variant="after" />',
					"\t</>",
					");",
					"",
				].join("\n"),
			},
		});
		expect(
			describeFindings(await fixture.run(unknownVariantValueRule)).map(
				(line) => line.split(" passes")[0],
			),
		).toEqual(['src/app.tsx:6:22 <Button variant="after">']);
	});

	it("checks literal objects passed to the variants export and its slots", async () => {
		const fixture = await fixtures.create({
			components: [button(), card()],
			files: {
				"src/ui/button.tsx": BUTTON_WRAPPER,
				"src/ui/card.tsx": [
					'import { cardVariants } from "./card.variants";',
					"export const Card = (rest: Record<string, unknown>) => {",
					'\tconst styles = cardVariants({ tone: "loud" });',
					'\treturn <div className={styles.root({ tone: "shouty" })}><h2 className={styles.title({ tone: "plain", ...rest })} /><p className={styles.body({ ...rest, tone: "nope" })} /></div>;',
					"};",
					"",
				].join("\n"),
				"src/page.tsx": [
					'import { buttonVariants } from "./ui/button";',
					'export const link = buttonVariants({ variant: "link", size: "sm", class: "x" });',
					"",
				].join("\n"),
			},
		});
		expect(
			describeFindings(await fixture.run(unknownVariantValueRule)),
		).toEqual([
			'src/page.tsx:2:21 buttonVariants(…) passes variant: "link", a value axis "variant" of "button" does not have (expected "primary", "ghost"). Use one of those, or add the value to the component in the system.',
			'src/ui/card.tsx:4:25 the "root" slot call passes tone: "shouty", a value axis "tone" of "card" does not have (expected "plain", "loud"). Use one of those, or add the value to the component in the system.',
			'src/ui/card.tsx:4:131 the "body" slot call passes tone: "nope", a value axis "tone" of "card" does not have (expected "plain", "loud"). Use one of those, or add the value to the component in the system.',
		]);
	});
});

describe("code.required-axis-missing", () => {
	it("reports usages without the required axis, skipping spreads and other exports", async () => {
		const fixture = await fixtures.create({
			components: [button()],
			files: {
				"src/ui/button.tsx": BUTTON_WRAPPER,
				"src/app.tsx": [
					'import * as UI from "./ui/button";',
					'import { Button as B } from "./ui/button";',
					"declare const props: Record<string, unknown>;",
					"export const App = () => (",
					"\t<>",
					'\t\t<B size="sm" />',
					"\t\t<UI.Button {...props} />",
					"\t\t<UI.Button variant={props.v as string} />",
					"\t\t<UI.ButtonIcon />",
					"\t\t<UI.Button />",
					"\t</>",
					");",
					"",
				].join("\n"),
			},
		});
		const findings = await fixture.run(requiredAxisMissingRule);
		expect(describeFindings(findings)).toEqual([
			'src/app.tsx:6:3 <B> omits "variant", a required axis of "button" (no default; expected "primary", "ghost"). Pass it, or give the axis a default in the system.',
			'src/app.tsx:10:3 <UI.Button> omits "variant", a required axis of "button" (no default; expected "primary", "ghost"). Pass it, or give the axis a default in the system.',
		]);
	});

	it("reports variants calls without the axis, skipping spreads and non-literal arguments", async () => {
		const fixture = await fixtures.create({
			components: [button()],
			files: {
				"src/ui/button.tsx": [
					'import { buttonVariants } from "./button.variants";',
					"export const Button = (props: { className?: string }) => <button className={buttonVariants({ class: props.className })} />;",
					"export const a = buttonVariants();",
					"export const b = buttonVariants({ ...props });",
					"export const c = buttonVariants(props);",
					'export const d = buttonVariants({ variant: "ghost" });',
					"declare const props: Record<string, unknown>;",
					"",
				].join("\n"),
			},
		});
		expect(
			describeFindings(await fixture.run(requiredAxisMissingRule)).map(
				(line) => line.split(" omits")[0],
			),
		).toEqual([
			"src/ui/button.tsx:2:77 buttonVariants(…)",
			"src/ui/button.tsx:3:18 buttonVariants(…)",
		]);
	});
});
