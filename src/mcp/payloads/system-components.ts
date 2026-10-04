import {
	bulkMigrateProjectSystemComponentInstances,
	type SystemComponentBulkMigrationReport,
} from "../../utils/system-component-bulk-migration";
import {
	describeSystemComponent,
	listSystemComponentSummaries,
} from "../../utils/system-component-operations";
import {
	type SystemComponentInstanceUsage,
	type SystemComponentUsageScanDiagnostic,
	type SystemComponentUsageScanResult,
	scanProjectSystemComponentUsage,
} from "../../utils/system-component-usage-scan";
import { assertCanUseSystemComponentInstanceSubtree } from "../design-operations";
import {
	assertCanReadDesignFile,
	assertCanWriteDesignFile,
	assertCanWriteProject,
	getMcpPolicy,
} from "../governance";
import type { TrickroomMcpServerContext } from "../server-types";
import { assertConfiguredSystem } from "./design-system";
import { getProjectReference } from "./project";

export const listSystemComponentsPayload = async (
	context: TrickroomMcpServerContext,
	systemName: string,
) => {
	const system = await assertConfiguredSystem(context, systemName);
	const result = await listSystemComponentSummaries(
		context.projectRoot,
		system.manifest.systemId,
	);
	return {
		project: getProjectReference(context),
		systemId: system.manifest.systemId,
		systemName: system.manifest.systemName,
		revision: result.revision,
		updatedAt: result.updatedAt,
		settings: {
			autoMigrateComponents:
				result.manifest.settings?.autoMigrateComponents ?? false,
		},
		components: result.components,
	};
};

/**
 * Keep only the current published version's template by default; older
 * versions are summarized (version, publishedAt, hashes) so callers can still
 * see the history and opt into full templates with versions: "all".
 */
const limitPublishedVersions = (
	record: Awaited<ReturnType<typeof describeSystemComponent>>["record"],
	versions: "current" | "all",
) => {
	if (versions === "all" || !record.published) {
		return { record };
	}
	const { currentVersion, versions: published } = record.published;
	const versionHistory = Object.values(published).map((entry) => ({
		version: entry.version,
		publishedAt: entry.publishedAt,
		templateHash: entry.templateHash,
		variantSchemaHash: entry.variantSchemaHash,
		...(entry.previousVersion !== undefined
			? { previousVersion: entry.previousVersion }
			: {}),
	}));
	return {
		record: {
			...record,
			published: {
				currentVersion,
				versions: Object.hasOwn(published, currentVersion)
					? { [currentVersion]: published[currentVersion] }
					: {},
			},
		},
		versionHistory,
	};
};

export const describeSystemComponentPayload = async (
	context: TrickroomMcpServerContext,
	systemName: string,
	componentId: string,
	versions: "current" | "all" = "current",
) => {
	const system = await assertConfiguredSystem(context, systemName);
	const result = await describeSystemComponent(
		context.projectRoot,
		system.manifest.systemId,
		componentId,
	);
	const limited = limitPublishedVersions(result.record, versions);
	return {
		project: getProjectReference(context),
		systemId: system.manifest.systemId,
		systemName: system.manifest.systemName,
		revision: result.revision,
		updatedAt: result.updatedAt,
		componentId: result.componentId,
		record: limited.record,
		...(limited.versionHistory
			? { versionHistory: limited.versionHistory }
			: {}),
		draftTemplateHash: result.draftTemplateHash,
		draftVariantSchemaHash: result.draftVariantSchemaHash,
		diagnostics: result.diagnostics,
		valid: result.valid,
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
	const bulkOptions = {
		systemHandle: system.manifest.systemId,
		componentId: options.componentId,
		dryRun: options.dryRun,
		onlySafe: options.onlySafe,
		persist: !options.dryRun,
		assertInstanceSubtreeAllowed: (design, elementId) => {
			assertCanUseSystemComponentInstanceSubtree(policy, design, elementId);
		},
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

export const bulkMigrateSystemComponentUsagesPayload = async (
	context: TrickroomMcpServerContext,
	systemName: string,
	options: {
		componentId?: string;
		designFileId?: string;
		dryRun?: boolean;
		onlySafe?: boolean;
	} = {},
) => {
	const report = await bulkMigratePolicyAllowedSystemComponentUsages(
		context,
		systemName,
		options,
	);

	return {
		project: getProjectReference(context),
		systemId: report.systemId,
		systemName: report.systemName ?? systemName,
		componentId: options.componentId,
		designFileId: options.designFileId,
		dryRun: report.dryRun,
		onlySafe: options.onlySafe !== false,
		scannedDesignCount: report.scannedDesignCount,
		changedCount: report.changedCount,
		skippedCount: report.skippedCount,
		reviewRequiredCount: report.reviewRequiredCount,
		failureCount: report.failureCount,
		designs: report.designs,
		changed: report.changed,
		skipped: report.skipped,
		reviewRequired: report.reviewRequired,
		failures: report.failures,
	};
};

export const listStaleSystemComponentUsagesPayload = async (
	context: TrickroomMcpServerContext,
	systemName: string,
	options: {
		componentId?: string;
		designFileId?: string;
	} = {},
) => {
	const result = await scanPolicyAllowedSystemComponentUsage(context, {
		systemName,
		...options,
	});
	const staleInstances = result.instances.filter(
		(instance) => instance.versionStatus?.status === "stale",
	);
	const diagnosticMatchesUsage = (
		diagnostic: SystemComponentUsageScanDiagnostic,
		usage: SystemComponentInstanceUsage,
	) =>
		diagnostic.designFileId === usage.designFileId &&
		diagnostic.elementId === usage.elementId &&
		diagnostic.componentId === usage.componentId &&
		diagnostic.version === usage.version;

	return {
		project: getProjectReference(context),
		systemId: result.systemId,
		systemName: result.systemName ?? systemName,
		componentId: options.componentId,
		designFileId: options.designFileId,
		staleCount: staleInstances.length,
		scannedDesignCount: result.scannedDesignCount,
		statusCounts: result.statusCounts,
		usages: staleInstances.map((usage) => ({
			designFileId: usage.designFileId,
			designFile: usage.designFile,
			designName: usage.designName,
			nodeId: usage.elementId,
			nodePath: usage.path,
			componentId: usage.componentId,
			systemId: usage.systemId,
			instanceId: usage.instanceId,
			referencedVersion: usage.version,
			attachedVersion: usage.version,
			currentVersion: usage.versionStatus?.currentVersion,
			publishedVersion: usage.versionStatus?.publishedVersion,
			diagnostics: result.diagnostics.filter((diagnostic) =>
				diagnosticMatchesUsage(diagnostic, usage),
			),
		})),
		diagnostics: result.diagnostics,
	};
};

export const systemComponentMutationPayload = async (
	context: TrickroomMcpServerContext,
	systemName: string,
	componentId: string,
	extra: Record<string, unknown> = {},
) => ({
	status: "success",
	...(await describeSystemComponentPayload(context, systemName, componentId)),
	...extra,
});
