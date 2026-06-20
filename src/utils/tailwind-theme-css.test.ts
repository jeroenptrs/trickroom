import { describe, expect, it } from "vitest";
import { serializeTailwindTheme } from "./tailwind-theme-css";

describe("serializeTailwindTheme", () => {
	it("serializes granular red overrides", () => {
		expect(
			serializeTailwindTheme(
				{ "blue-500": "#123456", "red-500": "#ff0000" },
				["--color-red-50", "--color-red-*", "--color-*"],
			),
		).toBe(
			[
				"@theme {",
				"  --color-*: initial;",
				"  --color-red-*: initial;",
				"  --color-red-50: initial;",
				"  --color-blue-500: #123456;",
				"  --color-red-500: #ff0000;",
				"}",
			].join("\n"),
		);
	});
});
