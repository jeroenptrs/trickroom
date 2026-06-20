import type { DesignFileRevision } from "../services/design-file-service.types";
import type { Node, TrickroomDesign } from "../types";
import {
	previewSystemComponentInstanceMigration,
	SystemComponentInstanceMigrationError,
	updateStaleSystemComponentInstance,
	type SystemComponentInstanceMigrationContext,
	type SystemComponentInstanceMigrationPreview,
} from "./system-component-instance-migration";
import {
	SystemComponentMigrationError,
	type SystemComponentMigrationResult,
} from "./system-component-migration";
import type { SystemComponentManifest } from "./system-components";
import {
	collectDesignAttachedSystemComponentUsages,
	getSystemComponentInstanceVersionStatus,
	type SystemComponentInstanceUsage,
	type SystemComponentInstanceVersionStatusKind,
} from "./system-component-usage-scan.core";

export type SystemComponentBulkMigrationSkipReason =
	| SystemComponentInstanceVersionStatusKind
	| "current"
	| "review-required"
	| "migration-blocked"
	| "policy-manual"
	| "component-not-allowed"
	| "filtered"
	| "not-in-design";

export type SystemComponentBulkMigrationFailureCode =
	| "DESIGN_READ_FAILED"
	| "INVALID_DESIGN_PAYLOAD"
	| "REVISION_MISMATCH"
	| "MANIFEST_READ_FAILED"
	| "INSTANCE_MIGRATION_FAILED";

export type SystemComponentBulkMigrationInstanceRef = {
	designFileId: string;
	designFile: string;
	designName: string;
	elementId: string;
	instanceId: string;
	systemId: string;
	componentId: string;
	fromVersion: string;
	toVersion?: string;
};

export type SystemComponentBulkMigrationChangedInstance =
	SystemComponentBulkMigrationInstanceRef & {
		toVersion: string;
		diagnosticsCount: number;
	};

export type SystemComponentBulkMigrationSkippedInstance =
	SystemComponentBulkMigrationInstanceRef & {
		reason: SystemComponentBulkMigrationSkipReason;
		message: string;
		preview?: Pick<
			SystemComponentInstanceMigrationPreview,
			"classification" | "blocked" | "blockMessage"
		>;
	};

export type SystemComponentBulkMigrationReviewRequiredInstance =
	SystemComponentBulkMigrationInstanceRef & {
		message: string;
		preview: Pick<
			SystemComponentInstanceMigrationPreview,
			"classification" | "migrationDiagnostics" | "blocked" | "blockMessage"
		>;
	};

export type SystemComponentBulkMigrationFailedInstance =
	SystemComponentBulkMigrationInstanceRef & {
		code: SystemComponentBulkMigrationFailureCode;
		message: string;
	};

export type SystemComponentBulkMigrationDesignReport = {
	designFileId: string;
	designFile: string;
	designName: string;
	changed: SystemComponentBulkMigrationChangedInstance[];
	skipped: SystemComponentBulkMigrationSkippedInstance[];
	reviewRequired: SystemComponentBulkMigrationReviewRequiredInstance[];
	failures: SystemComponentBulkMigrationFailedInstance[];
	applied: boolean;
	persisted: boolean;
	revision?: DesignFileRevision;
	nextRevision?: DesignFileRevision;
};

export type BulkMigrateDesignSystemComponentInstancesOptions = {
	componentId?: string;
	instanceIds?: readonly string[];
	dryRun?: boolean;
	onlySafe?: boolean;
	assertInstanceSubtreeAllowed?: (
		design: TrickroomDesign,
		elementId: string,
	) => void;
};

export const toInstanceRef = (
	usage: SystemComponentInstanceUsage,
	targetVersion?: string,
): SystemComponentBulkMigrationInstanceRef => ({
	designFileId: usage.designFileId,
	designFile: usage.designFile,
	designName: usage.designName,
	elementId: usage.elementId,
	instanceId: usage.instanceId,
	systemId: usage.systemId,
	componentId: usage.componentId,
	fromVersion: usage.version,
	...(targetVersion ? { toVersion: targetVersion } : {}),
});

const toChangedInstanceRef = (
	usage: SystemComponentInstanceUsage,
	migrationResult: SystemComponentMigrationResult,
	targetVersion: string,
): SystemComponentBulkMigrationChangedInstance => ({
	...toInstanceRef(usage, targetVersion),
	elementId: migrationResult.metadata.rootElementId,
	toVersion: targetVersion,
	diagnosticsCount: migrationResult.metadata.diagnostics.length,
});

const resolveMigrationContextForUsage = (
	usage: SystemComponentInstanceUsage,
	manifest: SystemComponentManifest,
	systemId: string,
): SystemComponentInstanceMigrationContext | null => {
	const record = manifest.components[usage.componentId];
	if (!record) {
		return null;
	}

	const published = record.published;
	const sourceVersion = published?.versions[usage.version];
	const targetVersionId = published?.currentVersion;
	const targetVersion = targetVersionId
		? published?.versions[targetVersionId]
		: undefined;
	if (!sourceVersion || !targetVersion) {
		return null;
	}

	return {
		systemId,
		componentId: usage.componentId,
		record,
		sourceVersion,
		targetVersion,
	};
};

const getInstanceSubtreePolicyMessage = (
	design: TrickroomDesign,
	boards: readonly Node[],
	elementId: string,
	assertInstanceSubtreeAllowed?: (
		design: TrickroomDesign,
		elementId: string,
	) => void,
): string | null => {
	if (!assertInstanceSubtreeAllowed) {
		return null;
	}

	try {
		assertInstanceSubtreeAllowed({ ...design, boards }, elementId);
		return null;
	} catch (error) {
		return error instanceof Error
			? error.message
			: "Component subtree is not allowed by policy.";
	}
};

const matchesBulkFilters = (
	usage: SystemComponentInstanceUsage,
	options: Pick<
		BulkMigrateDesignSystemComponentInstancesOptions,
		"componentId" | "instanceIds"
	>,
) => {
	if (options.componentId && usage.componentId !== options.componentId) {
		return false;
	}
	if (options.instanceIds && !options.instanceIds.includes(usage.instanceId)) {
		return false;
	}
	return true;
};

const classifyBulkMigrationPreview = (
	preview: SystemComponentInstanceMigrationPreview,
	options: { onlySafe: boolean },
):
	| {
			action: "migrate";
			preview: SystemComponentInstanceMigrationPreview;
	  }
	| {
			action: "skip";
			reason: SystemComponentBulkMigrationSkipReason;
			message: string;
			preview: SystemComponentInstanceMigrationPreview;
	  }
	| {
			action: "review";
			message: string;
			preview: SystemComponentInstanceMigrationPreview;
	  } => {
	if (preview.blocked) {
		return {
			action: "skip",
			reason: "migration-blocked",
			message:
				preview.blockMessage ??
				"Migration is blocked because authored content cannot be mapped safely.",
			preview,
		};
	}

	if (
		options.onlySafe !== false &&
		preview.classification.safety === "requires-review"
	) {
		return {
			action: "review",
			message:
				"Migration requires review before it can be applied automatically.",
			preview,
		};
	}

	return { action: "migrate", preview };
};

export const emptyDesignReport = (
	context: Pick<
		SystemComponentInstanceUsage,
		"designFileId" | "designFile" | "designName"
	>,
): SystemComponentBulkMigrationDesignReport => ({
	designFileId: context.designFileId,
	designFile: context.designFile,
	designName: context.designName,
	changed: [],
	skipped: [],
	reviewRequired: [],
	failures: [],
	applied: false,
	persisted: false,
});

const cloneBoard = (board: Node): Node => ({
	id: board.id,
	props: { ...board.props },
	children: Array.isArray(board.children)
		? board.children.map(cloneNodeDeep)
		: board.children,
});

const cloneNodeDeep = (node: Node): Node => ({
	id: node.id,
	props: { ...node.props },
	children: Array.isArray(node.children)
		? node.children.map(cloneNodeDeep)
		: node.children,
});

export const bulkMigrateDesignSystemComponentInstances = (
	design: TrickroomDesign,
	context: {
		designFileId: string;
		designFile: string;
		designName: string;
		systemId: string;
	},
	manifest: SystemComponentManifest,
	options: BulkMigrateDesignSystemComponentInstancesOptions = {},
): {
	report: SystemComponentBulkMigrationDesignReport;
	boards: Node[];
	design: TrickroomDesign;
} => {
	const dryRun = options.dryRun ?? false;
	const onlySafe = options.onlySafe !== false;
	const usages = collectDesignAttachedSystemComponentUsages(design, context);
	const report = emptyDesignReport(context);
	let boards = design.boards.map(cloneBoard);

	for (const usage of usages.instances) {
		if (!matchesBulkFilters(usage, options)) {
			report.skipped.push({
				...toInstanceRef(usage),
				reason: "filtered",
				message: "Instance did not match bulk migration filters.",
			});
			continue;
		}

		if (usage.systemId !== context.systemId) {
			report.skipped.push({
				...toInstanceRef(usage),
				reason: "filtered",
				message: `Instance system "${usage.systemId}" does not match design system "${context.systemId}".`,
			});
			continue;
		}

		const migrationContext = resolveMigrationContextForUsage(
			usage,
			manifest,
			context.systemId,
		);
		if (!migrationContext) {
			const versionStatus = getSystemComponentInstanceVersionStatus(
				usage,
				manifest,
			);
			const reason =
				versionStatus?.status ??
				("missing-component" as SystemComponentBulkMigrationSkipReason);
			report.skipped.push({
				...toInstanceRef(usage),
				reason,
				message:
					versionStatus?.message ??
					"Published component version metadata is unavailable for migration.",
			});
			continue;
		}

		const versionStatus = getSystemComponentInstanceVersionStatus(
			usage,
			manifest,
		);
		if (!versionStatus || versionStatus.status !== "stale") {
			const reason =
				versionStatus?.status ??
				("current" as SystemComponentBulkMigrationSkipReason);
			report.skipped.push({
				...toInstanceRef(usage, migrationContext.targetVersion.version),
				reason,
				message: versionStatus?.message ?? "Instance is not stale.",
			});
			continue;
		}

		const sourcePolicyMessage = getInstanceSubtreePolicyMessage(
			design,
			boards,
			usage.elementId,
			options.assertInstanceSubtreeAllowed,
		);
		if (sourcePolicyMessage) {
			report.skipped.push({
				...toInstanceRef(usage, migrationContext.targetVersion.version),
				reason: "component-not-allowed",
				message: sourcePolicyMessage,
			});
			continue;
		}

		let preview: SystemComponentInstanceMigrationPreview;
		try {
			preview = previewSystemComponentInstanceMigration(
				boards,
				usage.elementId,
				migrationContext,
			);
		} catch (error) {
			const message =
				error instanceof SystemComponentInstanceMigrationError
					? error.message
					: error instanceof Error
						? error.message
						: "Failed to preview attached system component instance migration.";
			report.failures.push({
				...toInstanceRef(usage, migrationContext.targetVersion.version),
				code: "INSTANCE_MIGRATION_FAILED",
				message,
			});
			continue;
		}

		if (!preview.blocked) {
			const policyTrialBoards = boards.map(cloneBoard);
			try {
				const policyTrialResult = updateStaleSystemComponentInstance(
					policyTrialBoards,
					usage.elementId,
					migrationContext,
				);
				const targetPolicyMessage = getInstanceSubtreePolicyMessage(
					design,
					policyTrialResult.roots,
					policyTrialResult.metadata.rootElementId,
					options.assertInstanceSubtreeAllowed,
				);
				if (targetPolicyMessage) {
					report.skipped.push({
						...toInstanceRef(usage, migrationContext.targetVersion.version),
						reason: "component-not-allowed",
						message: targetPolicyMessage,
					});
					continue;
				}
			} catch {
				// Fall through to blocked/review/migrate classification below.
			}
		}

		const evaluation = classifyBulkMigrationPreview(preview, { onlySafe });

		if (evaluation.action === "skip") {
			report.skipped.push({
				...toInstanceRef(usage, migrationContext.targetVersion.version),
				reason: evaluation.reason,
				message: evaluation.message,
				preview: {
					classification: evaluation.preview.classification,
					blocked: evaluation.preview.blocked,
					blockMessage: evaluation.preview.blockMessage,
				},
			});
			continue;
		}

		if (evaluation.action === "review") {
			report.reviewRequired.push({
				...toInstanceRef(usage, migrationContext.targetVersion.version),
				message: evaluation.message,
				preview: {
					classification: evaluation.preview.classification,
					migrationDiagnostics: evaluation.preview.migrationDiagnostics,
					blocked: evaluation.preview.blocked,
					blockMessage: evaluation.preview.blockMessage,
				},
			});
			continue;
		}

		const trialBoards = boards.map(cloneBoard);
		try {
			const result = updateStaleSystemComponentInstance(
				trialBoards,
				usage.elementId,
				migrationContext,
			);

			if (dryRun) {
				report.changed.push(
					toChangedInstanceRef(
						usage,
						result,
						migrationContext.targetVersion.version,
					),
				);
				continue;
			}

			boards = result.roots;
			report.changed.push(
				toChangedInstanceRef(
					usage,
					result,
					migrationContext.targetVersion.version,
				),
			);
		} catch (error) {
			const message =
				error instanceof SystemComponentInstanceMigrationError ||
				error instanceof SystemComponentMigrationError
					? error.message
					: error instanceof Error
						? error.message
						: "Failed to migrate attached system component instance.";
			report.failures.push({
				...toInstanceRef(usage, migrationContext.targetVersion.version),
				code: "INSTANCE_MIGRATION_FAILED",
				message,
			});
		}
	}

	report.applied = !dryRun && report.changed.length > 0;
	const nextDesign: TrickroomDesign = report.applied
		? { ...design, boards }
		: design;

	return { report, boards, design: nextDesign };
};

type ComponentMigrationPolicy = NonNullable<
	TrickroomDesign["componentMigrationPolicy"]
>;

const resolveAutomaticMigrationPolicy = (
	designPolicy: ComponentMigrationPolicy,
	systemAutoMigrateComponents: boolean,
): {
	allowed: boolean;
	message: string;
} => {
	if (!systemAutoMigrateComponents) {
		return {
			allowed: false,
			message:
				"Automatic migration skipped because the system autoMigrateComponents setting is off.",
		};
	}

	if (designPolicy === "manual") {
		return {
			allowed: false,
			message:
				"Automatic migration skipped because the design componentMigrationPolicy is manual.",
		};
	}

	return {
		allowed: true,
		message:
			designPolicy === "auto"
				? "Automatic safe migration allowed by system and design policy."
				: "Automatic safe migration allowed by inherited system policy.",
	};
};

export const skipDesignForAutomaticPolicy = (
	design: TrickroomDesign,
	context: {
		designFileId: string;
		designFile: string;
		designName: string;
		systemId: string;
	},
	manifest: SystemComponentManifest,
	message: string,
	options: Pick<BulkMigrateDesignSystemComponentInstancesOptions, "componentId">,
): SystemComponentBulkMigrationDesignReport => {
	const usages = collectDesignAttachedSystemComponentUsages(
		design,
		context,
	).instances;
	const report = emptyDesignReport(context);

	for (const usage of usages) {
		if (
			usage.systemId !== context.systemId ||
			!matchesBulkFilters(usage, options)
		) {
			continue;
		}

		const versionStatus = getSystemComponentInstanceVersionStatus(
			usage,
			manifest,
		);
		if (!versionStatus || versionStatus.status === "current") {
			continue;
		}

		if (versionStatus.status === "stale") {
			const targetVersion =
				manifest.components[usage.componentId]?.published?.currentVersion;
			report.skipped.push({
				...toInstanceRef(usage, targetVersion),
				reason: "policy-manual",
				message,
			});
			continue;
		}

		report.skipped.push({
			...toInstanceRef(usage),
			reason: versionStatus.status,
			message: versionStatus.message,
		});
	}

	return report;
};

export { resolveAutomaticMigrationPolicy };
