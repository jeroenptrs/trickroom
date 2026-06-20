import { describe, expect, it } from "vitest";
import {
	assetImageSlotValue,
	assetImageUtility,
	assetImageVarName,
	serializeAssetImageVars,
} from "./asset-background";

describe("asset-background helpers", () => {
	it("builds a clean id-bound utility and matching slot value", () => {
		expect(assetImageVarName("ast_hero")).toBe("--asset-ast_hero");
		expect(assetImageUtility("ast_hero")).toBe(
			"bg-[image:var(--asset-ast_hero)]",
		);
		expect(assetImageSlotValue("ast_hero")).toBe(
			"[image:var(--asset-ast_hero)]",
		);
	});

	it("keeps CSS-safe ids verbatim and disambiguates colliding ones", () => {
		// Safe ids map to themselves.
		expect(assetImageVarName("brand-logo")).toBe("--asset-brand-logo");
		// An id needing sanitization gets a hash suffix...
		expect(assetImageVarName("brand/logo")).toMatch(/^--asset-brand-logo-[a-z0-9]+$/);
		// ...so "brand/logo" and "brand-logo" never share a variable name.
		expect(assetImageVarName("brand/logo")).not.toBe(
			assetImageVarName("brand-logo"),
		);
	});

	it("serializes :root asset vars pointing at the file endpoint", () => {
		const css = serializeAssetImageVars("sys_acme", ["ast_hero", "ast_bg"]);
		expect(css).toContain(
			'--asset-ast_hero: url("/api/trickroom/systems/sys_acme/assets/ast_hero/file");',
		);
		expect(css).toContain("--asset-ast_bg:");
		expect(serializeAssetImageVars("sys_acme", [])).toBe(":root {}");
	});
});
