/**
 * Minimal glob matching for the source walker: `**` (any depth), `*` and
 * `?` within a segment, `{a,b}` alternatives and `[abc]` classes. Patterns
 * and paths are project-relative with `/` separators. No dependency, and
 * no negation: `exclude` globs handle that.
 */

const escapeRegExp = (value: string) =>
	value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

const expandBraces = (pattern: string): string[] => {
	const start = pattern.indexOf("{");
	if (start === -1) {
		return [pattern];
	}
	let depth = 0;
	let end = -1;
	for (let index = start; index < pattern.length; index += 1) {
		const char = pattern[index];
		if (char === "{") depth += 1;
		if (char === "}") {
			depth -= 1;
			if (depth === 0) {
				end = index;
				break;
			}
		}
	}
	if (end === -1) {
		return [pattern];
	}
	const head = pattern.slice(0, start);
	const tail = pattern.slice(end + 1);
	const alternatives: string[] = [];
	let current = "";
	depth = 0;
	for (const char of pattern.slice(start + 1, end)) {
		if (char === "{") depth += 1;
		if (char === "}") depth -= 1;
		if (char === "," && depth === 0) {
			alternatives.push(current);
			current = "";
			continue;
		}
		current += char;
	}
	alternatives.push(current);
	return alternatives.flatMap((alternative) =>
		expandBraces(`${head}${alternative}${tail}`),
	);
};

const segmentToRegExp = (segment: string): string => {
	let out = "";
	for (let index = 0; index < segment.length; index += 1) {
		const char = segment[index];
		if (char === "*") {
			out += "[^/]*";
		} else if (char === "?") {
			out += "[^/]";
		} else if (char === "[") {
			const close = segment.indexOf("]", index + 1);
			if (close === -1) {
				out += "\\[";
			} else {
				const body = segment.slice(index + 1, close);
				out += `[${body.startsWith("!") ? `^${body.slice(1)}` : body}]`;
				index = close;
			}
		} else {
			out += escapeRegExp(char);
		}
	}
	return out;
};

const patternToRegExpSource = (pattern: string): string => {
	const segments = pattern
		.split("/")
		.filter((segment, index) => segment.length > 0 || index === 0);
	const parts: string[] = [];
	segments.forEach((segment, index) => {
		const last = index === segments.length - 1;
		if (segment === "**") {
			parts.push(last ? ".*" : "(?:[^/]+/)*");
			return;
		}
		parts.push(segmentToRegExp(segment) + (last ? "" : "/"));
	});
	return `^${parts.join("")}$`;
};

export type GlobMatcher = (relativePath: string) => boolean;

/** Compile one or more globs into a matcher over `/`-separated paths. */
export const compileGlobs = (patterns: readonly string[]): GlobMatcher => {
	const expressions = patterns
		.map((pattern) => pattern.trim().replace(/^\.\//u, ""))
		.filter((pattern) => pattern.length > 0)
		.flatMap(expandBraces)
		.map((pattern) => new RegExp(patternToRegExpSource(pattern), "u"));
	return (relativePath) =>
		expressions.some((expression) => expression.test(relativePath));
};

/**
 * The literal directory prefix of a glob (segments before the first
 * wildcard), used to prune the walk: `src/**\/*.tsx` -> `src`.
 */
export const globStaticPrefix = (pattern: string): string => {
	const segments = pattern.trim().replace(/^\.\//u, "").split("/");
	const literal: string[] = [];
	for (const segment of segments.slice(0, -1)) {
		if (/[*?[{]/u.test(segment)) {
			break;
		}
		literal.push(segment);
	}
	return literal.join("/");
};
