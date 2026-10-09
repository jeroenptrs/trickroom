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
 * - Custom `@utility` classes are compiled with Tailwind and compared, by
 *   their declarations, with a stock utility of each class group (an
 *   arbitrary-value probe compiled through the same design system). A
 *   declaration counts with where it lands (selector, pseudo-classes,
 *   `@media`/`@supports`) and whether it is `!important`; custom
 *   properties count too, except Tailwind's own `--tw-*` plumbing.
 *
 * The rule: a utility joins a stock class group only when replacing it
 * with any member of that group loses nothing, that is when it sets
 * exactly what the group's probe sets. `card-padding { padding: 1rem }`
 * merges like `p-4`. Every other utility is protected: it gets a class
 * group of its own, shared with the utilities that set exactly the same
 * declarations (so `bg-royal-ui bg-pale-ui` still keeps the last), and
 * stock classes never remove it. Where it overrides everything another
 * group sets, a one-directional conflict lets a later protected utility
 * remove that group's earlier classes: `text-sm text-label-sm` keeps
 * `text-label-sm`, `text-label-sm text-sm` keeps both, and
 * `text-label-sm text-royal-9` keeps both.
 */

export type DerivedTwMerge = {
	config: TwMergeConfig;
};

type GroupProbe = {
	group: DefaultClassGroupIds;
	/** A stock candidate of the group, theme-independent (arbitrary values). */
	candidate: string;
};

/**
 * The stock class groups a custom utility can join, each with a stock
 * candidate whose generated CSS defines what a member sets. First match
 * wins; the same probes decide which stock groups a protected utility
 * overrides.
 */
export const TW_MERGE_GROUP_PROBES: readonly GroupProbe[] = [
	{ group: "font-size", candidate: "text-[1px]" },
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
	{ group: "ring-color", candidate: "ring-[red]" },
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

/** The candidate's own class in its top-level selector becomes `&`. */
const CLASS_SELECTOR = /\.(?:\\.|[^\s.#:,>+~()[\]\\])+/u;

const normalizeWhitespace = (value: string) =>
	value.replace(/\s+/gu, " ").trim();

/** One declaration and where it applies. */
type Declaration = {
	/** The selector with `&` for the element, then the at-rules around it. */
	context: string;
	property: string;
	important: boolean;
};

/** `context|property`: what a later declaration of the same key overrides. */
const targetOf = (declaration: Declaration) =>
	`${declaration.context}|${declaration.property}`;

const isTailwindPlumbing = (declaration: Declaration) =>
	declaration.property.startsWith("--tw-");

/**
 * Every declaration a candidate's CSS makes, with its context: the
 * selector (the candidate's class as `&`, pseudo-classes and nesting kept)
 * and the at-rules it sits in (`@media (hover: hover)`). `@property` and
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
					context: [normalizeWhitespace(selector), ...atRules].join(" "),
					property: property.startsWith("--")
						? property
						: property.toLowerCase(),
					important: node.important === true,
				};
				declarations.set(
					`${targetOf(declaration)}|${declaration.important}`,
					declaration,
				);
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
 * Whether `later` sets everything `earlier` sets, in the same place and at
 * least as `!important`, so removing an earlier class loses nothing.
 * Tailwind plumbing (`--tw-*`) counts only for a set made of nothing else.
 */
const overrides = (
	later: ReadonlyMap<string, boolean>,
	earlier: readonly Declaration[],
) => {
	const own = earlier.filter((entry) => !isTailwindPlumbing(entry));
	return (own.length > 0 ? own : earlier).every((entry) => {
		const important = later.get(targetOf(entry));
		return important !== undefined && (important || !entry.important);
	});
};

type CompiledProbe = {
	group: DefaultClassGroupIds;
	declarations: Declaration[];
};

/**
 * Whether a utility can join the probe's group: it sets exactly the
 * probe's declarations, none `!important`, and Tailwind plumbing only
 * where the probe sets it too.
 */
const joins = (declarations: readonly Declaration[], probe: CompiledProbe) => {
	if (declarations.some((entry) => entry.important)) return false;
	const own = new Set(
		declarations.filter((entry) => !isTailwindPlumbing(entry)).map(targetOf),
	);
	const probeOwn = new Set(
		probe.declarations
			.filter((entry) => !isTailwindPlumbing(entry))
			.map(targetOf),
	);
	const probeAll = new Set(probe.declarations.map(targetOf));
	return (
		own.size === probeOwn.size &&
		[...own].every((target) => probeOwn.has(target)) &&
		declarations.every((entry) => probeAll.has(targetOf(entry)))
	);
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

type ProtectedGroup = {
	id: string;
	members: string[];
	declarations: Declaration[];
	/** Importance by target; a target set twice counts as important if either is. */
	targets: ReadonlyMap<string, boolean>;
};

export const deriveTwMergeConfig = (
	introspection: TailwindIntrospection,
): DerivedTwMerge => {
	const prefix = introspection.getPrefix();
	const compile = (candidate: string) =>
		introspection.getCandidateAst(
			prefix ? `${prefix}:${candidate}` : candidate,
		);
	const probes = TW_MERGE_GROUP_PROBES.flatMap((probe): CompiledProbe[] => {
		const ast = compile(probe.candidate);
		const declarations = ast ? declarationsOf(ast) : [];
		return declarations.length > 0
			? [{ group: probe.group, declarations }]
			: [];
	});

	const joined = new Map<string, Set<string>>();
	// Protected utilities by the exact declarations they make.
	const shapes = new Map<
		string,
		{ members: Candidate[]; declarations: Declaration[] }
	>();
	const roots = sortedUnique(
		introspection.getCustomFunctionalUtilities().map((utility) => utility.root),
	);
	for (const root of roots) {
		for (const entry of candidatesOf(introspection, root)) {
			const ast = compile(entry.candidate);
			const declarations = ast ? declarationsOf(ast) : [];
			if (declarations.length === 0) continue;
			const probe = probes.find((candidate) => joins(declarations, candidate));
			if (probe) {
				const members = joined.get(probe.group) ?? new Set<string>();
				members.add(entry.candidate);
				joined.set(probe.group, members);
				continue;
			}
			const shape = sortedUnique(
				declarations.map(
					(declaration) =>
						`${targetOf(declaration)}${declaration.important ? "!" : ""}`,
				),
			).join("\n");
			const group = shapes.get(shape) ?? { members: [], declarations };
			group.members.push(entry);
			shapes.set(shape, group);
		}
	}

	// Name each protected group after its first member's utility.
	const taken = new Set<string>();
	const protectedGroups: ProtectedGroup[] = [...shapes.values()]
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
				targets: group.declarations.reduce(
					(targets, entry) =>
						targets.set(
							targetOf(entry),
							entry.important || targets.get(targetOf(entry)) === true,
						),
					new Map<string, boolean>(),
				),
			};
		});

	const classGroups: TwMergeConfig["extend"]["classGroups"] = {};
	for (const [group, members] of joined)
		classGroups[group] = sortedUnique(members);
	for (const group of protectedGroups) classGroups[group.id] = group.members;

	const conflictingClassGroups: TwMergeConfig["extend"]["conflictingClassGroups"] =
		{};
	for (const group of protectedGroups) {
		const overridden = [
			...probes
				.filter((probe) => overrides(group.targets, probe.declarations))
				.map((probe) => probe.group),
			...protectedGroups
				.filter(
					(other) =>
						other !== group && overrides(group.targets, other.declarations),
				)
				.map((other) => other.id),
		];
		if (overridden.length > 0) {
			conflictingClassGroups[group.id] = sortedUnique(overridden);
		}
	}

	const sortKeys = <T>(record: Record<string, T>) =>
		Object.fromEntries(
			Object.keys(record)
				.sort(compareTwMergeValues)
				.map((key) => [key, record[key]]),
		) as Record<string, T>;
	return {
		config: {
			...(prefix ? { prefix } : {}),
			extend: {
				theme: deriveTheme(introspection),
				classGroups: sortKeys(classGroups),
				conflictingClassGroups: sortKeys(conflictingClassGroups),
			},
		},
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
