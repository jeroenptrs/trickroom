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
import {
	classifyParsedClass,
	type SpacingIntent,
	type StyleIntent,
	type UtilityIntent,
	parseClassName,
} from "../utils/tailwind-classname";
import { loadTailwindDesignSystem } from "../utils/tailwind-design-system";
import {
	TAILWIND_TOKEN_DOMAINS,
	type TailwindTokenDomain,
} from "../utils/tailwind-token-domains";
import {
	readDomainTokensReadonly,
	type TailwindTokenStorageV2,
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
	} | null;
};

type TailwindUtilityInspector = (
	candidate: string,
) => TailwindUtilityInspection;

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

const collectRecipeDiagnostics = (
	design: TrickroomDesign,
	issues: ClassTokenDiagnostic[],
) => {
	for (const instance of validateRecipeInstances(design.boards).instances) {
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

const collectResourceDiagnostics = async (
	context: TrickroomMcpServerContext,
	design: TrickroomDesign,
	issues: ClassTokenDiagnostic[],
) => {
	const references = collectDesignResourceReferences(design).filter(
		(reference) => reference.kind === "asset" || reference.kind === "icon",
	);
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
	issues: ClassTokenDiagnostic[],
) => {
	if (intent.token && !intent.resolved) {
		pushClassDiagnostic(issues, {
			severity: "warning",
			code: "UNKNOWN_COLOR_TOKEN",
			message: `Class "${parsedRaw}" references unavailable color token "${intent.token}".`,
			...base,
			token: intent.token,
			property: intent.property,
			domain: "color",
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
	issues: ClassTokenDiagnostic[],
) => {
	if (intent.value.kind !== "scale") {
		return;
	}

	const spacingTokens = resolvedTokens.spacing;
	if (isSpacingScaleResolved(intent.value.value, spacingTokens)) {
		return;
	}

	pushClassDiagnostic(issues, {
		severity: "warning",
		code: "UNKNOWN_SPACING_TOKEN",
		message: `Class "${parsedRaw}" references unavailable spacing token "${intent.value.value}".`,
		...base,
		token: intent.value.value,
		property: intent.property,
		domain: "spacing",
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
	issues: ClassTokenDiagnostic[],
) => {
	const domain = STYLE_PROPERTY_TO_TOKEN_DOMAIN[intent.property];
	if (!domain) {
		return;
	}

	if (intent.value.kind === "scale" || intent.value.kind === "keyword") {
		const tokenName = intent.value.value;
		const tokenNames = resolvedTokens[domain];
		if (tokenNames.has(tokenName)) {
			return;
		}

		pushClassDiagnostic(issues, {
			severity: "warning",
			code: unknownTokenCodeForDomain(domain),
			message: `Class "${parsedRaw}" references unavailable ${domain} token "${tokenName}".`,
			...base,
			token: tokenName,
			property: intent.property,
			domain,
		});
		return;
	}

	if (
		intent.value.kind === "arbitrary" &&
		ARBITRARY_WARN_DOMAINS.has(domain)
	) {
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
	if (!inspectUtility) {
		return;
	}

	const inspection = inspectUtility(parsedRaw);
	if (inspection.supported) {
		return;
	}

	pushClassDiagnostic(issues, {
		severity: "warning",
		code: "UNKNOWN_TAILWIND_UTILITY",
		message: `Class "${parsedRaw}" is not recognized as a supported Tailwind utility.`,
		...base,
		domain: "tailwind",
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
	inspectUtility: TailwindUtilityInspector | null,
	issues: ClassTokenDiagnostic[],
	options: CollectClassDiagnosticsOptions = {},
) => {
	const includeTokenDomainDiagnostics =
		options.includeTokenDomainDiagnostics ?? true;
	const className = node.props.className;
	if (className?.trim()) {
		for (const parsed of parseClassName(className)) {
			const base = createClassDiagnosticBase(
				node,
				path,
				className,
				parsed.raw,
			);
			const intent = classifyParsedClass(parsed, { colorTokens });

			switch (intent.kind) {
				case "color":
					if (includeTokenDomainDiagnostics) {
						collectColorDiagnostics(intent, base, parsed.raw, issues);
					}
					break;
				case "spacing":
					if (includeTokenDomainDiagnostics) {
						collectSpacingDiagnostics(
							intent,
							base,
							parsed.raw,
							resolvedTokens,
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
				inspectUtility,
				issues,
				options,
			);
		}
	}
};

const getTokenSnapshotMetadata = (
	system: { systemId: string; systemName: string } | null,
	storedTokens: TailwindTokenStorageV2 | null,
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
		return (candidate) =>
			inspectTailwindUtilityCandidate(designSystem, candidate);
	} catch {
		return null;
	}
};

export const getDesignDiagnostics = async (
	context: TrickroomMcpServerContext,
	design: TrickroomDesign,
): Promise<DesignDiagnostics> => {
	const systemHandle = design.systemId ?? design.systemName ?? null;
	const system = systemHandle
		? await findDesignSystem(context.projectRoot, systemHandle)
		: null;
	const issues: ClassTokenDiagnostic[] = [];
	collectRecipeDiagnostics(design, issues);
	await collectResourceDiagnostics(context, design, issues);
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

		for (const [rootIndex, board] of design.boards.entries()) {
			collectClassDiagnostics(
				board,
				`boards[${rootIndex}]`,
				emptyResolvedTokens,
				emptyColorTokens,
				inspectUtility,
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
	const inspectUtility = await loadTailwindUtilityInspector(
		context,
		system.manifest.cssPath ?? storedTokens.metadata.cssPath,
	);

	for (const [rootIndex, board] of design.boards.entries()) {
		collectClassDiagnostics(
			board,
			`boards[${rootIndex}]`,
			resolvedTokens,
			colorTokens,
			inspectUtility,
			issues,
		);
	}

	return {
		issues,
		tokenSnapshot: getTokenSnapshotMetadata(system.manifest, storedTokens),
	};
};
