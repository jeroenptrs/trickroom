import { DesignTransformError } from "../../services/design-transform-service";
import {
	type BulkMigrateProjectSystemComponentInstancesOptions,
	bulkMigrateProjectSystemComponentInstances,
	type SystemComponentBulkMigrationReport,
} from "../../utils/system-component-bulk-migration";
import {
	describeSystemComponent,
	listSystemComponentSummaries,
} from "../../utils/system-component-operations";
import { resolveSystemComponentVariantValues } from "../../utils/system-component-resolution";
import {
	type SystemComponentUsageScanResult,
	scanProjectSystemComponentUsage,
} from "../../utils/system-component-usage-scan";
import type {
	SystemComponentDraftPayload,
	SystemComponentRecord,
	SystemComponentVariantSchema,
} from "../../utils/system-components";
import {
	collectRecipeTemplateNodes,
	hashSystemComponentTemplate,
	hashSystemComponentVariantSchema,
	type SystemComponentManifestDiagnostic,
} from "../../utils/system-components-validation";
import { assertCanUseSystemComponentInstanceSubtree } from "../design-operations";
import {
	appendMcpAuditLog,
	assertCanReadDesignFile,
	assertCanWriteDesignFile,
	assertCanWriteProject,
	getMcpPolicy,
} from "../governance";
import type { TrickroomMcpServerContext } from "../server-types";
import { TOOL } from "../tool-names";
import {
	assertConfiguredSystem,
	canonicalizeDesignSystemReferenceForStorage,
} from "./design-system";
import { getProjectReference } from "./project";

const INDEX_DESCRIPTION_LENGTH = 80;

/** First sentence or line of a description, bounded for index rows. */
const truncateDescription = (description: string) => {
	const firstLine = description.trim().split("\n")[0]?.trim() ?? "";
	const sentenceEnd = firstLine.search(/[.!?](\s|$)/);
	const sentence =
		sentenceEnd >= 0 ? firstLine.slice(0, sentenceEnd + 1) : firstLine;
	if (sentence.length <= INDEX_DESCRIPTION_LENGTH) {
		return sentence;
	}
	const cut = sentence.slice(0, INDEX_DESCRIPTION_LENGTH);
	const lastSpace = cut.lastIndexOf(" ");
	return `${(lastSpace > INDEX_DESCRIPTION_LENGTH / 2 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
};

const currentPublishedVersion = (record: SystemComponentRecord) =>
	record.published?.versions[record.published.currentVersion];

/**
 * Draft state relative to the current published version: "unpublished" when
 * nothing is published yet, "changed" when publishing would change the
 * template or variants. Undefined when there is no draft or it matches.
 */
const draftState = (record: SystemComponentRecord) => {
	if (!record.draft) {
		return undefined;
	}
	const published = currentPublishedVersion(record);
	if (!published) {
		return "unpublished" as const;
	}
	return hashSystemComponentTemplate(record.draft) !== published.templateHash ||
		hashSystemComponentVariantSchema(record.draft.variants) !==
			published.variantSchemaHash
		? ("changed" as const)
		: undefined;
};

const variantAxesSummary = (
	variants: SystemComponentVariantSchema | undefined,
) =>
	Object.entries(variants?.axes ?? {})
		.map(
			([axis, definition]) =>
				`${axis}: ${Object.keys(definition.values).join("|")}`,
		)
		.join("; ");

const matchesQuery = (record: SystemComponentRecord, query: string) => {
	const needle = query.trim().toLowerCase();
	return [
		record.componentId,
		record.slug,
		record.name,
		record.group ?? "",
		record.description ?? "",
	].some((value) => value.toLowerCase().includes(needle));
};

/**
 * Compact component index: one short row per component so 100+ components
 * fit in one response. component_read describe has the interface details.
 */
export const listSystemComponentsPayload = async (
	context: TrickroomMcpServerContext,
	systemName: string,
	filters: { query?: string; group?: string } = {},
) => {
	const system = await assertConfiguredSystem(context, systemName);
	const result = await listSystemComponentSummaries(
		context.projectRoot,
		system.manifest.systemId,
	);
	const records = result.components
		.map((summary) => result.manifest.components[summary.componentId])
		.filter((record) => record !== undefined);
	const groupFilter = filters.group?.trim().toLowerCase();
	const matched = records.filter(
		(record) =>
			(groupFilter === undefined ||
				(record.group ?? "").toLowerCase() === groupFilter) &&
			(filters.query === undefined || matchesQuery(record, filters.query)),
	);
	const filtered = filters.query !== undefined || filters.group !== undefined;

	return {
		project: getProjectReference(context),
		systemId: system.manifest.systemId,
		systemName: system.manifest.systemName,
		revision: result.revision,
		settings: {
			autoMigrateComponents:
				result.manifest.settings?.autoMigrateComponents ?? false,
		},
		componentCount: records.length,
		...(filtered ? { matchedCount: matched.length } : {}),
		components: matched.map((record) => {
			const published = currentPublishedVersion(record);
			const draft = draftState(record);
			const variants = variantAxesSummary(
				(published ?? record.draft)?.variants,
			);
			return {
				componentId: record.componentId,
				slug: record.slug,
				// "Empty State" adds nothing to "empty-state".
				...(record.name.toLowerCase() !== record.slug.replaceAll("-", " ")
					? { name: record.name }
					: {}),
				...(record.group ? { group: record.group } : {}),
				...(record.published
					? { version: record.published.currentVersion }
					: {}),
				...(draft ? { draft } : {}),
				...(variants ? { variants } : {}),
				...(record.description
					? { description: truncateDescription(record.description) }
					: {}),
			};
		}),
	};
};

type ComponentPayload = Pick<
	SystemComponentDraftPayload,
	"root" | "slots" | "props" | "variants" | "overrideTargets"
>;

const defaultVariantValues = (
	variants: SystemComponentVariantSchema | undefined,
) => {
	try {
		return resolveSystemComponentVariantValues(variants);
	} catch {
		return variants?.defaultValues ?? {};
	}
};

/** What an agent needs to place and vary an instance of this component. */
const componentInterface = (payload: ComponentPayload) => {
	const defaults = defaultVariantValues(payload.variants);
	const compoundVariantCount = payload.variants?.compoundVariants?.length ?? 0;
	return {
		variantAxes: Object.entries(payload.variants?.axes ?? {}).map(
			([axis, definition]) => ({
				axis,
				...(definition.label && definition.label !== axis
					? { label: definition.label }
					: {}),
				values: Object.keys(definition.values),
				...(defaults[axis] !== undefined ? { default: defaults[axis] } : {}),
			}),
		),
		...(compoundVariantCount > 0 ? { compoundVariantCount } : {}),
		slots: Object.values(payload.slots ?? {}).map((slot) => ({
			name: slot.name,
			...(slot.label ? { label: slot.label } : {}),
			hostPath: slot.hostPath,
			...(slot.insertIndex !== undefined
				? { insertIndex: slot.insertIndex }
				: {}),
			...(slot.defaultChildren?.length
				? { defaultChildCount: slot.defaultChildren.length }
				: {}),
		})),
		overrideTargets: Object.values(payload.overrideTargets ?? {}).map(
			(target) => ({
				targetId: target.targetId,
				label: target.label,
				path: target.path,
				capabilities: target.capabilities ?? ["className"],
				...(target.props?.length ? { props: target.props } : {}),
			}),
		),
		...(payload.props && Object.keys(payload.props).length > 0
			? { props: payload.props }
			: {}),
	};
};

/**
 * Keep only the current published version's template by default; older
 * versions are summarized (version, publishedAt, hashes) so callers can still
 * see the history and opt into full templates with versions: "all".
 */
const limitPublishedVersions = (
	record: SystemComponentRecord,
	versions: "current" | "all",
): SystemComponentRecord => {
	if (versions === "all" || !record.published) {
		return record;
	}
	const { currentVersion, versions: published } = record.published;
	return {
		...record,
		published: {
			currentVersion,
			versions: Object.hasOwn(published, currentVersion)
				? { [currentVersion]: published[currentVersion] }
				: {},
		},
	};
};

const componentDiagnostics = (
	diagnostics: SystemComponentManifestDiagnostic[],
	componentId: string,
) =>
	diagnostics.filter(
		(diagnostic) =>
			diagnostic.componentId === undefined ||
			diagnostic.componentId === componentId,
	);

export type DescribeSystemComponentInclude = "template" | "classes" | "record";

export const describeSystemComponentPayload = async (
	context: TrickroomMcpServerContext,
	systemName: string,
	componentId: string,
	options: {
		source?: "published" | "draft";
		include?: readonly DescribeSystemComponentInclude[];
		versions?: "current" | "all";
	} = {},
) => {
	const system = await assertConfiguredSystem(context, systemName);
	const result = await describeSystemComponent(
		context.projectRoot,
		system.manifest.systemId,
		componentId,
	);
	const record = result.record;
	const published = currentPublishedVersion(record);
	const sourceKind = options.source ?? (published ? "published" : "draft");
	const payload = sourceKind === "published" ? published : record.draft;
	if (!payload) {
		throw new DesignTransformError(
			"INVALID_OPERATION_PARAMETERS",
			sourceKind === "published"
				? `Component "${componentId}" has no published version; describe it with source: "draft".`
				: `Component "${componentId}" has no draft; describe it with source: "published".`,
		);
	}
	const include = new Set(options.include ?? []);
	if (options.versions === "all") {
		include.add("record");
	}
	const draft = draftState(record);
	const diagnostics = componentDiagnostics(result.diagnostics, componentId);

	return {
		project: getProjectReference(context),
		systemId: system.manifest.systemId,
		systemName: system.manifest.systemName,
		revision: result.revision,
		componentId,
		slug: record.slug,
		name: record.name,
		...(record.group ? { group: record.group } : {}),
		...(record.description ? { description: record.description } : {}),
		...(record.published
			? { currentVersion: record.published.currentVersion }
			: {}),
		source:
			sourceKind === "published"
				? { kind: "published", version: record.published?.currentVersion }
				: { kind: "draft" },
		...(record.draft
			? {
					draftTemplateHash: result.draftTemplateHash,
					draftVariantSchemaHash: result.draftVariantSchemaHash,
					...(draft ? { draftState: draft } : {}),
				}
			: {}),
		interface: componentInterface(payload),
		...(include.has("template")
			? {
					root: payload.root,
					...(payload.slots ? { slots: payload.slots } : {}),
					...(payload.overrideTargets
						? { overrideTargets: payload.overrideTargets }
						: {}),
				}
			: {}),
		...(include.has("classes") && payload.variants
			? { variants: payload.variants }
			: {}),
		...(record.published
			? {
					versionHistory: Object.values(record.published.versions).map(
						(entry) => ({
							version: entry.version,
							publishedAt: entry.publishedAt,
						}),
					),
				}
			: {}),
		...(include.has("record")
			? {
					record: limitPublishedVersions(record, options.versions ?? "current"),
				}
			: {}),
		valid: result.valid,
		diagnostics,
	};
};

type ComponentShape = {
	nodeCount: number;
	axes: Map<string, string[]>;
	compoundVariantCount: number;
	slots: string[];
	overrideTargets: string[];
	templateHash: string;
	variantSchemaHash: string;
};

const componentShape = (payload: ComponentPayload): ComponentShape => ({
	nodeCount: collectRecipeTemplateNodes(payload.root).length,
	axes: new Map(
		Object.entries(payload.variants?.axes ?? {}).map(([axis, definition]) => [
			axis,
			Object.keys(definition.values),
		]),
	),
	compoundVariantCount: payload.variants?.compoundVariants?.length ?? 0,
	slots: Object.keys(payload.slots ?? {}),
	overrideTargets: Object.keys(payload.overrideTargets ?? {}),
	templateHash: hashSystemComponentTemplate(payload),
	variantSchemaHash: hashSystemComponentVariantSchema(payload.variants),
});

const keyDiff = (before: readonly string[], after: readonly string[]) => {
	const added = after.filter((key) => !before.includes(key));
	const removed = before.filter((key) => !after.includes(key));
	return added.length > 0 || removed.length > 0
		? {
				...(added.length > 0 ? { added } : {}),
				...(removed.length > 0 ? { removed } : {}),
			}
		: undefined;
};

/** Summary-level difference between two component payloads. */
const diffComponentShapes = (before: ComponentShape, after: ComponentShape) => {
	const variantValues = Object.fromEntries(
		[...after.axes]
			.filter(([axis]) => before.axes.has(axis))
			.map(([axis, values]) => [
				axis,
				keyDiff(before.axes.get(axis) ?? [], values),
			])
			.filter(([, diff]) => diff !== undefined),
	);
	const variantAxes = keyDiff([...before.axes.keys()], [...after.axes.keys()]);
	const slots = keyDiff(before.slots, after.slots);
	const overrideTargets = keyDiff(
		before.overrideTargets,
		after.overrideTargets,
	);
	return {
		templateChanged: before.templateHash !== after.templateHash,
		variantsChanged: before.variantSchemaHash !== after.variantSchemaHash,
		...(before.nodeCount !== after.nodeCount
			? { nodeCount: { from: before.nodeCount, to: after.nodeCount } }
			: {}),
		...(variantAxes ? { variantAxes } : {}),
		...(Object.keys(variantValues).length > 0 ? { variantValues } : {}),
		...(before.compoundVariantCount !== after.compoundVariantCount
			? {
					compoundVariantCount: {
						from: before.compoundVariantCount,
						to: after.compoundVariantCount,
					},
				}
			: {}),
		...(slots ? { slots } : {}),
		...(overrideTargets ? { overrideTargets } : {}),
	};
};

const shapeSummary = (shape: ComponentShape) => ({
	nodeCount: shape.nodeCount,
	variantAxes: [...shape.axes.keys()],
	slots: shape.slots,
	overrideTargets: shape.overrideTargets,
});

/** What a write changed in a component's labels: name, group, description. */
export type SystemComponentMetadataChanges = {
	name?: { from: string; to: string };
	group?: { from: string | null; to: string | null };
	description?: "set" | "changed" | "cleared";
};

export const diffSystemComponentMetadata = (
	before: Pick<SystemComponentRecord, "name" | "group" | "description">,
	after: Pick<SystemComponentRecord, "name" | "group" | "description">,
): SystemComponentMetadataChanges => ({
	...(before.name !== after.name
		? { name: { from: before.name, to: after.name } }
		: {}),
	...((before.group ?? null) !== (after.group ?? null)
		? { group: { from: before.group ?? null, to: after.group ?? null } }
		: {}),
	...(before.description !== after.description
		? {
				description:
					before.description === undefined
						? ("set" as const)
						: after.description === undefined
							? ("cleared" as const)
							: ("changed" as const),
			}
		: {}),
});

/**
 * Write acknowledgement for draft and publish tools: ids, the new manifest
 * revision, hashes, this component's diagnostics, and a summary of what
 * changed. Never the full record; component_read describe with include "record" has that.
 */
export const systemComponentMutationPayload = async (
	context: TrickroomMcpServerContext,
	systemName: string,
	componentId: string,
	change:
		| { kind: "created" }
		| {
				kind: "updated";
				/** The draft before the write, when draft parts were replaced. */
				before?: ComponentPayload;
				replaced: string[];
				metadata?: SystemComponentMetadataChanges;
		  }
		| { kind: "published"; previousVersion?: string },
) => {
	const system = await assertConfiguredSystem(context, systemName);
	const result = await describeSystemComponent(
		context.projectRoot,
		system.manifest.systemId,
		componentId,
	);
	const record = result.record;
	const published = currentPublishedVersion(record);
	const changes = (() => {
		if (change.kind === "created") {
			return record.draft
				? { created: true, ...shapeSummary(componentShape(record.draft)) }
				: { created: true };
		}
		if (change.kind === "updated") {
			const metadata =
				change.metadata && Object.keys(change.metadata).length > 0
					? { metadata: change.metadata }
					: {};
			if (change.before === undefined) {
				return Object.keys(metadata).length > 0
					? metadata
					: { unchanged: true };
			}
			return {
				replaced: change.replaced,
				...metadata,
				...(record.draft
					? diffComponentShapes(
							componentShape(change.before),
							componentShape(record.draft),
						)
					: {}),
			};
		}
		const previous =
			change.previousVersion !== undefined
				? record.published?.versions[change.previousVersion]
				: undefined;
		return {
			...(change.previousVersion !== undefined
				? { fromVersion: change.previousVersion }
				: {}),
			toVersion: record.published?.currentVersion,
			...(previous && published
				? diffComponentShapes(
						componentShape(previous),
						componentShape(published),
					)
				: published
					? shapeSummary(componentShape(published))
					: {}),
		};
	})();
	const draft = draftState(record);

	return {
		status: "success",
		project: getProjectReference(context),
		systemId: system.manifest.systemId,
		systemName: system.manifest.systemName,
		revision: result.revision,
		componentId,
		slug: record.slug,
		...(record.draft
			? {
					draftTemplateHash: result.draftTemplateHash,
					draftVariantSchemaHash: result.draftVariantSchemaHash,
					...(draft ? { draftState: draft } : {}),
				}
			: {}),
		...(record.published && published
			? {
					published: {
						currentVersion: record.published.currentVersion,
						templateHash: published.templateHash,
						variantSchemaHash: published.variantSchemaHash,
					},
				}
			: {}),
		changes,
		valid: result.valid,
		diagnostics: componentDiagnostics(result.diagnostics, componentId),
	};
};

const emptySystemComponentUsageStatusCounts =
	(): SystemComponentUsageScanResult["statusCounts"] => ({
		current: 0,
		stale: 0,
		"missing-component": 0,
		"missing-version": 0,
		"hash-mismatch": 0,
	});

const createEmptySystemComponentUsageScanResult = (options: {
	systemId?: string;
	systemName?: string;
	componentId?: string;
}): SystemComponentUsageScanResult => ({
	systemId: options.systemId,
	systemName: options.systemName,
	componentId: options.componentId,
	instances: [],
	diagnostics: [],
	usedByCount: 0,
	scannedDesignCount: 0,
	statusCounts: emptySystemComponentUsageStatusCounts(),
});

const mergeSystemComponentUsageScanResults = (
	results: readonly SystemComponentUsageScanResult[],
	defaults: Pick<
		SystemComponentUsageScanResult,
		"systemId" | "systemName" | "componentId"
	> = {},
): SystemComponentUsageScanResult => {
	if (results.length === 0) {
		return createEmptySystemComponentUsageScanResult(defaults);
	}

	const merged: SystemComponentUsageScanResult = {
		instances: [],
		diagnostics: [],
		usedByCount: 0,
		scannedDesignCount: 0,
		statusCounts: emptySystemComponentUsageStatusCounts(),
	};

	for (const result of results) {
		merged.systemId ??= result.systemId;
		merged.systemName ??= result.systemName;
		merged.componentId ??= result.componentId;
		merged.instances.push(...result.instances);
		merged.diagnostics.push(...result.diagnostics);
		merged.usedByCount += result.usedByCount;
		merged.scannedDesignCount += result.scannedDesignCount;
		for (const [status, count] of Object.entries(result.statusCounts)) {
			merged.statusCounts[
				status as keyof SystemComponentUsageScanResult["statusCounts"]
			] += count;
		}
	}

	return merged;
};

const scanPolicyAllowedSystemComponentUsage = async (
	context: TrickroomMcpServerContext,
	options: {
		systemName: string;
		componentId?: string;
		designFileId?: string;
	},
) => {
	const policy = getMcpPolicy(context.config);
	const system = await assertConfiguredSystem(context, options.systemName);

	if (options.designFileId) {
		assertCanReadDesignFile(policy, options.designFileId);
		return scanProjectSystemComponentUsage(context.projectRoot, {
			systemHandle: system.manifest.systemId,
			componentId: options.componentId,
			designFileId: options.designFileId,
		});
	}

	if (policy.allowedDesignFileIds !== null) {
		const emptyScanDefaults = {
			systemId: system.manifest.systemId,
			systemName: system.manifest.systemName,
			componentId: options.componentId,
		};
		if (policy.allowedDesignFileIds.size === 0) {
			return createEmptySystemComponentUsageScanResult(emptyScanDefaults);
		}

		const results = await Promise.all(
			Array.from(policy.allowedDesignFileIds).map((designFileId) =>
				scanProjectSystemComponentUsage(context.projectRoot, {
					systemHandle: system.manifest.systemId,
					componentId: options.componentId,
					designFileId,
				}),
			),
		);
		return mergeSystemComponentUsageScanResults(results, emptyScanDefaults);
	}

	return scanProjectSystemComponentUsage(context.projectRoot, {
		systemHandle: system.manifest.systemId,
		componentId: options.componentId,
	});
};

const createEmptySystemComponentBulkMigrationReport = (options: {
	dryRun?: boolean;
	systemId?: string;
	systemName?: string;
	componentId?: string;
}): SystemComponentBulkMigrationReport => ({
	systemId: options.systemId,
	systemName: options.systemName,
	componentId: options.componentId,
	dryRun: options.dryRun ?? false,
	designs: [],
	changed: [],
	skipped: [],
	reviewRequired: [],
	failures: [],
	scannedDesignCount: 0,
	changedCount: 0,
	skippedCount: 0,
	reviewRequiredCount: 0,
	failureCount: 0,
});

const mergeSystemComponentBulkMigrationReports = (
	reports: readonly SystemComponentBulkMigrationReport[],
	defaults: Pick<
		SystemComponentBulkMigrationReport,
		"dryRun" | "systemId" | "systemName" | "componentId"
	> = { dryRun: false },
): SystemComponentBulkMigrationReport => {
	if (reports.length === 0) {
		return createEmptySystemComponentBulkMigrationReport(defaults);
	}

	const merged: SystemComponentBulkMigrationReport = {
		...reports[0],
		designs: [],
		changed: [],
		skipped: [],
		reviewRequired: [],
		failures: [],
		scannedDesignCount: 0,
	};

	for (const report of reports) {
		merged.designs.push(...report.designs);
		merged.changed.push(...report.changed);
		merged.skipped.push(...report.skipped);
		merged.reviewRequired.push(...report.reviewRequired);
		merged.failures.push(...report.failures);
		merged.scannedDesignCount += report.scannedDesignCount;
	}

	merged.changedCount = merged.changed.length;
	merged.skippedCount = merged.skipped.length;
	merged.reviewRequiredCount = merged.reviewRequired.length;
	merged.failureCount = merged.failures.length;
	return merged;
};

const bulkMigratePolicyAllowedSystemComponentUsages = async (
	context: TrickroomMcpServerContext,
	systemName: string,
	options: {
		componentId?: string;
		designFileId?: string;
		dryRun?: boolean;
		onlySafe?: boolean;
	},
) => {
	const system = await assertConfiguredSystem(context, systemName);
	const policy = getMcpPolicy(context.config);
	const bulkOptions: BulkMigrateProjectSystemComponentInstancesOptions = {
		systemHandle: system.manifest.systemId,
		componentId: options.componentId,
		dryRun: options.dryRun,
		onlySafe: options.onlySafe,
		persist: !options.dryRun,
		assertInstanceSubtreeAllowed: (design, elementId) => {
			assertCanUseSystemComponentInstanceSubtree(policy, design, elementId);
		},
		prepareDesign: (design) =>
			canonicalizeDesignSystemReferenceForStorage(context, design),
		onDesignWrite: ({ status, message, ...write }) =>
			appendMcpAuditLog(context, {
				toolName: TOOL.componentMigrate,
				operation: "bulk",
				projectId: context.config.projectId ?? null,
				projectRoot: context.projectRoot,
				...write,
				success: status === "success",
				status,
				...(message ? { message } : {}),
			}),
	};

	if (options.designFileId) {
		assertCanReadDesignFile(policy, options.designFileId);
		if (!options.dryRun) {
			assertCanWriteDesignFile(policy, options.designFileId);
		}
		return bulkMigrateProjectSystemComponentInstances(context.projectRoot, {
			...bulkOptions,
			designFileId: options.designFileId,
		});
	}

	if (policy.allowedDesignFileIds !== null) {
		const emptyReportDefaults = {
			dryRun: options.dryRun ?? false,
			systemId: system.manifest.systemId,
			systemName: system.manifest.systemName,
			componentId: options.componentId,
		};
		if (policy.allowedDesignFileIds.size === 0) {
			return createEmptySystemComponentBulkMigrationReport(emptyReportDefaults);
		}

		const reports = await Promise.all(
			Array.from(policy.allowedDesignFileIds).map((designFileId) => {
				assertCanReadDesignFile(policy, designFileId);
				if (!options.dryRun) {
					assertCanWriteDesignFile(policy, designFileId);
				}
				return bulkMigrateProjectSystemComponentInstances(context.projectRoot, {
					...bulkOptions,
					designFileId,
				});
			}),
		);
		return mergeSystemComponentBulkMigrationReports(
			reports,
			emptyReportDefaults,
		);
	}

	if (!options.dryRun) {
		assertCanWriteProject(policy);
	}

	return bulkMigrateProjectSystemComponentInstances(
		context.projectRoot,
		bulkOptions,
	);
};

const DEFAULT_INSTANCE_LIMIT = 20;

const countBy = <Item>(items: readonly Item[], key: (item: Item) => string) => {
	const counts: Record<string, number> = {};
	for (const item of items) {
		const value = key(item);
		counts[value] = (counts[value] ?? 0) + 1;
	}
	return counts;
};

/** First `limit` items plus how many were left out. */
const capped = <Item>(key: string, items: readonly Item[], limit: number) => ({
	[key]: items.slice(0, limit),
	...(items.length > limit ? { [`${key}Omitted`]: items.length - limit } : {}),
});

/**
 * Summary by default: counts, a per-design rollup of designs with changes,
 * review-required instances without previews, and failures. includeInstances
 * adds the changed/review-required/skipped instance rows (non-current only),
 * each capped at `limit`.
 */
export const bulkMigrateSystemComponentUsagesPayload = async (
	context: TrickroomMcpServerContext,
	systemName: string,
	options: {
		componentId?: string;
		designFileId?: string;
		dryRun?: boolean;
		onlySafe?: boolean;
		includeInstances?: boolean;
		limit?: number;
	} = {},
) => {
	const report = await bulkMigratePolicyAllowedSystemComponentUsages(
		context,
		systemName,
		options,
	);
	const limit = options.limit ?? DEFAULT_INSTANCE_LIMIT;
	// Instances already on the current version are reported by the scan as
	// skipped; they are counted, never listed.
	const actionableSkipped = report.skipped.filter(
		(entry) => entry.reason !== "current",
	);

	return {
		project: getProjectReference(context),
		systemId: report.systemId,
		systemName: report.systemName ?? systemName,
		...(options.componentId ? { componentId: options.componentId } : {}),
		...(options.designFileId ? { designFileId: options.designFileId } : {}),
		dryRun: report.dryRun,
		onlySafe: options.onlySafe !== false,
		scannedDesignCount: report.scannedDesignCount,
		changedCount: report.changedCount,
		skippedCount: report.skippedCount,
		reviewRequiredCount: report.reviewRequiredCount,
		failureCount: report.failureCount,
		...(report.skipped.length > 0
			? { skippedReasons: countBy(report.skipped, (entry) => entry.reason) }
			: {}),
		designs: report.designs
			.filter(
				(design) =>
					design.changed.length > 0 ||
					design.reviewRequired.length > 0 ||
					design.failures.length > 0,
			)
			.map((design) => ({
				designFileId: design.designFileId,
				designName: design.designName,
				changed: design.changed.length,
				reviewRequired: design.reviewRequired.length,
				failures: design.failures.length,
				persisted: design.persisted,
				...(design.nextRevision ? { newRevision: design.nextRevision } : {}),
			})),
		...(options.includeInstances
			? {
					...capped("changed", report.changed, limit),
					...capped("reviewRequired", report.reviewRequired, limit),
					...capped("skipped", actionableSkipped, limit),
				}
			: capped(
					"reviewRequired",
					report.reviewRequired.map(
						({
							preview: _preview,
							designFile: _file,
							systemId: _system,
							...entry
						}) => entry,
					),
					limit,
				)),
		...capped("failures", report.failures, limit),
	};
};

export const listStaleSystemComponentUsagesPayload = async (
	context: TrickroomMcpServerContext,
	systemName: string,
	options: {
		componentId?: string;
		designFileId?: string;
		limit?: number;
	} = {},
) => {
	const result = await scanPolicyAllowedSystemComponentUsage(context, {
		systemName,
		componentId: options.componentId,
		designFileId: options.designFileId,
	});
	const limit = options.limit ?? DEFAULT_INSTANCE_LIMIT;
	const staleInstances = result.instances.filter(
		(instance) => instance.versionStatus?.status === "stale",
	);
	// STALE_VERSION diagnostics restate each usage row; keep the others
	// (hash-review signals, unreadable designs).
	const otherDiagnostics = result.diagnostics.filter(
		(diagnostic) => diagnostic.code !== "STALE_VERSION",
	);
	const byComponent = new Map<
		string,
		{
			currentVersion?: string;
			count: number;
			fromVersions: Record<string, number>;
			designs: Set<string>;
		}
	>();
	for (const usage of staleInstances) {
		const entry = byComponent.get(usage.componentId) ?? {
			currentVersion: usage.versionStatus?.currentVersion,
			count: 0,
			fromVersions: {},
			designs: new Set<string>(),
		};
		entry.count += 1;
		entry.fromVersions[usage.version] =
			(entry.fromVersions[usage.version] ?? 0) + 1;
		entry.designs.add(usage.designFileId);
		byComponent.set(usage.componentId, entry);
	}
	const designNames = new Map(
		staleInstances.map((usage) => [usage.designFileId, usage.designName]),
	);
	const byDesign = countBy(staleInstances, (usage) => usage.designFileId);

	return {
		project: getProjectReference(context),
		systemId: result.systemId,
		systemName: result.systemName ?? systemName,
		...(options.componentId ? { componentId: options.componentId } : {}),
		...(options.designFileId ? { designFileId: options.designFileId } : {}),
		staleCount: staleInstances.length,
		scannedDesignCount: result.scannedDesignCount,
		statusCounts: result.statusCounts,
		components: [...byComponent].map(([componentId, entry]) => ({
			componentId,
			currentVersion: entry.currentVersion,
			staleCount: entry.count,
			fromVersions: entry.fromVersions,
			designCount: entry.designs.size,
		})),
		designs: Object.entries(byDesign).map(([designFileId, staleCount]) => ({
			designFileId,
			designName: designNames.get(designFileId),
			staleCount,
		})),
		...capped(
			"usages",
			staleInstances.map((usage) => ({
				designFileId: usage.designFileId,
				nodeId: usage.elementId,
				componentId: usage.componentId,
				instanceId: usage.instanceId,
				attachedVersion: usage.version,
				currentVersion: usage.versionStatus?.currentVersion,
			})),
			limit,
		),
		...(otherDiagnostics.length > 0
			? {
					diagnosticCounts: countBy(
						otherDiagnostics,
						(diagnostic) => diagnostic.code,
					),
					...capped("diagnostics", otherDiagnostics, limit),
				}
			: {}),
	};
};
