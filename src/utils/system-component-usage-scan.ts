import { isTrickroomDesign } from "../server-utils";
import {
	createDesignFileService,
	DesignFileServiceError,
	type DesignFileSummary,
} from "../services/design-file-service";
import type { Node, TrickroomDesign } from "../types";
import { findProjectSystemDesigns } from "./design-resource-references";
import { findDesignSystem } from "./design-system-store";
import { readSystemComponentManifest } from "./system-component-manifest-service";
import {
	collectDesignAttachedSystemComponentUsages,
	getSystemComponentInstanceVersionStatus,
} from "./system-component-usage-scan.core";
import type {
	DesignComponentMigrationPolicy,
	SystemComponentInstanceUsage,
	SystemComponentInstanceVersionStatusKind,
	SystemComponentMigrationPolicyPrompt,
	SystemComponentUsageScanDiagnostic,
	SystemComponentUsageScanResult,
} from "./system-component-usage-scan.types";
import type { SystemComponentManifest } from "./system-components";

export {
	collectDesignAttachedSystemComponentUsages,
	getSystemComponentInstanceVersionStatus,
} from "./system-component-usage-scan.core";
export type {
	DesignComponentMigrationPolicy,
	SystemComponentInstanceUsage,
	SystemComponentInstanceVersionStatus,
	SystemComponentInstanceVersionStatusKind,
	SystemComponentMigrationPolicyPrompt,
	SystemComponentUsageScanDiagnostic,
	SystemComponentUsageScanDiagnosticCode,
	SystemComponentUsageScanResult,
} from "./system-component-usage-scan.types";

export type ScanProjectSystemComponentUsageOptions = {
	systemHandle?: string;
	componentId?: string;
	designFileId?: string;
	version?: string;
	validateManifest?: boolean;
};

const resolveEffectiveMigrationPolicy = (
	designPolicy: DesignComponentMigrationPolicy,
	systemAutoMigrateComponents: boolean,
): "manual" | "auto" => {
	if (designPolicy === "manual" || !systemAutoMigrateComponents) {
		return "manual";
	}
	return "auto";
};

const createMigrationPolicyPrompt = (
	designPolicy: DesignComponentMigrationPolicy,
	systemAutoMigrateComponents: boolean,
	statusCounts: Record<SystemComponentInstanceVersionStatusKind, number>,
): SystemComponentMigrationPolicyPrompt | undefined => {
	const reviewOnlyCount =
		statusCounts["missing-component"] +
		statusCounts["missing-version"] +
		statusCounts["hash-mismatch"];
	const staleCount = statusCounts.stale;
	const attentionCount = staleCount + reviewOnlyCount;
	if (attentionCount === 0) {
		return undefined;
	}

	const effectivePolicy = resolveEffectiveMigrationPolicy(
		designPolicy,
		systemAutoMigrateComponents,
	);

	return {
		designPolicy,
		systemAutoMigrateComponents,
		effectivePolicy,
		promptRequired:
			staleCount > 0 &&
			designPolicy === "inherit" &&
			!systemAutoMigrateComponents &&
			effectivePolicy === "manual",
		safeAutomaticMigrationEnabled:
			effectivePolicy === "auto" && reviewOnlyCount === 0,
		reviewOnlyCount,
		staleCount,
		message:
			"Stale attached system components were found. Ask whether to enable automatic safe updates for future changes; hash mismatches and missing or unsafe migrations remain review-only.",
	};
};

const matchesUsageFilters = (
	usage: SystemComponentInstanceUsage,
	filter: {
		systemId?: string;
		componentId?: string;
		version?: string;
	},
) => {
	if (filter.systemId && usage.systemId !== filter.systemId) {
		return false;
	}
	if (filter.componentId && usage.componentId !== filter.componentId) {
		return false;
	}
	if (filter.version && usage.version !== filter.version) {
		return false;
	}
	return true;
};

const emptyStatusCounts = (): Record<
	SystemComponentInstanceVersionStatusKind,
	number
> => ({
	current: 0,
	stale: 0,
	"missing-component": 0,
	"missing-version": 0,
	"hash-mismatch": 0,
});

const matchesDiagnosticScope = (
	usage: Pick<SystemComponentInstanceUsage, "componentId">,
	componentId?: string,
) => !componentId || usage.componentId === componentId;

const appendManifestReferenceDiagnostics = (
	usage: SystemComponentInstanceUsage,
	manifest: SystemComponentManifest | null,
	expectedSystemId: string | undefined,
	diagnostics: SystemComponentUsageScanDiagnostic[],
) => {
	if (!manifest) {
		return;
	}

	const record = manifest.components[usage.componentId];
	if (!record) {
		diagnostics.push({
			code: "UNKNOWN_COMPONENT",
			message: `Attached instance references unknown component "${usage.componentId}".`,
			designFileId: usage.designFileId,
			designFile: usage.designFile,
			elementId: usage.elementId,
			path: usage.path,
			systemId: usage.systemId,
			componentId: usage.componentId,
			version: usage.version,
			instanceId: usage.instanceId,
		});
		return;
	}

	if (!record.published?.versions[usage.version]) {
		diagnostics.push({
			code: "UNKNOWN_VERSION",
			message: `Attached instance references unknown published version "${usage.version}" for component "${usage.componentId}".`,
			designFileId: usage.designFileId,
			designFile: usage.designFile,
			elementId: usage.elementId,
			path: usage.path,
			systemId: usage.systemId,
			componentId: usage.componentId,
			version: usage.version,
			instanceId: usage.instanceId,
		});
	}

	if (usage.versionStatus?.status === "stale") {
		diagnostics.push({
			code: "STALE_VERSION",
			message: usage.versionStatus.message,
			designFileId: usage.designFileId,
			designFile: usage.designFile,
			elementId: usage.elementId,
			path: usage.path,
			systemId: usage.systemId,
			componentId: usage.componentId,
			version: usage.version,
			instanceId: usage.instanceId,
		});
	}

	if (usage.versionStatus?.status === "hash-mismatch") {
		diagnostics.push({
			code: "HASH_MISMATCH",
			message: usage.versionStatus.message,
			designFileId: usage.designFileId,
			designFile: usage.designFile,
			elementId: usage.elementId,
			path: usage.path,
			systemId: usage.systemId,
			componentId: usage.componentId,
			version: usage.version,
			instanceId: usage.instanceId,
		});
	}
};

const readTargetedDesignSummary = async (
	projectRoot: string,
	designFileId: string,
): Promise<
	| { kind: "summary"; summary: DesignFileSummary }
	| { kind: "diagnostic"; diagnostic: SystemComponentUsageScanDiagnostic }
	| { kind: "missing" }
> => {
	const service = createDesignFileService(projectRoot);
	try {
		service.assertDesignId(designFileId);
	} catch (error) {
		return {
			kind: "diagnostic",
			diagnostic: {
				code: "DESIGN_READ_FAILED",
				message:
					error instanceof Error
						? error.message
						: "Design id is invalid for usage scan.",
				designFileId,
			},
		};
	}

	try {
		const read = await service.readDesignFile(designFileId);
		return {
			kind: "summary",
			summary: {
				uuid: read.uuid,
				file: read.file,
				name: read.design.name,
				...(read.design.systemId !== undefined
					? { systemId: read.design.systemId }
					: {}),
				...(read.design.systemName !== undefined
					? { systemName: read.design.systemName }
					: {}),
				boardsCount: read.design.boards.length,
				layersCount: 0,
				modifiedAt: new Date().toISOString(),
				revision: read.revision,
			},
		};
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return { kind: "missing" };
		}
		if (error instanceof DesignFileServiceError) {
			return {
				kind: "diagnostic",
				diagnostic: {
					code:
						error.code === "INVALID_DESIGN_PAYLOAD"
							? "INVALID_DESIGN_PAYLOAD"
							: "DESIGN_READ_FAILED",
					message: error.message,
					designFileId,
				},
			};
		}

		return {
			kind: "diagnostic",
			diagnostic: {
				code: "DESIGN_READ_FAILED",
				message:
					error instanceof Error
						? error.message
						: "Failed to read design file for usage scan.",
				designFileId,
			},
		};
	}
};

export const resolveDesignSummariesForScan = async (
	projectRoot: string,
	options: Pick<
		ScanProjectSystemComponentUsageOptions,
		"designFileId" | "systemHandle"
	>,
): Promise<DesignFileSummary[]> => {
	if (options.designFileId) {
		const targeted = await readTargetedDesignSummary(
			projectRoot,
			options.designFileId,
		);
		if (targeted.kind === "summary") {
			return [targeted.summary];
		}
		return [];
	}

	if (options.systemHandle) {
		return findProjectSystemDesigns(projectRoot, options.systemHandle);
	}

	const service = createDesignFileService(projectRoot);
	return service.listDesignSummaries();
};

const readDesignForUsageScan = async (
	projectRoot: string,
	summary: DesignFileSummary,
	diagnostics: SystemComponentUsageScanDiagnostic[],
): Promise<TrickroomDesign | null> => {
	const service = createDesignFileService(projectRoot);

	try {
		const read = await service.readDesignFile(summary.uuid);
		return read.design;
	} catch (error) {
		if (error instanceof DesignFileServiceError) {
			diagnostics.push({
				code:
					error.code === "INVALID_DESIGN_PAYLOAD"
						? "INVALID_DESIGN_PAYLOAD"
						: "DESIGN_READ_FAILED",
				message: error.message,
				designFileId: summary.uuid,
				designFile: summary.file,
			});
			return null;
		}

		diagnostics.push({
			code: "DESIGN_READ_FAILED",
			message:
				error instanceof Error
					? error.message
					: "Failed to read design file for usage scan.",
			designFileId: summary.uuid,
			designFile: summary.file,
		});
		return null;
	}
};

export async function scanProjectSystemComponentUsage(
	projectRoot: string,
	options: ScanProjectSystemComponentUsageOptions = {},
): Promise<SystemComponentUsageScanResult> {
	const validateManifest = options.validateManifest ?? true;
	const summaries = await resolveDesignSummariesForScan(projectRoot, options);
	const instances: SystemComponentInstanceUsage[] = [];
	const diagnostics: SystemComponentUsageScanDiagnostic[] = [];

	if (summaries.length === 0 && options.designFileId) {
		const targeted = await readTargetedDesignSummary(
			projectRoot,
			options.designFileId,
		);
		if (targeted.kind === "diagnostic") {
			diagnostics.push(targeted.diagnostic);
		} else {
			diagnostics.push({
				code: "DESIGN_READ_FAILED",
				message: "Design file not found for usage scan.",
				designFileId: options.designFileId,
			});
		}
	}

	let scopedSystemId: string | undefined;
	let scopedSystemName: string | undefined;
	let manifest: SystemComponentManifest | null = null;
	let scannedDesignPolicy: DesignComponentMigrationPolicy = "inherit";
	let sawSingleDesignForPrompt = false;

	if (options.systemHandle) {
		const system = await findDesignSystem(projectRoot, options.systemHandle);
		scopedSystemId = system?.manifest.systemId;
		scopedSystemName = system?.manifest.systemName;
		if (validateManifest) {
			const read = await readSystemComponentManifest(
				projectRoot,
				options.systemHandle,
			);
			manifest = read.manifest;
		}
	}

	const usageFilter = {
		systemId: scopedSystemId,
		componentId: options.componentId,
		version: options.version,
	};

	for (const summary of summaries) {
		const design = await readDesignForUsageScan(
			projectRoot,
			summary,
			diagnostics,
		);
		if (!design) {
			continue;
		}

		if (!isTrickroomDesign(design)) {
			diagnostics.push({
				code: "INVALID_DESIGN_PAYLOAD",
				message: "Invalid trickroom design payload",
				designFileId: summary.uuid,
				designFile: summary.file,
			});
			continue;
		}

		if (summaries.length === 1) {
			scannedDesignPolicy = design.componentMigrationPolicy ?? "inherit";
			sawSingleDesignForPrompt = true;
		}

		const designScan = collectDesignAttachedSystemComponentUsages(design, {
			designFileId: summary.uuid,
			designFile: summary.file,
			designName: summary.name,
		});

		for (const usage of designScan.instances) {
			const versionStatus = validateManifest
				? getSystemComponentInstanceVersionStatus(usage, manifest)
				: undefined;
			const usageWithStatus = versionStatus
				? { ...usage, versionStatus }
				: usage;
			const inScope = matchesUsageFilters(usage, usageFilter);

			if (inScope) {
				instances.push(usageWithStatus);
			}

			if (validateManifest) {
				const inDiagnosticScope = matchesDiagnosticScope(
					usage,
					options.componentId,
				);
				if (
					scopedSystemId &&
					usage.systemId !== scopedSystemId &&
					inDiagnosticScope
				) {
					diagnostics.push({
						code: "SYSTEM_MISMATCH",
						message: `Attached instance references system "${usage.systemId}" but scan scope is "${scopedSystemId}".`,
						designFileId: usage.designFileId,
						designFile: usage.designFile,
						elementId: usage.elementId,
						path: usage.path,
						systemId: usage.systemId,
						componentId: usage.componentId,
						version: usage.version,
						instanceId: usage.instanceId,
					});
					continue;
				}

				if (inScope && inDiagnosticScope) {
					appendManifestReferenceDiagnostics(
						usageWithStatus,
						manifest,
						scopedSystemId,
						diagnostics,
					);
				}
			}
		}

		for (const diagnostic of designScan.diagnostics) {
			if (
				options.componentId &&
				diagnostic.componentId &&
				diagnostic.componentId !== options.componentId
			) {
				continue;
			}
			diagnostics.push(diagnostic);
		}
	}

	const statusCounts = emptyStatusCounts();
	for (const instance of instances) {
		if (instance.versionStatus) {
			statusCounts[instance.versionStatus.status] += 1;
		}
	}

	return {
		systemId: scopedSystemId,
		systemName: scopedSystemName,
		componentId: options.componentId,
		instances,
		diagnostics,
		usedByCount: instances.length,
		scannedDesignCount: summaries.length,
		statusCounts,
		...(sawSingleDesignForPrompt
			? {
					migrationPolicyPrompt: createMigrationPolicyPrompt(
						scannedDesignPolicy,
						manifest?.settings?.autoMigrateComponents ?? false,
						statusCounts,
					),
				}
			: {}),
	};
}

export const scanDesignFileSystemComponentUsage = async (
	projectRoot: string,
	designFileId: string,
	options: Omit<ScanProjectSystemComponentUsageOptions, "designFileId"> = {},
): Promise<SystemComponentUsageScanResult> =>
	scanProjectSystemComponentUsage(projectRoot, {
		...options,
		designFileId,
	});
