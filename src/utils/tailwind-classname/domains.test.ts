import { describe, expect, it } from "vitest";
import { classifyParsedClass, parseClassName, UTILITY_DOMAINS } from "./index";

const opts = { colorTokens: new Set(["red-500", "blue-500"]) };

describe("UTILITY_DOMAINS registry", () => {
	it("runs custom-functional first (DS utilities win ambiguous prefixes), then color before spacing", () => {
		expect(UTILITY_DOMAINS.map((d) => d.kind)).toEqual([
			"custom-functional",
			"color",
			"spacing",
			"style",
		]);
	});

	it("does not claim built-in classes when no custom roots are configured", () => {
		// custom-functional returns null without roots, so built-ins classify
		// exactly as before the reorder.
		const kinds = parseClassName("bg-red-500 text-sm p-4").map(
			(parsed) => classifyParsedClass(parsed, opts).kind,
		);
		expect(kinds).toEqual(["color", "style", "spacing"]);
	});
});
