import { resolveRegistryComponent } from "../libraries/registry";
import { hasStageRenderer } from "../libraries/renderable-components";
import { validateRecipeInstances } from "../recipes/validation";
import type { Node as DesignNode, TrickroomDesign } from "../types";
import { readAssetManifest } from "../utils/asset-manifest-service";
import {
	assetIdProp,
	collectDesignResourceReferences,
	iconIdProp,
} from "../utils/design-resource-references";
import { findDesignSystem } from "../utils/design-system-store";
import { readIconManifest } from "../utils/icon-manifest-service";
import { computeResolvedColorTokens } from "../utils/resolved-color-tokens";
import {
	buildResolvedTokenContext,
	type ResolvedTokenContext,
} from "../utils/resolved-tailwind-domain-tokens";
import { formatDidYouMean, suggestClosest } from "../utils/suggestions";
import {
	classifyParsedClass,
	parseClassName,
	type SpacingIntent,
	type StyleIntent,
	type UtilityIntent,
} from "../utils/tailwind-classname";
import {
	loadTailwindDesignSystem,
	type TailwindDesignSystem,
} from "../utils/tailwind-design-system";
import {
	TAILWIND_TOKEN_DOMAINS,
	type TailwindTokenDomain,
} from "../utils/tailwind-token-domains";
import {
	readDomainTokensReadonly,
	type TailwindCustomUtilityStorage,
	type TailwindTokenStorage,
} from "../utils/tailwind-token-store";
import {
	inspectTailwindUtilityCandidate,
	type TailwindUtilityInspection,
} from "../utils/tailwind-utility-inspector";
import type { TrickroomMcpServerContext } from "./server";

export type McpDesignIssue = {
	severity: "error" | "warning";
	code: string;
	message: string;
	path?: string;
	elementId?: string;
};

export type ClassTokenDiagnostic = McpDesignIssue & {
	className?: string;
	classToken?: string;
	token?: string;
	property?: string;
	domain?: TailwindTokenDomain | "tailwind";
	/** Nearest valid class names, when cheaply available. */
	suggestions?: string[];
};

export type DesignDiagnostics = {
	issues: ClassTokenDiagnostic[];
	tokenSnapshot: {
		available: boolean;
		systemId?: string | null;
		systemName: string | null;
		reviewRequired?: boolean;
		syncedAt?: string;
		tailwindBaselineVersion?: string;
		tokenCount?: number;
		customUtilities?: readonly TailwindCustomUtilityStorage[];
	} | null;
};

/**
 * Detail of write and validation responses. "compact" (default): error
 * issues, a warningCount, and likely-typo and missing-renderer warnings on
 * the touched elements, grouped. "full": every warning in scope ungrouped,
 * plus the token diagnostics with the custom-utility catalog.
 */
export type MutationResponseDetail = "compact" | "full";

/**
 * Warning codes that almost always mean a typo in a class name: Tailwind
 * cannot emit the utility, or the utility references a token the linked
 * system does not define. These surface on writes by default.
 */
export const isLikelyTypoWarning = (issue: McpDesignIssue) =>
	issue.code === "UNKNOWN_TAILWIND_UTILITY" ||
	/^UNKNOWN_[A-Z_]+_TOKEN$/u.test(issue.code);

/**
 * Warnings that surface on writes by default (for touched elements): likely
 * typos, and elements the stage cannot render, which otherwise only show up
 * as a placeholder in a screenshot.
 */
export const isDefaultSurfacedWarning = (issue: McpDesignIssue) =>
	isLikelyTypoWarning(issue) || issue.code === "MISSING_RENDERER";

/**
 * Drop the heavy `customUtilities` catalog from a token snapshot unless the
 * caller asked for it. The remaining snapshot metadata (counts, review flags) is
 * small and always kept.
 */
export const stripHeavyTokenDiagnostics = <
	T extends {
		customUtilities?: unknown;
	},
>(
	tokenDiagnostics: T | null,
	includeTokenDiagnostics: boolean,
): T | null => {
	if (tokenDiagnostics === null || includeTokenDiagnostics) {
		return tokenDiagnostics;
	}

	if (!Object.hasOwn(tokenDiagnostics, "customUtilities")) {
		return tokenDiagnostics;
	}

	const { customUtilities: _customUtilities, ...rest } = tokenDiagnostics;
	return rest as T;
};

/**
 * Warnings that share a code and offending class (or message), with the
 * elements that carry them. The message names the class and suggestions.
 */
export type GroupedWarning = {
	code: string;
	message: string;
	elementIds?: string[];
	/** Total elements in the group, set when elementIds is truncated. */
	count?: number;
};

/**
 * Group warnings by code plus offending class token (or message), so five
 * elements with the same typo cost one entry. File-level warnings have no
 * elementIds. `maxElementIds` truncates long groups and reports `count`.
 */
export const groupWarnings = (
	warnings: readonly McpDesignIssue[],
	options: { maxElementIds?: number } = {},
): GroupedWarning[] => {
	const groups = new Map<string, GroupedWarning & { ids: string[] }>();
	for (const warning of warnings) {
		const classToken = (warning as ClassTokenDiagnostic).classToken;
		const key = `${warning.code}\u0000${classToken ?? warning.message}`;
		let group = groups.get(key);
		if (!group) {
			group = { code: warning.code, message: warning.message, ids: [] };
			groups.set(key, group);
		}
		if (warning.elementId !== undefined) {
			group.ids.push(warning.elementId);
		}
	}

	const maxElementIds = options.maxElementIds ?? Number.POSITIVE_INFINITY;
	return [...groups.values()].map(({ ids, ...group }) => {
		const elementIds = [...new Set(ids)];
		if (elementIds.length === 0) {
			return group;
		}
		return elementIds.length > maxElementIds
			? {
					...group,
					elementIds: elementIds.slice(0, maxElementIds),
					count: elementIds.length,
				}
			: { ...group, elementIds };
	});
};

/** Count issues per code, most frequent first. */
export const countIssuesByCode = (issues: readonly McpDesignIssue[]) => {
	const counts = new Map<string, number>();
	for (const issue of issues) {
		counts.set(issue.code, (counts.get(issue.code) ?? 0) + 1);
	}
	return Object.fromEntries(
		[...counts.entries()].sort(
			([codeA, countA], [codeB, countB]) =>
				countB - countA || codeA.localeCompare(codeB),
		),
	);
};

export type ShapedMutationDiagnostics = {
	issues: McpDesignIssue[];
	warningCount: number;
	warnings?: GroupedWarning[] | McpDesignIssue[];
	tokenDiagnostics?: unknown;
};

/**
 * Shape a full design diagnostics result for a write response. Always returns
 * every error-severity `issue` and a `warningCount` for the warning scope:
 * the `affectedElementIds` plus file-level warnings (the whole design when no
 * ids are passed). "compact" attaches the likely-typo and missing-renderer
 * warnings on touched elements, grouped; "full" attaches every warning in
 * scope ungrouped plus the token diagnostics.
 */
export const shapeMutationDiagnostics = (
	diagnostics: { issues: McpDesignIssue[]; tokenSnapshot: unknown },
	detail: MutationResponseDetail | undefined,
	affectedElementIds?: Iterable<string>,
): ShapedMutationDiagnostics => {
	const allWarnings = diagnostics.issues.filter(
		(issue) => issue.severity === "warning",
	);
	let scopedWarnings = allWarnings;
	if (affectedElementIds !== undefined) {
		const affected = new Set(affectedElementIds);
		// File-level warnings without an elementId (e.g. review-required,
		// recipe diagnostics) are always in scope; element-bound warnings are
		// limited to elements this write touched.
		scopedWarnings = allWarnings.filter(
			(warning) =>
				warning.elementId === undefined || affected.has(warning.elementId),
		);
	}

	const shaped: ShapedMutationDiagnostics = {
		issues: diagnostics.issues.filter((issue) => issue.severity === "error"),
		warningCount: scopedWarnings.length,
	};

	if (detail === "full") {
		if (scopedWarnings.length > 0) {
			shaped.warnings = scopedWarnings;
		}
		shaped.tokenDiagnostics = diagnostics.tokenSnapshot;
		return shaped;
	}

	const surfaced = scopedWarnings.filter(
		(warning) =>
			warning.elementId !== undefined && isDefaultSurfacedWarning(warning),
	);
	if (surfaced.length > 0) {
		shaped.warnings = groupWarnings(surfaced);
	}
	return shaped;
};

type TailwindUtilityInspector = {
	inspect: (candidate: string) => TailwindUtilityInspection;
	/** Nearest valid classes for an unsupported candidate, variants preserved. */
	suggest: (candidate: string) => string[];
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
const splitCandidate = (candidate: string) => {
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
	const { prefix, important, root, modifier } = splitCandidate(candidate);
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

const EMPTY_CUSTOM_UTILITY_ROOTS: CustomUtilityRoots = {
	customFunctionalUtilityRoots: [],
	customStaticUtilityRoots: [],
};

/**
 * Split persisted custom @utility roots by kind for classification: functional
 * roots are prefix-matched, static roots exact-matched. Each list is sorted
 * longest-first. Legacy entries without `kind` are treated as functional.
 */
function splitCustomUtilityRoots(
	customUtilities: readonly TailwindCustomUtilityStorage[],
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
	inspectUtility: TailwindUtilityInspector | null,
	storedTokens: TailwindTokenStorage,
): AvailableTokenCheck => {
	if (!inspectUtility) {
		return () => false;
	}
	const removed = new Set(
		TAILWIND_TOKEN_DOMAINS.flatMap((domain) =>
			(storedTokens.domains[domain]?.baselineDiff.removed ?? []).map(
				(token) => `${domain}:${token.name}`,
			),
		),
	);
	return (domain, token, candidate) =>
		!removed.has(`${domain}:${token}`) &&
		inspectUtility.inspect(candidate).supported;
};

const noAvailableTokenCheck: AvailableTokenCheck = () => false;

/** A board with its index in the design, so issue paths stay `boards[i]`. */
type IndexedBoard = { board: DesignNode; index: number };

/**
 * The boards to diagnose: every board, or the ones in `boardIds`. Every
 * check is local to a board (recipe instances and resource references live
 * inside one), so a board's issues do not depend on the other boards.
 */
const selectBoards = (
	design: TrickroomDesign,
	boardIds: ReadonlySet<string> | undefined,
): IndexedBoard[] =>
	design.boards
		.map((board, index) => ({ board, index }))
		.filter(({ board }) => boardIds === undefined || boardIds.has(board.id));

const collectRecipeDiagnostics = (
	boards: readonly IndexedBoard[],
	issues: ClassTokenDiagnostic[],
) => {
	for (const instance of validateRecipeInstances(
		boards.map(({ board }) => board),
	).instances) {
		if (instance.status === "attached-valid") {
			continue;
		}

		for (const issue of instance.issues) {
			const elementId = issue.elementId ?? instance.rootElementId ?? undefined;
			issues.push({
				severity:
					instance.status === "attached-stale" &&
					issue.code === "RECIPE_TEMPLATE_STALE"
						? "warning"
						: "error",
				code: issue.code,
				message: issue.message,
				...(issue.path
					? { path: `recipeInstances.${instance.instanceId}.${issue.path}` }
					: {}),
				...(elementId ? { elementId } : {}),
			});
		}
	}
};

/**
 * Elements whose registry component has no stage render component render as
 * a "No renderer" placeholder in the editor and in screenshots. Unknown
 * registry ids are already errors (UNKNOWN_REGISTRY_*) from design validation.
 */
const collectRendererDiagnostics = (
	boards: readonly IndexedBoard[],
	issues: ClassTokenDiagnostic[],
) => {
	const visit = (node: DesignNode, path: string) => {
		const library = node.props["data-trickroom-library"];
		const component = node.props["data-trickroom-component"];
		if (
			resolveRegistryComponent(library, component).status === "known" &&
			!hasStageRenderer(library, component)
		) {
			issues.push({
				severity: "warning",
				code: "MISSING_RENDERER",
				message: `"${library}/${component}" has no render component, so this element renders as a "No renderer" placeholder in the editor and in screenshots.`,
				path,
				elementId: node.id,
			});
		}
		if (Array.isArray(node.children)) {
			for (const [childIndex, child] of node.children.entries()) {
				visit(child, `${path}.children[${childIndex}]`);
			}
		}
	};

	for (const { board, index } of boards) {
		visit(board, `boards[${index}]`);
	}
};

const collectResourceDiagnostics = async (
	context: TrickroomMcpServerContext,
	design: TrickroomDesign,
	boards: readonly IndexedBoard[],
	issues: ClassTokenDiagnostic[],
) => {
	const references = collectDesignResourceReferences({
		...design,
		boards: boards.map(({ board }) => board),
	})
		.filter(
			(reference) => reference.kind === "asset" || reference.kind === "icon",
		)
		.map((reference) => ({
			...reference,
			// Paths count the selected boards; point them at the design's.
			path: reference.path.replace(
				/^boards\[(\d+)\]/u,
				(_match, position: string) =>
					`boards[${boards[Number(position)]?.index ?? position}]`,
			),
		}));
	if (references.length === 0) {
		return;
	}

	const systemHandle = design.systemId ?? design.systemName ?? null;
	const system = systemHandle
		? await findDesignSystem(context.projectRoot, systemHandle)
		: null;
	if (systemHandle === null || !system) {
		for (const reference of references) {
			if (reference.resourceId === null && reference.allowsBlank) {
				continue;
			}

			issues.push({
				severity: "error",
				code:
					reference.kind === "asset"
						? "DESIGN_SYSTEM_REQUIRED_FOR_ASSET"
						: "DESIGN_SYSTEM_REQUIRED_FOR_ICON",
				message:
					reference.kind === "asset"
						? "Asset elements require the design to be linked to a system."
						: "Icon elements require the design to be linked to a system.",
				path: reference.path,
				elementId: reference.elementId,
			});
		}
		return;
	}

	const systemId = system.manifest.systemId;
	const systemName = system.manifest.systemName;

	const assetManifest = await readAssetManifest(context.projectRoot, systemId);
	const iconManifest = await readIconManifest(context.projectRoot, systemId);
	for (const reference of references) {
		const idProp = reference.kind === "asset" ? assetIdProp : iconIdProp;
		if (reference.resourceId === null) {
			if (reference.allowsBlank) {
				continue;
			}

			issues.push({
				severity: "error",
				code:
					reference.kind === "asset" ? "MISSING_ASSET_ID" : "MISSING_ICON_ID",
				message:
					reference.kind === "asset"
						? `Asset element is missing ${assetIdProp}.`
						: `Icon element is missing ${iconIdProp}.`,
				path: `${reference.path}.props.${idProp}`,
				elementId: reference.elementId,
			});
			continue;
		}

		if (
			reference.kind === "asset" &&
			!assetManifest.assets[reference.resourceId]
		) {
			issues.push({
				severity: "error",
				code: "UNKNOWN_ASSET_ID",
				message: `Asset id "${reference.resourceId}" does not exist in system "${systemName}".`,
				path: `${reference.path}.props.${assetIdProp}`,
				elementId: reference.elementId,
			});
		}

		if (
			reference.kind === "icon" &&
			!iconManifest.icons[reference.resourceId]
		) {
			issues.push({
				severity: "error",
				code: "UNKNOWN_ICON_ID",
				message: `Icon id "${reference.resourceId}" does not exist in system "${systemName}".`,
				path: `${reference.path}.props.${iconIdProp}`,
				elementId: reference.elementId,
			});
		}
	}
};

const hasClassNames = (nodes: DesignNode[]): boolean =>
	nodes.some(
		(node) =>
			(node.props.className?.trim().length ?? 0) > 0 ||
			(Array.isArray(node.children) && hasClassNames(node.children)),
	);

const pushClassDiagnostic = (
	issues: ClassTokenDiagnostic[],
	diagnostic: ClassTokenDiagnostic,
) => {
	issues.push(diagnostic);
};

const createClassDiagnosticBase = (
	node: DesignNode,
	path: string,
	className: string,
	parsedRaw: string,
): Pick<
	ClassTokenDiagnostic,
	"path" | "elementId" | "className" | "classToken"
> => ({
	path: `${path}.props.className`,
	elementId: node.id,
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
		ClassTokenDiagnostic,
		"path" | "elementId" | "className" | "classToken"
	>,
	parsedRaw: string,
	colorTokens: ReadonlySet<string>,
	isAvailableToken: AvailableTokenCheck,
	issues: ClassTokenDiagnostic[],
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
		ClassTokenDiagnostic,
		"path" | "elementId" | "className" | "classToken"
	>,
	parsedRaw: string,
	resolvedTokens: ResolvedTokenContext,
	isAvailableToken: AvailableTokenCheck,
	issues: ClassTokenDiagnostic[],
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
		ClassTokenDiagnostic,
		"path" | "elementId" | "className" | "classToken"
	>,
	parsedRaw: string,
	resolvedTokens: ResolvedTokenContext,
	isAvailableToken: AvailableTokenCheck,
	issues: ClassTokenDiagnostic[],
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
		ClassTokenDiagnostic,
		"path" | "elementId" | "className" | "classToken"
	>,
	inspectUtility: TailwindUtilityInspector | null,
	issues: ClassTokenDiagnostic[],
) => {
	if (!inspectUtility || GROUP_MARKER_PATTERN.test(parsedRaw)) {
		return;
	}

	const inspection = inspectUtility.inspect(parsedRaw);
	if (inspection.supported) {
		return;
	}

	const { suggestions, messageSuffix } = withSuggestions(
		inspectUtility.suggest(parsedRaw),
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

type CollectClassDiagnosticsOptions = {
	includeTokenDomainDiagnostics?: boolean;
};

const createEmptyResolvedTokenContext = (): ResolvedTokenContext =>
	Object.fromEntries(
		TAILWIND_TOKEN_DOMAINS.map((domain) => [domain, new Set<string>()]),
	) as ResolvedTokenContext;

const collectClassDiagnostics = (
	node: DesignNode,
	path: string,
	resolvedTokens: ResolvedTokenContext,
	colorTokens: ReadonlySet<string>,
	customUtilityRoots: CustomUtilityRoots,
	inspectUtility: TailwindUtilityInspector | null,
	isAvailableToken: AvailableTokenCheck,
	issues: ClassTokenDiagnostic[],
	options: CollectClassDiagnosticsOptions = {},
) => {
	const includeTokenDomainDiagnostics =
		options.includeTokenDomainDiagnostics ?? true;
	const className = node.props.className;
	if (className?.trim()) {
		for (const parsed of parseClassName(className)) {
			const base = createClassDiagnosticBase(node, path, className, parsed.raw);
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
							inspectUtility,
							issues,
						);
					}
					break;
				case "unknown":
					collectUnknownUtilityDiagnostics(
						parsed.raw,
						base,
						inspectUtility,
						issues,
					);
					break;
			}
		}
	}

	if (Array.isArray(node.children)) {
		for (const [childIndex, child] of node.children.entries()) {
			collectClassDiagnostics(
				child,
				`${path}.children[${childIndex}]`,
				resolvedTokens,
				colorTokens,
				customUtilityRoots,
				inspectUtility,
				isAvailableToken,
				issues,
				options,
			);
		}
	}
};

const getTokenSnapshotMetadata = (
	system: { systemId: string; systemName: string } | null,
	storedTokens: TailwindTokenStorage | null,
): DesignDiagnostics["tokenSnapshot"] => {
	if (system === null) {
		return null;
	}

	if (!storedTokens) {
		return {
			available: false,
			systemId: system.systemId,
			systemName: system.systemName,
		};
	}

	return {
		available: true,
		systemId: system.systemId,
		systemName: system.systemName,
		reviewRequired: storedTokens.metadata.reviewRequired,
		syncedAt: storedTokens.metadata.syncedAt,
		tailwindBaselineVersion: storedTokens.metadata.tailwindBaselineVersion,
		tokenCount: Object.values(storedTokens.domains).reduce(
			(total, domain) => total + Object.keys(domain.tokens).length,
			0,
		),
		...(storedTokens.customUtilities.length > 0
			? { customUtilities: storedTokens.customUtilities }
			: {}),
	};
};

const loadTailwindUtilityInspector = async (
	context: TrickroomMcpServerContext,
	cssPath: string | undefined,
): Promise<TailwindUtilityInspector | null> => {
	if (!cssPath?.trim()) {
		return null;
	}

	try {
		const { designSystem } = await loadTailwindDesignSystem({
			projectRoot: context.projectRoot,
			cssPath,
		});
		return {
			inspect: (candidate) =>
				inspectTailwindUtilityCandidate(designSystem, candidate),
			suggest: (candidate) =>
				suggestTailwindClasses(
					getDesignSystemClassNames(designSystem),
					candidate,
				),
		};
	} catch {
		return null;
	}
};

/**
 * Diagnostics of a design: recipe instances, renderers, asset and icon
 * references, and class tokens. `boardIds` limits them to those boards (for
 * example the boards a write changed); file-level warnings are kept.
 */
export const getDesignDiagnostics = async (
	context: TrickroomMcpServerContext,
	design: TrickroomDesign,
	options: { boardIds?: ReadonlySet<string> } = {},
): Promise<DesignDiagnostics> => {
	const systemHandle = design.systemId ?? design.systemName ?? null;
	const system = systemHandle
		? await findDesignSystem(context.projectRoot, systemHandle)
		: null;
	const boards = selectBoards(design, options.boardIds);
	const issues: ClassTokenDiagnostic[] = [];
	collectRecipeDiagnostics(boards, issues);
	collectRendererDiagnostics(boards, issues);
	await collectResourceDiagnostics(context, design, boards, issues);
	if (systemHandle === null) {
		return {
			issues,
			tokenSnapshot: null,
		};
	}
	if (!system) {
		return {
			issues,
			tokenSnapshot: {
				available: false,
				systemName: design.systemName ?? systemHandle,
			},
		};
	}

	const storedTokens = await readDomainTokensReadonly(
		context.projectRoot,
		system.manifest.systemId,
	);

	if (!storedTokens) {
		if (hasClassNames(design.boards)) {
			issues.push({
				severity: "warning",
				code: "DESIGN_TOKENS_NOT_STORED",
				message: `Design system "${system.manifest.systemName}" does not have a stored token snapshot; class token availability could not be verified.`,
				path: "systemName",
			});
		}

		const inspectUtility = await loadTailwindUtilityInspector(
			context,
			system.manifest.cssPath,
		);
		const emptyResolvedTokens = createEmptyResolvedTokenContext();
		const emptyColorTokens = new Set<string>();

		for (const { board, index } of boards) {
			collectClassDiagnostics(
				board,
				`boards[${index}]`,
				emptyResolvedTokens,
				emptyColorTokens,
				EMPTY_CUSTOM_UTILITY_ROOTS,
				inspectUtility,
				noAvailableTokenCheck,
				issues,
				{ includeTokenDomainDiagnostics: false },
			);
		}

		return {
			issues,
			tokenSnapshot: getTokenSnapshotMetadata(system.manifest, storedTokens),
		};
	}

	if (storedTokens.metadata.reviewRequired) {
		issues.push({
			severity: "warning",
			code: "DESIGN_SYSTEM_REVIEW_REQUIRED",
			message: `Design system "${system.manifest.systemName}" has token changes that require review.`,
			path: "systemName",
		});
	}

	const resolvedTokens = buildResolvedTokenContext(storedTokens);
	const colorDomain = storedTokens.domains.color;
	const colorTokens = computeResolvedColorTokens({
		meaningfulTokens: colorDomain.tokens,
		removed: colorDomain.baselineDiff.removed,
	}).names;
	const customUtilityRoots = splitCustomUtilityRoots(
		storedTokens.customUtilities,
	);
	const inspectUtility = await loadTailwindUtilityInspector(
		context,
		system.manifest.cssPath ?? storedTokens.metadata.cssPath,
	);

	const isAvailableToken = createAvailableTokenCheck(
		inspectUtility,
		storedTokens,
	);
	for (const { board, index } of boards) {
		collectClassDiagnostics(
			board,
			`boards[${index}]`,
			resolvedTokens,
			colorTokens,
			customUtilityRoots,
			inspectUtility,
			isAvailableToken,
			issues,
		);
	}

	return {
		issues,
		tokenSnapshot: getTokenSnapshotMetadata(system.manifest, storedTokens),
	};
};
