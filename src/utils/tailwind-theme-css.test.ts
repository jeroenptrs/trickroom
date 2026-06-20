import { describe, expect, it } from "vitest";
import {
	serializeTailwindTheme,
	serializeTailwindThemeDomains,
} from "./tailwind-theme-css";
import {
	TAILWIND_TOKEN_DOMAINS,
	type TailwindTokenDomain,
} from "./tailwind-token-domains";
import type { TailwindDomainStorage } from "./tailwind-token-store";

function emptyDomainStorage(): TailwindDomainStorage {
	return {
		tokens: {},
		overrides: [],
		baselineDiff: { added: [], overridden: [], removed: [] },
	};
}

function emptyDomainStorages(): Record<
	TailwindTokenDomain,
	TailwindDomainStorage
> {
	return Object.fromEntries(
		TAILWIND_TOKEN_DOMAINS.map((domain) => [domain, emptyDomainStorage()]),
	) as Record<TailwindTokenDomain, TailwindDomainStorage>;
}

describe("serializeTailwindTheme", () => {
	it("serializes granular red overrides", () => {
		expect(
			serializeTailwindTheme({ "blue-500": "#123456", "red-500": "#ff0000" }, [
				"--color-red-50",
				"--color-red-*",
				"--color-*",
			]),
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

	it("serializes exact namespace overrides for default token domains", () => {
		const domains = emptyDomainStorages();
		domains.spacing = {
			tokens: { DEFAULT: "0.25rem" },
			overrides: ["--spacing"],
			baselineDiff: { added: [], overridden: [], removed: [] },
		};

		expect(serializeTailwindThemeDomains(domains)).toBe(
			["@theme {", "  --spacing: initial;", "  --spacing: 0.25rem;", "}"].join(
				"\n",
			),
		);
	});
});
