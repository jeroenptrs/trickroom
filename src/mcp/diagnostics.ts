import { resolveRegistryComponent } from "../libraries/registry";
import { hasStageRenderer } from "../libraries/renderable-components";
import type { LintComponentLocation } from "../lint/component-location";
import {
	type DesignLintResult,
	lintDesign,
	loadDesignLintSetup,
} from "../lint/design-lint";
import { validateRecipeInstances } from "../recipes/validation";
import type { Node as DesignNode, TrickroomDesign } from "../types";
import { readAssetManifest } from "../utils/asset-manifest-service";
import {
	type ClassTokenInspector,
	classTokenContextFromStorage,
	createClassTokenInspector,
} from "../utils/class-token-diagnostics";
import {
	createDesignClassChecker,
	type DesignClassChecker,
	type DesignClassDiagnostic,
} from "../utils/design-class-diagnostics";
import {
	assetIdProp,
	collectDesignResourceReferences,
	iconIdProp,
} from "../utils/design-resource-references";
import { findDesignSystem } from "../utils/design-system-store";
import { readIconManifest } from "../utils/icon-manifest-service";
import { loadCachedTailwindDesignSystem } from "../utils/tailwind-design-system";
import type { TailwindTokenDomain } from "../utils/tailwind-token-domains";
import {
	readDomainTokensReadonly,
	type TailwindCustomUtilityStorage,
	type TailwindTokenStorage,
} from "../utils/tailwind-token-store";
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

export { suggestTailwindClasses } from "../utils/class-token-diagnostics";

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

/** Run a class checker over every className of a board, depth first. */
const collectClassDiagnostics = (
	node: DesignNode,
	path: string,
	check: DesignClassChecker,
	issues: ClassTokenDiagnostic[],
) => {
	const className = node.props.className;
	if (className?.trim()) {
		check(
			className,
			{ path: `${path}.props.className`, elementId: node.id },
			issues as DesignClassDiagnostic[],
		);
	}
	if (Array.isArray(node.children)) {
		for (const [childIndex, child] of node.children.entries()) {
			collectClassDiagnostics(
				child,
				`${path}.children[${childIndex}]`,
				check,
				issues,
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
): Promise<ClassTokenInspector | null> => {
	if (!cssPath?.trim()) {
		return null;
	}

	try {
		const { designSystem } = await loadCachedTailwindDesignSystem({
			projectRoot: context.projectRoot,
			cssPath,
		});
		return createClassTokenInspector(designSystem);
	} catch {
		return null;
	}
};

/**
 * Lint findings as design issues: the code is the rule kind id, the
 * severity the instance's (`info` findings are notes, not issues), and the
 * kind's details (the offending class and suggestions, the axis and value)
 * ride along. Problems that kept a rule from running are warnings.
 */
/** Where in a component definition a finding is, for `design_validate`. */
const toComponentLocation = ({
	kind: _kind,
	...location
}: LintComponentLocation) => location;

const toDesignLintIssues = (
	result: DesignLintResult,
): ClassTokenDiagnostic[] => {
	const issues: ClassTokenDiagnostic[] = [];
	for (const finding of result.findings) {
		if (finding.severity === "info") continue;
		const location =
			finding.location?.kind === "design" ? finding.location : null;
		issues.push({
			...finding.details,
			severity: finding.severity,
			code: finding.rule,
			message: finding.message,
			...(location?.path === undefined ? {} : { path: location.path }),
			...(location?.element === undefined
				? {}
				: { elementId: location.element }),
			...(finding.component === undefined
				? {}
				: { component: finding.component }),
			...(finding.location?.kind === "component"
				? { componentLocation: toComponentLocation(finding.location) }
				: {}),
		});
	}
	for (const diagnostic of result.diagnostics) {
		issues.push({
			severity: "warning",
			code: diagnostic.code,
			message: diagnostic.message,
		});
	}
	return issues;
};

/**
 * Diagnostics of a design: recipe instances, renderers, asset and icon
 * references, and class tokens. `boardIds` limits them to those boards (for
 * example the boards a write changed); file-level warnings are kept.
 *
 * With `lint`, the class and token checks run as the system's design-side
 * lint rules instead (`design.unknown-class-token`,
 * `design.unknown-variant-value`, `design.design-only-class-target`), with
 * its `lint.json`: codes are rule kind ids and severities, enabled kinds
 * and options follow the config. `design_validate` and the editor's design
 * lint route pass it; without it the result is what it always was.
 */
export const getDesignDiagnostics = async (
	context: TrickroomMcpServerContext,
	design: TrickroomDesign,
	options: {
		boardIds?: ReadonlySet<string>;
		lint?: { designId: string };
	} = {},
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
	if (!storedTokens && hasClassNames(design.boards)) {
		issues.push({
			severity: "warning",
			code: "DESIGN_TOKENS_NOT_STORED",
			message: `Design system "${system.manifest.systemName}" does not have a stored token snapshot; class token availability could not be verified.`,
			path: "systemName",
		});
	}
	if (storedTokens?.metadata.reviewRequired) {
		issues.push({
			severity: "warning",
			code: "DESIGN_SYSTEM_REVIEW_REQUIRED",
			message: `Design system "${system.manifest.systemName}" has token changes that require review.`,
			path: "systemName",
		});
	}

	if (options.lint) {
		const setup = await loadDesignLintSetup({
			projectRoot: context.projectRoot,
			system,
		});
		issues.push(
			...toDesignLintIssues(
				await lintDesign({
					projectRoot: context.projectRoot,
					setup,
					designId: options.lint.designId,
					design,
					boardIds: options.boardIds,
				}),
			),
		);
	} else {
		const check = createDesignClassChecker(
			classTokenContextFromStorage(
				storedTokens,
				await loadTailwindUtilityInspector(
					context,
					system.manifest.cssPath ?? storedTokens?.metadata.cssPath,
				),
			),
		);
		for (const { board, index } of boards) {
			collectClassDiagnostics(board, `boards[${index}]`, check, issues);
		}
	}

	return {
		issues,
		tokenSnapshot: getTokenSnapshotMetadata(system.manifest, storedTokens),
	};
};
