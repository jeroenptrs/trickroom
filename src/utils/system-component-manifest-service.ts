import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { RecipeTemplateNode } from "../types";
import {
	ensureDesignSystemManifest,
	findDesignSystem,
	resolveDesignSystemFilePath,
} from "./design-system-store.ts";
import {
	assertComponentIdKeyInvariant,
	createEmptySystemComponentManifest,
	type PublishedSystemComponentVersion,
	SYSTEM_COMPONENT_EMPTY_TIMESTAMP,
	SYSTEM_COMPONENT_MANIFEST_FILE_NAME,
	SYSTEM_COMPONENT_MANIFEST_VERSION,
	type SystemComponentDraftPayload,
	type SystemComponentManifest,
	SystemComponentManifestError,
	type SystemComponentMigrationHints,
	type SystemComponentMigrationPolicy,
	type SystemComponentOverrideTarget,
	type SystemComponentPublishedState,
	type SystemComponentRecord,
	type SystemComponentSlotDefinition,
	type SystemComponentVariantAxis,
	type SystemComponentVariantSchema,
} from "./system-components.ts";

export type { SystemComponentManifestRevision } from "./system-component-manifest-service.types";

import type { SystemComponentManifestRevision } from "./system-component-manifest-service.types";
import { backfillOptionalVariantDefaults } from "./system-component-variant-defaults-migration.ts";
import { hashSystemComponentVariantSchema } from "./system-components-validation.ts";

export type SystemComponentManifestWarningCode =
	| "UNKNOWN_TOP_LEVEL_FIELD"
	| "UNKNOWN_COMPONENT_FIELD";

export type SystemComponentManifestWarning = {
	code: SystemComponentManifestWarningCode;
	message: string;
	path?: string;
};

const supportedSystemComponentManifestVersions = new Set<number>([
	1,
	SYSTEM_COMPONENT_MANIFEST_VERSION,
]);

type SystemComponentManifestNormalizationContext = {
	backfillOptionalVariantDefaults: boolean;
};

export type SystemComponentManifestDiagnosticCode =
	| "INVALID_JSON"
	| "UNSUPPORTED_VERSION"
	| "INVALID_METADATA"
	| "INVALID_MIGRATION_POLICY"
	| "INVALID_COMPONENTS"
	| "INVALID_COMPONENT"
	| "MISSING_COMPONENT_ID"
	| "MISMATCHED_COMPONENT_ID_KEY"
	| "INVALID_COMPONENT_MANIFEST"
	| "INVALID_COMPONENT_STATE"
	| "INVALID_PUBLISHED_METADATA";

export type SystemComponentManifestDiagnostic = {
	code: SystemComponentManifestDiagnosticCode;
	message: string;
	path?: string;
};

export type SystemComponentManifestRead = {
	manifest: SystemComponentManifest;
	revision: SystemComponentManifestRevision;
	updatedAt: string;
	exists: boolean;
	path: string;
	warnings: SystemComponentManifestWarning[];
	diagnostics: SystemComponentManifestDiagnostic[];
};

export type WriteSystemComponentManifestOptions = {
	expectedRevision: SystemComponentManifestRevision;
	now?: string;
	/** When "replace", incoming.components fully replaces the stored map (used for deletions). */
	componentsMerge?: "merge" | "replace";
};

export class SystemComponentManifestServiceError extends Error {
	readonly code:
		| "MALFORMED_MANIFEST"
		| "INVALID_MANIFEST"
		| "STALE_WRITE"
		| "SYSTEM_NOT_FOUND";

	readonly diagnostics: SystemComponentManifestDiagnostic[];

	constructor(
		code: SystemComponentManifestServiceError["code"],
		message: string,
		diagnostics: SystemComponentManifestDiagnostic[] = [],
	) {
		super(message);
		this.name = "SystemComponentManifestServiceError";
		this.code = code;
		this.diagnostics = diagnostics;
	}
}

const defaultMigrationPolicy =
	createEmptySystemComponentManifest().migrationPolicy;

export function serializeSystemComponentManifest(
	manifest: SystemComponentManifest,
): string {
	return `${JSON.stringify(manifest, null, "\t")}\n`;
}

export function systemComponentManifestRevision(
	contents: string,
): SystemComponentManifestRevision {
	return `sha256:${createHash("sha256").update(contents).digest("hex")}`;
}

export const emptySystemComponentManifestRevision =
	systemComponentManifestRevision(
		serializeSystemComponentManifest(createEmptySystemComponentManifest()),
	);

export async function readSystemComponentManifest(
	projectRoot: string,
	systemHandle: string,
): Promise<SystemComponentManifestRead> {
	const manifestPath = await resolveDesignSystemFilePath(
		projectRoot,
		systemHandle,
		SYSTEM_COMPONENT_MANIFEST_FILE_NAME,
	);

	try {
		const contents = await readFile(manifestPath, "utf8");
		const { manifest, warnings, diagnostics } =
			parseSystemComponentManifestContents(contents, manifestPath);
		return {
			manifest,
			revision: systemComponentManifestRevision(contents),
			updatedAt: manifest.metadata.updatedAt,
			exists: true,
			path: manifestPath,
			warnings,
			diagnostics,
		};
	} catch (error) {
		const fsError = error as NodeJS.ErrnoException;
		if (fsError.code === "ENOENT") {
			const manifest = createEmptySystemComponentManifest();
			return {
				manifest,
				revision: emptySystemComponentManifestRevision,
				updatedAt: manifest.metadata.updatedAt,
				exists: false,
				path: manifestPath,
				warnings: [],
				diagnostics: [],
			};
		}

		throw error;
	}
}

const manifestWriteQueues = new Map<string, Promise<unknown>>();

async function runExclusiveManifestWrite<T>(
	manifestPath: string,
	operation: () => Promise<T>,
): Promise<T> {
	const previousWrite = manifestWriteQueues.get(manifestPath);
	const queuedWrite = previousWrite
		? previousWrite.catch(() => undefined).then(operation)
		: operation();

	manifestWriteQueues.set(manifestPath, queuedWrite);
	queuedWrite.then(
		() => {
			if (manifestWriteQueues.get(manifestPath) === queuedWrite) {
				manifestWriteQueues.delete(manifestPath);
			}
		},
		() => {
			if (manifestWriteQueues.get(manifestPath) === queuedWrite) {
				manifestWriteQueues.delete(manifestPath);
			}
		},
	);

	return queuedWrite;
}

export async function writeSystemComponentManifest(
	projectRoot: string,
	systemHandle: string,
	manifest: SystemComponentManifest,
	options: WriteSystemComponentManifestOptions,
): Promise<SystemComponentManifestRead> {
	const manifestPath = await resolveDesignSystemFilePath(
		projectRoot,
		systemHandle,
		SYSTEM_COMPONENT_MANIFEST_FILE_NAME,
	);

	return runExclusiveManifestWrite(manifestPath, () =>
		writeSystemComponentManifestExclusive(
			projectRoot,
			systemHandle,
			manifestPath,
			manifest,
			options,
		),
	);
}

async function writeSystemComponentManifestExclusive(
	projectRoot: string,
	systemHandle: string,
	manifestPath: string,
	manifest: SystemComponentManifest,
	options: WriteSystemComponentManifestOptions,
): Promise<SystemComponentManifestRead> {
	const current = await readSystemComponentManifest(projectRoot, systemHandle);
	if (current.revision !== options.expectedRevision) {
		throw new SystemComponentManifestServiceError(
			"STALE_WRITE",
			`Component manifest revision mismatch for "${systemHandle}". Re-read the manifest and retry with the current revision.`,
		);
	}

	const now = options.now ?? new Date().toISOString();
	const merged = mergeSystemComponentManifests(
		current.manifest,
		manifest,
		now,
		options.componentsMerge ?? "merge",
	);
	const normalized = normalizeSystemComponentManifest(
		merged,
		manifestPath,
	).manifest;
	const contents = serializeSystemComponentManifest(normalized);

	await ensureDesignSystemManifest(projectRoot, systemHandle);
	await mkdir(path.dirname(manifestPath), { recursive: true });
	await writeJsonAtomically(manifestPath, normalized);

	return {
		manifest: normalized,
		revision: systemComponentManifestRevision(contents),
		updatedAt: normalized.metadata.updatedAt,
		exists: true,
		path: manifestPath,
		warnings: [],
		diagnostics: [],
	};
}

export async function assertDesignSystemExistsForComponents(
	projectRoot: string,
	systemHandle: string,
): Promise<void> {
	const record = await findDesignSystem(projectRoot, systemHandle);
	if (record) {
		return;
	}

	const manifestPath = await resolveDesignSystemFilePath(
		projectRoot,
		systemHandle,
		"system.json",
	);
	try {
		await readFile(manifestPath, "utf8");
	} catch (error) {
		const fsError = error as NodeJS.ErrnoException;
		if (fsError.code === "ENOENT") {
			throw new SystemComponentManifestServiceError(
				"SYSTEM_NOT_FOUND",
				`Design system "${systemHandle}" was not found.`,
			);
		}
		throw error;
	}
}

export function parseSystemComponentManifestContents(
	contents: string,
	manifestPath: string,
): {
	manifest: SystemComponentManifest;
	warnings: SystemComponentManifestWarning[];
	diagnostics: SystemComponentManifestDiagnostic[];
} {
	let parsed: unknown;
	try {
		parsed = JSON.parse(contents) as unknown;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		const diagnostics: SystemComponentManifestDiagnostic[] = [
			{
				code: "INVALID_JSON",
				message: `Invalid JSON at ${manifestPath}: ${message}`,
			},
		];
		throw new SystemComponentManifestServiceError(
			"MALFORMED_MANIFEST",
			`Malformed component manifest JSON at ${manifestPath}.`,
			diagnostics,
		);
	}

	return normalizeSystemComponentManifest(parsed, manifestPath);
}

export function normalizeSystemComponentManifest(
	value: unknown,
	manifestPath: string,
): {
	manifest: SystemComponentManifest;
	warnings: SystemComponentManifestWarning[];
	diagnostics: SystemComponentManifestDiagnostic[];
} {
	const warnings: SystemComponentManifestWarning[] = [];
	const diagnostics: SystemComponentManifestDiagnostic[] = [];

	if (!isRecord(value)) {
		throw invalidManifest(manifestPath, [
			{
				code: "INVALID_COMPONENTS",
				message: "Component manifest must be a JSON object.",
			},
		]);
	}

	for (const key of Object.keys(value)) {
		if (
			key !== "version" &&
			key !== "metadata" &&
			key !== "settings" &&
			key !== "migrationPolicy" &&
			key !== "components"
		) {
			warnings.push({
				code: "UNKNOWN_TOP_LEVEL_FIELD",
				message: `Ignoring unknown top-level field "${key}".`,
				path: key,
			});
		}
	}

	if (
		typeof value.version !== "number" ||
		!supportedSystemComponentManifestVersions.has(value.version)
	) {
		throw invalidManifest(manifestPath, [
			{
				code: "UNSUPPORTED_VERSION",
				message: `Unsupported component manifest version: ${String(value.version)}.`,
				path: "version",
			},
		]);
	}
	const normalizationContext: SystemComponentManifestNormalizationContext = {
		backfillOptionalVariantDefaults:
			value.version < SYSTEM_COMPONENT_MANIFEST_VERSION,
	};

	const metadata = normalizeMetadata(value.metadata, manifestPath);
	const settings = normalizeSettings(value.settings);
	const migrationPolicy = normalizeMigrationPolicy(
		value.migrationPolicy,
		manifestPath,
	);
	const components = normalizeComponents(
		value.components,
		manifestPath,
		warnings,
		diagnostics,
		normalizationContext,
	);

	try {
		assertComponentIdKeyInvariant(components);
	} catch (error) {
		if (error instanceof SystemComponentManifestError) {
			throw invalidManifest(manifestPath, [
				{
					code: error.code,
					message: error.message,
				},
			]);
		}
		throw error;
	}

	if (diagnostics.length > 0) {
		throw invalidManifest(manifestPath, diagnostics);
	}

	return {
		manifest: {
			version: SYSTEM_COMPONENT_MANIFEST_VERSION,
			metadata,
			...(settings ? { settings } : {}),
			migrationPolicy,
			components,
		},
		warnings,
		diagnostics,
	};
}

function mergeSystemComponentManifests(
	existing: SystemComponentManifest,
	incoming: SystemComponentManifest,
	now: string,
	componentsMerge: "merge" | "replace",
): SystemComponentManifest {
	const createdAt =
		existing.metadata.createdAt !== SYSTEM_COMPONENT_EMPTY_TIMESTAMP
			? existing.metadata.createdAt
			: incoming.metadata.createdAt;

	return {
		version: SYSTEM_COMPONENT_MANIFEST_VERSION,
		metadata: {
			schemaVersion: SYSTEM_COMPONENT_MANIFEST_VERSION,
			createdAt,
			updatedAt: now,
		},
		settings: {
			autoMigrateComponents:
				incoming.settings?.autoMigrateComponents ??
				existing.settings?.autoMigrateComponents ??
				false,
		},
		migrationPolicy: {
			...existing.migrationPolicy,
			...incoming.migrationPolicy,
		},
		components:
			componentsMerge === "replace"
				? incoming.components
				: {
						...existing.components,
						...incoming.components,
					},
	};
}

function normalizeSettings(
	value: unknown,
): NonNullable<SystemComponentManifest["settings"]> {
	if (value === undefined) {
		return { autoMigrateComponents: false };
	}
	if (!isRecord(value)) {
		return { autoMigrateComponents: false };
	}
	const autoMigrateComponents =
		typeof value.autoMigrateComponents === "boolean"
			? value.autoMigrateComponents
			: false;
	return { autoMigrateComponents };
}

function normalizeMetadata(
	value: unknown,
	manifestPath: string,
): SystemComponentManifest["metadata"] {
	if (!isRecord(value)) {
		throw invalidManifest(manifestPath, [
			{
				code: "INVALID_METADATA",
				message: "Component manifest metadata must be an object.",
				path: "metadata",
			},
		]);
	}

	const createdAt =
		typeof value.createdAt === "string"
			? value.createdAt
			: new Date(0).toISOString();
	const updatedAt =
		typeof value.updatedAt === "string"
			? value.updatedAt
			: new Date(0).toISOString();

	return {
		schemaVersion: SYSTEM_COMPONENT_MANIFEST_VERSION,
		createdAt,
		updatedAt,
	};
}

function normalizeMigrationPolicy(
	value: unknown,
	manifestPath: string,
): SystemComponentMigrationPolicy {
	if (value === undefined) {
		return { ...defaultMigrationPolicy };
	}

	if (!isRecord(value)) {
		throw invalidManifest(manifestPath, [
			{
				code: "INVALID_MIGRATION_POLICY",
				message: "Component manifest migrationPolicy must be an object.",
				path: "migrationPolicy",
			},
		]);
	}

	return {
		allowAutomaticMigration:
			typeof value.allowAutomaticMigration === "boolean"
				? value.allowAutomaticMigration
				: defaultMigrationPolicy.allowAutomaticMigration,
		maxAutomaticMigrationsPerRun:
			typeof value.maxAutomaticMigrationsPerRun === "number" &&
			value.maxAutomaticMigrationsPerRun >= 0
				? value.maxAutomaticMigrationsPerRun
				: defaultMigrationPolicy.maxAutomaticMigrationsPerRun,
		requireExplicitReview:
			typeof value.requireExplicitReview === "boolean"
				? value.requireExplicitReview
				: defaultMigrationPolicy.requireExplicitReview,
		preserveDrafts:
			typeof value.preserveDrafts === "boolean"
				? value.preserveDrafts
				: defaultMigrationPolicy.preserveDrafts,
	};
}

function normalizeComponents(
	value: unknown,
	manifestPath: string,
	warnings: SystemComponentManifestWarning[],
	diagnostics: SystemComponentManifestDiagnostic[],
	context: SystemComponentManifestNormalizationContext,
): Record<string, SystemComponentRecord> {
	if (value === undefined) {
		return {};
	}

	if (!isRecord(value)) {
		throw invalidManifest(manifestPath, [
			{
				code: "INVALID_COMPONENTS",
				message: "Component manifest components must be an object.",
				path: "components",
			},
		]);
	}

	const components: Record<string, SystemComponentRecord> = {};
	for (const [componentKey, rawComponent] of Object.entries(value)) {
		const normalized = normalizeComponentRecord(
			rawComponent,
			componentKey,
			warnings,
			diagnostics,
			context,
		);
		if (!normalized) {
			continue;
		}

		const componentId = normalized.componentId;
		if (components[componentId]) {
			diagnostics.push({
				code: "INVALID_COMPONENT",
				message: `Duplicate component id "${componentId}" in component manifest.`,
				path: `components.${componentId}`,
			});
			continue;
		}

		components[componentId] = normalized;
	}

	return components;
}

function normalizeComponentRecord(
	value: unknown,
	componentKey: string,
	warnings: SystemComponentManifestWarning[],
	diagnostics: SystemComponentManifestDiagnostic[],
	context: SystemComponentManifestNormalizationContext,
): SystemComponentRecord | null {
	const basePath = `components.${componentKey}`;

	if (!isRecord(value)) {
		diagnostics.push({
			code: "INVALID_COMPONENT",
			message: `Component "${componentKey}" must be a JSON object.`,
			path: basePath,
		});
		return null;
	}

	for (const key of Object.keys(value)) {
		if (
			![
				"componentId",
				"slug",
				"name",
				"description",
				"group",
				"order",
				"createdAt",
				"updatedAt",
				"draft",
				"published",
			].includes(key)
		) {
			warnings.push({
				code: "UNKNOWN_COMPONENT_FIELD",
				message: `Ignoring unknown field "${key}" on component "${componentKey}".`,
				path: `${basePath}.${key}`,
			});
		}
	}

	const componentId =
		typeof value.componentId === "string" && value.componentId.trim().length > 0
			? value.componentId.trim()
			: componentKey.trim();
	if (componentId.length === 0) {
		diagnostics.push({
			code: "MISSING_COMPONENT_ID",
			message: `Component "${componentKey}" is missing componentId.`,
			path: `${basePath}.componentId`,
		});
		return null;
	}

	if (componentKey !== componentId) {
		diagnostics.push({
			code: "MISMATCHED_COMPONENT_ID_KEY",
			message: `Component record key "${componentKey}" must match component.componentId "${componentId}".`,
			path: basePath,
		});
		return null;
	}

	if (typeof value.slug !== "string" || value.slug.trim().length === 0) {
		diagnostics.push({
			code: "INVALID_COMPONENT",
			message: `Component "${componentId}" must include a non-empty slug.`,
			path: `${basePath}.slug`,
		});
		return null;
	}

	if (typeof value.name !== "string" || value.name.trim().length === 0) {
		diagnostics.push({
			code: "INVALID_COMPONENT",
			message: `Component "${componentId}" must include a non-empty name.`,
			path: `${basePath}.name`,
		});
		return null;
	}

	const createdAt =
		typeof value.createdAt === "string"
			? value.createdAt
			: new Date(0).toISOString();
	const updatedAt =
		typeof value.updatedAt === "string"
			? value.updatedAt
			: new Date(0).toISOString();

	const draft = normalizeDraftPayload(
		value.draft,
		componentId,
		diagnostics,
		`${basePath}.draft`,
		context,
	);
	const published = normalizePublishedState(
		value.published,
		componentId,
		diagnostics,
		`${basePath}.published`,
		context,
	);

	if (!draft && !published) {
		diagnostics.push({
			code: "INVALID_COMPONENT",
			message: `Component "${componentId}" must include a draft and/or published state.`,
			path: basePath,
		});
		return null;
	}

	return {
		componentId,
		slug: value.slug.trim(),
		name: value.name.trim(),
		...(typeof value.description === "string" &&
		value.description.trim().length > 0
			? { description: value.description.trim() }
			: {}),
		...(typeof value.group === "string" && value.group.trim().length > 0
			? { group: value.group.trim() }
			: {}),
		...(typeof value.order === "number" ? { order: value.order } : {}),
		createdAt,
		updatedAt,
		...(draft ? { draft } : {}),
		...(published ? { published } : {}),
	};
}

type DraftPayloadNormalizationState = {
	backfilledVariantDefaults: boolean;
};

function normalizeDraftPayload(
	value: unknown,
	componentId: string,
	diagnostics: SystemComponentManifestDiagnostic[],
	basePath: string,
	context: SystemComponentManifestNormalizationContext,
	normalizationState?: DraftPayloadNormalizationState,
): SystemComponentDraftPayload | undefined {
	if (value === undefined) {
		return undefined;
	}
	if (!isRecord(value)) {
		diagnostics.push({
			code: "INVALID_COMPONENT",
			message: `Component "${componentId}" draft must be an object.`,
			path: basePath,
		});
		return undefined;
	}

	const root = normalizeRecipeTemplateNode(
		value.root,
		componentId,
		diagnostics,
		`${basePath}.root`,
	);
	if (!root) {
		return undefined;
	}

	const draft: SystemComponentDraftPayload = { root };
	if (
		typeof value.baseVersion === "string" &&
		value.baseVersion.trim().length > 0
	) {
		draft.baseVersion = value.baseVersion.trim();
	}
	const slots = normalizeSlotDefinitions(
		value.slots,
		componentId,
		diagnostics,
		basePath,
	);
	if (slots) {
		draft.slots = slots;
	}
	const props = normalizeProps(value.props, componentId, diagnostics, basePath);
	if (props) {
		draft.props = props;
	}
	const variants = normalizeVariantSchema(
		value.variants,
		componentId,
		diagnostics,
		basePath,
	);
	if (variants) {
		if (context.backfillOptionalVariantDefaults) {
			const backfilled = backfillOptionalVariantDefaults(variants);
			if (backfilled.changed && normalizationState) {
				normalizationState.backfilledVariantDefaults = true;
			}
			draft.variants = backfilled.variants;
		} else {
			draft.variants = variants;
		}
	}
	const overrideTargets = normalizeOverrideTargetMap(
		value.overrideTargets,
		componentId,
		diagnostics,
		basePath,
	);
	if (overrideTargets) {
		draft.overrideTargets = overrideTargets;
	}
	const migrationHints = normalizeMigrationHints(
		value.migrationHints,
		componentId,
		diagnostics,
		`${basePath}.migrationHints`,
	);
	if (migrationHints) {
		draft.migrationHints = migrationHints;
	}

	return draft;
}

function normalizePublishedState(
	value: unknown,
	componentId: string,
	diagnostics: SystemComponentManifestDiagnostic[],
	basePath: string,
	context: SystemComponentManifestNormalizationContext,
): SystemComponentPublishedState | undefined {
	if (value === undefined) {
		return undefined;
	}
	if (!isRecord(value)) {
		diagnostics.push({
			code: "INVALID_PUBLISHED_METADATA",
			message: `Component "${componentId}" published must be an object.`,
			path: basePath,
		});
		return undefined;
	}

	const currentVersion =
		typeof value.currentVersion === "string" &&
		value.currentVersion.trim().length > 0
			? value.currentVersion.trim()
			: "";
	if (!currentVersion) {
		diagnostics.push({
			code: "INVALID_PUBLISHED_METADATA",
			message: `Component "${componentId}" published.currentVersion is required.`,
			path: `${basePath}.currentVersion`,
		});
		return undefined;
	}

	if (!isRecord(value.versions)) {
		diagnostics.push({
			code: "INVALID_PUBLISHED_METADATA",
			message: `Component "${componentId}" published.versions must be an object.`,
			path: `${basePath}.versions`,
		});
		return undefined;
	}

	const versions: Record<string, PublishedSystemComponentVersion> = {};
	for (const [versionId, rawVersion] of Object.entries(value.versions)) {
		const normalized = normalizePublishedVersion(
			rawVersion,
			versionId,
			componentId,
			diagnostics,
			`${basePath}.versions.${versionId}`,
			context,
		);
		if (!normalized) {
			continue;
		}
		if (normalized.version !== versionId) {
			diagnostics.push({
				code: "INVALID_PUBLISHED_METADATA",
				message: `Published version key "${versionId}" must match version "${normalized.version}".`,
				path: `${basePath}.versions.${versionId}`,
			});
			continue;
		}
		versions[versionId] = normalized;
	}

	return {
		currentVersion,
		versions,
	};
}

function normalizePublishedVersion(
	value: unknown,
	versionId: string,
	componentId: string,
	diagnostics: SystemComponentManifestDiagnostic[],
	basePath: string,
	context: SystemComponentManifestNormalizationContext,
): PublishedSystemComponentVersion | null {
	if (!isRecord(value)) {
		diagnostics.push({
			code: "INVALID_PUBLISHED_METADATA",
			message: `Published version "${versionId}" on component "${componentId}" must be an object.`,
			path: basePath,
		});
		return null;
	}

	const version =
		typeof value.version === "string" && value.version.trim().length > 0
			? value.version.trim()
			: versionId;
	const publishedAt =
		typeof value.publishedAt === "string" && value.publishedAt.trim().length > 0
			? value.publishedAt.trim()
			: new Date(0).toISOString();
	const templateHash =
		typeof value.templateHash === "string" ? value.templateHash.trim() : "";
	const variantSchemaHash =
		typeof value.variantSchemaHash === "string"
			? value.variantSchemaHash.trim()
			: "";

	if (!templateHash || !variantSchemaHash) {
		diagnostics.push({
			code: "INVALID_PUBLISHED_METADATA",
			message: `Published version "${version}" on component "${componentId}" must include templateHash and variantSchemaHash.`,
			path: basePath,
		});
		return null;
	}

	const payloadNormalizationState: DraftPayloadNormalizationState = {
		backfilledVariantDefaults: false,
	};
	const payload = normalizeDraftPayload(
		value,
		componentId,
		diagnostics,
		basePath,
		context,
		payloadNormalizationState,
	);
	if (!payload) {
		return null;
	}
	const normalizedVariantSchemaHash =
		payloadNormalizationState.backfilledVariantDefaults
			? hashSystemComponentVariantSchema(payload.variants)
			: variantSchemaHash;

	const publishedVersion: PublishedSystemComponentVersion = {
		...payload,
		version,
		publishedAt,
		templateHash,
		variantSchemaHash: normalizedVariantSchemaHash,
	};
	if (
		typeof value.previousVersion === "string" &&
		value.previousVersion.trim().length > 0
	) {
		publishedVersion.previousVersion = value.previousVersion.trim();
	}
	const migrationHints = normalizeMigrationHints(
		value.migrationHints,
		componentId,
		diagnostics,
		`${basePath}.migrationHints`,
	);
	if (migrationHints) {
		publishedVersion.migrationHints = migrationHints;
	}

	return publishedVersion;
}

function normalizeRecipeTemplateNode(
	value: unknown,
	componentId: string,
	diagnostics: SystemComponentManifestDiagnostic[],
	basePath: string,
): RecipeTemplateNode | null {
	if (!isRecord(value)) {
		diagnostics.push({
			code: "INVALID_COMPONENT",
			message: `Component "${componentId}" template node must be an object.`,
			path: basePath,
		});
		return null;
	}

	if (
		typeof value.path !== "string" ||
		typeof value.library !== "string" ||
		typeof value.component !== "string"
	) {
		diagnostics.push({
			code: "INVALID_COMPONENT",
			message: `Component "${componentId}" template node must include path, library, and component.`,
			path: basePath,
		});
		return null;
	}

	const node: RecipeTemplateNode = {
		path: value.path,
		library: value.library,
		component: value.component,
	};
	if (typeof value.name === "string" && value.name.trim().length > 0) {
		node.name = value.name.trim();
	}
	if (typeof value.className === "string") {
		node.className = value.className;
	}
	if (typeof value.slot === "string" && value.slot.trim().length > 0) {
		node.slot = value.slot.trim();
	}
	if (typeof value.text === "string") {
		node.text = value.text;
	}
	if (Array.isArray(value.children)) {
		node.children = value.children
			.map((child, index) =>
				normalizeRecipeTemplateNode(
					child,
					componentId,
					diagnostics,
					`${basePath}.children[${index}]`,
				),
			)
			.filter((child): child is RecipeTemplateNode => child !== null);
	}
	if (isRecord(value.props)) {
		node.props = value.props as RecipeTemplateNode["props"];
	}

	return node;
}

function normalizeSlotDefinitions(
	value: unknown,
	componentId: string,
	diagnostics: SystemComponentManifestDiagnostic[],
	basePath: string,
): Record<string, SystemComponentSlotDefinition> | undefined {
	if (value === undefined) {
		return undefined;
	}
	if (!isRecord(value)) {
		diagnostics.push({
			code: "INVALID_COMPONENT",
			message: `Component "${componentId}" slots must be an object.`,
			path: `${basePath}.slots`,
		});
		return undefined;
	}

	const slots: Record<string, SystemComponentSlotDefinition> = {};
	for (const [slotKey, rawSlot] of Object.entries(value)) {
		if (!isRecord(rawSlot)) {
			diagnostics.push({
				code: "INVALID_COMPONENT",
				message: `Slot "${slotKey}" on component "${componentId}" must be an object.`,
				path: `${basePath}.slots.${slotKey}`,
			});
			continue;
		}

		if (typeof rawSlot.name !== "string" || rawSlot.name.trim().length === 0) {
			diagnostics.push({
				code: "INVALID_COMPONENT",
				message: `Slot "${slotKey}" on component "${componentId}" must include a non-empty name.`,
				path: `${basePath}.slots.${slotKey}.name`,
			});
			continue;
		}

		if (
			typeof rawSlot.hostPath !== "string" ||
			rawSlot.hostPath.trim().length === 0
		) {
			diagnostics.push({
				code: "INVALID_COMPONENT",
				message: `Slot "${slotKey}" on component "${componentId}" must include a non-empty hostPath.`,
				path: `${basePath}.slots.${slotKey}.hostPath`,
			});
			continue;
		}

		const slot: SystemComponentSlotDefinition = {
			name: rawSlot.name.trim(),
			hostPath: rawSlot.hostPath.trim(),
		};
		if (typeof rawSlot.label === "string" && rawSlot.label.trim().length > 0) {
			slot.label = rawSlot.label.trim();
		}
		if (rawSlot.insertIndex !== undefined) {
			if (
				typeof rawSlot.insertIndex === "number" &&
				Number.isInteger(rawSlot.insertIndex) &&
				rawSlot.insertIndex >= 0
			) {
				slot.insertIndex = rawSlot.insertIndex;
			} else {
				diagnostics.push({
					code: "INVALID_COMPONENT",
					message: `Slot "${slotKey}" on component "${componentId}" insertIndex must be a non-negative integer.`,
					path: `${basePath}.slots.${slotKey}.insertIndex`,
				});
			}
		}
		if (Array.isArray(rawSlot.defaultChildren)) {
			slot.defaultChildren = rawSlot.defaultChildren
				.map((child, index) =>
					normalizeRecipeTemplateNode(
						child,
						componentId,
						diagnostics,
						`${basePath}.slots.${slotKey}.defaultChildren[${index}]`,
					),
				)
				.filter((child): child is RecipeTemplateNode => child !== null);
		}
		if (Array.isArray(rawSlot.history)) {
			slot.history = rawSlot.history
				.filter((entry): entry is Record<string, unknown> => isRecord(entry))
				.map((entry) => ({
					fromVersion: String(entry.fromVersion ?? ""),
					...(typeof entry.previousName === "string"
						? { previousName: entry.previousName }
						: {}),
					...(typeof entry.previousHostPath === "string"
						? { previousHostPath: entry.previousHostPath }
						: {}),
				}))
				.filter((entry) => entry.fromVersion.length > 0);
		}
		slots[slotKey] = slot;
	}

	return slots;
}

function normalizeProps(
	value: unknown,
	componentId: string,
	diagnostics: SystemComponentManifestDiagnostic[],
	basePath: string,
): Record<string, unknown> | undefined {
	if (value === undefined) {
		return undefined;
	}
	if (!isRecord(value)) {
		diagnostics.push({
			code: "INVALID_COMPONENT",
			message: `Component "${componentId}" props must be an object.`,
			path: `${basePath}.props`,
		});
		return undefined;
	}
	return { ...value };
}

function normalizeVariantSchema(
	value: unknown,
	componentId: string,
	diagnostics: SystemComponentManifestDiagnostic[],
	basePath: string,
): SystemComponentVariantSchema | undefined {
	if (value === undefined) {
		return undefined;
	}
	if (!isRecord(value)) {
		diagnostics.push({
			code: "INVALID_COMPONENT",
			message: `Component "${componentId}" variants must be an object.`,
			path: `${basePath}.variants`,
		});
		return undefined;
	}

	const schema: SystemComponentVariantSchema = { axes: {} };
	if (isRecord(value.axes)) {
		for (const [axisId, rawAxis] of Object.entries(value.axes)) {
			if (!isRecord(rawAxis) || typeof rawAxis.label !== "string") {
				diagnostics.push({
					code: "INVALID_COMPONENT",
					message: `Variant axis "${axisId}" on component "${componentId}" must include a label.`,
					path: `${basePath}.variants.axes.${axisId}`,
				});
				continue;
			}
			const axis: SystemComponentVariantAxis = {
				label: rawAxis.label,
				values: {} as SystemComponentVariantSchema["axes"][string]["values"],
			};
			if (typeof rawAxis.defaultValue === "string") {
				axis.defaultValue = rawAxis.defaultValue;
			}
			if (isRecord(rawAxis.values)) {
				for (const [valueId, rawValue] of Object.entries(rawAxis.values)) {
					if (!isRecord(rawValue)) {
						continue;
					}
					axis.values[valueId] = {
						...(typeof rawValue.label === "string"
							? { label: rawValue.label }
							: {}),
						...(isRecord(rawValue.classesByPath)
							? {
									classesByPath: stringRecordFromRecord(rawValue.classesByPath),
								}
							: {}),
					};
				}
			}
			schema.axes[axisId] = axis;
		}
	}
	if (Array.isArray(value.compoundVariants)) {
		schema.compoundVariants = value.compoundVariants
			.filter((entry): entry is Record<string, unknown> => isRecord(entry))
			.map((entry) => ({
				when: isRecord(entry.when)
					? (entry.when as Record<string, string | string[]>)
					: {},
				classesByPath: isRecord(entry.classesByPath)
					? stringRecordFromRecord(entry.classesByPath)
					: {},
			}));
	}
	if (isRecord(value.defaultValues)) {
		schema.defaultValues = stringRecordFromRecord(value.defaultValues);
	}

	return schema;
}

function normalizeOverrideTargetMap(
	value: unknown,
	componentId: string,
	diagnostics: SystemComponentManifestDiagnostic[],
	basePath: string,
): Record<string, SystemComponentOverrideTarget> | undefined {
	if (value === undefined) {
		return undefined;
	}
	if (!isRecord(value)) {
		diagnostics.push({
			code: "INVALID_COMPONENT",
			message: `Component "${componentId}" overrideTargets must be an object.`,
			path: `${basePath}.overrideTargets`,
		});
		return undefined;
	}

	const targets: Record<string, SystemComponentOverrideTarget> = {};
	for (const [targetId, rawTarget] of Object.entries(value)) {
		if (!isRecord(rawTarget)) {
			diagnostics.push({
				code: "INVALID_COMPONENT",
				message: `Override target "${targetId}" on component "${componentId}" must be an object.`,
				path: `${basePath}.overrideTargets.${targetId}`,
			});
			continue;
		}

		if (
			typeof rawTarget.targetId !== "string" ||
			rawTarget.targetId.trim().length === 0 ||
			typeof rawTarget.label !== "string" ||
			rawTarget.label.trim().length === 0 ||
			typeof rawTarget.path !== "string" ||
			rawTarget.path.trim().length === 0
		) {
			diagnostics.push({
				code: "INVALID_COMPONENT",
				message: `Override target "${targetId}" on component "${componentId}" must include targetId, label, and path.`,
				path: `${basePath}.overrideTargets.${targetId}`,
			});
			continue;
		}

		const target: SystemComponentOverrideTarget = {
			targetId: rawTarget.targetId.trim(),
			label: rawTarget.label.trim(),
			path: rawTarget.path.trim(),
		};
		if (Array.isArray(rawTarget.capabilities)) {
			target.capabilities = rawTarget.capabilities
				.filter((entry): entry is string => typeof entry === "string")
				.filter(
					(
						entry,
					): entry is NonNullable<
						SystemComponentOverrideTarget["capabilities"]
					>[number] =>
						entry === "className" ||
						entry === "text" ||
						entry === "icon" ||
						entry === "asset",
				);
		}
		if (Array.isArray(rawTarget.props)) {
			target.props = [
				...new Set(
					rawTarget.props
						.filter((entry): entry is string => typeof entry === "string")
						.map((entry) => entry.trim())
						.filter(Boolean),
				),
			];
		}
		if (Array.isArray(rawTarget.history)) {
			target.history = rawTarget.history
				.filter((entry): entry is Record<string, unknown> => isRecord(entry))
				.map((entry) => ({
					fromVersion: String(entry.fromVersion ?? ""),
					...(typeof entry.previousTargetId === "string"
						? { previousTargetId: entry.previousTargetId }
						: {}),
					...(typeof entry.previousPath === "string"
						? { previousPath: entry.previousPath }
						: {}),
				}))
				.filter((entry) => entry.fromVersion.length > 0);
		}
		targets[targetId] = target;
	}

	return targets;
}

function normalizeMigrationHints(
	value: unknown,
	componentId: string,
	diagnostics: SystemComponentManifestDiagnostic[],
	basePath: string,
): SystemComponentMigrationHints | undefined {
	if (value === undefined) {
		return undefined;
	}
	if (!isRecord(value)) {
		diagnostics.push({
			code: "INVALID_COMPONENT",
			message: `Component "${componentId}" migrationHints must be an object.`,
			path: basePath,
		});
		return undefined;
	}

	const hints: SystemComponentMigrationHints = {};
	if (Array.isArray(value.variantAxes)) {
		hints.variantAxes = value.variantAxes
			.filter((entry) => isRecord(entry))
			.map((entry) => ({
				fromAxis: String(entry.fromAxis ?? ""),
				...(typeof entry.toAxis === "string" ? { toAxis: entry.toAxis } : {}),
				...(Array.isArray(entry.valueMappings)
					? {
							valueMappings: entry.valueMappings
								.filter((mapping) => isRecord(mapping))
								.map((mapping) => ({
									fromValue: String(mapping.fromValue ?? ""),
									...(typeof mapping.toValue === "string"
										? { toValue: mapping.toValue }
										: {}),
								})),
						}
					: {}),
			}));
	}
	if (Array.isArray(value.slots)) {
		hints.slots = value.slots
			.filter((entry) => isRecord(entry))
			.map((entry) => ({
				fromName: String(entry.fromName ?? ""),
				...(typeof entry.toName === "string" ? { toName: entry.toName } : {}),
				...(Array.isArray(entry.hostPathMappings)
					? {
							hostPathMappings: entry.hostPathMappings
								.filter((mapping) => isRecord(mapping))
								.map((mapping) => ({
									fromPath: String(mapping.fromPath ?? ""),
									...(typeof mapping.toPath === "string"
										? { toPath: mapping.toPath }
										: {}),
								})),
						}
					: {}),
			}));
	}
	if (Array.isArray(value.overrideTargets)) {
		hints.overrideTargets = value.overrideTargets
			.filter((entry) => isRecord(entry))
			.map((entry) => ({
				fromTargetId: String(entry.fromTargetId ?? ""),
				...(typeof entry.toTargetId === "string"
					? { toTargetId: entry.toTargetId }
					: {}),
				...(Array.isArray(entry.pathMappings)
					? {
							pathMappings: entry.pathMappings
								.filter((mapping) => isRecord(mapping))
								.map((mapping) => ({
									fromPath: String(mapping.fromPath ?? ""),
									...(typeof mapping.toPath === "string"
										? { toPath: mapping.toPath }
										: {}),
								})),
						}
					: {}),
			}));
	}

	return hints;
}

function invalidManifest(
	manifestPath: string,
	diagnostics: SystemComponentManifestDiagnostic[],
): SystemComponentManifestServiceError {
	return new SystemComponentManifestServiceError(
		"INVALID_MANIFEST",
		`Invalid component manifest at ${manifestPath}.`,
		diagnostics,
	);
}

async function writeJsonAtomically(filePath: string, value: unknown) {
	const contents = `${JSON.stringify(value, null, "\t")}\n`;
	const tempPath = `${filePath}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`;

	try {
		await writeFile(tempPath, contents, "utf8");
		await rename(tempPath, filePath);
	} catch (error) {
		await unlink(tempPath).catch(() => undefined);
		throw error;
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringRecordFromRecord(
	value: Record<string, unknown>,
): Record<string, string> {
	return Object.fromEntries(
		Object.entries(value).filter(([, entry]) => typeof entry === "string"),
	) as Record<string, string>;
}
