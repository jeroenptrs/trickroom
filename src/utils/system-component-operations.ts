import type { RecipeTemplateNode } from "../types";
import {
	assertDesignSystemExistsForComponents,
	readSystemComponentManifest,
	type SystemComponentManifestRead,
	type SystemComponentManifestRevision,
	SystemComponentManifestServiceError,
	writeSystemComponentManifest,
} from "./system-component-manifest-service.ts";
import {
	assertComponentIdKeyInvariant,
	generateSystemComponentId,
	isSystemComponentSlug,
	type PublishedSystemComponentVersion,
	type SystemComponentDraftPayload,
	type SystemComponentManifest,
	SystemComponentManifestError,
	type SystemComponentRecord,
} from "./system-components.ts";
import {
	assertValidSystemComponentManifest,
	hashSystemComponentTemplate,
	hashSystemComponentVariantSchema,
	type SystemComponentManifestDiagnostic,
	validateSystemComponentManifest,
} from "./system-components-validation.ts";

export type SystemComponentMutationOptions = {
	expectedRevision: SystemComponentManifestRevision;
	expectedDraftTemplateHash?: string;
	expectedDraftVariantSchemaHash?: string;
	now?: string;
};

export type SystemComponentMutationResult = SystemComponentManifestRead & {
	componentId: string;
};

export type { SystemComponentSummary } from "./system-component-operations.types";
import type { SystemComponentSummary } from "./system-component-operations.types";

export type SystemComponentDescribeResult = Omit<
	SystemComponentMutationResult,
	"diagnostics"
> & {
	record: SystemComponentRecord;
	draftTemplateHash?: string;
	draftVariantSchemaHash?: string;
	diagnostics: SystemComponentManifestDiagnostic[];
	valid: boolean;
};

export type UpdateSystemComponentSettingsInput = {
	autoMigrateComponents: boolean;
};

export class SystemComponentOperationsError extends Error {
	readonly code:
		| "COMPONENT_NOT_FOUND"
		| "COMPONENT_ALREADY_EXISTS"
		| "DRAFT_ALREADY_EXISTS"
		| "NO_DRAFT"
		| "NO_PUBLISHED"
		| "PUBLISHED_VERSION_NOT_FOUND"
		| "DUPLICATE_SLUG"
		| "INVALID_SLUG"
		| "VALIDATION_FAILED"
		| "DRAFT_HASH_MISMATCH"
		| "STALE_WRITE"
		| "SYSTEM_NOT_FOUND";

	constructor(code: SystemComponentOperationsError["code"], message: string) {
		super(message);
		this.name = "SystemComponentOperationsError";
		this.code = code;
	}
}

const defaultRootTemplate = (): RecipeTemplateNode => ({
	path: "root",
	library: "trickroom",
	component: "container",
});

const cloneDraftPayload = (
	payload: SystemComponentDraftPayload,
): SystemComponentDraftPayload =>
	JSON.parse(JSON.stringify(payload)) as SystemComponentDraftPayload;

const cloneRecord = (record: SystemComponentRecord): SystemComponentRecord =>
	JSON.parse(JSON.stringify(record)) as SystemComponentRecord;

const findSlugOwner = (
	manifest: SystemComponentManifest,
	slug: string,
	excludeComponentId?: string,
): SystemComponentRecord | undefined =>
	Object.values(manifest.components).find(
		(record) =>
			record.slug === slug && record.componentId !== excludeComponentId,
	);

const nextPublishedVersionId = (
	versions: Record<string, PublishedSystemComponentVersion>,
): string => {
	const numericVersions = Object.keys(versions)
		.map((version) => Number.parseInt(version, 10))
		.filter((value) => Number.isFinite(value));
	const max = numericVersions.length > 0 ? Math.max(...numericVersions) : 0;
	return String(max + 1);
};

const publishedVersionToDraft = (
	version: PublishedSystemComponentVersion,
): SystemComponentDraftPayload => {
	const {
		version: _version,
		publishedAt: _publishedAt,
		templateHash: _templateHash,
		variantSchemaHash: _variantSchemaHash,
		previousVersion: _previousVersion,
		...draft
	} = version;
	return {
		...cloneDraftPayload(draft),
		baseVersion: version.version,
	};
};

const assertSlugAvailable = (
	manifest: SystemComponentManifest,
	slug: string,
	excludeComponentId?: string,
) => {
	if (!isSystemComponentSlug(slug)) {
		throw new SystemComponentOperationsError(
			"INVALID_SLUG",
			`Component slug "${slug}" must be a unique lowercase identifier without slashes.`,
		);
	}
	const existing = findSlugOwner(manifest, slug, excludeComponentId);
	if (existing) {
		throw new SystemComponentOperationsError(
			"DUPLICATE_SLUG",
			`Component slug "${slug}" is already used by ${existing.componentId}.`,
		);
	}
};

const validateManifestForWrite = (
	manifest: SystemComponentManifest,
	options?: { verifyPublishedHashes?: boolean },
) => {
	const result = validateSystemComponentManifest(manifest, options);
	if (result.valid) {
		return result;
	}
	const messages = result.diagnostics
		.filter((entry) => entry.severity === "error")
		.map((entry) => entry.message)
		.join(" ");
	throw new SystemComponentOperationsError(
		"VALIDATION_FAILED",
		messages || "Component manifest validation failed.",
	);
};

const commitManifestMutation = async (
	projectRoot: string,
	systemHandle: string,
	options: SystemComponentMutationOptions,
	mutate: (manifest: SystemComponentManifest) => string,
	verifyPublishedHashes = false,
): Promise<SystemComponentMutationResult> => {
	await assertDesignSystemExistsForComponents(projectRoot, systemHandle);
	const read = await readSystemComponentManifest(projectRoot, systemHandle);
	const manifest: SystemComponentManifest = {
		...read.manifest,
		components: { ...read.manifest.components },
	};
	const componentId = mutate(manifest);

	try {
		assertComponentIdKeyInvariant(manifest.components);
	} catch (error) {
		if (error instanceof SystemComponentManifestError) {
			throw new SystemComponentOperationsError(
				"VALIDATION_FAILED",
				error.message,
			);
		}
		throw error;
	}

	validateManifestForWrite(manifest, { verifyPublishedHashes });
	const now = options.now ?? new Date().toISOString();

	try {
		const written = await writeSystemComponentManifest(
			projectRoot,
			systemHandle,
			manifest,
			{
				expectedRevision: options.expectedRevision,
				now,
				componentsMerge: "replace",
			},
		);
		return { ...written, componentId };
	} catch (error) {
		if (error instanceof SystemComponentManifestServiceError) {
			if (error.code === "STALE_WRITE" || error.code === "SYSTEM_NOT_FOUND") {
				throw new SystemComponentOperationsError(error.code, error.message);
			}
		}
		throw error;
	}
};

const requireRecord = (
	manifest: SystemComponentManifest,
	componentId: string,
): SystemComponentRecord => {
	const record = manifest.components[componentId];
	if (!record) {
		throw new SystemComponentOperationsError(
			"COMPONENT_NOT_FOUND",
			`Component "${componentId}" was not found.`,
		);
	}
	return record;
};

const touchRecord = (record: SystemComponentRecord, now: string) => {
	record.updatedAt = now;
};

export async function listSystemComponentSummaries(
	projectRoot: string,
	systemHandle: string,
): Promise<{
	manifest: SystemComponentManifest;
	revision: SystemComponentManifestRevision;
	updatedAt: string;
	components: SystemComponentSummary[];
}> {
	await assertDesignSystemExistsForComponents(projectRoot, systemHandle);
	const read = await readSystemComponentManifest(projectRoot, systemHandle);
	const components = Object.values(read.manifest.components)
		.map((record) => ({
			componentId: record.componentId,
			slug: record.slug,
			name: record.name,
			...(record.description ? { description: record.description } : {}),
			...(record.group ? { group: record.group } : {}),
			...(typeof record.order === "number" ? { order: record.order } : {}),
			hasDraft: Boolean(record.draft),
			hasPublished: Boolean(record.published),
			...(record.published?.currentVersion
				? { currentVersion: record.published.currentVersion }
				: {}),
			createdAt: record.createdAt,
			updatedAt: record.updatedAt,
		}))
		.sort((left, right) => {
			const orderDelta =
				(left.order ?? Number.MAX_SAFE_INTEGER) -
				(right.order ?? Number.MAX_SAFE_INTEGER);
			if (orderDelta !== 0) {
				return orderDelta;
			}
			return left.name.localeCompare(right.name);
		});

	return {
		manifest: read.manifest,
		revision: read.revision,
		updatedAt: read.updatedAt,
		components,
	};
}

export async function updateSystemComponentSettings(
	projectRoot: string,
	systemHandle: string,
	input: UpdateSystemComponentSettingsInput,
	options: SystemComponentMutationOptions,
): Promise<SystemComponentMutationResult> {
	return commitManifestMutation(
		projectRoot,
		systemHandle,
		options,
		(manifest) => {
			manifest.settings = {
				autoMigrateComponents: input.autoMigrateComponents,
			};
			return "";
		},
	);
}

export async function describeSystemComponent(
	projectRoot: string,
	systemHandle: string,
	componentId: string,
): Promise<SystemComponentDescribeResult> {
	await assertDesignSystemExistsForComponents(projectRoot, systemHandle);
	const read = await readSystemComponentManifest(projectRoot, systemHandle);
	const record = requireRecord(read.manifest, componentId);
	const validation = validateSystemComponentManifest(read.manifest, {
		verifyPublishedHashes: true,
	});

	return {
		...read,
		componentId,
		record: cloneRecord(record),
		...(record.draft
			? { draftTemplateHash: hashSystemComponentTemplate(record.draft) }
			: {}),
		...(record.draft
			? {
					draftVariantSchemaHash: hashSystemComponentVariantSchema(
						record.draft.variants,
					),
				}
			: {}),
		diagnostics: validation.diagnostics,
		valid: validation.valid,
	};
}

export type CreateSystemComponentDraftInput = {
	slug: string;
	name: string;
	description?: string;
	group?: string;
	order?: number;
	draft?: Partial<SystemComponentDraftPayload>;
};

export async function createSystemComponentDraft(
	projectRoot: string,
	systemHandle: string,
	input: CreateSystemComponentDraftInput,
	options: SystemComponentMutationOptions,
): Promise<SystemComponentMutationResult> {
	return commitManifestMutation(
		projectRoot,
		systemHandle,
		options,
		(manifest) => {
			const now = options.now ?? new Date().toISOString();
			assertSlugAvailable(manifest, input.slug);
			const componentId = generateSystemComponentId();
			const draft = cloneDraftPayload({
				root: input.draft?.root ?? defaultRootTemplate(),
				...(input.draft?.baseVersion
					? { baseVersion: input.draft.baseVersion }
					: {}),
				...(input.draft?.slots ? { slots: input.draft.slots } : {}),
				...(input.draft?.props ? { props: input.draft.props } : {}),
				...(input.draft?.variants ? { variants: input.draft.variants } : {}),
				...(input.draft?.overrideTargets
					? { overrideTargets: input.draft.overrideTargets }
					: {}),
				...(input.draft?.migrationHints
					? { migrationHints: input.draft.migrationHints }
					: {}),
			});

			manifest.components[componentId] = {
				componentId,
				slug: input.slug,
				name: input.name,
				...(input.description ? { description: input.description } : {}),
				...(input.group ? { group: input.group } : {}),
				...(typeof input.order === "number" ? { order: input.order } : {}),
				createdAt: now,
				updatedAt: now,
				draft,
			};
			return componentId;
		},
	);
}

export type UpdateSystemComponentMetadataInput = {
	name?: string;
	description?: string | null;
	slug?: string;
	group?: string | null;
	order?: number | null;
};

export async function updateSystemComponentDraftMetadata(
	projectRoot: string,
	systemHandle: string,
	componentId: string,
	input: UpdateSystemComponentMetadataInput,
	options: SystemComponentMutationOptions,
): Promise<SystemComponentMutationResult> {
	return commitManifestMutation(
		projectRoot,
		systemHandle,
		options,
		(manifest) => {
			const record = requireRecord(manifest, componentId);
			if (!record.draft) {
				throw new SystemComponentOperationsError(
					"NO_DRAFT",
					`Component "${componentId}" does not have a draft to update.`,
				);
			}
			const now = options.now ?? new Date().toISOString();
			if (input.slug !== undefined) {
				assertSlugAvailable(manifest, input.slug, componentId);
				record.slug = input.slug;
			}
			if (input.name !== undefined) {
				record.name = input.name;
			}
			if (input.description !== undefined) {
				if (
					input.description === null ||
					input.description.trim().length === 0
				) {
					delete record.description;
				} else {
					record.description = input.description.trim();
				}
			}
			if (input.group !== undefined) {
				if (input.group === null || input.group.trim().length === 0) {
					delete record.group;
				} else {
					record.group = input.group.trim();
				}
			}
			if (input.order !== undefined) {
				if (input.order === null) {
					delete record.order;
				} else {
					record.order = input.order;
				}
			}
			touchRecord(record, now);
			manifest.components[componentId] = record;
			return componentId;
		},
	);
}

export async function updateSystemComponentDraftTemplate(
	projectRoot: string,
	systemHandle: string,
	componentId: string,
	root: RecipeTemplateNode,
	options: SystemComponentMutationOptions,
): Promise<SystemComponentMutationResult> {
	return commitManifestMutation(
		projectRoot,
		systemHandle,
		options,
		(manifest) => {
			const record = requireRecord(manifest, componentId);
			if (!record.draft) {
				throw new SystemComponentOperationsError(
					"NO_DRAFT",
					`Component "${componentId}" does not have a draft to update.`,
				);
			}
			if (
				options.expectedDraftTemplateHash !== undefined &&
				hashSystemComponentTemplate(record.draft) !==
					options.expectedDraftTemplateHash
			) {
				throw new SystemComponentOperationsError(
					"DRAFT_HASH_MISMATCH",
					`Component "${componentId}" draft changed since it was loaded. Reload before saving.`,
				);
			}
			const now = options.now ?? new Date().toISOString();
			record.draft = {
				...record.draft,
				root: cloneDraftPayload({ root }).root,
			};
			touchRecord(record, now);
			manifest.components[componentId] = record;
			return componentId;
		},
	);
}

export async function updateSystemComponentDraftSlots(
	projectRoot: string,
	systemHandle: string,
	componentId: string,
	slots: SystemComponentDraftPayload["slots"] | null,
	options: SystemComponentMutationOptions,
): Promise<SystemComponentMutationResult> {
	return commitManifestMutation(
		projectRoot,
		systemHandle,
		options,
		(manifest) => {
			const record = requireRecord(manifest, componentId);
			if (!record.draft) {
				throw new SystemComponentOperationsError(
					"NO_DRAFT",
					`Component "${componentId}" does not have a draft to update.`,
				);
			}
			const now = options.now ?? new Date().toISOString();
			record.draft = {
				...record.draft,
				...(slots
					? {
							slots: cloneDraftPayload({ root: defaultRootTemplate(), slots })
								.slots,
						}
					: {}),
			};
			if (!slots) {
				delete record.draft.slots;
			}
			touchRecord(record, now);
			manifest.components[componentId] = record;
			return componentId;
		},
	);
}

export async function updateSystemComponentDraftVariants(
	projectRoot: string,
	systemHandle: string,
	componentId: string,
	variants: SystemComponentDraftPayload["variants"] | null,
	options: SystemComponentMutationOptions,
): Promise<SystemComponentMutationResult> {
	return commitManifestMutation(
		projectRoot,
		systemHandle,
		options,
		(manifest) => {
			const record = requireRecord(manifest, componentId);
			if (!record.draft) {
				throw new SystemComponentOperationsError(
					"NO_DRAFT",
					`Component "${componentId}" does not have a draft to update.`,
				);
			}
			const now = options.now ?? new Date().toISOString();
			record.draft = {
				...record.draft,
				...(variants
					? {
							variants: cloneDraftPayload({
								root: defaultRootTemplate(),
								variants,
							}).variants,
						}
					: {}),
			};
			if (!variants) {
				delete record.draft.variants;
			}
			touchRecord(record, now);
			manifest.components[componentId] = record;
			return componentId;
		},
	);
}

export async function updateSystemComponentDraftOverrideTargets(
	projectRoot: string,
	systemHandle: string,
	componentId: string,
	overrideTargets: SystemComponentDraftPayload["overrideTargets"] | null,
	options: SystemComponentMutationOptions,
): Promise<SystemComponentMutationResult> {
	return commitManifestMutation(
		projectRoot,
		systemHandle,
		options,
		(manifest) => {
			const record = requireRecord(manifest, componentId);
			if (!record.draft) {
				throw new SystemComponentOperationsError(
					"NO_DRAFT",
					`Component "${componentId}" does not have a draft to update.`,
				);
			}
			const now = options.now ?? new Date().toISOString();
			record.draft = {
				...record.draft,
				...(overrideTargets
					? {
							overrideTargets: cloneDraftPayload({
								root: defaultRootTemplate(),
								overrideTargets,
							}).overrideTargets,
						}
					: {}),
			};
			if (!overrideTargets) {
				delete record.draft.overrideTargets;
			}
			touchRecord(record, now);
			manifest.components[componentId] = record;
			return componentId;
		},
	);
}

export type UpdateSystemComponentDraftInput = {
	root?: RecipeTemplateNode;
	slots?: SystemComponentDraftPayload["slots"] | null;
	variants?: SystemComponentDraftPayload["variants"] | null;
	overrideTargets?: SystemComponentDraftPayload["overrideTargets"] | null;
};

export async function updateSystemComponentDraft(
	projectRoot: string,
	systemHandle: string,
	componentId: string,
	input: UpdateSystemComponentDraftInput,
	options: SystemComponentMutationOptions,
): Promise<SystemComponentMutationResult> {
	return commitManifestMutation(
		projectRoot,
		systemHandle,
		options,
		(manifest) => {
			const record = requireRecord(manifest, componentId);
			if (!record.draft) {
				throw new SystemComponentOperationsError(
					"NO_DRAFT",
					`Component "${componentId}" does not have a draft to update.`,
				);
			}
			if (
				options.expectedDraftTemplateHash !== undefined &&
				hashSystemComponentTemplate(record.draft) !==
					options.expectedDraftTemplateHash
			) {
				throw new SystemComponentOperationsError(
					"DRAFT_HASH_MISMATCH",
					`Component "${componentId}" draft changed since it was loaded. Reload before saving.`,
				);
			}
			if (
				options.expectedDraftVariantSchemaHash !== undefined &&
				hashSystemComponentVariantSchema(record.draft.variants) !==
					options.expectedDraftVariantSchemaHash
			) {
				throw new SystemComponentOperationsError(
					"DRAFT_HASH_MISMATCH",
					`Component "${componentId}" draft variants changed since they were loaded. Reload before saving.`,
				);
			}

			const draft = cloneDraftPayload(record.draft);
			if (input.root !== undefined) {
				draft.root = cloneDraftPayload({ root: input.root }).root;
			}
			if (input.slots !== undefined) {
				if (input.slots === null) {
					delete draft.slots;
				} else {
					draft.slots = cloneDraftPayload({
						root: defaultRootTemplate(),
						slots: input.slots,
					}).slots;
				}
			}
			if (input.variants !== undefined) {
				if (input.variants === null) {
					delete draft.variants;
				} else {
					draft.variants = cloneDraftPayload({
						root: defaultRootTemplate(),
						variants: input.variants,
					}).variants;
				}
			}
			if (input.overrideTargets !== undefined) {
				if (input.overrideTargets === null) {
					delete draft.overrideTargets;
				} else {
					draft.overrideTargets = cloneDraftPayload({
						root: defaultRootTemplate(),
						overrideTargets: input.overrideTargets,
					}).overrideTargets;
				}
			}

			const now = options.now ?? new Date().toISOString();
			record.draft = draft;
			touchRecord(record, now);
			manifest.components[componentId] = record;
			return componentId;
		},
	);
}

export async function publishSystemComponentDraft(
	projectRoot: string,
	systemHandle: string,
	componentId: string,
	options: SystemComponentMutationOptions,
): Promise<SystemComponentMutationResult & { publishedVersion: string }> {
	const result = await commitManifestMutation(
		projectRoot,
		systemHandle,
		options,
		(manifest) => {
			const record = requireRecord(manifest, componentId);
			if (!record.draft) {
				throw new SystemComponentOperationsError(
					"NO_DRAFT",
					`Component "${componentId}" does not have a draft to publish.`,
				);
			}

			const now = options.now ?? new Date().toISOString();
			const published = record.published ?? {
				currentVersion: "",
				versions: {},
			};
			const versionId = nextPublishedVersionId(published.versions);
			const draft = cloneDraftPayload(record.draft);
			const publishedVersion: PublishedSystemComponentVersion = {
				...draft,
				version: versionId,
				publishedAt: now,
				templateHash: hashSystemComponentTemplate(draft),
				variantSchemaHash: hashSystemComponentVariantSchema(draft.variants),
				...(published.currentVersion
					? { previousVersion: published.currentVersion }
					: {}),
			};

			const versions = {
				...published.versions,
				[versionId]: publishedVersion,
			};
			record.published = {
				currentVersion: versionId,
				versions,
			};
			touchRecord(record, now);
			manifest.components[componentId] = record;
			return componentId;
		},
		true,
	);

	const record = result.manifest.components[result.componentId];
	const publishedVersion = record?.published?.currentVersion ?? "";
	return { ...result, publishedVersion };
}

export async function copyPublishedSystemComponentToDraft(
	projectRoot: string,
	systemHandle: string,
	componentId: string,
	versionId: string | undefined,
	options: SystemComponentMutationOptions,
): Promise<SystemComponentMutationResult> {
	return commitManifestMutation(
		projectRoot,
		systemHandle,
		options,
		(manifest) => {
			const record = requireRecord(manifest, componentId);
			if (!record.published) {
				throw new SystemComponentOperationsError(
					"NO_PUBLISHED",
					`Component "${componentId}" does not have a published version to copy.`,
				);
			}

			const targetVersionId = versionId ?? record.published.currentVersion;
			const source = record.published.versions[targetVersionId];
			if (!source) {
				throw new SystemComponentOperationsError(
					"PUBLISHED_VERSION_NOT_FOUND",
					`Published version "${targetVersionId}" was not found on component "${componentId}".`,
				);
			}

			if (record.draft) {
				throw new SystemComponentOperationsError(
					"DRAFT_ALREADY_EXISTS",
					`Component "${componentId}" already has a draft. Discard it before copying a published version.`,
				);
			}

			const now = options.now ?? new Date().toISOString();
			record.draft = publishedVersionToDraft(source);
			touchRecord(record, now);
			manifest.components[componentId] = record;
			return componentId;
		},
	);
}

export async function discardSystemComponentDraft(
	projectRoot: string,
	systemHandle: string,
	componentId: string,
	options: SystemComponentMutationOptions,
): Promise<SystemComponentMutationResult & { removedComponent: boolean }> {
	const result = await commitManifestMutation(
		projectRoot,
		systemHandle,
		options,
		(manifest) => {
			const record = requireRecord(manifest, componentId);
			if (!record.draft) {
				throw new SystemComponentOperationsError(
					"NO_DRAFT",
					`Component "${componentId}" does not have a draft to discard.`,
				);
			}

			const now = options.now ?? new Date().toISOString();
			if (record.published) {
				delete record.draft;
				touchRecord(record, now);
				manifest.components[componentId] = record;
				return componentId;
			}

			delete manifest.components[componentId];
			return componentId;
		},
	);

	const removedComponent = !result.manifest.components[result.componentId];
	return { ...result, removedComponent };
}

export async function deleteSystemComponent(
	projectRoot: string,
	systemHandle: string,
	componentId: string,
	options: SystemComponentMutationOptions,
): Promise<SystemComponentMutationResult> {
	return commitManifestMutation(
		projectRoot,
		systemHandle,
		options,
		(manifest) => {
			requireRecord(manifest, componentId);
			delete manifest.components[componentId];
			return componentId;
		},
	);
}

export { assertValidSystemComponentManifest };
