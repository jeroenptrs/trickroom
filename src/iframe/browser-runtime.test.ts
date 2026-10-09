import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"../..",
);

describe("vendored Tailwind browser runtime", () => {
	// The shell loads `public/tailwind/index.global.js`, a copy of
	// `@tailwindcss/browser`'s build. Bumping the dependency does not refresh
	// it: copy `node_modules/@tailwindcss/browser/dist/index.global.js` over it.
	it("matches the installed @tailwindcss/browser build", () => {
		const vendored = readFileSync(
			path.join(repoRoot, "public/tailwind/index.global.js"),
			"utf8",
		);
		const installed = readFileSync(
			require.resolve("@tailwindcss/browser"),
			"utf8",
		);
		expect(vendored === installed).toBe(true);
	});
});
