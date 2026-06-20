import { describe, expect, it } from "vitest";
import { defaultTailwindTokensByDomain } from "./default-tailwind-tokens";
import {
	buildResolvedTokenContext,
	computeResolvedDomainTokens,
} from "./resolved-tailwind-domain-tokens";
import type { TailwindTokenStorageV2 } from "./tailwind-token-store";

const defaultRadiusNames = new Set(
	Object.keys(defaultTailwindTokensByDomain.radius),
);

describe("computeResolvedDomainTokens", () => {
	it("returns bundled defaults when no overrides are supplied", () => {
		const resolved = computeResolvedDomainTokens({ domain: "radius" });

		expect(resolved.names).toEqual(defaultRadiusNames);
		for (const name of defaultRadiusNames) {
			expect(resolved.values.get(name)).toBe(
				defaultTailwindTokensByDomain.radius[
					name as keyof typeof defaultTailwindTokensByDomain.radius
				],
			);
		}
	});

	it("layers meaningful tokens on top of defaults", () => {
		const resolved = computeResolvedDomainTokens({
			domain: "radius",
			meaningfulTokens: { card: "1.25rem" },
		});

		expect(resolved.names.has("card")).toBe(true);
		expect(resolved.values.get("card")).toBe("1.25rem");
		expect(resolved.names.has("lg")).toBe(true);
	});

	it("removes defaults explicitly marked as removed", () => {
		const resolved = computeResolvedDomainTokens({
			domain: "font",
			removed: ["mono"],
		});

		expect(resolved.names.has("mono")).toBe(false);
		expect(resolved.names.has("sans")).toBe(true);
	});

	it("accepts removed entries as objects with a name field", () => {
		const resolved = computeResolvedDomainTokens({
			domain: "spacing",
			removed: [{ name: "card", defaultValue: "2rem", domain: "spacing" }],
		});

		expect(resolved.names.has("card")).toBe(false);
	});
});

describe("buildResolvedTokenContext", () => {
	it("builds resolved token names for every stored domain", () => {
		const storage = {
			version: 2,
			metadata: {
				cssPath: "src/index.css",
				syncedAt: "2026-01-01T00:00:00.000Z",
				tailwindBaselineVersion: "test",
				reviewRequired: false,
			},
			domains: Object.fromEntries(
				Object.keys(defaultTailwindTokensByDomain).map((domain) => [
					domain,
					{
						tokens: {},
						overrides: [],
						baselineDiff: { added: [], overridden: [], removed: [] },
					},
				]),
			),
		} as TailwindTokenStorageV2;

		storage.domains.font = {
			tokens: { display: "Display, sans-serif" },
			overrides: [],
			baselineDiff: {
				added: [
					{
						name: "display",
						value: "Display, sans-serif",
						domain: "font",
					},
				],
				overridden: [],
				removed: [{ name: "mono", defaultValue: "mono", domain: "font" }],
			},
		};

		const context = buildResolvedTokenContext(storage);

		expect(context.font.has("display")).toBe(true);
		expect(context.font.has("mono")).toBe(false);
		expect(context.font.has("sans")).toBe(true);
		expect(context.radius.has("lg")).toBe(true);
	});
});
