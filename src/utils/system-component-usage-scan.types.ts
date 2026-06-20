import type { TrickroomDesign } from "../types";

export type SystemComponentUsageScanDiagnosticCode =
	| "DESIGN_READ_FAILED"
	| "INVALID_DESIGN_PAYLOAD"
	| "MALFORMED_INSTANCE_MARKER"
	| "UNKNOWN_COMPONENT"
	| "UNKNOWN_VERSION"
	| "STALE_VERSION"
	| "HASH_MISMATCH"
	| "SYSTEM_MISMATCH";

export type SystemComponentUsageScanDiagnostic = {
	code: SystemComponentUsageScanDiagnosticCode;
	message: string;
	designFileId?: string;
	designFile?: string;
	elementId?: string;
	path?: string;
	systemId?: string;
	componentId?: string;
	version?: string;
	instanceId?: string;
};

export type SystemComponentInstanceVersionStatusKind =
	| "current"
	| "stale"
	| "missing-component"
	| "missing-version"
	| "hash-mismatch";

export type SystemComponentInstanceVersionStatus = {
	status: SystemComponentInstanceVersionStatusKind;
	message: string;
	componentId: string;
	instanceVersion: string;
	currentVersion?: string;
	publishedVersion?: string;
	templateHash?: string | null;
	expectedTemplateHash?: string;
	variantSchemaHash?: string | null;
	expectedVariantSchemaHash?: string;
	reasons: Array<"version" | "template-hash" | "variant-schema-hash">;
};

export type SystemComponentInstanceUsage = {
	systemId: string;
	componentId: string;
	version: string;
	instanceId: string;
	designFileId: string;
	designFile: string;
	designName: string;
	elementId: string;
	path: string;
	systemName?: string | null;
	templateHash?: string | null;
	variantSchemaHash?: string | null;
	versionStatus?: SystemComponentInstanceVersionStatus;
};

export type SystemComponentUsageScanResult = {
	systemId?: string;
	systemName?: string;
	componentId?: string;
	instances: SystemComponentInstanceUsage[];
	diagnostics: SystemComponentUsageScanDiagnostic[];
	usedByCount: number;
	scannedDesignCount: number;
	statusCounts: Record<SystemComponentInstanceVersionStatusKind, number>;
	migrationPolicyPrompt?: SystemComponentMigrationPolicyPrompt;
};

export type DesignComponentMigrationPolicy = NonNullable<
	TrickroomDesign["componentMigrationPolicy"]
>;

export type SystemComponentMigrationPolicyPrompt = {
	designPolicy: DesignComponentMigrationPolicy;
	systemAutoMigrateComponents: boolean;
	effectivePolicy: "manual" | "auto";
	promptRequired: boolean;
	safeAutomaticMigrationEnabled: boolean;
	reviewOnlyCount: number;
	staleCount: number;
	message: string;
};
