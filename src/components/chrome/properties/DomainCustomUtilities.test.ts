import { describe, expect, it } from "vitest";
import { selectCustomUtilitiesForDomain } from "./DomainCustomUtilities";

const domainsByRoot = new Map<string, readonly string[]>([
	["bg-penn-app", ["background"]],
	["text-interaction", ["typography"]],
	["core-interaction-primary", ["interaction", "typography"]],
]);

const context = {
	colorTokens: new Set<string>(),
	customFunctionalUtilityRoots: ["text-interaction"],
	customStaticUtilityRoots: ["bg-penn-app", "core-interaction-primary"],
};

describe("selectCustomUtilitiesForDomain", () => {
	const className =
		"flex bg-penn-app text-interaction-sm core-interaction-primary bg-blue-500";

	it("selects static utilities folding into the domain", () => {
		expect(
			selectCustomUtilitiesForDomain({
				className,
				domain: "background",
				context,
				domainsByRoot,
			}),
		).toEqual(["bg-penn-app"]);
	});

	it("selects functional + multi-domain utilities under typography", () => {
		expect(
			selectCustomUtilitiesForDomain({
				className,
				domain: "typography",
				context,
				domainsByRoot,
			}),
		).toEqual(["text-interaction-sm", "core-interaction-primary"]);
	});

	it("includes a multi-domain utility under each of its domains", () => {
		expect(
			selectCustomUtilitiesForDomain({
				className,
				domain: "interaction",
				context,
				domainsByRoot,
			}),
		).toEqual(["core-interaction-primary"]);
	});

	it("returns nothing for a domain with no matching custom utilities", () => {
		expect(
			selectCustomUtilitiesForDomain({
				className,
				domain: "spacing",
				context,
				domainsByRoot,
			}),
		).toEqual([]);
	});

	it("ignores built-in classes", () => {
		expect(
			selectCustomUtilitiesForDomain({
				className: "bg-blue-500 flex p-4",
				domain: "background",
				context,
				domainsByRoot,
			}),
		).toEqual([]);
	});
});
