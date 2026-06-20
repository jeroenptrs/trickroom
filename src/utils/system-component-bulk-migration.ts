/**
 * Bulk migration for attached system component instances.
 *
 * Supported:
 * - One design file (in-memory or persisted via project helper)
 * - Project scope for one system, optionally filtered by component and/or design file
 *
 * Boundaries:
 * - Only stale instances with published source/target versions are candidates
 * - `onlySafe` (default true) skips review-required classifications; they are reported only
 * - Blocked unsafe previews and non-stale statuses are never applied
 * - Each instance migrates atomically; a failed instance does not partially rewrite its subtree
 * - Persisted writes are per design file; a revision mismatch rolls back that file's in-memory changes
 */
import {
	createDesignFileService,
	DesignFileServiceError,
	type DesignFileRevision,
	type DesignFileSummary,
} from "../services/design-file-service";
import type { TrickroomDesign } from "../types";
import {
	bulkMigrateDesignSystemComponentInstances,
	emptyDesignReport,
	resolveAutomaticMigrationPolicy,
	skipDesignForAutomaticPolicy,
	toInstanceRef,
	type BulkMigrateDesignSystemComponentInstancesOptions,
	type SystemComponentBulkMigrationChangedInstance,
	type SystemComponentBulkMigrationDesignReport,
	type SystemComponentBulkMigrationFailedInstance,
	type SystemComponentBulkMigrationFailureCode,
	type SystemComponentBulkMigrationInstanceRef,
	type SystemComponentBulkMigrationReviewRequiredInstance,
	type SystemComponentBulkMigrationSkipReason,
	type SystemComponentBulkMigrationSkippedInstance,
} from "./system-component-bulk-migration-design";
import { readSystemComponentManifest } from "./system-component-manifest-service";
import {
	resolveDesignSummariesForScan,
	scanProjectSystemComponentUsage,
	type SystemComponentInstanceUsage,
	type SystemComponentUsageScanDiagnostic,
} from "./system-component-usage-scan";

export {
	bulkMigrateDesignSystemComponentInstances,
	type BulkMigrateDesignSystemComponentInstancesOptions,
	type SystemComponentBulkMigrationChangedInstance,
	type SystemComponentBulkMigrationDesignReport,
	type SystemComponentBulkMigrationFailedInstance,
	type SystemComponentBulkMigrationFailureCode,
	type SystemComponentBulkMigrationInstanceRef,
	type SystemComponentBulkMigrationReviewRequiredInstance,
	type SystemComponentBulkMigrationSkipReason,
	type SystemComponentBulkMigrationSkippedInstance,
} from "./system-component-bulk-migration-design";

export type SystemComponentBulkMigrationReport = {
	systemId?: string;
	systemName?: string;
	componentId?: string;
	dryRun: boolean;
	designs: SystemComponentBulkMigrationDesignReport[];
	changed: SystemComponentBulkMigrationChangedInstance[];
	skipped: SystemComponentBulkMigrationSkippedInstance[];
	reviewRequired: SystemComponentBulkMigrationReviewRequiredInstance[];
	failures: SystemComponentBulkMigrationFailedInstance[];
	scannedDesignCount: number;
	changedCount: number;
	skippedCount: number;
	reviewRequiredCount: number;
	failureCount: number;
};

export type BulkMigrateProjectSystemComponentInstancesOptions = {
	systemHandle: string;
	componentId?: string;
	designFileId?: string;
	designFile?: string;
	dryRun?: boolean;
	onlySafe?: boolean;
	persist?: boolean;
	automatic?: boolean;
	assertInstanceSubtreeAllowed?: (
		design: TrickroomDesign,
		elementId: string,
	) => void;
};

const mergeProjectReport = (
	base: SystemComponentBulkMigrationReport,
	designReport: SystemComponentBulkMigrationDesignReport,
) => {
	base.designs.push(designReport);
	base.changed.push(...designReport.changed);
	base.skipped.push(...designReport.skipped);
	base.reviewRequired.push(...designReport.reviewRequired);
	base.failures.push(...designReport.failures);
	base.changedCount = base.changed.length;
	base.skippedCount = base.skipped.length;
	base.reviewRequiredCount = base.reviewRequired.length;
	base.failureCount = base.failures.length;
};

const isBulkMigrationScanDiagnostic = (
	diagnostic: SystemComponentUsageScanDiagnostic,
): diagnostic is SystemComponentUsageScanDiagnostic & {
	code: "DESIGN_READ_FAILED" | "INVALID_DESIGN_PAYLOAD";
} =>
	diagnostic.code === "DESIGN_READ_FAILED" ||
	diagnostic.code === "INVALID_DESIGN_PAYLOAD";

const toBulkFailureFromScanDiagnostic = (
	diagnostic: SystemComponentUsageScanDiagnostic & {
		code: "DESIGN_READ_FAILED" | "INVALID_DESIGN_PAYLOAD";
	},
	context: {
		systemId: string;
		componentId?: string;
		designName?: string;
		designFileId?: string;
		designFile?: string;
	},
): SystemComponentBulkMigrationFailedInstance => ({
	designFileId: diagnostic.designFileId ?? context.designFileId ?? "unknown",
	designFile: diagnostic.designFile ?? context.designFile ?? "unknown",
	designName: context.designName ?? "unknown",
	elementId: diagnostic.elementId ?? "unknown",
	instanceId: diagnostic.instanceId ?? "unknown",
	systemId: diagnostic.systemId ?? context.systemId,
	componentId: diagnostic.componentId ?? context.componentId ?? "unknown",
	fromVersion: diagnostic.version ?? "unknown",
	code: diagnostic.code,
	message: diagnostic.message,
});

const mergeScanDiagnosticsIntoReport = (
	report: SystemComponentBulkMigrationReport,
	scan: Pick<
		Awaited<ReturnType<typeof scanProjectSystemComponentUsage>>,
		"diagnostics" | "systemId"
	>,
	options: Pick<
		BulkMigrateProjectSystemComponentInstancesOptions,
		"componentId" | "designFileId" | "designFile" | "systemHandle"
	>,
	summaryById: Map<string, DesignFileSummary>,
) => {
	const reportsByDesignId = new Map(
		report.designs.map((designReport) => [
			designReport.designFileId,
			designReport,
		]),
	);

	for (const diagnostic of scan.diagnostics) {
		if (!isBulkMigrationScanDiagnostic(diagnostic)) {
			continue;
		}

		const designFileId =
			diagnostic.designFileId ?? options.designFileId ?? "unknown";
		const summary = summaryById.get(designFileId);
		let designReport = reportsByDesignId.get(designFileId);
		if (!designReport) {
			designReport = emptyDesignReport({
				designFileId,
				designFile:
					diagnostic.designFile ??
					summary?.file ??
					options.designFile ??
					"unknown",
				designName: summary?.name ?? "unknown",
			});
			reportsByDesignId.set(designFileId, designReport);
			report.designs.push(designReport);
		}

		const failure = toBulkFailureFromScanDiagnostic(diagnostic, {
			systemId: scan.systemId ?? options.systemHandle,
			componentId: options.componentId,
			designName: designReport.designName,
			designFileId,
			designFile: designReport.designFile,
		});
		designReport.failures.push(failure);
		report.failures.push(failure);
	}

	report.failureCount = report.failures.length;
};

const createProjectReport = (
	options: Pick<
		BulkMigrateProjectSystemComponentInstancesOptions,
		"componentId" | "dryRun"
	> & {
		systemId?: string;
		systemName?: string;
	},
): SystemComponentBulkMigrationReport => ({
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

const persistDesignMigration = async (
	projectRoot: string,
	summary: DesignFileSummary,
	design: TrickroomDesign,
	expectedRevision: DesignFileRevision | undefined,
	dryRun: boolean,
): Promise<
	Pick<
		SystemComponentBulkMigrationDesignReport,
		"persisted" | "revision" | "nextRevision"
	>
> => {
	const baseRevision = expectedRevision ?? summary.revision;

	if (dryRun) {
		return { persisted: false, revision: baseRevision };
	}

	const service = createDesignFileService(projectRoot);
	try {
		const write = await service.writeDesignFile(summary.file, design, {
			expectedRevision: baseRevision,
		});
		return {
			persisted: true,
			revision: baseRevision,
			nextRevision: write.revision,
		};
	} catch (error) {
		if (error instanceof DesignFileServiceError) {
			throw error;
		}
		throw error;
	}
};

export async function bulkMigrateProjectSystemComponentInstances(
	projectRoot: string,
	options: BulkMigrateProjectSystemComponentInstancesOptions,
): Promise<SystemComponentBulkMigrationReport> {
	const dryRun = options.dryRun ?? false;
	const persist = options.persist ?? !dryRun;
	const onlySafe = options.automatic ? true : options.onlySafe !== false;

	let manifestRead: Awaited<ReturnType<typeof readSystemComponentManifest>>;
	try {
		manifestRead = await readSystemComponentManifest(
			projectRoot,
			options.systemHandle,
		);
	} catch (error) {
		const report = createProjectReport({
			...options,
			dryRun,
		});
		report.failures.push({
			designFileId: options.designFileId ?? "unknown",
			designFile: options.designFile ?? "unknown",
			designName: "unknown",
			elementId: "unknown",
			instanceId: "unknown",
			systemId: options.systemHandle,
			componentId: options.componentId ?? "unknown",
			fromVersion: "unknown",
			code: "MANIFEST_READ_FAILED",
			message:
				error instanceof Error
					? error.message
					: "Failed to read system component manifest.",
		});
		report.failureCount = report.failures.length;
		return report;
	}

	const scan = await scanProjectSystemComponentUsage(projectRoot, {
		systemHandle: options.systemHandle,
		componentId: options.componentId,
		designFileId: options.designFileId,
		designFile: options.designFile,
		validateManifest: true,
	});

	const report = createProjectReport({
		systemId: scan.systemId,
		systemName: scan.systemName,
		componentId: options.componentId,
		dryRun,
	});
	report.scannedDesignCount = scan.scannedDesignCount;

	if (!scan.systemId) {
		return report;
	}

	const usagesByDesign = new Map<string, SystemComponentInstanceUsage[]>();
	for (const usage of scan.instances) {
		const existing = usagesByDesign.get(usage.designFileId) ?? [];
		existing.push(usage);
		usagesByDesign.set(usage.designFileId, existing);
	}

	const service = createDesignFileService(projectRoot);
	const summaries =
		options.designFileId || options.designFile
			? await resolveDesignSummariesForScan(projectRoot, {
					designFileId: options.designFileId,
					designFile: options.designFile,
				})
			: await service.listDesignSummaries();
	const summaryById = new Map(
		summaries.map((summary) => [summary.uuid, summary]),
	);

	for (const [designFileId, designUsages] of usagesByDesign) {
		const summary = summaryById.get(designFileId);
		const firstUsage = designUsages[0];
		if (!summary || !firstUsage) {
			for (const usage of designUsages) {
				report.failures.push({
					...toInstanceRef(usage),
					code: "DESIGN_READ_FAILED",
					message: "Design file summary was not found for bulk migration.",
				});
			}
			continue;
		}

		let read: Awaited<ReturnType<typeof service.readDesignFile>>;
		try {
			read = await service.readDesignFile(summary.file);
		} catch (error) {
			const message =
				error instanceof DesignFileServiceError
					? error.message
					: error instanceof Error
						? error.message
						: "Failed to read design file for bulk migration.";
			const designReport = emptyDesignReport({
				designFileId: summary.uuid,
				designFile: summary.file,
				designName: summary.name,
			});
			for (const usage of designUsages) {
				designReport.failures.push({
					...toInstanceRef(usage),
					code:
						error instanceof DesignFileServiceError &&
						error.code === "INVALID_DESIGN_PAYLOAD"
							? "INVALID_DESIGN_PAYLOAD"
							: "DESIGN_READ_FAILED",
					message,
				});
			}
			mergeProjectReport(report, designReport);
			continue;
		}

		const designContext = {
			designFileId: summary.uuid,
			designFile: summary.file,
			designName: summary.name,
			systemId: scan.systemId,
		};

		if (options.automatic) {
			const designPolicy = read.design.componentMigrationPolicy ?? "inherit";
			const policy = resolveAutomaticMigrationPolicy(
				designPolicy,
				manifestRead.manifest.settings.autoMigrateComponents,
			);
			if (!policy.allowed) {
				const designReport = skipDesignForAutomaticPolicy(
					read.design,
					designContext,
					manifestRead.manifest,
					policy.message,
					options,
				);
				designReport.revision = read.revision;
				mergeProjectReport(report, designReport);
				continue;
			}
		}

		const migration = bulkMigrateDesignSystemComponentInstances(
			read.design,
			designContext,
			manifestRead.manifest,
			{
				componentId: options.componentId,
				dryRun: dryRun || !persist,
				onlySafe,
				assertInstanceSubtreeAllowed: options.assertInstanceSubtreeAllowed,
			},
		);

		if (migration.report.applied && persist) {
			try {
				const persisted = await persistDesignMigration(
					projectRoot,
					summary,
					migration.design,
					read.revision,
					false,
				);
				migration.report.persisted = persisted.persisted;
				migration.report.revision = persisted.revision;
				migration.report.nextRevision = persisted.nextRevision;
			} catch (error) {
				const message =
					error instanceof DesignFileServiceError
						? error.message
						: error instanceof Error
							? error.message
							: "Failed to persist migrated design file.";
				migration.report.applied = false;
				migration.report.persisted = false;
				migration.report.revision = read.revision;
				for (const changed of migration.report.changed) {
					migration.report.failures.push({
						...changed,
						code:
							error instanceof DesignFileServiceError &&
							error.code === "REVISION_MISMATCH"
								? "REVISION_MISMATCH"
								: "DESIGN_READ_FAILED",
						message: `${message} Instance "${changed.instanceId}" changes were rolled back.`,
					});
				}
				migration.report.changed = [];
			}
		} else {
			migration.report.revision = read.revision;
		}

		mergeProjectReport(report, migration.report);
	}

	mergeScanDiagnosticsIntoReport(report, scan, options, summaryById);

	report.changedCount = report.changed.length;
	report.skippedCount = report.skipped.length;
	report.reviewRequiredCount = report.reviewRequired.length;
	report.failureCount = report.failures.length;
	return report;
}
