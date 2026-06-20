import {
	TAILWIND_TOKEN_DOMAINS,
	type TailwindTokenDomain,
	tokenDomainToCssPropertyName,
} from "./tailwind-token-domains";
import type { TailwindTokenStorage } from "./tailwind-token-store";

function isValidOverrideName(
	domain: TailwindTokenDomain,
	name: string,
): boolean {
	const prefix = tokenDomainToCssPropertyName(domain, "");
	const namespace = prefix.endsWith("-") ? prefix.slice(0, -1) : prefix;
	if (name.toLowerCase() === namespace.toLowerCase()) {
		return true;
	}
	if (!name.toLowerCase().startsWith(`${namespace.toLowerCase()}-`)) {
		return false;
	}
	const suffix = name.slice(namespace.length + 1);
	return suffix.length > 0 && /^[a-z0-9\-_.*/]+$/i.test(suffix);
}

function isValidTokenName(name: string): boolean {
	if (name.length === 0 || name.includes("*") || name.startsWith("--")) {
		return false;
	}
	return /^[a-z0-9\-_.]+$/i.test(name);
}

function isValidValue(value: string): boolean {
	return !/[;{}]/.test(value);
}

function isValidCustomPropertyName(name: string): boolean {
	return name.startsWith("--") && /^--[a-z0-9\-_.]+$/i.test(name);
}

export function serializeTailwindThemeDomains(
	domains: TailwindTokenStorage["domains"],
	customProperties: Record<string, string> = {},
): string {
	const lines: string[] = [];

	for (const domain of TAILWIND_TOKEN_DOMAINS) {
		const storage = domains[domain];
		const validOverrides = storage.overrides
			.filter((override) => isValidOverrideName(domain, override))
			.sort((left, right) => left.localeCompare(right));

		for (const override of validOverrides) {
			lines.push(`  ${override}: initial;`);
		}

		const validTokenNames = Object.keys(storage.tokens)
			.filter(isValidTokenName)
			.sort((left, right) => left.localeCompare(right));

		for (const name of validTokenNames) {
			const value = storage.tokens[name];
			if (isValidValue(value)) {
				lines.push(
					`  ${tokenDomainToCssPropertyName(domain, name)}: ${value};`,
				);
			}
		}
	}

	const customPropertyNames = Object.keys(customProperties)
		.filter(isValidCustomPropertyName)
		.sort((left, right) => left.localeCompare(right));

	for (const name of customPropertyNames) {
		const value = customProperties[name];
		if (isValidValue(value)) {
			lines.push(`  ${name}: ${value};`);
		}
	}

	if (lines.length === 0) {
		return "@theme {}";
	}

	return `@theme {\n${lines.join("\n")}\n}`;
}

/**
 * Backward-compatible color-only serializer for existing callers/tests.
 */
export function serializeTailwindTheme(
	tokens: Record<string, string>,
	overrides: string[],
): string {
	return serializeTailwindThemeDomains({
		color: {
			tokens,
			overrides,
			baselineDiff: { added: [], overridden: [], removed: [] },
		},
		...Object.fromEntries(
			TAILWIND_TOKEN_DOMAINS.filter((domain) => domain !== "color").map(
				(domain) => [
					domain,
					{
						tokens: {},
						overrides: [],
						baselineDiff: { added: [], overridden: [], removed: [] },
					},
				],
			),
		),
	} as TailwindTokenStorage["domains"]);
}
