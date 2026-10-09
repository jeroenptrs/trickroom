import {
	type DefaultClassGroupIds,
	type DefaultThemeGroupIds,
	extendTailwindMerge,
	getDefaultConfig,
} from "tailwind-merge";
import { stableStringify } from "./system-component-template-hash";
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
 * - Custom `@utility` classes are compiled with Tailwind and compared,
 *   declaration by declaration, with sampled stock members of each class
 *   group: arbitrary values, modifiers (`/50`, `/[2]`) and the theme keys
 *   with sub-keys (`--text-sm--line-height`), compiled through the same
 *   design system. A declaration counts with its selector (pseudo-classes
 *   and `.dark` included), the at-rules around it, `!important`, and the
 *   variables its value reads.
 *
 * The rule: a class may be removed in favour of a later one only when the
 * later one overrides every declaration it makes (same selector, at-rules
 * no narrower, at least as `!important`), custom properties included:
 * Tailwind's `--tw-*` variables like any other, since an arbitrary
 * property or a descendant may read them. A merge group's contract is the
 * one exception, for its members' own custom properties.
 *
 * A custom utility joins a stock class group only when it and every
 * sampled member can replace each other under that rule. Every other
 * utility is protected: it gets a class group of its own, shared with the
 * utilities that make the same declarations, and stock classes never
 * remove it. A protected group conflicts (one-directionally) with the
 * stock and own groups all of whose sampled members it may remove:
 * `text-sm text-label-sm` keeps `text-label-sm`, `text-label-sm text-sm`
 * keeps both, and `text-label-sm text-royal-9` keeps both.
 */

export type DerivedTwMerge = {
	config: TwMergeConfig;
};

/**
 * `codegen.twMerge.mergeGroups`: per group key, the utility patterns the
 * project declares interchangeable (`text-title-*`, a static class name).
 * The project promises that the custom properties its members set, other
 * than Tailwind's `--tw-*`, are plumbing only members read. Trickroom then
 * puts the members in one class group, so the last class wins, and lets a
 * later class drop those properties when it does not read them itself.
 */
export type TwMergeGroups = Readonly<Record<string, readonly string[]>>;

/** The class group id of a merge group in the generated config. */
export const mergeGroupId = (key: string) => `mergeGroups.${key}`;

/**
 * A custom utility whose classes cannot all be listed, and some class
 * group would claim the ones that are not: tailwind-merge could then
 * remove them in favour of a stock class.
 *
 * - `TW_MERGE_OPEN_MODIFIER`: it uses `--modifier(…)`. Its modifier forms
 *   (`badge-sm/blue`, `badge-sm/[red]`) set more than its base classes, and
 *   tailwind-merge merges them through the base class, so such a utility
 *   is left out of the config; that is safe only while nothing claims it.
 * - `TW_MERGE_OPEN_VALUE`: its `--value(…)` takes arbitrary or bare values
 *   (`[length]`, `integer`), which cannot be listed either.
 */
export class TwMergeOpenFormsError extends Error {
	readonly code: "TW_MERGE_OPEN_MODIFIER" | "TW_MERGE_OPEN_VALUE";
	readonly issues: readonly string[];

	constructor(code: TwMergeOpenFormsError["code"], issues: readonly string[]) {
		super(issues.join(" "));
		this.name = "TwMergeOpenFormsError";
		this.code = code;
		this.issues = issues;
	}
}

/**
 * A `--value()` argument whose values can be listed: theme keys
 * (`--text-*`, `--text-*--line-height`) or a quoted literal (`'auto'`).
 * Anything else (`[length]`, `integer`) is open-ended.
 */
const isListedArgument = (argument: string) =>
	/^--[\w-]+-\*(--[\w-]+)?$/u.test(argument) || /^(['"]).*\1$/u.test(argument);

/** A `mergeGroups` entry the design system cannot honour. */
export class TwMergeGroupError extends Error {
	readonly issues: readonly string[];

	constructor(issues: readonly string[]) {
		super(issues.join(" "));
		this.name = "TwMergeGroupError";
		this.issues = issues;
	}
}

type GroupProbe = {
	group: DefaultClassGroupIds;
	/** Stock members that need no theme: arbitrary values, with modifiers. */
	candidates: readonly string[];
	/** The utility root theme keys are sampled with. */
	root?: string;
	/** Theme namespaces whose keys are members (`text` → `text-sm`). */
	themes?: readonly DefaultThemeGroupIds[];
	/** Modifiers each sampled theme member is also compiled with. */
	modifiers?: readonly string[];
};

const color = (
	group: DefaultClassGroupIds,
	root: string,
	opacity = true,
): GroupProbe => ({
	group,
	candidates: opacity
		? [`${root}-[red]`, `${root}-[red]/50`]
		: [`${root}-[red]`],
	root,
	themes: ["color"],
	modifiers: opacity ? ["/50"] : [],
});

const spacing = (
	group: DefaultClassGroupIds,
	root: string,
	extra: readonly string[] = [],
	themes: readonly DefaultThemeGroupIds[] = ["spacing"],
): GroupProbe => ({
	group,
	candidates: [`${root}-[1px]`, `${root}-4`, `${root}-px`, ...extra],
	root,
	themes,
});

const size = (group: DefaultClassGroupIds, root: string): GroupProbe =>
	spacing(
		group,
		root,
		[`${root}-full`, `${root}-auto`, `${root}-1/2`],
		["spacing", "container"],
	);

/**
 * The stock class groups a custom utility can join or override, with the
 * stock members sampled for each. Joining tries them in order.
 */
export const TW_MERGE_GROUP_PROBES: readonly GroupProbe[] = [
	{
		group: "font-size",
		candidates: ["text-[1px]", "text-[1px]/[2]", "text-[1px]/6"],
		root: "text",
		themes: ["text"],
		modifiers: ["/[2]", "/6"],
	},
	{
		group: "font-weight",
		candidates: ["font-[700]"],
		root: "font",
		themes: ["font-weight"],
	},
	{
		group: "font-family",
		candidates: ["font-[family-name:x]"],
		root: "font",
		themes: ["font"],
	},
	{
		group: "leading",
		candidates: ["leading-[2]", "leading-6", "leading-none"],
		root: "leading",
		themes: ["leading"],
	},
	{
		group: "tracking",
		candidates: ["tracking-[1px]"],
		root: "tracking",
		themes: ["tracking"],
	},
	color("text-color", "text"),
	color("text-decoration-color", "decoration"),
	color("placeholder-color", "placeholder"),
	color("bg-color", "bg"),
	{ group: "bg-image", candidates: ["bg-[url(x)]", "bg-none"] },
	color("border-color", "border"),
	color("border-color-x", "border-x"),
	color("border-color-y", "border-y"),
	color("border-color-s", "border-s"),
	color("border-color-e", "border-e"),
	color("border-color-t", "border-t"),
	color("border-color-r", "border-r"),
	color("border-color-b", "border-b"),
	color("border-color-l", "border-l"),
	color("divide-color", "divide"),
	color("outline-color", "outline"),
	color("ring-color", "ring"),
	...(
		["rounded", "rounded-t", "rounded-r", "rounded-b", "rounded-l"] as const
	).map(
		(root): GroupProbe => ({
			group: root,
			candidates: [`${root}-[1px]`, `${root}-full`, `${root}-none`],
			root,
			themes: ["radius"],
		}),
	),
	{
		group: "shadow",
		candidates: ["shadow-[0_0_red]", "shadow-[0_0_red]/50", "shadow-none"],
		root: "shadow",
		themes: ["shadow"],
		modifiers: ["/50"],
	},
	{ group: "opacity", candidates: ["opacity-[0.5]", "opacity-50"] },
	color("fill", "fill", false),
	color("stroke", "stroke", false),
	color("caret-color", "caret", false),
	color("accent", "accent", false),
	...(["p", "px", "py", "ps", "pe", "pt", "pr", "pb", "pl"] as const).map(
		(root) => spacing(root, root),
	),
	...(["m", "mx", "my", "ms", "me", "mt", "mr", "mb", "ml"] as const).map(
		(root) => spacing(root, root, [`${root}-auto`]),
	),
	spacing("gap", "gap"),
	spacing("gap-x", "gap-x"),
	spacing("gap-y", "gap-y"),
	spacing("space-x", "space-x"),
	spacing("space-y", "space-y"),
	size("size", "size"),
	size("w", "w"),
	size("h", "h"),
	size("min-w", "min-w"),
	size("min-h", "min-h"),
	size("max-w", "max-w"),
	size("max-h", "max-h"),
	{ group: "z", candidates: ["z-[1]", "z-10", "z-auto"] },
];

export const compareTwMergeValues = (left: string, right: string) =>
	left.localeCompare(right, "en", { numeric: true }) ||
	(left < right ? -1 : left > right ? 1 : 0);

const sortedUnique = (values: Iterable<string>) =>
	[...new Set(values)].sort(compareTwMergeValues);

/** The candidate's own class in its top-level selector becomes `&`. */
const CLASS_SELECTOR = /\.(?:\\.|[^\s.#:,>+~()[\]\\])+/u;

const normalizeWhitespace = (value: string) =>
	value.replace(/\s+/gu, " ").trim();

const VARIABLE_READ = /var\(\s*(--[\w-]+)/gu;

/** One declaration and where it applies. */
type Declaration = {
	/** The selector with `&` for the element, pseudo-classes kept. */
	selector: string;
	/** The at-rules around it (`@media (hover: hover)`), sorted. */
	atRules: readonly string[];
	property: string;
	value: string;
	important: boolean;
	/** The custom properties its value reads through `var()`, sorted. */
	reads: readonly string[];
};

/** `selector|property`: what a later declaration must set to override it. */
const targetOf = (declaration: Declaration) =>
	`${declaration.selector}|${declaration.property}`;

const isTailwindVariable = (property: string) => property.startsWith("--tw-");

/**
 * Every declaration a candidate's CSS makes: its selector (the candidate's
 * class as `&`, pseudo-classes and nesting kept), the at-rules around it,
 * importance and the variables its value reads. `@property` and
 * `@keyframes` are not declarations of the element and are left out.
 */
const declarationsOf = (nodes: readonly CandidateAstNode[]): Declaration[] => {
	const declarations = new Map<string, Declaration>();
	const walk = (
		list: readonly CandidateAstNode[],
		selector: string | null,
		atRules: readonly string[],
	) => {
		for (const node of list) {
			if (node.kind === "declaration") {
				const property = node.property?.trim();
				if (selector === null || !property) continue;
				const declaration: Declaration = {
					selector: normalizeWhitespace(selector),
					atRules: sortedUnique(atRules),
					property: property.startsWith("--")
						? property
						: property.toLowerCase(),
					value: node.value ?? "",
					important: node.important === true,
					reads: sortedUnique(
						[...(node.value ?? "").matchAll(VARIABLE_READ)].map(
							(match) => match[1],
						),
					),
				};
				// Of two declarations of a property in the same place, the one CSS
				// applies counts: an !important one over a normal one, else the
				// later one.
				const key = `${targetOf(declaration)}|${declaration.atRules.join(" ")}`;
				const existing = declarations.get(key);
				if (!existing || declaration.important || !existing.important) {
					declarations.set(key, declaration);
				}
			} else if (node.kind === "rule" && node.selector !== undefined) {
				const next =
					selector === null
						? node.selector.replace(CLASS_SELECTOR, "&")
						: node.selector.includes("&")
							? node.selector.replaceAll("&", selector)
							: `${selector} ${node.selector}`;
				walk(node.nodes ?? [], next, atRules);
			} else if (node.kind === "at-rule") {
				const name = node.name?.replace(/^@/u, "") ?? "";
				if (name === "property" || name === "keyframes") continue;
				walk(node.nodes ?? [], selector, [
					...atRules,
					normalizeWhitespace(`@${name} ${node.params ?? ""}`),
				]);
			} else if (node.nodes) {
				walk(node.nodes, selector, atRules);
			}
		}
	};
	walk(nodes, null, []);
	return [...declarations.values()];
};

/**
 * What decides whether two declaration sets replace each other: where each
 * declaration lands and its importance. Values do not count, so
 * `bg-royal-ui` and `bg-pale-ui` share a shape.
 */
const shapeOf = (declarations: readonly Declaration[]) =>
	sortedUnique(
		declarations.map(
			(entry) =>
				`${targetOf(entry)}|${entry.atRules.join(" ")}|${entry.important ? "!" : ""}`,
		),
	).join("\n");

/**
 * Whether `later` overrides `earlier`'s declaration: same selector and
 * property, at-rules no narrower, at least as `!important`.
 */
const overridesDeclaration = (later: Declaration, earlier: Declaration) =>
	later.selector === earlier.selector &&
	later.property === earlier.property &&
	later.atRules.every((rule) => earlier.atRules.includes(rule)) &&
	(later.important || !earlier.important);

/**
 * Whether an earlier class may be removed in favour of a later one without
 * losing anything: the later class overrides every declaration, custom
 * properties included (`--tw-*` too: any class, an arbitrary property
 * such as `[font-size:var(--tw-leading)]` among them, may read one). The
 * only exception is the earlier class's private properties under a merge
 * group's contract, when the later class does not read them.
 */
const mayRemove = (
	earlier: readonly Declaration[],
	later: readonly Declaration[],
	earlierPrivate: ReadonlySet<string> = NONE,
) => {
	const laterByTarget = new Map<string, Declaration[]>();
	for (const entry of later) {
		const list = laterByTarget.get(targetOf(entry)) ?? [];
		list.push(entry);
		laterByTarget.set(targetOf(entry), list);
	}
	const laterReads = new Set(later.flatMap((entry) => entry.reads));
	return earlier.every(
		(entry) =>
			(laterByTarget.get(targetOf(entry)) ?? []).some((candidate) =>
				overridesDeclaration(candidate, entry),
			) ||
			(earlierPrivate.has(entry.property) && !laterReads.has(entry.property)),
	);
};

const NONE: ReadonlySet<string> = new Set();

/** Targets a later class must set to remove these declarations. */
const requiredTargets = (
	declarations: readonly Declaration[],
	privateProperties: ReadonlySet<string> = NONE,
) =>
	new Set(
		declarations
			.filter((entry) => !privateProperties.has(entry.property))
			.map(targetOf),
	);

/**
 * Per tailwind-merge theme key, the keys of the namespace of the same name.
 * Sub-keys (`--text-sm--line-height`), the bare namespace (`--spacing`) and
 * keys of a longer namespace (`--font-weight-*` under `--font`,
 * `--text-shadow-*` under `--text`) are left out.
 */
const themeKeyCache = new WeakMap<
	TailwindIntrospection,
	Map<string, { keys: string[]; withSubKeys: Set<string> }>
>();

const themeKeysOf = (
	introspection: TailwindIntrospection,
	key: DefaultThemeGroupIds,
	allKeys: readonly string[],
) => {
	const cache =
		themeKeyCache.get(introspection) ??
		new Map<string, { keys: string[]; withSubKeys: Set<string> }>();
	themeKeyCache.set(introspection, cache);
	const cached = cache.get(key);
	if (cached) return cached;
	const longer = allKeys
		.filter((other) => other.startsWith(`${key}-`))
		.map((other) => `${other.slice(key.length + 1)}-`);
	const raw = [...introspection.resolveNamespace(`--${key}`).keys()];
	const keys = sortedUnique(
		raw.filter(
			(value): value is string =>
				value !== null &&
				value.length > 0 &&
				!value.includes("--") &&
				!longer.some((prefix) => value.startsWith(prefix)),
		),
	);
	const withSubKeys = new Set(
		raw.flatMap((value) =>
			value?.includes("--") ? [value.slice(0, value.indexOf("--"))] : [],
		),
	);
	const result = { keys, withSubKeys };
	cache.set(key, result);
	return result;
};

const THEME_KEYS = Object.keys(getDefaultConfig().theme).sort(
	compareTwMergeValues,
) as DefaultThemeGroupIds[];

const deriveTheme = (
	introspection: TailwindIntrospection,
): TwMergeConfig["extend"]["theme"] => {
	const theme: TwMergeConfig["extend"]["theme"] = {};
	for (const key of THEME_KEYS) {
		const { keys } = themeKeysOf(introspection, key, THEME_KEYS);
		if (keys.length > 0) theme[key] = keys;
	}
	return theme;
};

/**
 * The stock members sampled for a group: its arbitrary candidates, and per
 * theme namespace every key with sub-keys plus the first key without, each
 * also with the group's modifiers. Sub-keys are what make one theme member
 * set more than another (`text-sm` sets line-height through
 * `--text-sm--line-height`); keys without any compile alike.
 */
const sampleCandidates = (
	introspection: TailwindIntrospection,
	probe: GroupProbe,
) => {
	const samples = [...probe.candidates];
	if (!probe.root) return samples;
	for (const namespace of probe.themes ?? []) {
		const { keys, withSubKeys } = themeKeysOf(
			introspection,
			namespace,
			THEME_KEYS,
		);
		const sampled = keys.filter((key) => withSubKeys.has(key));
		const plain = keys.find((key) => !withSubKeys.has(key));
		if (plain) sampled.push(plain);
		for (const key of sampled) {
			const member = `${probe.root}-${key}`;
			samples.push(
				member,
				...(probe.modifiers ?? []).map((modifier) => `${member}${modifier}`),
			);
		}
	}
	return samples;
};

type Candidate = {
	candidate: string;
	/** `root-*` for a functional utility's value, the class for a static one. */
	origin: string;
};

/** Candidates of a custom `@utility` root: the static class and every functional value. */
const candidatesOf = (
	introspection: TailwindIntrospection,
	root: string,
): Candidate[] => {
	const candidates: Candidate[] = [];
	if (introspection.hasUtility(root, "static")) {
		candidates.push({ candidate: root, origin: root });
	}
	if (introspection.hasUtility(root, "functional")) {
		const values = introspection
			.getCompletions(root)
			.flatMap((group) => group.values);
		for (const value of sortedUnique(
			values.map((value) => (value === null ? root : `${root}-${value}`)),
		)) {
			if (value !== root || candidates.length === 0) {
				candidates.push({ candidate: value, origin: `${root}-*` });
			}
		}
	}
	return candidates;
};

/** A class group as the conflict pass sees it. */
type ConflictTarget = {
	id: string;
	/** Every member's declarations (one entry for an own group: its members make the same). */
	members: ReadonlyArray<readonly Declaration[]>;
	/** Targets every remover must set, over all members. */
	required: ReadonlySet<string>;
	/** Properties the members may lose to any remover that does not read them. */
	private?: ReadonlySet<string>;
};

/**
 * The groups `group` may remove: those all of whose members it overrides.
 * Each target group is indexed under its rarest required target, so a
 * group is checked only against the groups whose rarest target it sets,
 * not against every group sharing a common one (`background-color`).
 */
const conflictsOf = (
	groups: ReadonlyArray<{
		id: string;
		/** Each member's declarations: every one must remove a target. */
		variants: ReadonlyArray<readonly Declaration[]>;
	}>,
	targets: readonly ConflictTarget[],
) => {
	const frequency = new Map<string, number>();
	for (const target of targets) {
		for (const key of target.required) {
			frequency.set(key, (frequency.get(key) ?? 0) + 1);
		}
	}
	const byRarest = new Map<string, ConflictTarget[]>();
	for (const target of targets) {
		let rarest: string | null = null;
		for (const key of target.required) {
			if (
				rarest === null ||
				(frequency.get(key) ?? 0) < (frequency.get(rarest) ?? 0)
			) {
				rarest = key;
			}
		}
		if (rarest === null) continue;
		const list = byRarest.get(rarest) ?? [];
		list.push(target);
		byRarest.set(rarest, list);
	}
	const conflicts: Record<string, string[]> = {};
	for (const group of groups) {
		// The targets every variant sets: only those can satisfy a target.
		const sets = group.variants.map(
			(variant) => new Set(variant.map(targetOf)),
		);
		const own = new Set(
			[...sets[0]].filter((key) => sets.every((set) => set.has(key))),
		);
		const removed: string[] = [];
		for (const key of own) {
			for (const target of byRarest.get(key) ?? []) {
				if (
					target.id !== group.id &&
					[...target.required].every((required) => own.has(required)) &&
					group.variants.every((variant) =>
						target.members.every((member) =>
							mayRemove(member, variant, target.private),
						),
					)
				) {
					removed.push(target.id);
				}
			}
		}
		if (removed.length > 0) conflicts[group.id] = sortedUnique(removed);
	}
	return conflicts;
};

/** `*` matches any run of characters; the pattern matches the whole class. */
const patternMatcher = (pattern: string) =>
	new RegExp(
		`^${pattern
			.split("*")
			.map((part) => part.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"))
			.join(".*")}$`,
		"u",
	);

export const deriveTwMergeConfig = (
	introspection: TailwindIntrospection,
	options: { mergeGroups?: TwMergeGroups } = {},
): DerivedTwMerge => {
	const prefix = introspection.getPrefix();
	const withPrefix = (candidate: string) =>
		prefix ? `${prefix}:${candidate}` : candidate;
	const compile = (candidate: string) => {
		const ast = introspection.getCandidateAst(withPrefix(candidate));
		return ast ? declarationsOf(ast) : [];
	};

	const probes = TW_MERGE_GROUP_PROBES.flatMap((probe) => {
		const members = sampleCandidates(introspection, probe)
			.map(compile)
			.filter((declarations) => declarations.length > 0);
		if (members.length === 0) return [];
		const targets = members.map((member) => new Set(member.map(targetOf)));
		return [
			{
				group: probe.group,
				members,
				// A joining utility sets every target some member needs set, and
				// needs set only targets every member sets.
				required: new Set(
					members.flatMap((member) => [...requiredTargets(member)]),
				),
				shared: new Set(
					[...targets[0]].filter((key) =>
						targets.every((member) => member.has(key)),
					),
				),
			},
		];
	});

	const roots = sortedUnique(
		introspection.getCustomFunctionalUtilities().map((utility) => utility.root),
	);
	const utilities = roots.flatMap((root) =>
		candidatesOf(introspection, root).flatMap((entry) => {
			const declarations = compile(entry.candidate);
			return declarations.length > 0 ? [{ ...entry, root, declarations }] : [];
		}),
	);
	const argumentsOf = (root: string) =>
		introspection.getCustomUtilityArguments(root);
	const isFunctional = (utility: { origin: string }) =>
		utility.origin.endsWith("-*");

	// The project's merge groups: validated against the utilities, then
	// taken out of the derivation below.
	const groupKeys = Object.keys(options.mergeGroups ?? {}).sort(
		compareTwMergeValues,
	);
	const membership = new Map<string, string[]>();
	const issues: string[] = [];
	for (const key of groupKeys) {
		for (const pattern of options.mergeGroups?.[key] ?? []) {
			const matcher = patternMatcher(pattern);
			const matches = utilities.filter((utility) =>
				matcher.test(utility.candidate),
			);
			if (matches.length === 0) {
				issues.push(
					`codegen.twMerge.mergeGroups.${key}: "${pattern}" matches no custom utility of the design system.`,
				);
			}
			for (const utility of matches) {
				const keys = membership.get(utility.candidate) ?? [];
				if (!keys.includes(key)) keys.push(key);
				membership.set(utility.candidate, keys);
			}
		}
	}
	for (const [candidate, keys] of membership) {
		if (keys.length > 1) {
			issues.push(
				`"${candidate}" is in mergeGroups ${keys.map((key) => `"${key}"`).join(" and ")}; a utility may belong to at most one merge group.`,
			);
		}
	}
	if (issues.length > 0) throw new TwMergeGroupError(issues);

	// A utility that uses --modifier(…) is left out of the config: its
	// modifier forms set more than its base classes, and tailwind-merge
	// merges them through the base class. A merge group may still hold its
	// classes when a pattern also matches the forms (`badge-*` matches
	// `badge-sm/[red]`): the project declared them interchangeable.
	const coversForms = (candidate: string) => {
		const key = membership.get(candidate)?.[0];
		return (
			key !== undefined &&
			(options.mergeGroups?.[key] ?? []).some((pattern) =>
				patternMatcher(pattern).test(`${candidate}/[x]`),
			)
		);
	};
	const usesModifier = (utility: { root: string; origin: string }) =>
		isFunctional(utility) && argumentsOf(utility.root).usesModifier;
	const formIssues = utilities
		.filter(
			(utility) =>
				usesModifier(utility) &&
				membership.has(utility.candidate) &&
				!coversForms(utility.candidate),
		)
		.map(
			(utility) =>
				`"${utility.candidate}" is in mergeGroups "${membership.get(utility.candidate)?.[0]}", but ${utility.origin} uses --modifier(…); add a pattern that also matches its modifier forms ("${utility.candidate}*" or "${utility.origin}").`,
		);
	if (formIssues.length > 0) {
		throw new TwMergeOpenFormsError("TW_MERGE_OPEN_MODIFIER", formIssues);
	}
	const excluded = new Set(
		utilities
			.filter(
				(utility) =>
					usesModifier(utility) && !membership.has(utility.candidate),
			)
			.map((utility) => utility.candidate),
	);
	const mergeGroups = groupKeys.map((key) => {
		const members = utilities.filter(
			(utility) => membership.get(utility.candidate)?.[0] === key,
		);
		const privateProperties = new Set(
			members.flatMap((member) =>
				member.declarations
					.map((entry) => entry.property)
					.filter(
						(property) =>
							property.startsWith("--") && !isTailwindVariable(property),
					),
			),
		);
		return {
			id: mergeGroupId(key),
			members: sortedUnique(members.map((member) => member.candidate)),
			variants: members.map((member) => member.declarations),
			privateProperties,
			// Its members' modifier forms merge as members but are not
			// compiled, so what the group sets is unknown: it neither removes
			// nor is removed by classes outside it.
			open: members.some(usesModifier),
		};
	});
	const closedMergeGroups = mergeGroups.filter((group) => !group.open);
	/** Whether a merge group holds classes of this root (its forms merge there). */
	const hasListedMember = (root: string) =>
		utilities.some(
			(utility) => utility.root === root && membership.has(utility.candidate),
		);

	const joined = new Map<string, Set<string>>();
	// Protected utilities by the declarations they make.
	const shapes = new Map<
		string,
		{ members: Candidate[]; declarations: Declaration[] }
	>();
	for (const entry of utilities) {
		if (membership.has(entry.candidate) || excluded.has(entry.candidate))
			continue;
		const declarations = entry.declarations;
		const own = new Set(declarations.map(targetOf));
		const needs = requiredTargets(declarations);
		const probe = probes.find(
			(candidate) =>
				[...candidate.required].every((key) => own.has(key)) &&
				[...needs].every((key) => candidate.shared.has(key)) &&
				candidate.members.every(
					(member) =>
						mayRemove(declarations, member) && mayRemove(member, declarations),
				),
		);
		if (probe) {
			const members = joined.get(probe.group) ?? new Set<string>();
			members.add(entry.candidate);
			joined.set(probe.group, members);
			continue;
		}
		const shape = shapeOf(declarations);
		const group = shapes.get(shape) ?? { members: [], declarations };
		group.members.push(entry);
		shapes.set(shape, group);
	}

	// Name each protected group after its first member's utility.
	const taken = new Set<string>();
	const protectedGroups = [...shapes.values()]
		.map((group) => ({
			...group,
			members: [...group.members].sort((left, right) =>
				compareTwMergeValues(left.candidate, right.candidate),
			),
		}))
		.sort((left, right) =>
			compareTwMergeValues(
				left.members[0].candidate,
				right.members[0].candidate,
			),
		)
		.map((group) => {
			const base = `@utility ${group.members[0].origin}`;
			let id = base;
			for (let index = 2; taken.has(id); index++) id = `${base} #${index}`;
			taken.add(id);
			return {
				id,
				members: group.members.map((member) => member.candidate),
				declarations: group.declarations,
			};
		});

	const classGroups: TwMergeConfig["extend"]["classGroups"] = {};
	for (const [group, members] of joined)
		classGroups[group] = sortedUnique(members);
	for (const group of protectedGroups) classGroups[group.id] = group.members;
	for (const group of mergeGroups) classGroups[group.id] = group.members;

	const conflictingClassGroups = conflictsOf(
		[
			...protectedGroups.map((group) => ({
				id: group.id,
				variants: [group.declarations],
			})),
			...closedMergeGroups,
		],
		[
			...probes.map((probe) => ({
				id: probe.group,
				members: probe.members,
				required: probe.required,
			})),
			...protectedGroups.map((group) => ({
				id: group.id,
				members: [group.declarations],
				required: requiredTargets(group.declarations),
			})),
			// Removing a merge group means removing any member: cover their union.
			...closedMergeGroups.map((group) => ({
				id: group.id,
				members: group.variants,
				required: new Set(
					group.variants.flatMap((variant) => [
						...requiredTargets(variant, group.privateProperties),
					]),
				),
				private: group.privateProperties,
			})),
		].filter((target) => target.required.size > 0),
	);

	const sortKeys = <T>(record: Record<string, T>) =>
		Object.fromEntries(
			Object.keys(record)
				.sort(compareTwMergeValues)
				.map((key) => [key, record[key]]),
		) as Record<string, T>;
	const config: TwMergeConfig = {
		...(prefix ? { prefix } : {}),
		extend: {
			theme: deriveTheme(introspection),
			classGroups: sortKeys(classGroups),
			conflictingClassGroups: sortKeys(conflictingClassGroups),
		},
	};

	// Classes the config cannot list are safe only while tailwind-merge
	// keeps them as unknown classes: no class group, stock or derived, may
	// claim any of their forms. Probed through the merger itself, so stock
	// validators (`text-*` takes any colour) count.
	const merge = extendTailwindMerge<string>(config);
	const isClaimed = (name: string) => {
		const className = withPrefix(name);
		return merge(`${className} ${className}`) === className;
	};
	const openIssues: Record<TwMergeOpenFormsError["code"], string[]> = {
		TW_MERGE_OPEN_MODIFIER: [],
		TW_MERGE_OPEN_VALUE: [],
	};
	for (const root of roots) {
		if (!introspection.hasUtility(root, "functional")) continue;
		const { values, usesModifier: modifier } = argumentsOf(root);
		const leftOut = utilities.filter(
			(utility) => utility.root === root && excluded.has(utility.candidate),
		);
		const openValues = values.filter((value) => !isListedArgument(value));
		const probes = [
			...(modifier && (leftOut.length > 0 || !hasListedMember(root))
				? [
						`${root}-[x]`,
						`${root}-[x]/[y]`,
						`${root}-x/y`,
						`${root}-x`,
						...leftOut.flatMap(({ candidate }) => [
							candidate,
							`${candidate}/[y]`,
							`${candidate}/y`,
						]),
					]
				: []),
			...(openValues.some((value) => value.startsWith("["))
				? [`${root}-[x]`]
				: []),
			...(openValues.some((value) => !value.startsWith("["))
				? [`${root}-1`, `${root}-50%`]
				: []),
		];
		const claimed = probes.find(isClaimed);
		if (claimed === undefined) continue;
		if (modifier && (leftOut.length > 0 || !hasListedMember(root))) {
			openIssues.TW_MERGE_OPEN_MODIFIER.push(
				`${root}-* uses --modifier(…), so it is left out of the tailwind-merge config, but a class group claims "${claimed}": a later class could remove it. Rename the utility so no class group matches its classes, or declare its classes interchangeable in a merge group ("${root}-*").`,
			);
		} else {
			openIssues.TW_MERGE_OPEN_VALUE.push(
				`${root}-* takes values the config cannot list (${openValues.join(", ")}), and a class group claims "${claimed}": a later class could remove it. Restrict its --value() to theme keys, or rename the utility so no class group matches its classes.`,
			);
		}
	}
	for (const code of [
		"TW_MERGE_OPEN_MODIFIER",
		"TW_MERGE_OPEN_VALUE",
	] as const) {
		if (openIssues[code].length > 0) {
			throw new TwMergeOpenFormsError(code, openIssues[code]);
		}
	}
	return { config };
};

const derivedByDesignSystem = new WeakMap<
	object,
	Map<string, DerivedTwMerge>
>();

/**
 * `deriveTwMergeConfig` for the system CSS, through the cached design
 * system: derived once per compiled design system and merge groups, and
 * reused by codegen and lint until the CSS changes. Throws when the CSS
 * does not compile, and `TwMergeGroupError` for invalid merge groups.
 */
export const loadDerivedTwMerge = async (
	options: LoadTailwindDesignSystemOptions,
	mergeGroups: TwMergeGroups = {},
): Promise<DerivedTwMerge> => {
	const { designSystem, cssSource } =
		await loadCachedTailwindDesignSystem(options);
	const byGroups =
		derivedByDesignSystem.get(designSystem) ??
		new Map<string, DerivedTwMerge>();
	derivedByDesignSystem.set(designSystem, byGroups);
	const key = stableStringify(mergeGroups);
	let derived = byGroups.get(key);
	if (!derived) {
		derived = deriveTwMergeConfig(
			createTailwindIntrospection(designSystem, cssSource),
			{ mergeGroups },
		);
		byGroups.set(key, derived);
	}
	return derived;
};
