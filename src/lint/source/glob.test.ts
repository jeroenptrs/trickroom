import { describe, expect, it } from "vitest";
import { compileGlobs, globStaticPrefix } from "./glob";

describe("globs", () => {
	it("matches segments, globstars, braces and classes", () => {
		const match = compileGlobs([
			"src/**/*.{ts,tsx}",
			"app/[a-c]*.js",
			"./lib/?.ts",
		]);
		expect(match("src/a.ts")).toBe(true);
		expect(match("src/deep/er/b.tsx")).toBe(true);
		expect(match("src/a.js")).toBe(false);
		expect(match("srcx/a.ts")).toBe(false);
		expect(match("app/beta.js")).toBe(true);
		expect(match("app/delta.js")).toBe(false);
		expect(match("lib/x.ts")).toBe(true);
		expect(match("lib/xy.ts")).toBe(false);
		expect(compileGlobs(["**/*.d.ts"])("types/global.d.ts")).toBe(true);
		expect(compileGlobs(["**/*.d.ts"])("global.d.ts")).toBe(true);
		expect(compileGlobs(["**"])("anything/at/all")).toBe(true);
		expect(compileGlobs([])("x")).toBe(false);
	});

	it("extracts the literal prefix for pruning", () => {
		expect(globStaticPrefix("src/**/*.tsx")).toBe("src");
		expect(globStaticPrefix("packages/ui/src/*.ts")).toBe("packages/ui/src");
		expect(globStaticPrefix("**/*.ts")).toBe("");
		expect(globStaticPrefix("./src/{a,b}/*.ts")).toBe("src");
	});
});
