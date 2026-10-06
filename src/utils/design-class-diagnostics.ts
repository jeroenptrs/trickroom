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
import type { TailwindTokenStorage } from "./tailwind-token-store";
import {
	inspectTailwindUtilityCandidate,
	type TailwindUtilityInspection,
} from "./tailwind-utility-inspector";

/**
 * The class and token checks of a design's `className` strings: unknown or
 * removed tokens per domain, arbitrary values where the system has tokens,
 * and utilities the system's Tailwind cannot emit. Shared by the MCP design
 * diagnostics (`getDesignDiagnostics`) and the `design.unknown-class-token`
 * lint rule, so an agent and the lint report see the same warnings.
 */

/** Every code a class check can report, in a stable order. */
export const DESIGN_CLASS_DIAGNOSTIC_CODES = [
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

export type DesignClassDiagnosticCode =
	(typeof DESIGN_CLASS_DIAGNOSTIC_CODES)[number];

export type DesignClassDiagnostic = {
	severity: "warning";
	code: string;
	message: string;
	/** `<element path>.props.className`. */
	path: string;
	elementId: string;
	className: string;
	/** The offending class, variants included (`hover:bg-brand-500`). */
	classToken: string;
	token?: string;
	property?: string;
	domain?: TailwindTokenDomain | "tailwind";
	/** Nearest valid class names, when cheaply available. */
	suggestions?: string[];
};

/** Where a className lives: its element and the path of the element. */
export type DesignClassTarget = { path: string; elementId: string };

/**
 * The system's tokens as the checks need them. Null (no stored snapshot)
 * turns the token-domain checks off; unknown utilities are still reported
 * when an inspector is available.
 */
export type DesignClassTokens = {
	/** Resolved names per domain: defaults minus removed, plus added. */
	domains: ResolvedTokenContext;
	colorTokens: ReadonlySet<string>;
	/** Removed defaults as `domain:name`. */
	removed: ReadonlySet<string>;
	customUtilities: ReadonlyArray<{
		root: string;
		kind?: "functional" | "static";
	}>;
};

export const designClassTokensFromStorage = (
	storedTokens: TailwindTokenStorage,
): DesignClassTokens => {
	const colorDomain = storedTokens.domains.color;
	return {
		domains: buildResolvedTokenContext(storedTokens),
		colorTokens: computeResolvedColorTokens({
			meaningfulTokens: colorDomain.tokens,
			removed: colorDomain.baselineDiff.removed,
		}).names,
		removed: new Set(
			TAILWIND_TOKEN_DOMAINS.flatMap((domain) =>
				(storedTokens.domains[domain]?.baselineDiff.removed ?? []).map(
					(token) => `${domain}:${token.name}`,
				),
			),
		),
		customUtilities: storedTokens.customUtilities,
	};
};

/** An inspector over a compiled design system, with suggestions. */
export const createDesignClassInspector = (
	designSystem: TailwindDesignSystem,
): DesignClassInspector => ({
	inspect: (candidate) =>
		inspectTailwindUtilityCandidate(designSystem, candidate),
	suggest: (candidate) =>
		suggestTailwindClasses(getDesignSystemClassNames(designSystem), candidate),
});

export type DesignClassInspector = {
	inspect: (candidate: string) => TailwindUtilityInspection;
	/** Nearest valid classes for an unsupported candidate, variants preserved. */
	suggest?: (candidate: string) => string[];
};

const classNameCache = new WeakMap<TailwindDesignSystem, string[]>();

export const getDesignSystemClassNames = (
	designSystem: TailwindDesignSystem,
) => {
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
export const splitClassCandidate = (candidate: string) => {
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

type CustomUtilityRoots = {
	customFunctionalUtilityRoots: readonly string[];
	customStaticUtilityRoots: readonly string[];
};

/**
 * Split persisted custom @utility roots by kind for classification: functional
 * roots are prefix-matched, static roots exact-matched. Each list is sorted
 * longest-first. Legacy entries without `kind` are treated as functional.
 */
function splitCustomUtilityRoots(
	customUtilities: DesignClassTokens["customUtilities"],
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

const STYLE_PROPERTY_TO_TOKEN_DOMAIN: Partial<
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
type AvailableTokenCheck = (
	domain: TailwindTokenDomain,
	token: string,
	candidate: string,
) => boolean;

const createAvailableTokenCheck = (
	inspectUtility: DesignClassInspector | null,
	removed: ReadonlySet<string>,
): AvailableTokenCheck => {
	if (!inspectUtility) {
		return () => false;
	}
	return (domain, token, candidate) =>
		!removed.has(`${domain}:${token}`) &&
		inspectUtility.inspect(candidate).supported;
};

const noAvailableTokenCheck: AvailableTokenCheck = () => false;

const pushClassDiagnostic = (
	issues: DesignClassDiagnostic[],
	diagnostic: DesignClassDiagnostic,
) => {
	issues.push(diagnostic);
};

const createClassDiagnosticBase = (
	target: DesignClassTarget,
	className: string,
	parsedRaw: string,
): Pick<
	DesignClassDiagnostic,
	"path" | "elementId" | "className" | "classToken"
> => ({
	path: target.path,
	elementId: target.elementId,
	className,
	classToken: parsedRaw,
});

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

const collectColorDiagnostics = (
	intent: Extract<UtilityIntent, { kind: "color" }>,
	base: Pick<
		DesignClassDiagnostic,
		"path" | "elementId" | "className" | "classToken"
	>,
	parsedRaw: string,
	colorTokens: ReadonlySet<string>,
	isAvailableToken: AvailableTokenCheck,
	issues: DesignClassDiagnostic[],
) => {
	if (
		intent.token &&
		!intent.resolved &&
		!isAvailableToken("color", intent.token, parsedRaw)
	) {
		const { suggestions, messageSuffix } = withSuggestions(
			suggestTokenClasses(parsedRaw, intent.token, colorTokens),
		);
		pushClassDiagnostic(issues, {
			severity: "warning",
			code: "UNKNOWN_COLOR_TOKEN",
			message: `Class "${parsedRaw}" references unavailable color token "${intent.token}".${messageSuffix}`,
			...base,
			token: intent.token,
			property: intent.property,
			domain: "color",
			...(suggestions ? { suggestions } : {}),
		});
	}

	if (intent.arbitraryValue !== null) {
		pushClassDiagnostic(issues, {
			severity: "warning",
			code: "OUT_OF_SYSTEM_COLOR",
			message: `Class "${parsedRaw}" uses arbitrary color value ${intent.arbitraryValue}.`,
			...base,
			property: intent.property,
			domain: "color",
		});
	}
};

const collectSpacingDiagnostics = (
	intent: SpacingIntent,
	base: Pick<
		DesignClassDiagnostic,
		"path" | "elementId" | "className" | "classToken"
	>,
	parsedRaw: string,
	resolvedTokens: ResolvedTokenContext,
	isAvailableToken: AvailableTokenCheck,
	issues: DesignClassDiagnostic[],
) => {
	if (intent.value.kind !== "scale") {
		return;
	}

	const spacingTokens = resolvedTokens.spacing;
	if (
		isSpacingScaleResolved(intent.value.value, spacingTokens) ||
		isAvailableToken("spacing", intent.value.value, parsedRaw)
	) {
		return;
	}

	const { suggestions, messageSuffix } = withSuggestions(
		suggestTokenClasses(parsedRaw, intent.value.value, spacingTokens),
	);
	pushClassDiagnostic(issues, {
		severity: "warning",
		code: "UNKNOWN_SPACING_TOKEN",
		message: `Class "${parsedRaw}" references unavailable spacing token "${intent.value.value}".${messageSuffix}`,
		...base,
		token: intent.value.value,
		property: intent.property,
		domain: "spacing",
		...(suggestions ? { suggestions } : {}),
	});
};

const collectStyleDiagnostics = (
	intent: StyleIntent,
	base: Pick<
		DesignClassDiagnostic,
		"path" | "elementId" | "className" | "classToken"
	>,
	parsedRaw: string,
	resolvedTokens: ResolvedTokenContext,
	isAvailableToken: AvailableTokenCheck,
	issues: DesignClassDiagnostic[],
) => {
	const domain = STYLE_PROPERTY_TO_TOKEN_DOMAIN[intent.property];
	if (!domain) {
		return;
	}

	if (intent.value.kind === "scale" || intent.value.kind === "keyword") {
		const tokenName = intent.value.value;
		const tokenNames = resolvedTokens[domain];
		if (
			tokenNames.has(tokenName) ||
			isAvailableToken(domain, tokenName, parsedRaw)
		) {
			return;
		}

		const { suggestions, messageSuffix } = withSuggestions(
			suggestTokenClasses(parsedRaw, tokenName, tokenNames),
		);
		pushClassDiagnostic(issues, {
			severity: "warning",
			code: unknownTokenCodeForDomain(domain),
			message: `Class "${parsedRaw}" references unavailable ${domain} token "${tokenName}".${messageSuffix}`,
			...base,
			token: tokenName,
			property: intent.property,
			domain,
			...(suggestions ? { suggestions } : {}),
		});
		return;
	}

	if (intent.value.kind === "arbitrary" && ARBITRARY_WARN_DOMAINS.has(domain)) {
		pushClassDiagnostic(issues, {
			severity: "warning",
			code: outOfSystemCodeForDomain(domain),
			message: `Class "${parsedRaw}" uses arbitrary ${domain} value ${intent.value.value}.`,
			...base,
			property: intent.property,
			domain,
		});
	}
};

const collectUnknownUtilityDiagnostics = (
	parsedRaw: string,
	base: Pick<
		DesignClassDiagnostic,
		"path" | "elementId" | "className" | "classToken"
	>,
	inspectUtility: DesignClassInspector | null,
	issues: DesignClassDiagnostic[],
) => {
	if (!inspectUtility || GROUP_MARKER_PATTERN.test(parsedRaw)) {
		return;
	}

	const inspection = inspectUtility.inspect(parsedRaw);
	if (inspection.supported) {
		return;
	}

	const { suggestions, messageSuffix } = withSuggestions(
		inspectUtility.suggest?.(parsedRaw) ?? [],
	);
	pushClassDiagnostic(issues, {
		severity: "warning",
		code: "UNKNOWN_TAILWIND_UTILITY",
		message: `Class "${parsedRaw}" is not recognized as a supported Tailwind utility.${messageSuffix}`,
		...base,
		domain: "tailwind",
		...(suggestions ? { suggestions } : {}),
	});
};

const createEmptyResolvedTokenContext = (): ResolvedTokenContext =>
	Object.fromEntries(
		TAILWIND_TOKEN_DOMAINS.map((domain) => [domain, new Set<string>()]),
	) as unknown as ResolvedTokenContext;

/**
 * Checks one `className` string and appends its diagnostics to `issues`.
 * Build it once per system and reuse it for every element.
 */
export type DesignClassChecker = (
	className: string,
	target: DesignClassTarget,
	issues: DesignClassDiagnostic[],
) => void;

export const createDesignClassChecker = ({
	tokens,
	inspector,
}: {
	tokens: DesignClassTokens | null;
	inspector: DesignClassInspector | null;
}): DesignClassChecker => {
	const includeTokenDomainDiagnostics = tokens !== null;
	const resolvedTokens = tokens?.domains ?? createEmptyResolvedTokenContext();
	const colorTokens = tokens?.colorTokens ?? new Set<string>();
	const customUtilityRoots = splitCustomUtilityRoots(
		tokens?.customUtilities ?? [],
	);
	const isAvailableToken = tokens
		? createAvailableTokenCheck(inspector, tokens.removed)
		: noAvailableTokenCheck;

	return (className, target, issues) => {
		if (!className.trim()) {
			return;
		}
		for (const parsed of parseClassName(className)) {
			const base = createClassDiagnosticBase(target, className, parsed.raw);
			const intent = classifyParsedClass(parsed, {
				colorTokens,
				...customUtilityRoots,
			});

			switch (intent.kind) {
				case "color":
					if (includeTokenDomainDiagnostics) {
						collectColorDiagnostics(
							intent,
							base,
							parsed.raw,
							colorTokens,
							isAvailableToken,
							issues,
						);
					}
					break;
				case "spacing":
					if (includeTokenDomainDiagnostics) {
						collectSpacingDiagnostics(
							intent,
							base,
							parsed.raw,
							resolvedTokens,
							isAvailableToken,
							issues,
						);
					}
					break;
				case "style":
					if (includeTokenDomainDiagnostics) {
						collectStyleDiagnostics(
							intent,
							base,
							parsed.raw,
							resolvedTokens,
							isAvailableToken,
							issues,
						);
					}
					// Style intents without a token domain are plain Tailwind core
					// utilities (e.g. flex direction); the classifier accepts any
					// value for them, so ask Tailwind whether it can emit the class.
					if (!STYLE_PROPERTY_TO_TOKEN_DOMAIN[intent.property]) {
						collectUnknownUtilityDiagnostics(
							parsed.raw,
							base,
							inspector,
							issues,
						);
					}
					break;
				case "unknown":
					collectUnknownUtilityDiagnostics(parsed.raw, base, inspector, issues);
					break;
			}
		}
	};
};
