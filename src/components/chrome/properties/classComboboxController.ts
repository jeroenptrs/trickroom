/**
 * Pure logic for the Classes-tab ClassCombobox (right-rail P5).
 *
 * Provides prefix-filtered suggestions over the known static Tailwind class
 * names plus functional roots. Scope prefixes (e.g. "md:", "hover:") are
 * stripped before matching and re-prepended to every suggestion so the user
 * can type "hover:ring" and get "hover:ring-2", "hover:ring-inset", etc.
 */

export type ClassComboboxOption = {
	value: string;
};

const KNOWN_SCOPE_PREFIXES = new Set([
	"sm",
	"md",
	"lg",
	"xl",
	"2xl",
	"hover",
	"focus",
	"focus-within",
	"focus-visible",
	"active",
	"visited",
	"checked",
	"disabled",
	"enabled",
	"placeholder",
	"before",
	"after",
	"first",
	"last",
	"odd",
	"even",
	"first-child",
	"last-child",
	"only-child",
	"group-hover",
	"group-focus",
	"peer-hover",
	"peer-focus",
	"peer-checked",
	"dark",
	"print",
	"portrait",
	"landscape",
	"motion-reduce",
	"motion-safe",
	"rtl",
	"ltr",
	"open",
]);

/** Extract any leading scope prefix chain (e.g. "md:hover:" → "md:hover:"). */
function extractScopePrefix(input: string): { prefix: string; query: string } {
	const parts = input.split(":");
	if (parts.length < 2) return { prefix: "", query: input };

	// The last segment is the partial class being typed; everything before is scopes.
	const query = parts[parts.length - 1] ?? "";
	const scopeSegments = parts.slice(0, -1);

	// Only treat as scope if every segment is a known scope prefix (or looks like a breakpoint).
	const allValid = scopeSegments.every(
		(seg) => KNOWN_SCOPE_PREFIXES.has(seg) || /^\d+xl?$/.test(seg),
	);
	if (!allValid) return { prefix: "", query: input };

	return { prefix: `${scopeSegments.join(":")}:`, query };
}

const MAX_SUGGESTIONS = 50;

export function filterComboboxOptions(
	input: string,
	staticNames: readonly string[],
	functionalRoots: readonly string[],
): ClassComboboxOption[] {
	const { prefix, query } = extractScopePrefix(input.trim());

	// Empty query after scope prefix: return nothing (too many options to be useful).
	if (query === "") return [];

	const q = query.toLowerCase();
	const results: ClassComboboxOption[] = [];

	// Static names: exact prefix match first, then contains.
	const startsWith: string[] = [];
	const contains: string[] = [];
	for (const name of staticNames) {
		const n = name.toLowerCase();
		if (n.startsWith(q)) startsWith.push(name);
		else if (n.includes(q)) contains.push(name);
	}

	for (const name of [...startsWith, ...contains]) {
		results.push({ value: `${prefix}${name}` });
		if (results.length >= MAX_SUGGESTIONS) return results;
	}

	// Functional roots: only show if the query could match (starts with root or root starts with query).
	for (const root of functionalRoots) {
		const r = root.toLowerCase();
		if (!r.startsWith(q) && !q.startsWith(`${r}-`)) continue;
		// Don't duplicate roots already surfaced via static names.
		const repr = `${prefix}${root}-`;
		if (!results.some((o) => o.value === repr)) {
			results.push({ value: repr });
			if (results.length >= MAX_SUGGESTIONS) return results;
		}
	}

	return results;
}
