import { describe, expect, it } from "vitest";
import { classifyParsedClass } from "./classify";
import { parseClassName } from "./parse";
import {
	getModifierChain,
	getUtilityConflictScope,
	utilityScopesMayConflict,
} from "./scope";

const opts = { colorTokens: new Set<string>() };

function scopeFor(raw: string) {
	const [parsed] = parseClassName(raw);
	const intent = classifyParsedClass(parsed, opts);
	if (intent.kind === "unknown") {
		throw new Error(`Expected ${raw} to classify as a known utility`);
	}
	return getUtilityConflictScope(parsed, intent);
}

describe("modifier-chain class conflict scope", () => {
	it("exposes the exact modifier chain in source order", () => {
		const [parsed] = parseClassName(
			"md:dark:data-[orientation=horizontal]:hover:h-px",
		);

		expect(getModifierChain(parsed)).toEqual({
			modifiers: ["md", "dark", "data-[orientation=horizontal]", "hover"],
			key: "md:dark:data-[orientation=horizontal]:hover",
			scoped: true,
		});
		expect(parsed.modes).toEqual(["dark"]);
		expect(parsed.variants).toEqual([
			"md",
			"data-[orientation=horizontal]",
			"hover",
		]);
	});

	it("lets the same utility group and same modifier chain conflict", () => {
		const first = scopeFor("data-[orientation=horizontal]:h-px");
		const second = scopeFor("data-[orientation=horizontal]:h-2");

		expect(first.utilityGroup).toBe("style:size.height");
		expect(second.utilityGroup).toBe("style:size.height");
		expect(utilityScopesMayConflict(first, second)).toBe(true);
	});

	it("does not conflict the same utility group across different modifier chains", () => {
		const horizontal = scopeFor("data-[orientation=horizontal]:h-px");
		const vertical = scopeFor("data-[orientation=vertical]:h-px");
		const hover = scopeFor("hover:h-2");
		const focus = scopeFor("focus:h-4");

		expect(utilityScopesMayConflict(horizontal, vertical)).toBe(false);
		expect(utilityScopesMayConflict(hover, focus)).toBe(false);
	});

	it("keeps unscoped and scoped utilities distinct by default", () => {
		const scoped = scopeFor("data-[orientation=horizontal]:h-px");
		const unscoped = scopeFor("h-2");

		expect(scoped.modifierChain.key).toBe("data-[orientation=horizontal]");
		expect(unscoped.modifierChain.key).toBe("");
		expect(utilityScopesMayConflict(scoped, unscoped)).toBe(false);
	});

	it("does not conflict different utility groups in the same modifier chain", () => {
		const height = scopeFor("data-[orientation=horizontal]:h-px");
		const width = scopeFor("data-[orientation=horizontal]:w-full");

		expect(height.utilityGroup).toBe("style:size.height");
		expect(width.utilityGroup).toBe("style:size.width");
		expect(utilityScopesMayConflict(height, width)).toBe(false);
	});
});
