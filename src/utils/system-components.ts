import type { RecipeTemplateNode } from "../types";

export const SYSTEM_COMPONENT_MANIFEST_VERSION = 2;
export const SYSTEM_COMPONENT_MANIFEST_FILE_NAME = "components.json";
export const SYSTEM_COMPONENT_EMPTY_TIMESTAMP = new Date(0).toISOString();
export const SYSTEM_COMPONENT_ID_PREFIX = "cmp_";

export type SystemComponentId = string;

export type SystemComponentSlotHistoryEntry = {
	fromVersion: string;
	previousName?: string;
	previousHostPath?: string;
};

export type SystemComponentSlotDefinition = {
	name: string;
	label?: string;
	hostPath: string;
	defaultChildren?: RecipeTemplateNode[];
	history?: SystemComponentSlotHistoryEntry[];
};

export type SystemComponentVariantValue = {
	label?: string;
	classesByPath?: Record<string, string>;
};

export type SystemComponentVariantAxis = {
	label: string;
	defaultValue?: string;
	values: Record<string, SystemComponentVariantValue>;
};

export type SystemComponentCompoundVariant = {
	when: Record<string, string | string[]>;
	classesByPath: Record<string, string>;
};

export type SystemComponentVariantSchema = {
	axes: Record<string, SystemComponentVariantAxis>;
	compoundVariants?: SystemComponentCompoundVariant[];
	defaultValues?: Record<string, string>;
};

export type SystemComponentOverrideTargetHistoryEntry = {
	fromVersion: string;
	previousTargetId?: string;
	previousPath?: string;
};

export type SystemComponentOverrideCapability =
	| "className"
	| "text"
	| "icon"
	| "asset";

export type SystemComponentOverrideTarget = {
	targetId: string;
	label: string;
	path: string;
	capabilities?: SystemComponentOverrideCapability[];
	history?: SystemComponentOverrideTargetHistoryEntry[];
};

export type SystemComponentVariantMigrationHint = {
	fromAxis: string;
	toAxis?: string;
	valueMappings?: Array<{
		fromValue: string;
		toValue?: string;
	}>;
};

export type SystemComponentSlotMigrationHint = {
	fromName: string;
	toName?: string;
	hostPathMappings?: Array<{
		fromPath: string;
		toPath?: string;
	}>;
};

export type SystemComponentOverrideTargetMigrationHint = {
	fromTargetId: string;
	toTargetId?: string;
	pathMappings?: Array<{
		fromPath: string;
		toPath?: string;
	}>;
};

export type SystemComponentMigrationHints = {
	variantAxes?: SystemComponentVariantMigrationHint[];
	slots?: SystemComponentSlotMigrationHint[];
	overrideTargets?: SystemComponentOverrideTargetMigrationHint[];
};

export type SystemComponentMigrationPolicy = {
	allowAutomaticMigration: boolean;
	maxAutomaticMigrationsPerRun: number;
	requireExplicitReview: boolean;
	preserveDrafts: boolean;
};

export type SystemComponentDraftPayload = {
	baseVersion?: string;
	root: RecipeTemplateNode;
	slots?: Record<string, SystemComponentSlotDefinition>;
	props?: Record<string, unknown>;
	variants?: SystemComponentVariantSchema;
	overrideTargets?: Record<string, SystemComponentOverrideTarget>;
	migrationHints?: SystemComponentMigrationHints;
};

export type PublishedSystemComponentVersion = SystemComponentDraftPayload & {
	version: string;
	publishedAt: string;
	templateHash: string;
	variantSchemaHash: string;
	previousVersion?: string;
	migrationHints?: SystemComponentMigrationHints;
};

export type SystemComponentPublishedState = {
	currentVersion: string;
	versions: Record<string, PublishedSystemComponentVersion>;
};

export type SystemComponentRecord = {
	componentId: SystemComponentId;
	slug: string;
	name: string;
	description?: string;
	group?: string;
	order?: number;
	createdAt: string;
	updatedAt: string;
	draft?: SystemComponentDraftPayload;
	published?: SystemComponentPublishedState;
};

export type SystemComponentManifest = {
	version: typeof SYSTEM_COMPONENT_MANIFEST_VERSION;
	metadata: {
		schemaVersion: number;
		createdAt: string;
		updatedAt: string;
	};
	settings?: {
		autoMigrateComponents: boolean;
	};
	migrationPolicy: SystemComponentMigrationPolicy;
	components: Record<string, SystemComponentRecord>;
};

export class SystemComponentManifestError extends Error {
	readonly code:
		| "MISSING_COMPONENT_ID"
		| "MISMATCHED_COMPONENT_ID_KEY"
		| "INVALID_COMPONENT_MANIFEST";

	constructor(code: SystemComponentManifestError["code"], message: string) {
		super(message);
		this.name = "SystemComponentManifestError";
		this.code = code;
	}
}

const DEFAULT_SYSTEM_COMPONENT_MIGRATION_POLICY: SystemComponentMigrationPolicy =
	{
		allowAutomaticMigration: false,
		maxAutomaticMigrationsPerRun: 100,
		requireExplicitReview: true,
		preserveDrafts: true,
	};

export function generateSystemComponentId(): string {
	return `${SYSTEM_COMPONENT_ID_PREFIX}${globalThis.crypto.randomUUID()}`;
}

export function isSystemComponentId(
	value: unknown,
): value is SystemComponentId {
	return (
		typeof value === "string" &&
		/^cmp_[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
			value.trim(),
		)
	);
}

export function isSystemComponentSlug(value: unknown): value is string {
	return (
		typeof value === "string" &&
		/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(value) &&
		!value.includes("/")
	);
}

export function systemComponentSlugFromName(name: string) {
	return name
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/gu, "-")
		.replace(/-+/gu, "-")
		.replace(/^-+|-+$/gu, "");
}

export function slugifyComponentName(name: string) {
	return systemComponentSlugFromName(name) || "component";
}

export function createEmptySystemComponentManifest(): SystemComponentManifest {
	return {
		version: SYSTEM_COMPONENT_MANIFEST_VERSION,
		metadata: {
			schemaVersion: SYSTEM_COMPONENT_MANIFEST_VERSION,
			createdAt: SYSTEM_COMPONENT_EMPTY_TIMESTAMP,
			updatedAt: SYSTEM_COMPONENT_EMPTY_TIMESTAMP,
		},
		settings: {
			autoMigrateComponents: false,
		},
		migrationPolicy: {
			...DEFAULT_SYSTEM_COMPONENT_MIGRATION_POLICY,
		},
		components: {},
	};
}

export function assertComponentIdKeyInvariant(
	components: Record<string, SystemComponentRecord>,
): void {
	for (const [componentKey, component] of Object.entries(components)) {
		if (!component.componentId) {
			throw new SystemComponentManifestError(
				"MISSING_COMPONENT_ID",
				`Component record "${componentKey}" is missing componentId.`,
			);
		}

		if (componentKey !== component.componentId) {
			throw new SystemComponentManifestError(
				"MISMATCHED_COMPONENT_ID_KEY",
				`Component record key "${componentKey}" must match component.componentId "${component.componentId}".`,
			);
		}
	}
}
