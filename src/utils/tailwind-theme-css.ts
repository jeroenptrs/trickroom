/**
 * Serializes Tailwind color tokens and overrides into a Tailwind 4 @theme block.
 *
 * Requirements:
 * - Deterministic output (sorted overrides, then sorted tokens).
 * - Overrides emit as `--name: initial;`.
 * - Tokens emit as `--color-name: value;`.
 * - Safe validation for names and values.
 */

/**
 * Validates a color override name.
 * Requires the `--color-` prefix and a non-empty suffix.
 * Suffix allows ASCII letters, digits, hyphen, underscore, dot, and `*`.
 */
function isValidColorOverrideName(name: string): boolean {
	if (!name.startsWith("--color-")) {
		return false;
	}
	const suffix = name.slice("--color-".length);
	return suffix.length > 0 && /^[a-z0-9\-_.*]+$/i.test(suffix);
}

/**
 * Validates a color token name.
 * Requires a non-empty name, disallows `*`, disallows starting with `--`.
 * Allows ASCII letters, digits, hyphen, underscore, and dot.
 */
function isValidColorTokenName(name: string): boolean {
	if (name.length === 0 || name.includes("*") || name.startsWith("--")) {
		return false;
	}
	return /^[a-z0-9\-_.]+$/i.test(name);
}

/**
 * Validates a CSS value.
 * Basic protection against CSS injection by disallowing characters that can break the declaration or block.
 */
function isValidValue(value: string): boolean {
	// Disallow characters that could terminate a declaration or block
	return !/[;{}]/.test(value);
}

/**
 * Serializes stored Tailwind color tokens and confirmed overrides into safe CSS for a @theme block.
 *
 * @param tokens - Record of token names (e.g., "blue-500") to values (e.g., "#3b82f6").
 * @param overrides - List of full property names to reset (e.g., "--color-*").
 * @returns A complete @theme { ... } block as a string.
 */
export function serializeTailwindTheme(
	tokens: Record<string, string>,
	overrides: string[],
): string {
	const lines: string[] = [];

	// 1. Process and sort overrides
	const validOverrides = overrides
		.filter(isValidColorOverrideName)
		.sort((a, b) => a.localeCompare(b));

	for (const override of validOverrides) {
		lines.push(`  ${override}: initial;`);
	}

	// 2. Process and sort tokens
	const validTokenNames = Object.keys(tokens)
		.filter(isValidColorTokenName)
		.sort((a, b) => a.localeCompare(b));

	for (const name of validTokenNames) {
		const value = tokens[name];
		if (isValidValue(value)) {
			lines.push(`  --color-${name}: ${value};`);
		}
	}

	if (lines.length === 0) {
		return "@theme {}";
	}

	return `@theme {\n${lines.join("\n")}\n}`;
}
