import {
	getDefaultProps,
	getDefaultText,
	isRegistryId,
	resolveRegistryComponent,
} from "../libraries/registry";
import type { Node, Props, RecipeTemplateNode } from "../types";
import {
	expandResolvedSystemComponent,
	type ResolvedPublishedSystemComponent,
} from "./system-component-expansion.core";
import {
	getSystemComponentMarkerProps,
	getSystemComponentStructuralMetadata,
	type SystemComponentInstanceOverrides,
} from "./system-component-markers";
import {
	resolveMaterializedSystemComponentClassComposition,
	resolveSystemComponentVariantValues,
} from "./system-component-resolution";
import type {
	PublishedSystemComponentVersion,
	SystemComponentOverrideTarget,
	SystemComponentMigrationHints,
	SystemComponentRecord,
	SystemComponentSlotDefinition,
	SystemComponentVariantAxis,
	SystemComponentVariantMigrationHint,
} from "./system-components";

export type SystemComponentMigrationDiagnosticCode =
	| "VARIANT_AXIS_DROPPED"
	| "VARIANT_VALUE_DEFAULTED"
	| "OVERRIDE_DROPPED"
	| "SLOT_CONTENT_DROPPED"
	| "SLOT_MAPPING_CONFLICT"
	| "OVERRIDE_MAPPING_CONFLICT"
	| "DROPPED_SLOT"
	| "DROPPED_VARIANT_VALUE"
	| "DROPPED_OVERRIDE_TARGET"
	| "MISSING_HISTORY"
	| "HASH_MISMATCH";

export type SystemComponentMigrationDiagnostic = {
	code: SystemComponentMigrationDiagnosticCode;
	severity: "info" | "warning" | "review";
	message: string;
	componentId?: string;
	fromVersion?: string;
	toVersion?: string;
	instanceId?: string;
	axisKey?: string;
	targetId?: string;
	slotName?: string;
	fromValue?: string;
	toValue?: string;
	variantAxis?: string;
	variantValue?: string;
	overrideTargetId?: string;
	expectedHash?: string;
	actualHash?: string | null;
	hashKind?: "template" | "variant-schema";
};

export type SystemComponentMigrationSafety = "safe" | "requires-review";

export type SystemComponentMigrationClassification = {
	safety: SystemComponentMigrationSafety;
	automatic: boolean;
	diagnostics: SystemComponentMigrationDiagnostic[];
};

export type ClassifySystemComponentMigrationInput = {
	componentId: string;
	fromVersion: PublishedSystemComponentVersion;
	toVersion: PublishedSystemComponentVersion;
	instanceId?: string;
	templateHash?: string | null;
	variantSchemaHash?: string | null;
	variantValues?: Record<string, string>;
	overrides?: Record<string, unknown>;
};

export type SystemComponentMigrationPathMapping = {
	fromPath: string;
	toPath: string;
	elementId: string;
	mappingSource: "direct" | "slot" | "history" | "hint";
};

export type SystemComponentMigrationSlotMapping = {
	slotName: string;
	fromHostPath: string;
	toHostPath: string;
	preservedChildIds: string[];
	mappingSource: "name" | "history" | "host-path" | "hint";
};

export type SystemComponentMigrationVariantMapping = {
	axisKey: string;
	fromValue?: string;
	toValue: string;
	mappingSource: "direct" | "hint" | "default";
};

export type SystemComponentMigrationOverrideMapping = {
	fromTargetId: string;
	toTargetId?: string;
	className?: string;
	mappingSource: "direct" | "history" | "hint" | "dropped";
};

export type SystemComponentMigrationMetadata = {
	systemId: string;
	componentId: string;
	instanceId: string;
	rootElementId: string;
	fromVersion: string;
	toVersion: string;
	fromTemplateHash: string;
	toTemplateHash: string;
	preservedPaths: SystemComponentMigrationPathMapping[];
	remappedPaths: SystemComponentMigrationPathMapping[];
	addedPaths: SystemComponentMigrationPathMapping[];
	removedPaths: string[];
	preservedSlots: SystemComponentMigrationSlotMapping[];
	droppedSlots: Array<{ slotName: string; fromHostPath: string; childIds: string[] }>;
	variantMappings: SystemComponentMigrationVariantMapping[];
	overrideMappings: SystemComponentMigrationOverrideMapping[];
	diagnostics: SystemComponentMigrationDiagnostic[];
};

export type SystemComponentMigrationResult = {
	roots: Node[];
	changedElementId: string;
	metadata: SystemComponentMigrationMetadata;
};

export class SystemComponentMigrationError extends Error {
	readonly code:
		| "ELEMENT_NOT_FOUND"
		| "INSTANCE_NOT_FOUND"
		| "INSTANCE_MISMATCH"
		| "MIGRATION_UNSAFE";

	constructor(code: SystemComponentMigrationError["code"], message: string) {
		super(message);
		this.name = "SystemComponentMigrationError";
		this.code = code;
	}
}

type NodeReference = {
	node: Node;
	metadata: NonNullable<ReturnType<typeof getSystemComponentStructuralMetadata>>;
};

export type MigrateSystemComponentInstanceInput = {
	systemId: string;
	componentId: string;
	sourceVersion: PublishedSystemComponentVersion;
	targetVersion: PublishedSystemComponentVersion;
	migrationHints?: SystemComponentMigrationHints;
};

const getTemplateNodesByPath = (root: RecipeTemplateNode) => {
	const nodes = new Map<string, RecipeTemplateNode>();
	const visit = (template: RecipeTemplateNode) => {
		nodes.set(template.path, template);
		for (const child of template.children ?? []) {
			visit(child);
		}
	};
	visit(root);
	return nodes;
};

const getTemplateSlotName = (
	version: PublishedSystemComponentVersion,
	template: RecipeTemplateNode,
) =>
	template.slot ??
	Object.values(version.slots ?? {}).find(
		(slot) => slot.hostPath === template.path,
	)?.name ??
	null;

const getSlotDefinition = (
	version: PublishedSystemComponentVersion,
	slotName: string,
): SystemComponentSlotDefinition | null =>
	version.slots?.[slotName] ??
	Object.values(version.slots ?? {}).find((slot) => slot.name === slotName) ??
	null;

const hasSlotHistoryFrom = (
	slot: SystemComponentSlotDefinition,
	fromVersion: string,
	fromSlot: SystemComponentSlotDefinition,
) =>
	(slot.history ?? []).some(
		(entry) =>
			entry.fromVersion === fromVersion &&
			(entry.previousName === fromSlot.name ||
				entry.previousHostPath === fromSlot.hostPath),
	);

const findVariantAxisHint = (
	hints: readonly SystemComponentVariantMigrationHint[] | undefined,
	fromAxis: string,
) => hints?.find((hint) => hint.fromAxis === fromAxis);

const axisHasValue = (
	axis: SystemComponentVariantAxis | undefined,
	value: string,
) => Boolean(axis?.values[value]);

const getVariantAxisHintTargetAxis = (
	hint: SystemComponentVariantMigrationHint | undefined,
	fallbackAxis: string,
) => hint?.toAxis ?? fallbackAxis;

const getMappedVariantValue = (
	hint: SystemComponentVariantMigrationHint | undefined,
	fromValue: string,
	toVariantAxes: Record<string, SystemComponentVariantAxis>,
) => {
	const mapping = hint?.valueMappings?.find(
		(entry) => entry.fromValue === fromValue,
	);
	if (!mapping?.toValue) {
		return null;
	}
	const targetAxis = getVariantAxisHintTargetAxis(hint, hint.fromAxis);
	return axisHasValue(toVariantAxes[targetAxis], mapping.toValue)
		? mapping.toValue
		: null;
};

const findRemappedSlot = (
	fromSlot: SystemComponentSlotDefinition,
	toSlots: readonly SystemComponentSlotDefinition[],
	fromVersion: string,
	hints: SystemComponentMigrationHints | undefined,
) => {
	const sameName = toSlots.find((slot) => slot.name === fromSlot.name);
	if (sameName) {
		return sameName;
	}
	const historyMatch = toSlots.find((slot) =>
		hasSlotHistoryFrom(slot, fromVersion, fromSlot),
	);
	if (historyMatch) {
		return historyMatch;
	}
	const hint = hints?.slots?.find((entry) => entry.fromName === fromSlot.name);
	if (hint) {
		const hintedSlot = toSlots.find(
			(slot) => slot.name === (hint.toName ?? hint.fromName),
		);
		if (hintedSlot) {
			return hintedSlot;
		}
		for (const mapping of hint.hostPathMappings ?? []) {
			if (
				mapping.fromPath === fromSlot.hostPath &&
				mapping.toPath !== undefined
			) {
				const hostPathMatch = toSlots.find(
					(slot) => slot.hostPath === mapping.toPath,
				);
				if (hostPathMatch) {
					return hostPathMatch;
				}
			}
		}
	}
	return (
		toSlots.find((slot) => slot.hostPath === fromSlot.hostPath) ?? null
	);
};

const findRemappedOverrideTargetId = (
	sourceTargetId: string,
	sourceVersion: PublishedSystemComponentVersion,
	targetVersion: PublishedSystemComponentVersion,
	hints: SystemComponentMigrationHints | undefined,
): {
	targetId: string;
	mappingSource: SystemComponentMigrationOverrideMapping["mappingSource"];
} | null => {
	const targetTargets = targetVersion.overrideTargets ?? {};
	if (Object.hasOwn(targetTargets, sourceTargetId)) {
		return { targetId: sourceTargetId, mappingSource: "direct" };
	}

	const sourceTarget = sourceVersion.overrideTargets?.[sourceTargetId];
	for (const [candidateId, target] of Object.entries(targetTargets)) {
		const historyMatch = target.history?.some(
			(entry) =>
				entry.fromVersion === sourceVersion.version &&
				(entry.previousTargetId === sourceTargetId ||
					(sourceTarget !== undefined &&
						entry.previousPath === sourceTarget.path)),
		);
		if (historyMatch) {
			return { targetId: candidateId, mappingSource: "history" };
		}
	}

	const hint = hints?.overrideTargets?.find(
		(entry) => entry.fromTargetId === sourceTargetId,
	);
	if (hint?.toTargetId && Object.hasOwn(targetTargets, hint.toTargetId)) {
		return { targetId: hint.toTargetId, mappingSource: "hint" };
	}

	if (sourceTarget) {
		for (const mapping of hint?.pathMappings ?? []) {
			if (
				mapping.fromPath === sourceTarget.path &&
				mapping.toPath !== undefined
			) {
				const targetByPath = Object.entries(targetTargets).find(
					([, target]) => target.path === mapping.toPath,
				);
				if (targetByPath) {
					return { targetId: targetByPath[0], mappingSource: "hint" };
				}
			}
		}
	}

	return null;
};

const reviewMigrationDiagnostic = (
	diagnostic: Omit<SystemComponentMigrationDiagnostic, "severity">,
): SystemComponentMigrationDiagnostic => ({
	...diagnostic,
	severity: "review",
});

const appendMigrationHashMismatchDiagnostics = (
	input: ClassifySystemComponentMigrationInput,
	diagnostics: SystemComponentMigrationDiagnostic[],
) => {
	if (
		input.templateHash !== undefined &&
		input.templateHash !== input.fromVersion.templateHash
	) {
		diagnostics.push(
			reviewMigrationDiagnostic({
				code: "HASH_MISMATCH",
				message: `Attached instance template hash does not match published version "${input.fromVersion.version}".`,
				componentId: input.componentId,
				fromVersion: input.fromVersion.version,
				toVersion: input.toVersion.version,
				instanceId: input.instanceId,
				expectedHash: input.fromVersion.templateHash,
				actualHash: input.templateHash,
				hashKind: "template",
			}),
		);
	}

	if (
		input.variantSchemaHash !== undefined &&
		input.variantSchemaHash !== input.fromVersion.variantSchemaHash
	) {
		diagnostics.push(
			reviewMigrationDiagnostic({
				code: "HASH_MISMATCH",
				message: `Attached instance variant schema hash does not match published version "${input.fromVersion.version}".`,
				componentId: input.componentId,
				fromVersion: input.fromVersion.version,
				toVersion: input.toVersion.version,
				instanceId: input.instanceId,
				expectedHash: input.fromVersion.variantSchemaHash,
				actualHash: input.variantSchemaHash,
				hashKind: "variant-schema",
			}),
		);
	}
};

export const classifySystemComponentMigration = (
	input: ClassifySystemComponentMigrationInput,
): SystemComponentMigrationClassification => {
	const diagnostics: SystemComponentMigrationDiagnostic[] = [];
	const fromSlots = Object.values(input.fromVersion.slots ?? {});
	const toSlots = Object.values(input.toVersion.slots ?? {});
	const fromTargets = Object.values(input.fromVersion.overrideTargets ?? {});
	const toVariantAxes = input.toVersion.variants?.axes ?? {};
	const migrationHints = input.toVersion.migrationHints;
	const variantHints = migrationHints?.variantAxes;
	const fromTargetIds = new Set(
		Object.keys(input.fromVersion.overrideTargets ?? {}),
	);

	appendMigrationHashMismatchDiagnostics(input, diagnostics);

	if (
		input.fromVersion.version !== input.toVersion.version &&
		input.toVersion.previousVersion !== input.fromVersion.version
	) {
		diagnostics.push(
			reviewMigrationDiagnostic({
				code: "MISSING_HISTORY",
				message: `Published version "${input.toVersion.version}" does not declare "${input.fromVersion.version}" as its previous version.`,
				componentId: input.componentId,
				fromVersion: input.fromVersion.version,
				toVersion: input.toVersion.version,
				instanceId: input.instanceId,
			}),
		);
	}

	for (const conflict of collectSlotMappingConflicts(
		input.fromVersion,
		input.toVersion,
		migrationHints,
	)) {
		diagnostics.push(
			reviewMigrationDiagnostic({
				code: "SLOT_MAPPING_CONFLICT",
				message: `Slots ${conflict.sourceSlotNames.map((name) => `"${name}"`).join(", ")} from version "${input.fromVersion.version}" map to the same target host path "${conflict.targetHostPath}" in version "${input.toVersion.version}". Authored slot content may be dropped.`,
				componentId: input.componentId,
				fromVersion: input.fromVersion.version,
				toVersion: input.toVersion.version,
				instanceId: input.instanceId,
				slotName: conflict.sourceSlotNames[0],
			}),
		);
	}

	for (const conflict of collectOverrideMappingConflicts(
		input.fromVersion,
		input.toVersion,
		migrationHints,
	)) {
		diagnostics.push(
			reviewMigrationDiagnostic({
				code: "OVERRIDE_MAPPING_CONFLICT",
				message: `Override targets ${conflict.sourceTargetIds.map((id) => `"${id}"`).join(", ")} from version "${input.fromVersion.version}" map to the same target "${conflict.targetId}" in version "${input.toVersion.version}". Authored overrides may be dropped.`,
				componentId: input.componentId,
				fromVersion: input.fromVersion.version,
				toVersion: input.toVersion.version,
				instanceId: input.instanceId,
				overrideTargetId: conflict.sourceTargetIds[0],
				targetId: conflict.targetId,
			}),
		);
	}

	for (const fromSlot of fromSlots) {
		if (
			findRemappedSlot(
				fromSlot,
				toSlots,
				input.fromVersion.version,
				migrationHints,
			)
		) {
			continue;
		}
		diagnostics.push(
			reviewMigrationDiagnostic({
				code: "DROPPED_SLOT",
				message: `Slot "${fromSlot.name}" from version "${input.fromVersion.version}" is not present or mapped in version "${input.toVersion.version}". Authored children may be dropped.`,
				componentId: input.componentId,
				fromVersion: input.fromVersion.version,
				toVersion: input.toVersion.version,
				instanceId: input.instanceId,
				slotName: fromSlot.name,
			}),
		);
	}

	for (const [axisName, value] of Object.entries(input.variantValues ?? {})) {
		if (axisHasValue(toVariantAxes[axisName], value)) {
			continue;
		}
		const hint = findVariantAxisHint(variantHints, axisName);
		const toAxis = getVariantAxisHintTargetAxis(hint, axisName);
		if (
			axisHasValue(toVariantAxes[toAxis], value) ||
			getMappedVariantValue(hint, value, toVariantAxes) !== null
		) {
			continue;
		}
		diagnostics.push(
			reviewMigrationDiagnostic({
				code: "DROPPED_VARIANT_VALUE",
				message: `Variant value "${axisName}.${value}" from version "${input.fromVersion.version}" is not present or mapped in version "${input.toVersion.version}".`,
				componentId: input.componentId,
				fromVersion: input.fromVersion.version,
				toVersion: input.toVersion.version,
				instanceId: input.instanceId,
				variantAxis: axisName,
				variantValue: value,
			}),
		);
	}

	for (const [overrideTargetId] of Object.entries(input.overrides ?? {})) {
		if (!fromTargetIds.has(overrideTargetId)) {
			diagnostics.push(
				reviewMigrationDiagnostic({
					code: "DROPPED_OVERRIDE_TARGET",
					message: `Override target "${overrideTargetId}" is present on the instance but not declared in version "${input.fromVersion.version}". Authored overrides may be dropped.`,
					componentId: input.componentId,
					fromVersion: input.fromVersion.version,
					toVersion: input.toVersion.version,
					instanceId: input.instanceId,
					overrideTargetId,
					targetId: overrideTargetId,
				}),
			);
		}
	}

	for (const fromTarget of fromTargets) {
		const hasOverride = Object.hasOwn(input.overrides ?? {}, fromTarget.targetId);
		if (!hasOverride) {
			continue;
		}
		if (
			findRemappedOverrideTargetId(
				fromTarget.targetId,
				input.fromVersion,
				input.toVersion,
				migrationHints,
			)
		) {
			continue;
		}
		diagnostics.push(
			reviewMigrationDiagnostic({
				code: "DROPPED_OVERRIDE_TARGET",
				message: `Override target "${fromTarget.targetId}" from version "${input.fromVersion.version}" is not present or mapped in version "${input.toVersion.version}". Authored overrides may be dropped.`,
				componentId: input.componentId,
				fromVersion: input.fromVersion.version,
				toVersion: input.toVersion.version,
				instanceId: input.instanceId,
				overrideTargetId: fromTarget.targetId,
				targetId: fromTarget.targetId,
			}),
		);
	}

	const safety = diagnostics.some(
		(diagnostic) => diagnostic.severity === "review",
	)
		? "requires-review"
		: "safe";
	return {
		safety,
		automatic: safety === "safe",
		diagnostics,
	};
};

const collectReferences = (roots: readonly Node[]) => {
	const byId = new Map<string, NodeReference>();
	const visit = (node: Node) => {
		const metadata = getSystemComponentStructuralMetadata(node.props);
		if (metadata) {
			byId.set(node.id, { node, metadata });
		}
		if (Array.isArray(node.children)) {
			for (const child of node.children) {
				visit(child);
			}
		}
	};
	for (const root of roots) {
		visit(root);
	}
	return byId;
};

const collectInstanceReferences = (
	roots: readonly Node[],
	instanceId: string,
) =>
	[...collectReferences(roots).values()].filter(
		(reference) => reference.metadata.instanceId === instanceId,
	);

const findTargetMetadata = (roots: readonly Node[], elementId: string) => {
	const reference = collectReferences(roots).get(elementId);
	return reference?.metadata ?? null;
};

const findInstanceRootReference = (
	roots: readonly Node[],
	instanceId: string,
) =>
	collectInstanceReferences(roots, instanceId).find(
		(reference) => reference.metadata.isRoot,
	) ?? null;

const cloneNode = (node: Node): Node => ({
	id: node.id,
	props: { ...node.props },
	children: Array.isArray(node.children)
		? node.children.map(cloneNode)
		: node.children,
});

const replaceNode = (
	roots: readonly Node[],
	elementId: string,
	replacement: Node,
): Node[] =>
	roots.map((root) => {
		if (root.id === elementId) {
			return replacement;
		}
		if (!Array.isArray(root.children)) {
			return cloneNode(root);
		}
		return {
			...root,
			props: { ...root.props },
			children: replaceNode(root.children, elementId, replacement),
		};
	});

const getAuthoredSlotChildren = (node: Node, instanceId: string) =>
	Array.isArray(node.children)
		? node.children.filter(
				(child) =>
					getSystemComponentStructuralMetadata(child.props)?.instanceId !==
					instanceId,
			)
		: [];

const resolveSlotMappingSource = (
	sourceSlot: SystemComponentSlotDefinition,
	targetSlot: SystemComponentSlotDefinition,
	sourceVersion: string,
	hints: SystemComponentMigrationHints | undefined,
): SystemComponentMigrationSlotMapping["mappingSource"] => {
	if (sourceSlot.name === targetSlot.name) {
		return "name";
	}
	const historyMatch = targetSlot.history?.some(
		(entry) =>
			entry.fromVersion === sourceVersion &&
			(entry.previousName === sourceSlot.name ||
				entry.previousHostPath === sourceSlot.hostPath),
	);
	if (historyMatch) {
		return "history";
	}
	const hintMatch = hints?.slots?.some(
		(hint) =>
			hint.fromName === sourceSlot.name &&
			(hint.toName === undefined || hint.toName === targetSlot.name),
	);
	if (hintMatch) {
		return "hint";
	}
	if (sourceSlot.hostPath === targetSlot.hostPath) {
		return "host-path";
	}
	return "name";
};

const getMappedTargetHostPathBySourceHostPath = (
	source: PublishedSystemComponentVersion,
	target: PublishedSystemComponentVersion,
	hints: SystemComponentMigrationHints | undefined,
) => {
	const targetPaths = getTemplateNodesByPath(target.root);
	const map = new Map<string, string>();

	for (const path of getTemplateNodesByPath(source.root).keys()) {
		if (targetPaths.has(path)) {
			map.set(path, path);
		}
	}

	for (const sourceSlot of Object.values(source.slots ?? {})) {
		const targetSlot =
			getSlotDefinition(target, sourceSlot.name) ??
			(() => {
				const hint = hints?.slots?.find(
					(entry) => entry.fromName === sourceSlot.name,
				);
				return hint?.toName
					? getSlotDefinition(target, hint.toName)
					: null;
			})();
		if (targetSlot && targetPaths.has(targetSlot.hostPath)) {
			map.set(sourceSlot.hostPath, targetSlot.hostPath);
		}
	}

	for (const targetSlot of Object.values(target.slots ?? {})) {
		for (const entry of targetSlot.history ?? []) {
			if (entry.fromVersion !== source.version) {
				continue;
			}
			if (entry.previousHostPath) {
				map.set(entry.previousHostPath, targetSlot.hostPath);
			}
			if (entry.previousName) {
				const sourceSlot = getSlotDefinition(source, entry.previousName);
				if (sourceSlot) {
					map.set(sourceSlot.hostPath, targetSlot.hostPath);
				}
			}
		}
	}

	for (const hint of hints?.slots ?? []) {
		const sourceSlot = getSlotDefinition(source, hint.fromName);
		const targetSlot = getSlotDefinition(
			target,
			hint.toName ?? hint.fromName,
		);
		if (sourceSlot && targetSlot) {
			map.set(sourceSlot.hostPath, targetSlot.hostPath);
		}
		for (const mapping of hint.hostPathMappings ?? []) {
			if (mapping.toPath && targetPaths.has(mapping.toPath)) {
				map.set(mapping.fromPath, mapping.toPath);
			}
		}
	}

	return map;
};

const collectSlotMappingConflicts = (
	sourceVersion: PublishedSystemComponentVersion,
	targetVersion: PublishedSystemComponentVersion,
	hints: SystemComponentMigrationHints | undefined,
) => {
	const targetHostPathBySourceHostPath =
		getMappedTargetHostPathBySourceHostPath(
			sourceVersion,
			targetVersion,
			hints,
		);
	const sourceSlotsByTargetHostPath = new Map<string, string[]>();
	for (const sourceSlot of Object.values(sourceVersion.slots ?? {})) {
		const targetHostPath = targetHostPathBySourceHostPath.get(
			sourceSlot.hostPath,
		);
		if (!targetHostPath) {
			continue;
		}
		const sourceSlotNames =
			sourceSlotsByTargetHostPath.get(targetHostPath) ?? [];
		sourceSlotNames.push(sourceSlot.name);
		sourceSlotsByTargetHostPath.set(targetHostPath, sourceSlotNames);
	}

	const conflicts: Array<{
		targetHostPath: string;
		sourceSlotNames: string[];
	}> = [];
	for (const [targetHostPath, sourceSlotNames] of sourceSlotsByTargetHostPath) {
		if (sourceSlotNames.length > 1) {
			conflicts.push({ targetHostPath, sourceSlotNames });
		}
	}
	return conflicts;
};

const collectOverrideMappingConflicts = (
	sourceVersion: PublishedSystemComponentVersion,
	targetVersion: PublishedSystemComponentVersion,
	hints: SystemComponentMigrationHints | undefined,
) => {
	const sourceTargetIdsByRemappedTargetId = new Map<string, string[]>();
	for (const sourceTargetId of Object.keys(
		sourceVersion.overrideTargets ?? {},
	)) {
		const remapped = findRemappedOverrideTargetId(
			sourceTargetId,
			sourceVersion,
			targetVersion,
			hints,
		);
		if (!remapped) {
			continue;
		}
		const sourceTargetIds =
			sourceTargetIdsByRemappedTargetId.get(remapped.targetId) ?? [];
		sourceTargetIds.push(sourceTargetId);
		sourceTargetIdsByRemappedTargetId.set(remapped.targetId, sourceTargetIds);
	}

	const conflicts: Array<{
		targetId: string;
		sourceTargetIds: string[];
	}> = [];
	for (const [targetId, sourceTargetIds] of sourceTargetIdsByRemappedTargetId) {
		if (sourceTargetIds.length > 1) {
			conflicts.push({ targetId, sourceTargetIds });
		}
	}
	return conflicts;
};

const mapVariantValues = (
	sourceValues: Record<string, string>,
	sourceVersion: PublishedSystemComponentVersion,
	targetVersion: PublishedSystemComponentVersion,
	hints: SystemComponentMigrationHints | undefined,
) => {
	const mappings: SystemComponentMigrationVariantMapping[] = [];
	const diagnostics: SystemComponentMigrationDiagnostic[] = [];
	const selected: Record<string, string> = {};
	const targetAxes = targetVersion.variants?.axes ?? {};

	for (const [axisKey, value] of Object.entries(sourceValues)) {
		if (
			Object.hasOwn(targetAxes, axisKey) &&
			Object.hasOwn(targetAxes[axisKey].values, value)
		) {
			selected[axisKey] = value;
			mappings.push({
				axisKey,
				fromValue: value,
				toValue: value,
				mappingSource: "direct",
			});
			continue;
		}

		const hint = hints?.variantAxes?.find(
			(entry) => entry.fromAxis === axisKey,
		);
		const targetAxisKey = hint?.toAxis ?? axisKey;
		if (!Object.hasOwn(targetAxes, targetAxisKey)) {
			diagnostics.push({
				code: "VARIANT_AXIS_DROPPED",
				severity: "warning",
				message: `Variant axis "${axisKey}" is not available in version "${targetVersion.version}" and was dropped.`,
				axisKey,
				fromValue: value,
			});
			continue;
		}

		const mappedValue = getMappedVariantValue(hint, value, targetAxes);
		if (mappedValue !== null) {
			selected[targetAxisKey] = mappedValue;
			mappings.push({
				axisKey: targetAxisKey,
				fromValue: value,
				toValue: mappedValue,
				mappingSource: hint ? "hint" : "direct",
			});
			continue;
		}

		if (axisHasValue(targetAxes[targetAxisKey], value)) {
			selected[targetAxisKey] = value;
			mappings.push({
				axisKey: targetAxisKey,
				fromValue: value,
				toValue: value,
				mappingSource: hint ? "hint" : "direct",
			});
			continue;
		}

		if (
			hint?.valueMappings?.some((entry) => entry.fromValue === value) &&
			Object.hasOwn(targetAxes, targetAxisKey)
		) {
			diagnostics.push({
				code: "VARIANT_VALUE_DEFAULTED",
				severity: "warning",
				message: `Variant value "${value}" for axis "${axisKey}" maps to an invalid value in version "${targetVersion.version}" and will use the target default.`,
				axisKey: targetAxisKey,
				fromValue: value,
			});
			continue;
		}

		diagnostics.push({
			code: "VARIANT_VALUE_DEFAULTED",
			severity: "info",
			message: `Variant value "${value}" for axis "${axisKey}" is not valid in version "${targetVersion.version}" and will use the target default.`,
			axisKey: targetAxisKey,
			fromValue: value,
		});
	}

	const resolved = resolveSystemComponentVariantValues(
		targetVersion.variants,
		selected,
	);
	for (const [axisKey, toValue] of Object.entries(resolved)) {
		if (Object.hasOwn(selected, axisKey)) {
			continue;
		}
		mappings.push({
			axisKey,
			toValue,
			mappingSource: "default",
		});
	}

	return { variantValues: resolved, mappings, diagnostics };
};

const mapOverrides = (
	sourceOverrides: SystemComponentInstanceOverrides,
	sourceVersion: PublishedSystemComponentVersion,
	targetVersion: PublishedSystemComponentVersion,
	hints: SystemComponentMigrationHints | undefined,
) => {
	const mappings: SystemComponentMigrationOverrideMapping[] = [];
	const diagnostics: SystemComponentMigrationDiagnostic[] = [];
	const overrides: SystemComponentInstanceOverrides = {};
	const fromTargetIds = new Set(
		Object.keys(sourceVersion.overrideTargets ?? {}),
	);
	const remappedSourceTargetByTargetId = new Map<string, string>();

	for (const [targetId, override] of Object.entries(sourceOverrides)) {
		if (!fromTargetIds.has(targetId)) {
			mappings.push({
				fromTargetId: targetId,
				className: override.className,
				mappingSource: "dropped",
			});
			diagnostics.push({
				code: "OVERRIDE_DROPPED",
				severity: "warning",
				message: `Override target "${targetId}" is present on the instance but not declared in version "${sourceVersion.version}" and was dropped.`,
				overrideTargetId: targetId,
				targetId,
			});
			continue;
		}

		const remapped = findRemappedOverrideTargetId(
			targetId,
			sourceVersion,
			targetVersion,
			hints,
		);
		if (remapped) {
			const previousSourceTargetId = remappedSourceTargetByTargetId.get(
				remapped.targetId,
			);
			if (
				previousSourceTargetId !== undefined &&
				previousSourceTargetId !== targetId
			) {
				throw new SystemComponentMigrationError(
					"MIGRATION_UNSAFE",
					`Override targets "${previousSourceTargetId}" and "${targetId}" both map to "${remapped.targetId}" in version "${targetVersion.version}". Authored overrides cannot be merged safely.`,
				);
			}
			remappedSourceTargetByTargetId.set(remapped.targetId, targetId);
			overrides[remapped.targetId] = override;
			mappings.push({
				fromTargetId: targetId,
				toTargetId: remapped.targetId,
				className: override.className,
				mappingSource: remapped.mappingSource,
			});
			continue;
		}

		mappings.push({
			fromTargetId: targetId,
			className: override.className,
			mappingSource: "dropped",
		});
		diagnostics.push({
			code: "OVERRIDE_DROPPED",
			severity: "warning",
			message: `Override target "${targetId}" is not available in version "${targetVersion.version}" and was dropped.`,
			overrideTargetId: targetId,
			targetId,
		});
	}

	return { overrides, mappings, diagnostics };
};

const expandAuthoredTemplateNode = (
	componentId: string,
	version: PublishedSystemComponentVersion,
	template: RecipeTemplateNode,
	createElementId: () => string,
): Node => {
	if (!isRegistryId(template.library)) {
		throw new SystemComponentMigrationError(
			"MIGRATION_UNSAFE",
			`System component "${componentId}" version "${version.version}" references unknown registry library "${template.library}".`,
		);
	}
	const resolution = resolveRegistryComponent(
		template.library,
		template.component,
	);
	if (resolution.status !== "known") {
		throw new SystemComponentMigrationError(
			"MIGRATION_UNSAFE",
			`System component "${componentId}" version "${version.version}" references unknown component "${template.component}" in registry "${template.library}".`,
		);
	}
	const role = resolution.definition.role;
	const name = template.name ?? resolution.definition.label;
	const props = {
		...getDefaultProps(
			template.library,
			template.component,
			resolution.definition,
			name,
		),
		...(template.props ?? {}),
		...(template.className !== undefined
			? { className: template.className }
			: {}),
		"data-trickroom-name": name,
	} satisfies Props;
	return {
		id: createElementId(),
		props,
		children:
			role === "text"
				? (template.text ?? getDefaultText(role) ?? "")
				: role === "leaf"
					? []
					: (template.children ?? []).map((child) =>
							expandAuthoredTemplateNode(
								componentId,
								version,
								child,
								createElementId,
							),
						),
	};
};

const getPathMappingSource = (
	fromPath: string,
	toPath: string,
	source: PublishedSystemComponentVersion,
	target: PublishedSystemComponentVersion,
	hints: SystemComponentMigrationHints | undefined,
): SystemComponentMigrationPathMapping["mappingSource"] => {
	if (fromPath === toPath) {
		return "direct";
	}
	const sourceSlot = Object.values(source.slots ?? {}).find(
		(slot) => slot.hostPath === fromPath,
	);
	const targetSlot = Object.values(target.slots ?? {}).find(
		(slot) => slot.hostPath === toPath,
	);
	if (sourceSlot && targetSlot) {
		return resolveSlotMappingSource(
			sourceSlot,
			targetSlot,
			source.version,
			hints,
		) === "host-path"
			? "direct"
			: "slot";
	}
	if (
		targetSlot?.history?.some(
			(entry) =>
				entry.fromVersion === source.version &&
				entry.previousHostPath === fromPath,
		)
	) {
		return "history";
	}
	if (
		hints?.slots?.some((hint) =>
			hint.hostPathMappings?.some(
				(mapping) =>
					mapping.fromPath === fromPath && mapping.toPath === toPath,
			),
		)
	) {
		return "hint";
	}
	return "slot";
};

export const migrateSystemComponentInstance = (
	roots: readonly Node[],
	elementId: string,
	input: MigrateSystemComponentInstanceInput,
	options: { createElementId?: () => string } = {},
): SystemComponentMigrationResult => {
	const targetMetadata = findTargetMetadata(roots, elementId);
	if (!targetMetadata) {
		const exists = (nodes: readonly Node[]): boolean =>
			nodes.some(
				(node) =>
					node.id === elementId ||
					(Array.isArray(node.children) && exists(node.children)),
			);
		throw new SystemComponentMigrationError(
			exists(roots) ? "INSTANCE_NOT_FOUND" : "ELEMENT_NOT_FOUND",
			exists(roots)
				? `Element "${elementId}" is not part of an attached system component instance.`
				: `Element "${elementId}" not found.`,
		);
	}

	if (
		targetMetadata.systemId !== input.systemId ||
		targetMetadata.componentId !== input.componentId
	) {
		throw new SystemComponentMigrationError(
			"INSTANCE_MISMATCH",
			`Element "${elementId}" belongs to a different system component than requested.`,
		);
	}

	const rootReference = findInstanceRootReference(
		roots,
		targetMetadata.instanceId,
	);
	if (!rootReference) {
		throw new SystemComponentMigrationError(
			"INSTANCE_NOT_FOUND",
			`System component instance "${targetMetadata.instanceId}" is missing a root marker.`,
		);
	}

	const hints =
		input.migrationHints ?? input.targetVersion.migrationHints ?? {};
	const { sourceVersion, targetVersion } = input;
	const instanceReferences = collectInstanceReferences(
		roots,
		targetMetadata.instanceId,
	);
	const oldByPath = new Map(
		instanceReferences.map((reference) => [
			reference.metadata.path,
			reference,
		]),
	);
	const targetHostPathBySourceHostPath = getMappedTargetHostPathBySourceHostPath(
		sourceVersion,
		targetVersion,
		hints,
	);
	const sourcePathByTargetPath = new Map(
		[...targetHostPathBySourceHostPath].map(([from, to]) => [to, from]),
	);
	const targetNodesByPath = getTemplateNodesByPath(targetVersion.root);
	const sourceNodesByPath = getTemplateNodesByPath(sourceVersion.root);
	const preservedSlots: SystemComponentMigrationSlotMapping[] = [];
	const droppedSlots: SystemComponentMigrationMetadata["droppedSlots"] =
		[];
	const authoredChildrenByTargetPath = new Map<string, Node[]>();
	const diagnostics: SystemComponentMigrationDiagnostic[] = [];

	for (const sourceSlot of Object.values(sourceVersion.slots ?? {})) {
		const targetHostPath = targetHostPathBySourceHostPath.get(
			sourceSlot.hostPath,
		);
		const sourceHost = oldByPath.get(sourceSlot.hostPath);
		const authoredChildren = sourceHost
			? getAuthoredSlotChildren(sourceHost.node, targetMetadata.instanceId)
			: [];
		if (authoredChildren.length === 0) {
			continue;
		}
		if (!targetHostPath || !targetNodesByPath.has(targetHostPath)) {
			droppedSlots.push({
				slotName: sourceSlot.name,
				fromHostPath: sourceSlot.hostPath,
				childIds: authoredChildren.map((child) => child.id),
			});
			diagnostics.push({
				code: "SLOT_CONTENT_DROPPED",
				severity: "warning",
				message: `Slot "${sourceSlot.name}" authored content cannot be mapped to version "${targetVersion.version}".`,
				slotName: sourceSlot.name,
			});
			throw new SystemComponentMigrationError(
				"MIGRATION_UNSAFE",
				`System component instance "${targetMetadata.instanceId}" slot "${sourceSlot.name}" contains authored content that cannot be mapped to version "${targetVersion.version}".`,
			);
		}
		const targetSlot = Object.values(targetVersion.slots ?? {}).find(
			(slot) => slot.hostPath === targetHostPath,
		);
		if (authoredChildrenByTargetPath.has(targetHostPath)) {
			diagnostics.push({
				code: "SLOT_MAPPING_CONFLICT",
				severity: "warning",
				message: `Slot "${sourceSlot.name}" authored content cannot be merged with other slots mapped to "${targetHostPath}" in version "${targetVersion.version}".`,
				slotName: sourceSlot.name,
			});
			throw new SystemComponentMigrationError(
				"MIGRATION_UNSAFE",
				`System component instance "${targetMetadata.instanceId}" slot "${sourceSlot.name}" authored content conflicts with another slot mapped to "${targetHostPath}" in version "${targetVersion.version}".`,
			);
		}
		authoredChildrenByTargetPath.set(
			targetHostPath,
			authoredChildren.map(cloneNode),
		);
		preservedSlots.push({
			slotName: sourceSlot.name,
			fromHostPath: sourceSlot.hostPath,
			toHostPath: targetHostPath,
			preservedChildIds: authoredChildren.map((child) => child.id),
			mappingSource: targetSlot
				? resolveSlotMappingSource(
						sourceSlot,
						targetSlot,
						sourceVersion.version,
						hints,
					)
				: "host-path",
		});
	}

	for (const conflict of collectOverrideMappingConflicts(
		sourceVersion,
		targetVersion,
		hints,
	)) {
		const conflictingAuthoredTargets = conflict.sourceTargetIds.filter(
			(sourceTargetId) =>
				Object.hasOwn(rootReference.metadata.overrides, sourceTargetId),
		);
		if (conflictingAuthoredTargets.length > 1) {
			diagnostics.push({
				code: "OVERRIDE_MAPPING_CONFLICT",
				severity: "warning",
				message: `Override targets ${conflictingAuthoredTargets.map((id) => `"${id}"`).join(", ")} both map to "${conflict.targetId}" in version "${targetVersion.version}".`,
				overrideTargetId: conflictingAuthoredTargets[0],
				targetId: conflict.targetId,
			});
			throw new SystemComponentMigrationError(
				"MIGRATION_UNSAFE",
				`System component instance "${targetMetadata.instanceId}" override targets ${conflictingAuthoredTargets.map((id) => `"${id}"`).join(", ")} both map to "${conflict.targetId}" in version "${targetVersion.version}".`,
			);
		}
	}

	const variantMapping = mapVariantValues(
		rootReference.metadata.variantValues,
		sourceVersion,
		targetVersion,
		hints,
	);
	const overrideMapping = mapOverrides(
		rootReference.metadata.overrides,
		sourceVersion,
		targetVersion,
		hints,
	);
	diagnostics.push(
		...variantMapping.diagnostics,
		...overrideMapping.diagnostics,
	);

	const preservedPaths: SystemComponentMigrationPathMapping[] = [];
	const remappedPaths: SystemComponentMigrationPathMapping[] = [];
	const addedPaths: SystemComponentMigrationPathMapping[] = [];
	const removedPaths = [...sourceNodesByPath.keys()].filter(
		(path) => !targetHostPathBySourceHostPath.has(path),
	);
	const createElementId =
		options.createElementId ?? (() => globalThis.crypto.randomUUID());

	const resolved: ResolvedPublishedSystemComponent = {
		systemId: input.systemId,
		componentId: input.componentId,
		record: {
			componentId: input.componentId,
			slug: "migration",
			name: "Migration",
			createdAt: "",
			updatedAt: "",
			published: {
				currentVersion: targetVersion.version,
				versions: { [targetVersion.version]: targetVersion },
			},
		} satisfies SystemComponentRecord,
		version: targetVersion,
	};

	const buildTargetNode = (
		template: RecipeTemplateNode,
		isRoot: boolean,
	): Node => {
		if (!isRegistryId(template.library)) {
			throw new SystemComponentMigrationError(
				"MIGRATION_UNSAFE",
				`System component "${input.componentId}" references unknown registry library "${template.library}".`,
			);
		}
		const resolution = resolveRegistryComponent(
			template.library,
			template.component,
		);
		if (resolution.status !== "known") {
			throw new SystemComponentMigrationError(
				"MIGRATION_UNSAFE",
				`System component "${input.componentId}" references unknown component "${template.component}" in registry "${template.library}".`,
			);
		}

		const sourcePath = sourcePathByTargetPath.get(template.path);
		const previousReference = sourcePath ? oldByPath.get(sourcePath) : null;
		const id = previousReference?.node.id ?? createElementId();
		const templatePropsClassName =
			typeof template.props?.className === "string"
				? template.props.className
				: undefined;
		const classComposition = resolveMaterializedSystemComponentClassComposition(
			targetVersion,
			template.path,
			template.className,
			templatePropsClassName,
			variantMapping.variantValues,
			overrideMapping.overrides,
			resolution.definition,
			{
				systemId: input.systemId,
				componentId: input.componentId,
				instanceId: targetMetadata.instanceId,
				library: template.library,
				component: template.component,
			},
		);
		const props = {
			...getDefaultProps(
				template.library,
				template.component,
				resolution.definition,
				template.name ?? resolution.definition.label,
			),
			...(template.props ?? {}),
			...classComposition.props,
			"data-trickroom-name": template.name ?? resolution.definition.label,
			"data-trickroom-library": template.library,
			"data-trickroom-component": template.component,
			"data-trickroom-role": resolution.definition.role,
			...getSystemComponentMarkerProps({
				systemId: input.systemId,
				componentId: input.componentId,
				instanceId: targetMetadata.instanceId,
				version: targetVersion.version,
				path: template.path,
				isRoot,
				slotName: getTemplateSlotName(targetVersion, template),
				variantValues: isRoot ? variantMapping.variantValues : undefined,
				overrides: isRoot ? overrideMapping.overrides : undefined,
				templateHash: targetVersion.templateHash,
				variantSchemaHash: targetVersion.variantSchemaHash,
			}),
		};

		if (previousReference) {
			const mapping = {
				fromPath: sourcePath ?? template.path,
				toPath: template.path,
				elementId: id,
				mappingSource: getPathMappingSource(
					sourcePath ?? template.path,
					template.path,
					sourceVersion,
					targetVersion,
					hints,
				),
			};
			if (mapping.fromPath === mapping.toPath) {
				preservedPaths.push(mapping);
			} else {
				remappedPaths.push(mapping);
			}
		} else {
			addedPaths.push({
				fromPath: "",
				toPath: template.path,
				elementId: id,
				mappingSource: "direct",
			});
		}

		const authoredChildren = authoredChildrenByTargetPath.get(template.path);
		const defaultChildren =
			authoredChildren === undefined
				? (
						getSlotDefinition(
							targetVersion,
							getTemplateSlotName(targetVersion, template) ?? "",
						)?.defaultChildren ?? []
					).map((child) =>
						expandAuthoredTemplateNode(
							input.componentId,
							targetVersion,
							child,
							createElementId,
						),
					)
				: authoredChildren;
		const role = resolution.definition.role;
		return {
			id,
			props,
			children:
				role === "text"
					? (template.text ?? getDefaultText(role) ?? "")
					: role === "leaf"
						? []
						: [
								...(template.children ?? []).map((child) =>
									buildTargetNode(child, false),
								),
								...defaultChildren,
							],
		};
	};

	const migratedRoot = buildTargetNode(targetVersion.root, true);
	const nextRoots = replaceNode(roots, rootReference.node.id, migratedRoot);

	return {
		roots: nextRoots,
		changedElementId:
			collectReferences([migratedRoot]).has(elementId) ||
			migratedRoot.id === elementId
				? elementId
				: migratedRoot.id,
		metadata: {
			systemId: input.systemId,
			componentId: input.componentId,
			instanceId: targetMetadata.instanceId,
			rootElementId: migratedRoot.id,
			fromVersion: sourceVersion.version,
			toVersion: targetVersion.version,
			fromTemplateHash: sourceVersion.templateHash,
			toTemplateHash: targetVersion.templateHash,
			preservedPaths,
			remappedPaths,
			addedPaths,
			removedPaths,
			preservedSlots,
			droppedSlots,
			variantMappings: variantMapping.mappings,
			overrideMappings: overrideMapping.mappings,
			diagnostics,
		},
	};
};

export const migrateSystemComponentInstanceToCurrent = (
	roots: readonly Node[],
	elementId: string,
	resolved: ResolvedPublishedSystemComponent,
	sourceVersion: PublishedSystemComponentVersion,
	options: { createElementId?: () => string } = {},
) =>
	migrateSystemComponentInstance(
		roots,
		elementId,
		{
			systemId: resolved.systemId,
			componentId: resolved.componentId,
			sourceVersion,
			targetVersion: resolved.version,
			migrationHints: resolved.version.migrationHints,
		},
		options,
	);

export const previewMigratedSystemComponentExpansion = (
	resolved: ResolvedPublishedSystemComponent,
	variantValues: Record<string, string>,
	overrides: SystemComponentInstanceOverrides,
	options: { createInstanceId?: () => string; createElementId?: () => string } =
		{},
) =>
	expandResolvedSystemComponent(resolved, {
		...options,
		variantValues,
		overrides,
	});
