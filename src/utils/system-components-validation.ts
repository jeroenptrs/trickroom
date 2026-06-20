import type { RecipeTemplateNode } from "../types";
import {
	classifyCompoundWhenShape,
	findDuplicateCompoundWhenSignatures,
} from "./system-component-compound-shape.ts";
import { compoundWhenSignature } from "./system-component-compound-signature.ts";
import { isSystemComponentOverrideCapability } from "./system-component-override-targets.ts";
import { stableSystemComponentTemplateInput } from "./system-component-template-hash.ts";
import { sha256Hex } from "./sha256.ts";
import {
	assertComponentIdKeyInvariant,
	isSystemComponentId,
	isSystemComponentSlug,
	type PublishedSystemComponentVersion,
	SYSTEM_COMPONENT_ID_PREFIX,
	type SystemComponentDraftPayload,
	type SystemComponentManifest,
	SystemComponentManifestError,
	type SystemComponentMigrationHints,
	type SystemComponentOverrideTarget,
	type SystemComponentRecord,
	type SystemComponentSlotDefinition,
	type SystemComponentVariantSchema,
} from "./system-components.ts";

export type {
	SystemComponentManifestDiagnostic,
	SystemComponentManifestDiagnosticCode,
	SystemComponentManifestDiagnosticSeverity,
} from "./system-components-validation.types";
import type {
	SystemComponentManifestDiagnostic,
	SystemComponentManifestDiagnosticCode,
	SystemComponentManifestDiagnosticSeverity,
} from "./system-components-validation.types";

export type SystemComponentManifestValidationResult = {
	valid: boolean;
	diagnostics: SystemComponentManifestDiagnostic[];
};

const stableStringify = (value: unknown): string => {
	if (Array.isArray(value)) {
		return `[${value.map(stableStringify).join(",")}]`;
	}
	if (value && typeof value === "object") {
		return `{${Object.entries(value as Record<string, unknown>)
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
			.join(",")}}`;
	}
	return JSON.stringify(value);
};

const compareDiagnostics = (
	left: SystemComponentManifestDiagnostic,
	right: SystemComponentManifestDiagnostic,
) =>
	left.code.localeCompare(right.code) ||
	left.severity.localeCompare(right.severity) ||
	(left.componentId ?? "").localeCompare(right.componentId ?? "") ||
	(left.path ?? "").localeCompare(right.path ?? "") ||
	left.message.localeCompare(right.message);

const pushDiagnostic = (
	diagnostics: SystemComponentManifestDiagnostic[],
	diagnostic: SystemComponentManifestDiagnostic,
) => {
	diagnostics.push(diagnostic);
};

export const isValidSystemComponentTemplatePath = (
	pathValue: string,
): boolean => pathValue.length > 0 && !pathValue.includes("/");

export const collectRecipeTemplateNodes = (
	root: RecipeTemplateNode,
): RecipeTemplateNode[] => {
	const nodes: RecipeTemplateNode[] = [];
	const visit = (node: RecipeTemplateNode) => {
		nodes.push(node);
		for (const child of node.children ?? []) {
			visit(child);
		}
	};
	visit(root);
	return nodes;
};

export const collectRecipeTemplatePaths = (
	root: RecipeTemplateNode,
): Set<string> =>
	new Set(collectRecipeTemplateNodes(root).map((node) => node.path));

export function hashSystemComponentTemplate(
	payload: Pick<
		SystemComponentDraftPayload,
		"root" | "slots" | "overrideTargets"
	>,
): string {
	const input = stableSystemComponentTemplateInput(payload);
	return `sha256:${sha256Hex(input)}`;
}

export function hashSystemComponentVariantSchema(
	variants?: SystemComponentVariantSchema,
): string {
	const input = stableStringify(variants ?? { axes: {} });
	return `sha256:${sha256Hex(input)}`;
}

const validateTemplatePaths = (
	componentId: string,
	root: RecipeTemplateNode,
	diagnostics: SystemComponentManifestDiagnostic[],
) => {
	const nodes = collectRecipeTemplateNodes(root);
	const paths = nodes.map((node) => node.path);
	const pathCounts = new Map<string, number>();

	for (const pathValue of paths) {
		pathCounts.set(pathValue, (pathCounts.get(pathValue) ?? 0) + 1);
	}

	const rootPathCount = pathCounts.get(root.path) ?? 0;
	if (rootPathCount !== 1) {
		pushDiagnostic(diagnostics, {
			code: "INVALID_TEMPLATE_ROOT",
			severity: "error",
			componentId,
			path: root.path,
			message: `Component "${componentId}" template must have exactly one root node with path "${root.path}".`,
		});
	}

	for (const pathValue of paths) {
		if (!isValidSystemComponentTemplatePath(pathValue)) {
			pushDiagnostic(diagnostics, {
				code: "INVALID_TEMPLATE_PATH",
				severity: "error",
				componentId,
				path: pathValue,
				message: `Component "${componentId}" template path "${pathValue}" must be a non-empty stable identifier without slashes.`,
			});
		}
	}

	for (const [pathValue, count] of pathCounts.entries()) {
		if (count > 1) {
			pushDiagnostic(diagnostics, {
				code: "INVALID_TEMPLATE_PATH",
				severity: "error",
				componentId,
				path: pathValue,
				message: `Component "${componentId}" template path "${pathValue}" is duplicated ${count} times.`,
			});
		}
	}

	if (root.path !== "root") {
		pushDiagnostic(diagnostics, {
			code: "UNCONVENTIONAL_ROOT_PATH",
			severity: "warning",
			componentId,
			path: root.path,
			message: `Component "${componentId}" root template path is "${root.path}"; "root" is the conventional root path.`,
		});
	}

	return new Set(paths.filter(isValidSystemComponentTemplatePath));
};

const validatePathsExist = (
	componentId: string,
	templatePaths: Set<string>,
	pathValue: string,
	code:
		| "INVALID_SLOT_HOST_PATH"
		| "INVALID_OVERRIDE_TARGET_PATH"
		| "INVALID_VARIANT_CLASS_TARGET_PATH",
	diagnostics: SystemComponentManifestDiagnostic[],
	context: string,
) => {
	if (!isValidSystemComponentTemplatePath(pathValue)) {
		pushDiagnostic(diagnostics, {
			code: "INVALID_TEMPLATE_PATH",
			severity: "error",
			componentId,
			path: pathValue,
			message: `Component "${componentId}" ${context} path "${pathValue}" must be a non-empty stable identifier without slashes.`,
		});
		return;
	}

	if (!templatePaths.has(pathValue)) {
		pushDiagnostic(diagnostics, {
			code,
			severity: "error",
			componentId,
			path: pathValue,
			message: `Component "${componentId}" ${context} path "${pathValue}" does not exist in the template.`,
		});
	}
};

const validateSlots = (
	componentId: string,
	slots: Record<string, SystemComponentSlotDefinition> | undefined,
	templatePaths: Set<string>,
	versionIds: Set<string>,
	diagnostics: SystemComponentManifestDiagnostic[],
) => {
	const slotNameCounts = new Map<string, number>();
	for (const [slotKey, slot] of Object.entries(slots ?? {})) {
		slotNameCounts.set(slot.name, (slotNameCounts.get(slot.name) ?? 0) + 1);
		if (slotKey !== slot.name) {
			pushDiagnostic(diagnostics, {
				code: "INVALID_SLOT_DEFINITION",
				severity: "error",
				componentId,
				path: slot.hostPath,
				message: `Component "${componentId}" slot key "${slotKey}" must match stable slot name "${slot.name}".`,
			});
		}
	}

	for (const [slotName, count] of slotNameCounts.entries()) {
		if (count > 1) {
			pushDiagnostic(diagnostics, {
				code: "INVALID_SLOT_DEFINITION",
				severity: "error",
				componentId,
				message: `Component "${componentId}" slot name "${slotName}" is duplicated ${count} times.`,
			});
		}
	}

	for (const slot of Object.values(slots ?? {})) {
		validatePathsExist(
			componentId,
			templatePaths,
			slot.hostPath,
			"INVALID_SLOT_HOST_PATH",
			diagnostics,
			`slot "${slot.name}" host`,
		);

		for (const historyEntry of slot.history ?? []) {
			if (!versionIds.has(historyEntry.fromVersion)) {
				pushDiagnostic(diagnostics, {
					code: "INVALID_MIGRATION_HINT_REFERENCE",
					severity: "error",
					componentId,
					path: slot.hostPath,
					message: `Component "${componentId}" slot "${slot.name}" history references unknown version "${historyEntry.fromVersion}".`,
				});
			}
			if (
				historyEntry.previousHostPath !== undefined &&
				!isValidSystemComponentTemplatePath(historyEntry.previousHostPath)
			) {
				pushDiagnostic(diagnostics, {
					code: "INVALID_MIGRATION_HINT_REFERENCE",
					severity: "error",
					componentId,
					path: historyEntry.previousHostPath,
					message: `Component "${componentId}" slot "${slot.name}" history previousHostPath "${historyEntry.previousHostPath}" is invalid.`,
				});
			}
		}
	}
};

const validateOverrideTargets = (
	componentId: string,
	overrideTargets: Record<string, SystemComponentOverrideTarget> | undefined,
	templatePaths: Set<string>,
	versionIds: Set<string>,
	diagnostics: SystemComponentManifestDiagnostic[],
) => {
	const targetIds = new Map<string, string>();
	for (const [targetKey, target] of Object.entries(overrideTargets ?? {})) {
		if (targetKey !== target.targetId) {
			pushDiagnostic(diagnostics, {
				code: "INVALID_OVERRIDE_TARGET_ID",
				severity: "error",
				componentId,
				path: target.path,
				message: `Component "${componentId}" override target key "${targetKey}" must match targetId "${target.targetId}".`,
			});
		}
		if (targetIds.has(target.targetId)) {
			pushDiagnostic(diagnostics, {
				code: "INVALID_OVERRIDE_TARGET_ID",
				severity: "error",
				componentId,
				path: target.path,
				message: `Component "${componentId}" override target id "${target.targetId}" is duplicated.`,
			});
		}
		targetIds.set(target.targetId, target.path);

		validatePathsExist(
			componentId,
			templatePaths,
			target.path,
			"INVALID_OVERRIDE_TARGET_PATH",
			diagnostics,
			`override target "${target.targetId}"`,
		);

		const capabilities = target.capabilities ?? ["className"];
		if (capabilities.length === 0) {
			pushDiagnostic(diagnostics, {
				code: "INVALID_OVERRIDE_TARGET_CAPABILITY",
				severity: "error",
				componentId,
				path: target.path,
				message: `Component "${componentId}" override target "${target.targetId}" must declare at least one capability.`,
			});
		}
		for (const capability of capabilities) {
			if (!isSystemComponentOverrideCapability(capability)) {
				pushDiagnostic(diagnostics, {
					code: "INVALID_OVERRIDE_TARGET_CAPABILITY",
					severity: "error",
					componentId,
					path: target.path,
					message: `Component "${componentId}" override target "${target.targetId}" has unknown capability "${capability}".`,
				});
			}
		}

		for (const historyEntry of target.history ?? []) {
			if (!versionIds.has(historyEntry.fromVersion)) {
				pushDiagnostic(diagnostics, {
					code: "INVALID_MIGRATION_HINT_REFERENCE",
					severity: "error",
					componentId,
					path: target.path,
					message: `Component "${componentId}" override target "${target.targetId}" history references unknown version "${historyEntry.fromVersion}".`,
				});
			}
			if (
				historyEntry.previousPath !== undefined &&
				!isValidSystemComponentTemplatePath(historyEntry.previousPath)
			) {
				pushDiagnostic(diagnostics, {
					code: "INVALID_MIGRATION_HINT_REFERENCE",
					severity: "error",
					componentId,
					path: historyEntry.previousPath,
					message: `Component "${componentId}" override target "${target.targetId}" history previousPath "${historyEntry.previousPath}" is invalid.`,
				});
			}
		}
	}
};

const validateVariantSchema = (
	componentId: string,
	variants: SystemComponentVariantSchema | undefined,
	templatePaths: Set<string>,
	diagnostics: SystemComponentManifestDiagnostic[],
) => {
	const axes = variants?.axes ?? {};
	const compoundVariants = variants?.compoundVariants ?? [];
	const duplicateSignatures = new Set(
		findDuplicateCompoundWhenSignatures(compoundVariants),
	);

	for (const [axisKey, axis] of Object.entries(axes)) {
		if (
			axis.defaultValue !== undefined &&
			!Object.hasOwn(axis.values, axis.defaultValue)
		) {
			pushDiagnostic(diagnostics, {
				code: "INVALID_VARIANT_DEFAULT_VALUE",
				severity: "error",
				componentId,
				path: axisKey,
				message: `Component "${componentId}" variant axis "${axisKey}" defaultValue "${axis.defaultValue}" does not exist in that axis values map.`,
			});
		}

		for (const value of Object.values(axis.values)) {
			for (const pathValue of Object.keys(value.classesByPath ?? {})) {
				validatePathsExist(
					componentId,
					templatePaths,
					pathValue,
					"INVALID_VARIANT_CLASS_TARGET_PATH",
					diagnostics,
					`variant class target`,
				);
			}
		}
	}

	for (const [axisKey, defaultValue] of Object.entries(
		variants?.defaultValues ?? {},
	)) {
		const axis = axes[axisKey];
		if (!axis) {
			pushDiagnostic(diagnostics, {
				code: "INVALID_VARIANT_DEFAULT_VALUE",
				severity: "error",
				componentId,
				path: axisKey,
				message: `Component "${componentId}" variants.defaultValues references unknown axis "${axisKey}".`,
			});
			continue;
		}
		if (!Object.hasOwn(axis.values, defaultValue)) {
			pushDiagnostic(diagnostics, {
				code: "INVALID_VARIANT_DEFAULT_VALUE",
				severity: "error",
				componentId,
				path: axisKey,
				message: `Component "${componentId}" variants.defaultValues for axis "${axisKey}" references unknown value "${defaultValue}".`,
			});
		}
	}

	for (const [compoundIndex, compoundVariant] of compoundVariants.entries()) {
		const compoundLabel = `compound variant ${compoundIndex + 1}`;
		const signature = compoundWhenSignature(compoundVariant.when);
		const classification = classifyCompoundWhenShape(compoundVariant.when, axes);

		for (const reason of classification.reasons) {
			const codeByReason = {
				empty_when: "COMPOUND_EMPTY_WHEN",
				array_value: "COMPOUND_ARRAY_VALUE",
				insufficient_conditions: "COMPOUND_INSUFFICIENT_CONDITIONS",
				unknown_axis: "COMPOUND_UNKNOWN_AXIS",
				unknown_value: "COMPOUND_UNKNOWN_VALUE",
			} as const;
			pushDiagnostic(diagnostics, {
				code: codeByReason[reason],
				severity: "warning",
				componentId,
				message: `Component "${componentId}" ${compoundLabel} has an advanced compound \`when\` shape (${reason.replaceAll("_", " ")}).`,
			});
		}

		if (duplicateSignatures.has(signature)) {
			pushDiagnostic(diagnostics, {
				code: "COMPOUND_DUPLICATE_SIGNATURE",
				severity: "warning",
				componentId,
				message: `Component "${componentId}" ${compoundLabel} shares a normalized \`when\` signature with another compound variant.`,
			});
		}

		if (Object.keys(compoundVariant.classesByPath).length === 0) {
			pushDiagnostic(diagnostics, {
				code: "COMPOUND_EMPTY_CLASSES_BY_PATH",
				severity: "warning",
				componentId,
				message: `Component "${componentId}" ${compoundLabel} has no classesByPath entries.`,
			});
		}

		for (const pathValue of Object.keys(compoundVariant.classesByPath)) {
			validatePathsExist(
				componentId,
				templatePaths,
				pathValue,
				"INVALID_VARIANT_CLASS_TARGET_PATH",
				diagnostics,
				`compound variant class target`,
			);
		}
	}
};

const validateMigrationHints = (
	componentId: string,
	hints: SystemComponentMigrationHints | undefined,
	templatePaths: Set<string>,
	_versionIds: Set<string>,
	axisIds: Set<string>,
	slotNames: Set<string>,
	targetIds: Set<string>,
	diagnostics: SystemComponentManifestDiagnostic[],
) => {
	for (const hint of hints?.variantAxes ?? []) {
		if (!axisIds.has(hint.fromAxis)) {
			pushDiagnostic(diagnostics, {
				code: "INVALID_MIGRATION_HINT_REFERENCE",
				severity: "error",
				componentId,
				message: `Component "${componentId}" migration hint references unknown variant axis "${hint.fromAxis}".`,
			});
		}
		if (hint.toAxis !== undefined && !axisIds.has(hint.toAxis)) {
			pushDiagnostic(diagnostics, {
				code: "INVALID_MIGRATION_HINT_REFERENCE",
				severity: "error",
				componentId,
				message: `Component "${componentId}" migration hint references unknown variant axis "${hint.toAxis}".`,
			});
		}
	}

	for (const hint of hints?.slots ?? []) {
		if (!slotNames.has(hint.fromName)) {
			pushDiagnostic(diagnostics, {
				code: "INVALID_MIGRATION_HINT_REFERENCE",
				severity: "error",
				componentId,
				message: `Component "${componentId}" migration hint references unknown slot "${hint.fromName}".`,
			});
		}
		if (hint.toName !== undefined && !slotNames.has(hint.toName)) {
			pushDiagnostic(diagnostics, {
				code: "INVALID_MIGRATION_HINT_REFERENCE",
				severity: "error",
				componentId,
				message: `Component "${componentId}" migration hint references unknown slot "${hint.toName}".`,
			});
		}
		for (const mapping of hint.hostPathMappings ?? []) {
			if (!isValidSystemComponentTemplatePath(mapping.fromPath)) {
				pushDiagnostic(diagnostics, {
					code: "INVALID_MIGRATION_HINT_REFERENCE",
					severity: "error",
					componentId,
					path: mapping.fromPath,
					message: `Component "${componentId}" slot migration hint fromPath "${mapping.fromPath}" is invalid.`,
				});
			}
			if (mapping.toPath !== undefined && !templatePaths.has(mapping.toPath)) {
				pushDiagnostic(diagnostics, {
					code: "INVALID_MIGRATION_HINT_REFERENCE",
					severity: "error",
					componentId,
					path: mapping.toPath,
					message: `Component "${componentId}" slot migration hint toPath "${mapping.toPath}" does not exist in the template.`,
				});
			}
		}
	}

	for (const hint of hints?.overrideTargets ?? []) {
		if (!targetIds.has(hint.fromTargetId)) {
			pushDiagnostic(diagnostics, {
				code: "INVALID_MIGRATION_HINT_REFERENCE",
				severity: "error",
				componentId,
				message: `Component "${componentId}" migration hint references unknown override target "${hint.fromTargetId}".`,
			});
		}
		if (hint.toTargetId !== undefined && !targetIds.has(hint.toTargetId)) {
			pushDiagnostic(diagnostics, {
				code: "INVALID_MIGRATION_HINT_REFERENCE",
				severity: "error",
				componentId,
				message: `Component "${componentId}" migration hint references unknown override target "${hint.toTargetId}".`,
			});
		}
		for (const mapping of hint.pathMappings ?? []) {
			if (!isValidSystemComponentTemplatePath(mapping.fromPath)) {
				pushDiagnostic(diagnostics, {
					code: "INVALID_MIGRATION_HINT_REFERENCE",
					severity: "error",
					componentId,
					path: mapping.fromPath,
					message: `Component "${componentId}" override migration hint fromPath "${mapping.fromPath}" is invalid.`,
				});
			}
			if (mapping.toPath !== undefined && !templatePaths.has(mapping.toPath)) {
				pushDiagnostic(diagnostics, {
					code: "INVALID_MIGRATION_HINT_REFERENCE",
					severity: "error",
					componentId,
					path: mapping.toPath,
					message: `Component "${componentId}" override migration hint toPath "${mapping.toPath}" does not exist in the template.`,
				});
			}
		}
	}
};

const validatePublishedVersionShape = (
	componentId: string,
	version: PublishedSystemComponentVersion,
	diagnostics: SystemComponentManifestDiagnostic[],
	verifyHashes: boolean,
) => {
	const requiredFields: Array<keyof PublishedSystemComponentVersion> = [
		"version",
		"publishedAt",
		"templateHash",
		"variantSchemaHash",
		"root",
	];
	for (const field of requiredFields) {
		if (version[field] === undefined || version[field] === null) {
			pushDiagnostic(diagnostics, {
				code: "INVALID_PUBLISHED_VERSION_SHAPE",
				severity: "error",
				componentId,
				message: `Component "${componentId}" published version "${version.version}" is missing required field "${field}".`,
			});
		}
	}

	if (!verifyHashes) {
		return;
	}

	const expectedTemplateHash = hashSystemComponentTemplate(version);
	if (expectedTemplateHash !== version.templateHash) {
		pushDiagnostic(diagnostics, {
			code: "MISMATCHED_PUBLISHED_HASH",
			severity: "error",
			componentId,
			message: `Component "${componentId}" published version "${version.version}" templateHash does not match the template content.`,
		});
	}

	const expectedVariantHash = hashSystemComponentVariantSchema(
		version.variants,
	);
	if (expectedVariantHash !== version.variantSchemaHash) {
		pushDiagnostic(diagnostics, {
			code: "MISMATCHED_PUBLISHED_HASH",
			severity: "error",
			componentId,
			message: `Component "${componentId}" published version "${version.version}" variantSchemaHash does not match the variant schema.`,
		});
	}
};

const validateDraftOrPublishedPayload = (
	componentId: string,
	payload: SystemComponentDraftPayload,
	versionIds: Set<string>,
	diagnostics: SystemComponentManifestDiagnostic[],
	options: {
		verifyPublishedHashes?: boolean;
		publishedVersion?: PublishedSystemComponentVersion;
	} = {},
) => {
	const templatePaths = validateTemplatePaths(
		componentId,
		payload.root,
		diagnostics,
	);
	validateSlots(
		componentId,
		payload.slots,
		templatePaths,
		versionIds,
		diagnostics,
	);
	validateOverrideTargets(
		componentId,
		payload.overrideTargets,
		templatePaths,
		versionIds,
		diagnostics,
	);
	validateVariantSchema(
		componentId,
		payload.variants,
		templatePaths,
		diagnostics,
	);

	if (options.publishedVersion) {
		validatePublishedVersionShape(
			componentId,
			options.publishedVersion,
			diagnostics,
			options.verifyPublishedHashes ?? false,
		);
		validateMigrationHints(
			componentId,
			options.publishedVersion.migrationHints,
			templatePaths,
			versionIds,
			new Set(Object.keys(payload.variants?.axes ?? {})),
			new Set(Object.values(payload.slots ?? {}).map((slot) => slot.name)),
			new Set(
				Object.values(payload.overrideTargets ?? {}).map(
					(target) => target.targetId,
				),
			),
			diagnostics,
		);
	}
};

const validateComponentRecord = (
	record: SystemComponentRecord,
	diagnostics: SystemComponentManifestDiagnostic[],
	options?: { verifyPublishedHashes?: boolean },
) => {
	const componentId = record.componentId;

	if (!isSystemComponentId(componentId)) {
		pushDiagnostic(diagnostics, {
			code: "INVALID_COMPONENT_ID",
			severity: "error",
			componentId,
			message: `Component id "${componentId}" must be a stable opaque id with prefix "${SYSTEM_COMPONENT_ID_PREFIX}".`,
		});
	}

	if (!isSystemComponentSlug(record.slug)) {
		pushDiagnostic(diagnostics, {
			code: "INVALID_COMPONENT_SLUG",
			severity: "error",
			componentId,
			message: `Component "${componentId}" slug "${record.slug}" must be a unique lowercase identifier without slashes.`,
		});
	}

	const versionIds = new Set(Object.keys(record.published?.versions ?? {}));

	if (record.draft) {
		validateDraftOrPublishedPayload(
			componentId,
			record.draft,
			versionIds,
			diagnostics,
		);
	}

	if (record.published) {
		if (!versionIds.has(record.published.currentVersion)) {
			pushDiagnostic(diagnostics, {
				code: "INVALID_CURRENT_VERSION",
				severity: "error",
				componentId,
				message: `Component "${componentId}" currentVersion "${record.published.currentVersion}" does not exist in published versions.`,
			});
		}

		for (const publishedVersion of Object.values(record.published.versions)) {
			if (publishedVersion.version !== publishedVersion.version.trim()) {
				pushDiagnostic(diagnostics, {
					code: "INVALID_PUBLISHED_VERSION_SHAPE",
					severity: "error",
					componentId,
					message: `Component "${componentId}" published version id must be a non-empty string.`,
				});
			}

			if (
				publishedVersion.previousVersion !== undefined &&
				!versionIds.has(publishedVersion.previousVersion)
			) {
				pushDiagnostic(diagnostics, {
					code: "INVALID_MIGRATION_HINT_REFERENCE",
					severity: "error",
					componentId,
					message: `Component "${componentId}" published version "${publishedVersion.version}" references unknown previousVersion "${publishedVersion.previousVersion}".`,
				});
			}

			validateDraftOrPublishedPayload(
				componentId,
				publishedVersion,
				versionIds,
				diagnostics,
				{
					verifyPublishedHashes: options?.verifyPublishedHashes,
					publishedVersion,
				},
			);
		}
	}
};

export function validateSystemComponentManifest(
	manifest: SystemComponentManifest,
	options?: { verifyPublishedHashes?: boolean },
): SystemComponentManifestValidationResult {
	const diagnostics: SystemComponentManifestDiagnostic[] = [];

	try {
		assertComponentIdKeyInvariant(manifest.components);
	} catch (error) {
		if (error instanceof SystemComponentManifestError) {
			pushDiagnostic(diagnostics, {
				code: "INVALID_COMPONENT_ID",
				severity: "error",
				message: error.message,
			});
		} else {
			throw error;
		}
	}

	const slugsByComponent = new Map<string, string[]>();
	for (const record of Object.values(manifest.components)) {
		const existing = slugsByComponent.get(record.slug) ?? [];
		existing.push(record.componentId);
		slugsByComponent.set(record.slug, existing);
	}

	for (const [slug, componentIds] of slugsByComponent.entries()) {
		if (componentIds.length > 1) {
			pushDiagnostic(diagnostics, {
				code: "DUPLICATE_COMPONENT_SLUG",
				severity: "error",
				message: `Component slug "${slug}" is used by ${componentIds.join(", ")}.`,
			});
		}
	}

	for (const record of Object.values(manifest.components)) {
		validateComponentRecord(record, diagnostics, options);
	}

	diagnostics.sort(compareDiagnostics);

	return {
		valid: diagnostics.every((entry) => entry.severity !== "error"),
		diagnostics,
	};
}

export function assertValidSystemComponentManifest(
	manifest: SystemComponentManifest,
	options?: { verifyPublishedHashes?: boolean },
): void {
	const result = validateSystemComponentManifest(manifest, options);
	if (result.valid) {
		return;
	}

	const messages = result.diagnostics
		.filter((entry) => entry.severity === "error")
		.map((entry) => entry.message)
		.join(" ");

	throw new SystemComponentManifestError(
		"INVALID_COMPONENT_MANIFEST",
		messages,
	);
}
