import {
	type DefaultClassGroupIds,
	type DefaultThemeGroupIds,
	getDefaultConfig,
} from "tailwind-merge";
import {
	type LoadTailwindDesignSystemOptions,
	loadCachedTailwindDesignSystem,
} from "./tailwind-design-system";
import {
	type CandidateAstNode,
	createTailwindIntrospection,
	type TailwindIntrospection,
} from "./tailwind-introspection";
import type { TwMergeConfig } from "./tailwind-merge-config";

/**
 * Derives a tailwind-merge configuration from a project's Tailwind design
 * system, so merging (tv(), `twMerge`, the redundant-class lint rule)
 * understands the project's tokens and custom utilities instead of a
 * hand-maintained list.
 *
 * - Theme: tailwind-merge's theme keys are Tailwind's theme namespaces
 *   (`color` ↔ `--color-*`, `text` ↔ `--text-*`, `spacing` ↔ `--spacing-*`),
 *   so each key lists the keys of its namespace.
 * - Custom `@utility` classes are classified by the CSS Tailwind generates
 *   for them: a class whose declarations are those of a stock utility's
 *   (compiled from an arbitrary-value probe through the same design system)
 *   joins that utility's class group. `text-label-sm` sets font-size (and
 *   line-height, font-weight, letter-spacing, which Tailwind's own `text-*`
 *   sets from theme sub-keys) and merges like `text-sm`; `bg-brand-ui`
 *   sets background-color, also under `:hover` and `.dark`, and merges
 *   like `bg-red-500`. A class that matches no single group (a component
 *   class setting background, colour and padding) is left out and listed
 *   in `unclassified`: tailwind-merge then keeps it, as it would anyway.
 */

export type TwMergeUnclassifiedUtility = {
	/** The class, or `root-*` when every value of a functional utility is unclassified. */
	utility: string;
	/** The CSS properties it sets, sorted; empty when it sets only custom properties. */
	properties: string[];
};

export type DerivedTwMerge = {
	config: TwMergeConfig;
	unclassified: TwMergeUnclassifiedUtility[];
};

type GroupProbe = {
	group: DefaultClassGroupIds;
	/** A stock candidate of the group, theme-independent (arbitrary values). */
	candidate: string;
	/** Properties a member may set besides the probe's. */
	also?: readonly string[];
};

/**
 * The class groups a custom utility can join, each with a stock candidate
 * whose generated CSS defines the group's declarations. First match wins.
 */
export const TW_MERGE_GROUP_PROBES: readonly GroupProbe[] = [
	// Tailwind's `text-*` sets line-height, letter-spacing and font-weight too
	// when the theme has `--text-*--line-height` (and the other sub-keys).
	{
		group: "font-size",
		candidate: "text-[1px]",
		also: ["line-height", "letter-spacing", "font-weight"],
	},
	{ group: "font-weight", candidate: "font-[700]" },
	{ group: "font-family", candidate: "font-[family-name:x]" },
	{ group: "leading", candidate: "leading-[2]" },
	{ group: "tracking", candidate: "tracking-[1px]" },
	{ group: "text-color", candidate: "text-[red]" },
	{ group: "text-decoration-color", candidate: "decoration-[red]" },
	{ group: "placeholder-color", candidate: "placeholder-[red]" },
	{ group: "bg-color", candidate: "bg-[red]" },
	{ group: "bg-image", candidate: "bg-[url(x)]" },
	{ group: "border-color", candidate: "border-[red]" },
	{ group: "border-color-x", candidate: "border-x-[red]" },
	{ group: "border-color-y", candidate: "border-y-[red]" },
	{ group: "border-color-s", candidate: "border-s-[red]" },
	{ group: "border-color-e", candidate: "border-e-[red]" },
	{ group: "border-color-t", candidate: "border-t-[red]" },
	{ group: "border-color-r", candidate: "border-r-[red]" },
	{ group: "border-color-b", candidate: "border-b-[red]" },
	{ group: "border-color-l", candidate: "border-l-[red]" },
	{ group: "divide-color", candidate: "divide-[red]" },
	{ group: "outline-color", candidate: "outline-[red]" },
	{ group: "rounded", candidate: "rounded-[1px]" },
	{ group: "rounded-t", candidate: "rounded-t-[1px]" },
	{ group: "rounded-r", candidate: "rounded-r-[1px]" },
	{ group: "rounded-b", candidate: "rounded-b-[1px]" },
	{ group: "rounded-l", candidate: "rounded-l-[1px]" },
	{ group: "shadow", candidate: "shadow-[0_0_red]" },
	{ group: "opacity", candidate: "opacity-[0.5]" },
	{ group: "fill", candidate: "fill-[red]" },
	{ group: "stroke", candidate: "stroke-[red]" },
	{ group: "caret-color", candidate: "caret-[red]" },
	{ group: "accent", candidate: "accent-[red]" },
	{ group: "p", candidate: "p-[1px]" },
	{ group: "px", candidate: "px-[1px]" },
	{ group: "py", candidate: "py-[1px]" },
	{ group: "ps", candidate: "ps-[1px]" },
	{ group: "pe", candidate: "pe-[1px]" },
	{ group: "pt", candidate: "pt-[1px]" },
	{ group: "pr", candidate: "pr-[1px]" },
	{ group: "pb", candidate: "pb-[1px]" },
	{ group: "pl", candidate: "pl-[1px]" },
	{ group: "m", candidate: "m-[1px]" },
	{ group: "mx", candidate: "mx-[1px]" },
	{ group: "my", candidate: "my-[1px]" },
	{ group: "ms", candidate: "ms-[1px]" },
	{ group: "me", candidate: "me-[1px]" },
	{ group: "mt", candidate: "mt-[1px]" },
	{ group: "mr", candidate: "mr-[1px]" },
	{ group: "mb", candidate: "mb-[1px]" },
	{ group: "ml", candidate: "ml-[1px]" },
	{ group: "gap", candidate: "gap-[1px]" },
	{ group: "gap-x", candidate: "gap-x-[1px]" },
	{ group: "gap-y", candidate: "gap-y-[1px]" },
	{ group: "space-x", candidate: "space-x-[1px]" },
	{ group: "space-y", candidate: "space-y-[1px]" },
	{ group: "size", candidate: "size-[1px]" },
	{ group: "w", candidate: "w-[1px]" },
	{ group: "h", candidate: "h-[1px]" },
	{ group: "min-w", candidate: "min-w-[1px]" },
	{ group: "min-h", candidate: "min-h-[1px]" },
	{ group: "max-w", candidate: "max-w-[1px]" },
	{ group: "max-h", candidate: "max-h-[1px]" },
	{ group: "z", candidate: "z-[1]" },
];

export const compareTwMergeValues = (left: string, right: string) =>
	left.localeCompare(right, "en", { numeric: true }) ||
	(left < right ? -1 : left > right ? 1 : 0);

const sortedUnique = (values: Iterable<string>) =>
	[...new Set(values)].sort(compareTwMergeValues);

/**
 * Drops pseudo-classes that do not wrap the element itself (`:hover`,
 * `:where(.dark, .dark *)`, `:not(:last-child)`), so the variants a
 * utility applies under (`hover:`, `dark:`) do not change where its
 * declarations land. Pseudo-elements (`::placeholder`) and pseudo-classes
 * around `&` (`:where(& > …)`) stay.
 */
const stripPseudoClasses = (selector: string): string => {
	let result = "";
	let index = 0;
	const readParens = (start: number) => {
		let depth = 0;
		let end = start;
		do {
			if (selector[end] === "(") depth++;
			else if (selector[end] === ")") depth--;
			end++;
		} while (depth > 0 && end < selector.length);
		return end;
	};
	while (index < selector.length) {
		const char = selector[index];
		if (char === "\\") {
			result += selector.slice(index, index + 2);
			index += 2;
			continue;
		}
		if (char !== ":") {
			result += char;
			index++;
			continue;
		}
		const pseudoElement = selector[index + 1] === ":";
		let end = index + (pseudoElement ? 2 : 1);
		while (end < selector.length && /[\w-]/u.test(selector[end])) end++;
		const name = selector.slice(index, end);
		let args: string | null = null;
		if (selector[end] === "(") {
			const close = readParens(end);
			args = selector.slice(end + 1, close - 1);
			end = close;
		}
		if (pseudoElement) {
			result += args === null ? name : `${name}(${args})`;
		} else if (args?.includes("&")) {
			result += `${name}(${stripPseudoClasses(args)})`;
		}
		index = end;
	}
	return result;
};

/** The candidate's own class in its top-level selector becomes `&`. */
const CLASS_SELECTOR = /\.(?:\\.|[^\s.#:,>+~()[\]\\])+/u;

const scopeOf = (selector: string) =>
	stripPseudoClasses(selector).replace(/\s+/gu, " ").trim();

/**
 * Where each declaration lands (`&`, `&::placeholder`, `:where(& > )`)
 * with its property, as `scope|property`. Custom properties, `@property`
 * and `@keyframes` are left out; at-rules (`@media`) are transparent.
 */
const declarationsOf = (nodes: readonly CandidateAstNode[]): Set<string> => {
	const declarations = new Set<string>();
	const walk = (list: readonly CandidateAstNode[], selector: string | null) => {
		for (const node of list) {
			if (node.kind === "declaration") {
				const property = node.property?.toLowerCase();
				if (selector === null || !property || property.startsWith("--"))
					continue;
				declarations.add(`${scopeOf(selector)}|${property}`);
			} else if (node.kind === "rule" && node.selector !== undefined) {
				const next =
					selector === null
						? node.selector.replace(CLASS_SELECTOR, "&")
						: node.selector.includes("&")
							? node.selector.replaceAll("&", selector)
							: `${selector} ${node.selector}`;
				walk(node.nodes ?? [], next);
			} else if (node.kind === "at-rule") {
				const name = node.name?.replace(/^@/u, "");
				if (name === "property" || name === "keyframes") continue;
				walk(node.nodes ?? [], selector);
			} else if (node.nodes) {
				walk(node.nodes, selector);
			}
		}
	};
	walk(nodes, null);
	return declarations;
};

const propertiesOf = (declarations: ReadonlySet<string>) =>
	sortedUnique(
		[...declarations].map((entry) => entry.slice(entry.lastIndexOf("|") + 1)),
	);

type CompiledProbe = {
	group: DefaultClassGroupIds;
	required: ReadonlySet<string>;
	allowed: ReadonlySet<string>;
};

const compileProbes = (introspection: TailwindIntrospection) =>
	TW_MERGE_GROUP_PROBES.flatMap((probe): CompiledProbe[] => {
		const ast = introspection.getCandidateAst(probe.candidate);
		if (!ast) return [];
		const required = declarationsOf(ast);
		if (required.size === 0) return [];
		const scopes = new Set(
			[...required].map((entry) => entry.slice(0, entry.lastIndexOf("|"))),
		);
		const allowed = new Set(required);
		for (const property of probe.also ?? []) {
			for (const scope of scopes) allowed.add(`${scope}|${property}`);
		}
		return [{ group: probe.group, required, allowed }];
	});

/**
 * The class group a set of declarations belongs to: it sets every
 * declaration of the group's probe and nothing the group does not allow.
 */
const classify = (
	declarations: ReadonlySet<string>,
	probes: readonly CompiledProbe[],
): DefaultClassGroupIds | null => {
	if (declarations.size === 0) return null;
	for (const probe of probes) {
		if (
			[...probe.required].every((entry) => declarations.has(entry)) &&
			[...declarations].every((entry) => probe.allowed.has(entry))
		) {
			return probe.group;
		}
	}
	return null;
};

/**
 * Per tailwind-merge theme key, the keys of the namespace of the same name.
 * Sub-keys (`--text-sm--line-height`), the bare namespace (`--spacing`) and
 * keys of a longer namespace (`--font-weight-*` under `--font`,
 * `--text-shadow-*` under `--text`) are left out.
 */
const deriveTheme = (
	introspection: TailwindIntrospection,
): TwMergeConfig["extend"]["theme"] => {
	const keys = Object.keys(getDefaultConfig().theme).sort(
		compareTwMergeValues,
	) as DefaultThemeGroupIds[];
	const theme: TwMergeConfig["extend"]["theme"] = {};
	for (const key of keys) {
		const longer = keys
			.filter((other) => other.startsWith(`${key}-`))
			.map((other) => `${other.slice(key.length + 1)}-`);
		const values = sortedUnique(
			[...introspection.resolveNamespace(`--${key}`).keys()].filter(
				(value): value is string =>
					value !== null &&
					value.length > 0 &&
					!value.includes("--") &&
					!longer.some((prefix) => value.startsWith(prefix)),
			),
		);
		if (values.length > 0) theme[key] = values;
	}
	return theme;
};

/** Candidates of a custom `@utility` root: the static class and every functional value. */
const candidatesOf = (introspection: TailwindIntrospection, root: string) => {
	const candidates: Array<{ candidate: string; functional: boolean }> = [];
	if (introspection.hasUtility(root, "static")) {
		candidates.push({ candidate: root, functional: false });
	}
	if (introspection.hasUtility(root, "functional")) {
		const values = introspection
			.getCompletions(root)
			.flatMap((group) => group.values);
		for (const value of sortedUnique(
			values.map((value) => (value === null ? root : `${root}-${value}`)),
		)) {
			if (value !== root || candidates.length === 0) {
				candidates.push({ candidate: value, functional: true });
			}
		}
	}
	return candidates;
};

export const deriveTwMergeConfig = (
	introspection: TailwindIntrospection,
): DerivedTwMerge => {
	const probes = compileProbes(introspection);
	const groups = new Map<DefaultClassGroupIds, Set<string>>();
	const unclassified = new Map<string, Set<string>>();
	const roots = sortedUnique(
		introspection.getCustomFunctionalUtilities().map((utility) => utility.root),
	);
	for (const root of roots) {
		const candidates = candidatesOf(introspection, root);
		const missed: Array<{ candidate: string; properties: string[] }> = [];
		let functionalCount = 0;
		for (const { candidate, functional } of candidates) {
			if (functional) functionalCount++;
			const ast = introspection.getCandidateAst(candidate);
			if (!ast) continue;
			const declarations = declarationsOf(ast);
			const group = classify(declarations, probes);
			if (group) {
				const members = groups.get(group) ?? new Set<string>();
				members.add(candidate);
				groups.set(group, members);
			} else {
				missed.push({ candidate, properties: propertiesOf(declarations) });
			}
		}
		const allFunctionalMissed =
			functionalCount > 1 &&
			missed.length === candidates.length &&
			candidates.every((entry) => entry.functional);
		if (allFunctionalMissed) {
			unclassified.set(
				`${root}-*`,
				new Set(missed.flatMap((entry) => entry.properties)),
			);
			continue;
		}
		for (const entry of missed) {
			unclassified.set(entry.candidate, new Set(entry.properties));
		}
	}

	const classGroups: TwMergeConfig["extend"]["classGroups"] = {};
	for (const group of [...groups.keys()].sort(compareTwMergeValues)) {
		classGroups[group] = sortedUnique(groups.get(group) ?? []);
	}
	return {
		config: { extend: { theme: deriveTheme(introspection), classGroups } },
		unclassified: [...unclassified.keys()]
			.sort(compareTwMergeValues)
			.map((utility) => ({
				utility,
				properties: sortedUnique(unclassified.get(utility) ?? []),
			})),
	};
};

const derivedByDesignSystem = new WeakMap<object, DerivedTwMerge>();

/**
 * `deriveTwMergeConfig` for the system CSS, through the cached design
 * system: derived once per compiled design system and reused by codegen
 * and lint until the CSS changes. Throws when the CSS does not compile.
 */
export const loadDerivedTwMerge = async (
	options: LoadTailwindDesignSystemOptions,
): Promise<DerivedTwMerge> => {
	const { designSystem, cssSource } =
		await loadCachedTailwindDesignSystem(options);
	let derived = derivedByDesignSystem.get(designSystem);
	if (!derived) {
		derived = deriveTwMergeConfig(
			createTailwindIntrospection(designSystem, cssSource),
		);
		derivedByDesignSystem.set(designSystem, derived);
	}
	return derived;
};
