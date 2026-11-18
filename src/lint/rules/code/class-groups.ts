import { parseClassName } from "../../../utils/tailwind-classname/parse";
import type { LintRuleOptionSpec } from "../../rule-options";
import { compileGlobs, type GlobMatcher } from "../../source/glob";
import type { SourceIndex } from "../../source/index";
import { type SourceClassString, TV_CONFIG_CALLS } from "../../source/parse";

/**
 * Class strings as the guideline class rules (`code.class-restricted`,
 * `code.missing-dark-variant`) see them: the classes that render together.
 * A `className` attribute or a class call (`cn(…)`, `clsx(…)`) is one class
 * string made of all its literals; in a `tv()` or `cva()` config each
 * literal is its own (base, a variant value and a slot do not share an
 * element). Two classes on different sides of one conditional
 * (`on ? "a" : "b"`) never render together. Template fragments are skipped,
 * and so are generated variants files.
 */

export type CodeClassToken = {
	classToken: string;
	entry: SourceClassString;
	/** Which occurrence of the class in its literal, from 0. */
	occurrence: number;
};

export type CodeClassGroup = { file: string; tokens: CodeClassToken[] };

const groupKey = (entry: SourceClassString, index: number) =>
	entry.origin.kind === "call" && TV_CONFIG_CALLS.includes(entry.origin.callee)
		? `literal:${index}`
		: `expression:${entry.expression.line}:${entry.expression.column}`;

/** Every class string of the scanned sources, file by file. */
export const codeClassGroups = (
	sources: SourceIndex,
	skip: GlobMatcher = () => false,
): CodeClassGroup[] => {
	const groups: CodeClassGroup[] = [];
	for (const file of sources.files) {
		if (sources.generated[file] !== undefined || skip(file)) continue;
		const byKey = new Map<string, CodeClassToken[]>();
		for (const [index, entry] of sources.modules[file].classStrings.entries()) {
			if (!entry.complete) continue;
			const key = groupKey(entry, index);
			const tokens = byKey.get(key) ?? [];
			const seen = new Map<string, number>();
			for (const parsed of parseClassName(entry.value)) {
				const occurrence = seen.get(parsed.raw) ?? 0;
				seen.set(parsed.raw, occurrence + 1);
				tokens.push({ classToken: parsed.raw, entry, occurrence });
			}
			byKey.set(key, tokens);
		}
		for (const tokens of byKey.values()) {
			if (tokens.length > 0) groups.push({ file, tokens });
		}
	}
	return groups;
};

/** Whether two classes of one group can render together. */
export const renderTogether = (
	left: CodeClassToken,
	right: CodeClassToken,
): boolean =>
	left.entry === right.entry ||
	!left.entry.branch.some((outer) =>
		right.entry.branch.some(
			(inner) => inner.choice === outer.choice && inner.side !== outer.side,
		),
	);

export const EXCLUDE_FILES_OPTION: LintRuleOptionSpec = {
	key: "exclude",
	label: "Excluded files",
	description:
		"Project-relative file globs this rule does not check, besides generated variants files. One per line.",
	type: "string-list",
	placeholder: "src/legacy/**",
};

/** The `exclude` option as a matcher. */
export const excludedFiles = (options: Record<string, unknown>): GlobMatcher =>
	Array.isArray(options.exclude) && options.exclude.length > 0
		? compileGlobs(options.exclude as string[])
		: () => false;
