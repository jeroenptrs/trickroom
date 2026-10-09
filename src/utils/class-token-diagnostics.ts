import { defaultTailwindTokensByDomain } from "./default-tailwind-tokens";
import { computeResolvedColorTokens } from "./resolved-color-tokens";
import {
	buildResolvedTokenContext,
	type ResolvedTokenContext,
} from "./resolved-tailwind-domain-tokens";
import { formatDidYouMean, suggestClosest } from "./suggestions";
import {
	classifyParsedClass,
	parseClassName,
	type SpacingIntent,
	type StyleIntent,
	type UtilityIntent,
} from "./tailwind-classname";
import type { TailwindDesignSystem } from "./tailwind-design-system";
import {
	TAILWIND_TOKEN_DOMAINS,
	type TailwindTokenDomain,
} from "./tailwind-token-domains";
import type {
	TailwindCustomUtilityStorage,
	TailwindTokenStorage,
} from "./tailwind-token-store";
import {
	canonicalizeTailwindCandidate,
	inspectTailwindUtilityCandidate,
	type TailwindUtilityInspection,
} from "./tailwind-utility-inspector";

/**
 * Class token checks of one className string against a system's tokens:
 * unknown theme tokens per domain, arbitrary values in token domains, and
 * classes the system's Tailwind build cannot emit. Pure: the caller hands
 * in the resolved token names and, optionally, a compiled inspector. The
 * design diagnostics (`src/mcp/diagnostics.ts`), the code-side lint rule
 * `code.unknown-class-token` and the design-side `design.unknown-class-token`
 * (through `design-class-diagnostics.ts`, which adds the element) all run
 * every class through here, with a context from `classTokenContextFromStorage`
 * or `classTokenContextFromResolved`.
 */

/** Every code a class check can report, in a stable order. */
export const CLASS_TOKEN_DIAGNOSTIC_CODES = [
	"UNKNOWN_COLOR_TOKEN",
	"UNKNOWN_SPACING_TOKEN",
	"UNKNOWN_FONT_TOKEN",
	"UNKNOWN_TEXT_TOKEN",
	"UNKNOWN_RADIUS_TOKEN",
	"UNKNOWN_SHADOW_TOKEN",
	"UNKNOWN_TAILWIND_TOKEN",
	"OUT_OF_SYSTEM_COLOR",
	"OUT_OF_SYSTEM_FONT",
	"OUT_OF_SYSTEM_RADIUS",
	"OUT_OF_SYSTEM_TEXT",
	"OUT_OF_SYSTEM_SHADOW",
	"OUT_OF_SYSTEM_BLUR",
	"OUT_OF_SYSTEM_TAILWIND_TOKEN",
	"UNKNOWN_TAILWIND_UTILITY",
] as const;

export type ClassTokenDiagnosticCode =
	(typeof CLASS_TOKEN_DIAGNOSTIC_CODES)[number];

export type ClassTokenIssue = {
	severity: "warning";
	code: string;
	message: string;
	/** The class as written, variants included (`md:bg-brand-500`). */
	classToken: string;
	token?: string;
	property?: string;
	domain?: TailwindTokenDomain | "tailwind";
	/** Nearest valid class names, when cheaply available. */
	suggestions?: string[];
};

export type ClassTokenInspector = {
	inspect: (candidate: string) => TailwindUtilityInspection;
	/** Nearest valid classes for an unsupported candidate, variants preserved. */
	suggest?: (candidate: string) => string[];
	/** The class as Tailwind would write it; the candidate itself when it already is. */
	canonicalize?: (candidate: string) => string;
};

export type CustomUtilityRoots = {
	customFunctionalUtilityRoots: readonly string[];
	customStaticUtilityRoots: readonly string[];
};

export const EMPTY_CUSTOM_UTILITY_ROOTS: CustomUtilityRoots = {
	customFunctionalUtilityRoots: [],
	customStaticUtilityRoots: [],
};

/**
 * Split persisted custom @utility roots by kind for classification: functional
 * roots are prefix-matched, static roots exact-matched. Each list is sorted
 * longest-first. Legacy entries without `kind` are treated as functional.
 */
export function splitCustomUtilityRoots(
	customUtilities: ReadonlyArray<
		Pick<TailwindCustomUtilityStorage, "root"> & { kind?: string }
	>,
): CustomUtilityRoots {
	const functional: string[] = [];
	const staticRoots: string[] = [];
	for (const utility of customUtilities) {
		(utility.kind === "static" ? staticRoots : functional).push(utility.root);
	}
	const byLengthDescending = (roots: string[]) =>
		roots.sort((a, b) => b.length - a.length || a.localeCompare(b));
	return {
		customFunctionalUtilityRoots: byLengthDescending(functional),
		customStaticUtilityRoots: byLengthDescending(staticRoots),
	};
}

export const STYLE_PROPERTY_TO_TOKEN_DOMAIN: Partial<
	Record<StyleIntent["property"], TailwindTokenDomain>
> = {
	"typography.font": "font",
	"typography.font-size": "text",
	"typography.font-weight": "font-weight",
	"typography.line-height": "leading",
	"typography.letter-spacing": "tracking",
	"border.radius": "radius",
	"effects.shadow": "shadow",
	"effects.inset-shadow": "inset-shadow",
	"effects.drop-shadow": "drop-shadow",
	"effects.text-shadow": "text-shadow",
	"effects.blur": "blur",
	"effects.backdrop-blur": "blur",
	"size.aspect-ratio": "aspect",
	"motion.animation": "animate",
	"motion.easing": "ease",
};

const UNKNOWN_TOKEN_CODES: Partial<Record<TailwindTokenDomain, string>> = {
	color: "UNKNOWN_COLOR_TOKEN",
	spacing: "UNKNOWN_SPACING_TOKEN",
	font: "UNKNOWN_FONT_TOKEN",
	text: "UNKNOWN_TEXT_TOKEN",
	radius: "UNKNOWN_RADIUS_TOKEN",
	shadow: "UNKNOWN_SHADOW_TOKEN",
};

const OUT_OF_SYSTEM_CODES: Partial<Record<TailwindTokenDomain, string>> = {
	color: "OUT_OF_SYSTEM_COLOR",
	font: "OUT_OF_SYSTEM_FONT",
	radius: "OUT_OF_SYSTEM_RADIUS",
	text: "OUT_OF_SYSTEM_TEXT",
	shadow: "OUT_OF_SYSTEM_SHADOW",
	blur: "OUT_OF_SYSTEM_BLUR",
};

const ARBITRARY_WARN_DOMAINS = new Set<TailwindTokenDomain>([
	"color",
	"font",
	"radius",
	"text",
	"shadow",
	"blur",
]);

const IMPLICIT_SPACING_SCALE_PATTERN = /^(\d+|\d*\.\d+|px)$/u;

/**
 * `group`/`peer` marker classes, optionally named (`group/sidebar`): they mark
 * an element for group-* and peer-* variants and emit no CSS of their own.
 */
const GROUP_MARKER_PATTERN = /^(group|peer)(\/[\w-]+)?$/u;

/**
 * The token snapshot only knows theme tokens, and the classifier only knows
 * colors: static utilities (`rounded-full`, `leading-none`) and tokens of a
 * sibling domain (`shadow-elevation-md`, a shadow token, read as a color) look
 * unknown to it. A class the system's Tailwind build can emit references an
 * available token, unless the system removed that token on purpose.
 */
export type AvailableTokenCheck = (
	domain: TailwindTokenDomain,
	token: string,
	candidate: string,
) => boolean;

/** `removed` holds `domain:token` keys of tokens the system removed. */
const createAvailableTokenCheck = (
	inspector: ClassTokenInspector | null,
	removed: ReadonlySet<string>,
): AvailableTokenCheck => {
	if (!inspector) {
		return () => false;
	}
	return (domain, token, candidate) =>
		!removed.has(`${domain}:${token}`) &&
		inspector.inspect(candidate).supported;
};

const noAvailableTokenCheck: AvailableTokenCheck = () => false;

/**
 * The `domain:token` keys of Tailwind default tokens missing from resolved
 * token names (defaults minus removed, plus added), that is the tokens a
 * system removed, for `createAvailableTokenCheck`.
 */
const removedDefaultTokenKeys = (
	resolved: Readonly<Record<TailwindTokenDomain, Iterable<string>>>,
): Set<string> => {
	const removed = new Set<string>();
	for (const domain of TAILWIND_TOKEN_DOMAINS) {
		const defaults =
			defaultTailwindTokensByDomain[
				domain as keyof typeof defaultTailwindTokensByDomain
			];
		if (!defaults) continue;
		const names = new Set(resolved[domain]);
		for (const name of Object.keys(defaults)) {
			if (!names.has(name)) removed.add(`${domain}:${name}`);
		}
	}
	return removed;
};

const createEmptyResolvedTokenContext = (): ResolvedTokenContext => {
	const context = {} as Record<TailwindTokenDomain, ReadonlySet<string>>;
	for (const domain of TAILWIND_TOKEN_DOMAINS) {
		context[domain] = new Set<string>();
	}
	return context;
};

/** Replace the last occurrence of `token` in a class with each suggestion. */
const suggestTokenClasses = (
	classToken: string,
	token: string,
	tokenNames: Iterable<string>,
): string[] => {
	const index = classToken.lastIndexOf(token);
	if (index < 0) return [];
	return suggestClosest(token, tokenNames, {
		limit: 3,
		prefixMatches: false,
	}).map(
		(name) =>
			`${classToken.slice(0, index)}${name}${classToken.slice(index + token.length)}`,
	);
};

const withSuggestions = (suggestions: string[]) =>
	suggestions.length > 0
		? {
				suggestions,
				messageSuffix: formatDidYouMean(suggestions),
			}
		: { suggestions: undefined, messageSuffix: "" };

const unknownTokenCodeForDomain = (domain: TailwindTokenDomain): string =>
	UNKNOWN_TOKEN_CODES[domain] ?? "UNKNOWN_TAILWIND_TOKEN";

const outOfSystemCodeForDomain = (domain: TailwindTokenDomain): string =>
	OUT_OF_SYSTEM_CODES[domain] ?? "OUT_OF_SYSTEM_TAILWIND_TOKEN";

const isSpacingScaleResolved = (
	token: string,
	spacingTokens: ReadonlySet<string>,
): boolean => {
	if (spacingTokens.has(token)) {
		return true;
	}

	if (
		spacingTokens.has("DEFAULT") &&
		IMPLICIT_SPACING_SCALE_PATTERN.test(token)
	) {
		return true;
	}

	return false;
};

export type ClassTokenCheckContext = {
	resolvedTokens: ResolvedTokenContext;
	colorTokens: ReadonlySet<string>;
	customUtilityRoots: CustomUtilityRoots;
	inspector: ClassTokenInspector | null;
	isAvailableToken: AvailableTokenCheck;
	/**
	 * False when there is no token snapshot to check against: only the
	 * "is this a Tailwind utility" check runs. Default true.
	 */
	includeTokenDomainDiagnostics?: boolean;
};

const collectColorDiagnostics = (
	intent: Extract<UtilityIntent, { kind: "color" }>,
	parsedRaw: string,
	context: ClassTokenCheckContext,
	issues: ClassTokenIssue[],
) => {
	if (
		intent.token &&
		!intent.resolved &&
		!context.isAvailableToken("color", intent.token, parsedRaw)
	) {
		const { suggestions, messageSuffix } = withSuggestions(
			suggestTokenClasses(parsedRaw, intent.token, context.colorTokens),
		);
		issues.push({
			severity: "warning",
			code: "UNKNOWN_COLOR_TOKEN",
			message: `Class "${parsedRaw}" references unavailable color token "${intent.token}".${messageSuffix}`,
			classToken: parsedRaw,
			token: intent.token,
			property: intent.property,
			domain: "color",
			...(suggestions ? { suggestions } : {}),
		});
	}

	if (intent.arbitraryValue !== null) {
		issues.push({
			severity: "warning",
			code: "OUT_OF_SYSTEM_COLOR",
			message: `Class "${parsedRaw}" uses arbitrary color value ${intent.arbitraryValue}.`,
			classToken: parsedRaw,
			property: intent.property,
			domain: "color",
		});
	}
};

const collectSpacingDiagnostics = (
	intent: SpacingIntent,
	parsedRaw: string,
	context: ClassTokenCheckContext,
	issues: ClassTokenIssue[],
) => {
	if (intent.value.kind !== "scale") {
		return;
	}

	const spacingTokens = context.resolvedTokens.spacing;
	if (
		isSpacingScaleResolved(intent.value.value, spacingTokens) ||
		context.isAvailableToken("spacing", intent.value.value, parsedRaw)
	) {
		return;
	}

	const { suggestions, messageSuffix } = withSuggestions(
		suggestTokenClasses(parsedRaw, intent.value.value, spacingTokens),
	);
	issues.push({
		severity: "warning",
		code: "UNKNOWN_SPACING_TOKEN",
		message: `Class "${parsedRaw}" references unavailable spacing token "${intent.value.value}".${messageSuffix}`,
		classToken: parsedRaw,
		token: intent.value.value,
		property: intent.property,
		domain: "spacing",
		...(suggestions ? { suggestions } : {}),
	});
};

const collectStyleDiagnostics = (
	intent: StyleIntent,
	parsedRaw: string,
	context: ClassTokenCheckContext,
	issues: ClassTokenIssue[],
) => {
	const domain = STYLE_PROPERTY_TO_TOKEN_DOMAIN[intent.property];
	if (!domain) {
		return;
	}

	if (intent.value.kind === "scale" || intent.value.kind === "keyword") {
		const tokenName = intent.value.value;
		const tokenNames = context.resolvedTokens[domain];
		if (
			tokenNames.has(tokenName) ||
			context.isAvailableToken(domain, tokenName, parsedRaw)
		) {
			return;
		}

		const { suggestions, messageSuffix } = withSuggestions(
			suggestTokenClasses(parsedRaw, tokenName, tokenNames),
		);
		issues.push({
			severity: "warning",
			code: unknownTokenCodeForDomain(domain),
			message: `Class "${parsedRaw}" references unavailable ${domain} token "${tokenName}".${messageSuffix}`,
			classToken: parsedRaw,
			token: tokenName,
			property: intent.property,
			domain,
			...(suggestions ? { suggestions } : {}),
		});
		return;
	}

	if (intent.value.kind === "arbitrary" && ARBITRARY_WARN_DOMAINS.has(domain)) {
		issues.push({
			severity: "warning",
			code: outOfSystemCodeForDomain(domain),
			message: `Class "${parsedRaw}" uses arbitrary ${domain} value ${intent.value.value}.`,
			classToken: parsedRaw,
			property: intent.property,
			domain,
		});
	}
};

const collectUnknownUtilityDiagnostics = (
	parsedRaw: string,
	inspector: ClassTokenInspector | null,
	issues: ClassTokenIssue[],
) => {
	if (!inspector || GROUP_MARKER_PATTERN.test(parsedRaw)) {
		return;
	}

	const inspection = inspector.inspect(parsedRaw);
	if (inspection.supported) {
		return;
	}

	const { suggestions, messageSuffix } = withSuggestions(
		inspector.suggest?.(parsedRaw) ?? [],
	);
	issues.push({
		severity: "warning",
		code: "UNKNOWN_TAILWIND_UTILITY",
		message: `Class "${parsedRaw}" is not recognized as a supported Tailwind utility.${messageSuffix}`,
		classToken: parsedRaw,
		domain: "tailwind",
		...(suggestions ? { suggestions } : {}),
	});
};

/** The token issues of every class in `className`, in class order. */
export const collectClassNameTokenIssues = (
	className: string,
	context: ClassTokenCheckContext,
): ClassTokenIssue[] => {
	const issues: ClassTokenIssue[] = [];
	if (!className.trim()) {
		return issues;
	}
	const includeTokenDomainDiagnostics =
		context.includeTokenDomainDiagnostics ?? true;
	for (const parsed of parseClassName(className)) {
		const intent = classifyParsedClass(parsed, {
			colorTokens: context.colorTokens,
			...context.customUtilityRoots,
		});

		switch (intent.kind) {
			case "color":
				if (includeTokenDomainDiagnostics) {
					collectColorDiagnostics(intent, parsed.raw, context, issues);
				}
				break;
			case "spacing":
				if (includeTokenDomainDiagnostics) {
					collectSpacingDiagnostics(intent, parsed.raw, context, issues);
				}
				break;
			case "style":
				if (includeTokenDomainDiagnostics) {
					collectStyleDiagnostics(intent, parsed.raw, context, issues);
				}
				// Style intents without a token domain are plain Tailwind core
				// utilities (e.g. flex direction); the classifier accepts any
				// value for them, so ask Tailwind whether it can emit the class.
				if (!STYLE_PROPERTY_TO_TOKEN_DOMAIN[intent.property]) {
					collectUnknownUtilityDiagnostics(
						parsed.raw,
						context.inspector,
						issues,
					);
				}
				break;
			case "unknown":
				collectUnknownUtilityDiagnostics(parsed.raw, context.inspector, issues);
				break;
		}
	}
	return issues;
};

/**
 * The check context for a system's stored token snapshot, as the design
 * diagnostics have always built it. Without a snapshot only the "is this a
 * Tailwind utility" check runs.
 */
export const classTokenContextFromStorage = (
	storedTokens: TailwindTokenStorage | null,
	inspector: ClassTokenInspector | null,
): ClassTokenCheckContext => {
	if (!storedTokens) {
		return {
			resolvedTokens: createEmptyResolvedTokenContext(),
			colorTokens: new Set<string>(),
			customUtilityRoots: EMPTY_CUSTOM_UTILITY_ROOTS,
			inspector,
			isAvailableToken: noAvailableTokenCheck,
			includeTokenDomainDiagnostics: false,
		};
	}
	const colorDomain = storedTokens.domains.color;
	const removed = new Set(
		TAILWIND_TOKEN_DOMAINS.flatMap((domain) =>
			(storedTokens.domains[domain]?.baselineDiff.removed ?? []).map(
				(token) => `${domain}:${token.name}`,
			),
		),
	);
	return {
		resolvedTokens: buildResolvedTokenContext(storedTokens),
		colorTokens: computeResolvedColorTokens({
			meaningfulTokens: colorDomain.tokens,
			removed: colorDomain.baselineDiff.removed,
		}).names,
		customUtilityRoots: splitCustomUtilityRoots(storedTokens.customUtilities),
		inspector,
		isAvailableToken: createAvailableTokenCheck(inspector, removed),
	};
};

/**
 * The check context for resolved token names (the lint contract's
 * `tokens`): removed defaults are the defaults missing from the names. With
 * `hasSnapshot` false only the "is this a Tailwind utility" check runs.
 */
export const classTokenContextFromResolved = (
	tokens: {
		domains: Readonly<Record<TailwindTokenDomain, readonly string[]>>;
		customUtilities: ReadonlyArray<{ root: string; kind?: string }>;
		hasSnapshot: boolean;
	},
	inspector: ClassTokenInspector | null,
): ClassTokenCheckContext => {
	const resolvedTokens = {} as Record<TailwindTokenDomain, ReadonlySet<string>>;
	for (const domain of TAILWIND_TOKEN_DOMAINS) {
		resolvedTokens[domain] = new Set(tokens.domains[domain] ?? []);
	}
	return tokens.hasSnapshot
		? {
				resolvedTokens,
				colorTokens: resolvedTokens.color,
				customUtilityRoots: splitCustomUtilityRoots(tokens.customUtilities),
				inspector,
				isAvailableToken: createAvailableTokenCheck(
					inspector,
					removedDefaultTokenKeys(tokens.domains),
				),
			}
		: {
				resolvedTokens,
				colorTokens: new Set(),
				customUtilityRoots: EMPTY_CUSTOM_UTILITY_ROOTS,
				inspector,
				isAvailableToken: noAvailableTokenCheck,
				includeTokenDomainDiagnostics: false,
			};
};

const classNameCache = new WeakMap<TailwindDesignSystem, string[]>();

const getDesignSystemClassNames = (designSystem: TailwindDesignSystem) => {
	let classNames = classNameCache.get(designSystem);
	if (!classNames) {
		classNames = designSystem.getClassList().map(([name]) => name);
		classNameCache.set(designSystem, classNames);
	}
	return classNames;
};

/**
 * Split `md:hover:!bg-red-500/50` into the variant prefix, important marker,
 * utility root, and opacity modifier so suggestions only rewrite the utility.
 */
const splitClassCandidate = (candidate: string) => {
	let depth = 0;
	let variantEnd = -1;
	for (let index = 0; index < candidate.length; index++) {
		const char = candidate[index];
		if (char === "[" || char === "(") depth++;
		else if (char === "]" || char === ")") depth--;
		else if (char === ":" && depth === 0) variantEnd = index;
	}
	const prefix = candidate.slice(0, variantEnd + 1);
	let utility = candidate.slice(variantEnd + 1);
	let important = "";
	if (utility.startsWith("!")) {
		important = "!";
		utility = utility.slice(1);
	} else if (utility.endsWith("!")) {
		important = "!";
		utility = utility.slice(0, -1);
	}
	const modifierIndex = utility.includes("[") ? -1 : utility.lastIndexOf("/");
	const modifier = modifierIndex > 0 ? utility.slice(modifierIndex) : "";
	const root = modifierIndex > 0 ? utility.slice(0, modifierIndex) : utility;
	return { prefix, important, root, modifier };
};

export const suggestTailwindClasses = (
	classNames: readonly string[],
	candidate: string,
): string[] => {
	const { prefix, important, root, modifier } = splitClassCandidate(candidate);
	if (root.length < 2 || root.includes("[")) {
		return [];
	}
	const maxDistance = Math.max(1, Math.min(3, Math.floor(root.length / 3)));
	const nearby = classNames.filter(
		(name) => Math.abs(name.length - root.length) <= maxDistance,
	);
	return suggestClosest(root, nearby, {
		limit: 3,
		maxDistance,
		prefixMatches: false,
	}).map((name) => `${prefix}${important}${name}${modifier}`);
};

const inspectorCache = new WeakMap<TailwindDesignSystem, ClassTokenInspector>();

/**
 * An inspector over a compiled design system, with suggestions; one per
 * design system object, so a cached design system keeps its inspector.
 */
export const createClassTokenInspector = (
	designSystem: TailwindDesignSystem,
): ClassTokenInspector => {
	let inspector = inspectorCache.get(designSystem);
	if (!inspector) {
		inspector = {
			inspect: (candidate) =>
				inspectTailwindUtilityCandidate(designSystem, candidate),
			suggest: (candidate) =>
				suggestTailwindClasses(
					getDesignSystemClassNames(designSystem),
					candidate,
				),
			canonicalize: (candidate) =>
				canonicalizeTailwindCandidate(designSystem, candidate),
		};
		inspectorCache.set(designSystem, inspector);
	}
	return inspector;
};

/**
 * An allow-list of class globs (`*` any run of characters, `?` one): a class
 * is allowed when the whole class (`md:hover:bg-legacy-500`) or its utility
 * without variants as Tailwind parses it (`bg-legacy-500`) matches a
 * pattern. Both class lint rules use it.
 */
export const compileClassAllowList = (
	patterns: readonly string[],
): ((classToken: string) => boolean) => {
	const expressions = patterns
		.map((pattern) => pattern.trim())
		.filter((pattern) => pattern.length > 0)
		.map(
			(pattern) =>
				new RegExp(
					`^${pattern
						.split("")
						.map((char) =>
							char === "*"
								? ".*"
								: char === "?"
									? "."
									: char.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"),
						)
						.join("")}$`,
					"u",
				),
		);
	if (expressions.length === 0) return () => false;
	const matches = (value: string) =>
		expressions.some((expression) => expression.test(value));
	return (classToken) =>
		matches(classToken) ||
		matches(parseClassName(classToken)[0]?.utility ?? classToken);
};
