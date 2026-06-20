import {
	canHaveElementChildren,
	getControlByProp,
	getControlProps,
	getDefaultProps,
	getDefaultText,
	isValidControlValue,
	migrateRegistryBaseClassProps,
	normalizeRole,
	resolveRegistryComponent,
	resolveRegistryRecipe,
	SYSTEM_PROP_KEYS,
} from "../libraries/registry";
import {
	findRecipeControlTargetElement,
	getRecipeControlByPathAndProp,
} from "../recipes/controls";
import { detachRecipeInstance } from "../recipes/detach";
import { expandRegistryRecipe } from "../recipes/expansion";
import { omitRecipeMarkerProps, recipeInstanceProp } from "../recipes/markers";
import {
	RecipeMigrationError,
	type RecipeMigrationMetadata,
	updateStaleRecipeInstance,
} from "../recipes/migration";
import {
	canDeleteElementAcrossRecipeBoundary,
	canInsertIntoRecipeBoundary,
	canMoveElementAcrossRecipeBoundary,
	getElementRecipeMetadata,
	getRecipeInstanceMetadata,
	getRecipeOwnedStructuralIds,
	isRecipeOwnedStructuralNode,
	isRecipeRoot,
} from "../recipes/ownership";
import {
	getRecipeSlotCandidateForExistingNode,
	getRecipeSlotCandidateFromProps,
	isRecipeSlotInsertionAllowed,
} from "../recipes/slot-allowlist";
import type {
	JsonPrimitive,
	Node,
	Props,
	RecipeSlotChildRef,
	RegistryComponentDefinition,
	Role,
	TrickroomDesign,
} from "../types";
import { designReferencesSystemHandle } from "../utils/design-resource-references";
import { findDesignSystem } from "../utils/design-system-store";
import { detachSystemComponentInstance } from "../utils/system-component-detach";
import {
	assertValidSystemComponentInstanceOverrides,
	expandPublishedSystemComponentVersion,
	resolvePublishedSystemComponentVersion,
	SystemComponentResolutionError,
} from "../utils/system-component-expansion";
import {
	previewSystemComponentInstanceMigration,
	resolveSystemComponentInstanceMigrationContext,
	SystemComponentInstanceMigrationError,
	type SystemComponentInstanceMigrationPreview,
	updateStaleSystemComponentInstance,
} from "../utils/system-component-instance-migration";
import { updateSystemComponentInstanceOnRoots } from "../utils/system-component-instance-update";
import { readSystemComponentManifest } from "../utils/system-component-manifest-service";
import type { SystemComponentInstanceOverrides } from "../utils/system-component-markers";
import {
	getSystemComponentStructuralMetadata,
	isSystemComponentMarkerPropKey,
	omitSystemComponentMarkerProps,
	systemComponentInstanceProp,
} from "../utils/system-component-markers";
import {
	SystemComponentMigrationError,
	type SystemComponentMigrationMetadata,
} from "../utils/system-component-migration";
import {
	canDeleteElementAcrossSystemComponentBoundary,
	canInsertIntoSystemComponentBoundary,
	canMoveElementAcrossSystemComponentBoundary,
	canUpdateSystemComponentStructuralNode,
	getElementSystemComponentMetadata,
	getSystemComponentInstanceMetadata,
	getSystemComponentOwnedStructuralIds,
	isSystemComponentOwnedStructuralNode,
	isSystemComponentRoot,
} from "../utils/system-component-ownership";
import type { PublishedSystemComponentVersion } from "../utils/system-components";

export type DesignTransformErrorCode =
	| "ELEMENT_NOT_FOUND"
	| "PARENT_NOT_FOUND"
	| "PARENT_CANNOT_HAVE_CHILDREN"
	| "DUPLICATE_ELEMENT_ID"
	| "CYCLE_DETECTED"
	| "INVALID_TEXT_UPDATE"
	| "DESIGN_SYSTEM_REQUIRED"
	| "UNKNOWN_REGISTRY_LIBRARY"
	| "UNKNOWN_REGISTRY_COMPONENT"
	| "UNKNOWN_REGISTRY_RECIPE"
	| "UNKNOWN_DESIGN_SYSTEM"
	| "INVALID_ASSET_ID"
	| "INVALID_ICON_ID"
	| "UNKNOWN_ASSET_ID"
	| "UNKNOWN_ICON_ID"
	| "MISSING_ASSET_ID"
	| "MISSING_ICON_ID"
	| "RECIPE_STRUCTURE_LOCKED"
	| "RECIPE_STRUCTURAL_NODE_LOCKED"
	| "COMPONENT_STRUCTURE_LOCKED"
	| "COMPONENT_STRUCTURAL_NODE_LOCKED"
	| "UNKNOWN_SYSTEM_COMPONENT"
	| "UNKNOWN_SYSTEM_COMPONENT_VERSION"
	| "DESIGN_NOT_LINKED_TO_SYSTEM"
	| "SYSTEM_COMPONENT_INSTANCE_NOT_FOUND"
	| "SYSTEM_COMPONENT_INSTANCE_NOT_STALE"
	| "INVALID_SYSTEM_COMPONENT_INSTANCE_STATE"
	| "SYSTEM_COMPONENT_MIGRATION_UNSAFE"
	| "RECIPE_SLOT_DISALLOWED_CHILD"
	| "RECIPE_INSTANCE_NOT_FOUND"
	| "RECIPE_INSTANCE_NOT_STALE"
	| "RECIPE_MIGRATION_UNSAFE"
	| "RECIPE_CONTROL_NOT_FOUND"
	| "BUILT_IN_REGISTRY_EDIT"
	| "INVALID_PROP_KEY"
	| "INVALID_PROP_VALUE"
	| "INVALID_INDEX"
	| "INDEX_OUT_OF_BOUNDS"
	| "SUBTREE_TOO_LARGE"
	| "SUBTREE_TOO_DEEP"
	| "DUPLICATE_TEMP_ID"
	| "INVALID_TEXT_CONTENT"
	| "RECIPE_NODES_NOT_ALLOWED"
	| "INVALID_OPERATION_PARAMETERS";

export class DesignTransformError extends Error {
	readonly code: DesignTransformErrorCode;

	constructor(code: DesignTransformErrorCode, message: string) {
		super(message);
		this.name = "DesignTransformError";
		this.code = code;
	}
}

type FlatEntity = {
	id: string;
	props: Props;
	parentId: string | null;
	role: Role;
	childIds?: string[];
	text?: string;
};

type FlatDesign = {
	name: string;
	systemId?: string | null;
	systemName?: string | null;
	componentMigrationPolicy?: TrickroomDesign["componentMigrationPolicy"];
	rootIds: string[];
	entitiesById: Record<string, FlatEntity>;
};

const normalizeNode = (
	node: Node,
	parentId: string | null,
	entitiesById: Record<string, FlatEntity>,
) => {
	const props = migrateRegistryBaseClassProps(node.props, {
		materializeBaseClass:
			getSystemComponentStructuralMetadata(node.props) !== null,
	});
	const role = normalizeRole(props["data-trickroom-role"]);
	const entity: FlatEntity = {
		id: node.id,
		props: { ...props, "data-trickroom-role": role },
		parentId,
		role,
	};

	if (Object.hasOwn(entitiesById, node.id)) {
		throw new DesignTransformError(
			"DUPLICATE_ELEMENT_ID",
			`Element id "${node.id}" is duplicated.`,
		);
	}

	entitiesById[node.id] = entity;

	if (role === "text") {
		entity.text = typeof node.children === "string" ? node.children : "";
		return;
	}

	if (role === "leaf") {
		entity.childIds = [];
		return;
	}

	if (typeof node.children === "string") {
		entity.childIds = [];
		return;
	}

	entity.childIds = node.children.map((child) => child.id);
	for (const child of node.children) {
		normalizeNode(child, node.id, entitiesById);
	}
};

export const normalizeDesignForMutation = (
	design: TrickroomDesign,
): FlatDesign => {
	const entitiesById: Record<string, FlatEntity> = {};
	for (const board of design.boards) {
		normalizeNode(board, null, entitiesById);
	}

	return {
		name: design.name,
		...(design.systemId !== undefined ? { systemId: design.systemId } : {}),
		...(design.systemName !== undefined
			? { systemName: design.systemName }
			: {}),
		...(design.componentMigrationPolicy !== undefined
			? { componentMigrationPolicy: design.componentMigrationPolicy }
			: {}),
		rootIds: design.boards.map((board) => board.id),
		entitiesById,
	};
};

const serializeEntity = (
	entityId: string,
	entitiesById: Record<string, FlatEntity>,
): Node => {
	const entity = entitiesById[entityId];
	if (!entity) {
		throw new Error(`Cannot serialize missing design entity: ${entityId}`);
	}

	const children =
		entity.role === "text"
			? (entity.text ?? "")
			: (entity.childIds ?? []).map((childId) =>
					serializeEntity(childId, entitiesById),
				);

	return {
		id: entity.id,
		props: entity.props,
		children: children as string | Node[],
	};
};

export const serializeFlatDesign = (flat: FlatDesign): TrickroomDesign => ({
	name: flat.name,
	...(flat.systemId !== undefined ? { systemId: flat.systemId } : {}),
	...(flat.systemId === undefined && flat.systemName !== undefined
		? { systemName: flat.systemName }
		: {}),
	...(flat.componentMigrationPolicy !== undefined
		? { componentMigrationPolicy: flat.componentMigrationPolicy }
		: {}),
	boards: flat.rootIds.map((rootId) =>
		serializeEntity(rootId, flat.entitiesById),
	),
});

const withoutId = (ids: string[], id: string) =>
	ids.filter((currentId) => currentId !== id);

const insertAt = (ids: string[], id: string, index: number) => {
	const nextIds = [...ids];
	const boundedIndex = Math.max(0, Math.min(index, nextIds.length));
	nextIds.splice(boundedIndex, 0, id);
	return nextIds;
};

const isDescendantOf = (
	entitiesById: Record<string, FlatEntity>,
	id: string,
	ancestorId: string,
) => {
	let current = entitiesById[id] ?? null;

	while (current?.parentId) {
		if (current.parentId === ancestorId) {
			return true;
		}
		current = entitiesById[current.parentId] ?? null;
	}

	return false;
};

const collectDescendantIds = (
	entitiesById: Record<string, FlatEntity>,
	id: string,
	ids: Set<string>,
) => {
	if (ids.has(id)) return;

	ids.add(id);
	const entity = entitiesById[id];
	for (const childId of entity?.childIds ?? []) {
		collectDescendantIds(entitiesById, childId, ids);
	}
};

const getRegistryDefinition = (
	library: string,
	component: string,
): RegistryComponentDefinition => {
	const resolution = resolveRegistryComponent(library, component);
	if (resolution.status === "unknown-library") {
		throw new DesignTransformError(
			"UNKNOWN_REGISTRY_LIBRARY",
			`Unknown registry library "${library}".`,
		);
	}

	if (resolution.status === "unknown-component") {
		throw new DesignTransformError(
			"UNKNOWN_REGISTRY_COMPONENT",
			`Unknown component "${component}" in registry "${library}".`,
		);
	}

	return resolution.definition;
};

const mapSystemComponentResolutionError = (
	error: SystemComponentResolutionError,
): DesignTransformError => {
	switch (error.code) {
		case "UNKNOWN_SYSTEM":
			return new DesignTransformError("UNKNOWN_DESIGN_SYSTEM", error.message);
		case "UNKNOWN_COMPONENT":
			return new DesignTransformError(
				"UNKNOWN_SYSTEM_COMPONENT",
				error.message,
			);
		case "UNKNOWN_VERSION":
			return new DesignTransformError(
				"UNKNOWN_SYSTEM_COMPONENT_VERSION",
				error.message,
			);
		case "INVALID_INSTANCE_STATE":
			return new DesignTransformError(
				"INVALID_SYSTEM_COMPONENT_INSTANCE_STATE",
				error.message,
			);
		case "UNKNOWN_REGISTRY_LIBRARY":
			return new DesignTransformError(
				"UNKNOWN_REGISTRY_LIBRARY",
				error.message,
			);
		case "UNKNOWN_REGISTRY_COMPONENT":
			return new DesignTransformError(
				"UNKNOWN_REGISTRY_COMPONENT",
				error.message,
			);
		default:
			return new DesignTransformError(
				"INVALID_OPERATION_PARAMETERS",
				error.message,
			);
	}
};

const assertRegistryRecipeExists = (library: string, recipe: string) => {
	const resolution = resolveRegistryRecipe(library, recipe);
	if (resolution.status === "unknown-library") {
		throw new DesignTransformError(
			"UNKNOWN_REGISTRY_LIBRARY",
			`Unknown registry library "${library}".`,
		);
	}

	if (resolution.status === "unknown-recipe") {
		throw new DesignTransformError(
			"UNKNOWN_REGISTRY_RECIPE",
			`Unknown recipe "${recipe}" in registry "${library}".`,
		);
	}
};

const createDesignElementId = () => globalThis.crypto.randomUUID();

export type MutationResult = {
	design: TrickroomDesign;
	changedElementId: string;
};

export type DeleteMutationResult = MutationResult & {
	deletedIds: string[];
};

export type AddElementParams = {
	parentId: string | null;
	index: number;
	library: string;
	component: string;
	/** Convenience alias for `data-trickroom-name`. Takes precedence over `props["data-trickroom-name"]`. */
	name?: string;
	/** Convenience alias for `className`. Takes precedence over `props.className`. */
	className?: string;
	text?: string;
	/**
	 * Optional extra instance props (allowed: `className`, `data-trickroom-name`, and registry-backed control props).
	 * Shortcuts `name`/`className` override the same keys when both are supplied.
	 * Registry-reference keys and unknown keys throw INVALID_PROP_KEY.
	 */
	props?: Record<string, JsonPrimitive>;
};

export type AddRecipeParams = {
	parentId: string | null;
	index: number;
	library: string;
	recipe: string;
};

export type AddRecipeMutationResult = MutationResult & {
	recipeId: string;
	instanceId: string;
	elementIdsByPath: Record<string, string>;
};

export type AddSystemComponentParams = {
	projectRoot: string;
	parentId: string | null;
	index: number;
	systemId: string;
	componentId: string;
	/** Omit or pass null to use the component manifest currentVersion. */
	version?: string | null;
	variantValues?: Record<string, string>;
	unsetVariantAxes?: string[];
	overrides?: SystemComponentInstanceOverrides;
};

export type AddSystemComponentMutationResult = MutationResult & {
	systemId: string;
	componentId: string;
	version: string;
	instanceId: string;
	elementIdsByPath: Record<string, string>;
	variantValues: Record<string, string>;
	overrides: SystemComponentInstanceOverrides;
};

export type UpdateSystemComponentInstanceParams = {
	projectRoot: string;
	rootElementId: string;
	variantValues?: Record<string, string>;
	unsetVariantAxes?: string[];
	overrides?: SystemComponentInstanceOverrides;
};

export type UpdateSystemComponentInstanceMutationResult = MutationResult & {
	systemId: string;
	componentId: string;
	version: string;
	instanceId: string;
	rootElementId: string;
	changedElementIds: string[];
	variantValues: Record<string, string>;
	overrides: SystemComponentInstanceOverrides;
};

export type MigrateSystemComponentInstanceParams = {
	projectRoot: string;
	rootElementId: string;
	onlySafe?: boolean;
	dryRun?: boolean;
};

export type MigrateSystemComponentInstanceOutcome =
	| "migrated"
	| "review-required"
	| "dry-run-preview";

export type MigrateSystemComponentInstanceMutationResult = MutationResult & {
	applied: boolean;
	outcome: MigrateSystemComponentInstanceOutcome;
	systemId: string;
	componentId: string;
	instanceId: string;
	rootElementId: string;
	fromVersion: string;
	toVersion: string;
	prospectiveDesign?: TrickroomDesign;
	componentMigration?: SystemComponentMigrationMetadata;
	preview?: Pick<
		SystemComponentInstanceMigrationPreview,
		"classification" | "migrationDiagnostics" | "blocked" | "blockMessage"
	>;
};

export type DetachSystemComponentParams = {
	projectRoot: string;
	elementId: string;
};

export type DetachSystemComponentMutationResult = MutationResult & {
	systemId: string;
	componentId: string;
	instanceId: string;
	rootElementId: string | null;
	detachedElementIds: string[];
};

export type AddSubtreeParams = {
	parentId: string | null;
	index: number;
	subtree: ProposedSubtreeNode;
	options?: Pick<
		ValidateSubtreeOptions,
		"maxNodes" | "maxDepth" | "allowRecipes"
	>;
};

export type AddSubtreeRecipeExpansion = {
	tempId?: string;
	recipeId: string;
	instanceId: string;
	rootElementId: string;
	elementIdsByPath: Record<string, string>;
};

export type AddSubtreeMutationResult = MutationResult & {
	rootElementId: string;
	idMap: Record<string, string>;
	inserted: {
		nodeCount: number;
		rootElementId: string;
		elementIds: string[];
	};
	recipeExpansions: AddSubtreeRecipeExpansion[];
};

export type ProposedElementNode = {
	kind?: "element";
	tempId?: string;
	library: string;
	component: string;
	name?: string;
	className?: string;
	props?: Record<string, JsonPrimitive>;
	text?: string;
	children?: ProposedSubtreeNode[];
};

export type ProposedRecipeNode = {
	kind: "recipe";
	tempId?: string;
	library: string;
	recipe: string;
};

export type ProposedSubtreeNode = ProposedElementNode | ProposedRecipeNode;

export type NormalizedElementSubtreeNode = {
	kind: "element";
	tempId?: string;
	library: string;
	component: string;
	role: Role;
	props: Props;
	text?: string;
	children: NormalizedSubtreeNode[];
};

export type RecipeExpansionSummary = {
	tempId?: string;
	library: string;
	recipe: string;
	recipeId: string;
	nodeCount: number;
	maxDepth: number;
};

export type NormalizedRecipeSubtreeNode = {
	kind: "recipe";
	tempId?: string;
	library: string;
	recipe: string;
	expansion: RecipeExpansionSummary;
};

export type NormalizedSubtreeNode =
	| NormalizedElementSubtreeNode
	| NormalizedRecipeSubtreeNode;

export type SubtreeDiagnosticSeverity = "error" | "warning" | "info";

export type SubtreeDiagnostic = {
	severity: SubtreeDiagnosticSeverity;
	code: string;
	message: string;
	/**
	 * Stable JSON Pointer path into the submitted payload, e.g. `/subtree/children/0/props/className`.
	 * Use an empty string for diagnostics that apply to the full payload.
	 */
	path: string;
	tempId?: string;
	details?: Record<string, unknown>;
};

export type SubtreeStats = {
	nodeCount: number;
	maxDepth: number;
	recipeCount: number;
};

export type SubtreeValidationSummary = {
	valid: boolean;
	diagnostics: SubtreeDiagnostic[];
	stats: SubtreeStats;
	normalizedSubtree?: NormalizedSubtreeNode;
	recipeExpansions: RecipeExpansionSummary[];
};

export type ValidateSubtreeOptions = {
	maxNodes?: number;
	maxDepth?: number;
	includeNormalizedTree?: boolean;
	allowRecipes?: boolean;
};

export type ValidateSubtreeParams = {
	parentId: string | null;
	index: number;
	subtree: ProposedSubtreeNode;
	options?: ValidateSubtreeOptions;
};

export type SubtreeValidationResult = SubtreeValidationSummary & {
	candidateDesign: TrickroomDesign | null;
	candidateRootId: string | null;
	candidateElementIds: string[];
};

export type UpdateElementPropsParams = {
	elementId: string;
	name?: string;
	className?: string;
	props?: Record<string, JsonPrimitive>;
};

export type UpdateRecipeControlParams = {
	instanceId: string;
	path: string;
	prop: string;
	value: JsonPrimitive;
};

export type UpdateElementTextParams = {
	elementId: string;
	text: string;
};

export type MoveElementParams = {
	elementId: string;
	targetParentId: string | null;
	index: number;
};

export type DeleteElementParams = {
	elementId: string;
};

export type DetachRecipeInstanceParams = {
	elementId: string;
};

export type DetachRecipeInstanceMutationResult = MutationResult & {
	recipeId: string;
	instanceId: string;
	rootElementId: string | null;
	detachedElementIds: string[];
};

export type UpdateRecipeInstanceParams = {
	elementId: string;
};

export type UpdateRecipeInstanceMutationResult = MutationResult & {
	recipeMigration: RecipeMigrationMetadata;
};

export type ExtractSubtreeParams = {
	elementId: string;
	name?: string;
	systemId?: string | null;
	systemName?: string | null;
	projectRoot?: string;
};

export type ExtractSubtreeResult = {
	newDesign: TrickroomDesign;
	changedElementId: string;
	idMap: Record<string, string>;
};

export type CopySubtreeParams = {
	sourceElementId: string;
	parentId: string | null;
	index: number;
	sameDesign?: boolean;
	projectRoot?: string;
};

export type CopySubtreeResult = MutationResult & {
	sourceElementId: string;
	rootElementId: string;
	idMap: Record<string, string>;
	inserted: {
		nodeCount: number;
		rootElementId: string;
		elementIds: string[];
	};
};

export const REGISTRY_PROP_KEYS = new Set([
	"data-trickroom-library",
	"data-trickroom-component",
	"data-trickroom-role",
]);

export const ALLOWED_INSTANCE_PROP_KEYS = new Set([
	"className",
	"data-trickroom-name",
]);

const RECIPE_STRUCTURAL_STYLE_PROP_KEYS = new Set([
	"className",
	"data-trickroom-name",
]);

const DEFAULT_SUBTREE_MAX_NODES = 200;
const DEFAULT_SUBTREE_MAX_DEPTH = 32;

const getRecipeLockGuidance = (
	entitiesById: Record<string, FlatEntity>,
	elementId: string,
) => {
	const metadata = getRecipeInstanceMetadata(entitiesById, elementId);
	const rootGuidance = metadata?.rootId
		? ` Delete recipe root "${metadata.rootId}" to remove the whole recipe instance.`
		: " Delete the recipe root to remove the whole recipe instance.";
	return `${rootGuidance} Use detachRecipeInstance when explicit detaching is available before changing recipe structure.`;
};

const getSystemComponentLockGuidance = (
	entitiesById: Record<string, FlatEntity>,
	elementId: string,
) => {
	const metadata = getSystemComponentInstanceMetadata(entitiesById, elementId);
	const rootGuidance = metadata?.rootId
		? ` Delete component root "${metadata.rootId}" to remove the whole component instance.`
		: " Delete the component root to remove the whole component instance.";
	return `${rootGuidance} Use component-level operations or detach the component before changing component-owned structure.`;
};

const assertCanInsertIntoRecipeStructure = (
	entitiesById: Record<string, FlatEntity>,
	parentId: string | null,
) => {
	if (canInsertIntoRecipeBoundary(entitiesById, parentId)) {
		return;
	}

	throw new DesignTransformError(
		"RECIPE_STRUCTURE_LOCKED",
		`Cannot insert into recipe-owned structure "${parentId}". Add authored content to a declared recipe slot instead.${parentId ? getRecipeLockGuidance(entitiesById, parentId) : ""}`,
	);
};

const assertCanInsertIntoSystemComponentStructure = (
	entitiesById: Record<string, FlatEntity>,
	parentId: string | null,
) => {
	if (canInsertIntoSystemComponentBoundary(entitiesById, parentId)) {
		return;
	}

	throw new DesignTransformError(
		"COMPONENT_STRUCTURE_LOCKED",
		`Cannot insert into component-owned structure "${parentId}". Add authored content to a declared component slot instead.${parentId ? getSystemComponentLockGuidance(entitiesById, parentId) : ""}`,
	);
};

const describeSlotCandidate = (candidate: RecipeSlotChildRef) =>
	candidate.kind === "recipe"
		? `${candidate.library}/${candidate.recipe}`
		: `${candidate.library}/${candidate.component}`;

const assertRecipeSlotAllowsChild = (
	entitiesById: Record<string, FlatEntity>,
	parentId: string | null,
	candidate: RecipeSlotChildRef,
) => {
	if (isRecipeSlotInsertionAllowed(entitiesById, parentId, candidate)) {
		return;
	}

	throw new DesignTransformError(
		"RECIPE_SLOT_DISALLOWED_CHILD",
		`Recipe slot "${parentId}" does not allow child "${describeSlotCandidate(candidate)}".`,
	);
};

const assertCanMoveAcrossRecipeStructure = (
	entitiesById: Record<string, FlatEntity>,
	elementId: string,
	targetParentId: string | null,
) => {
	if (
		canMoveElementAcrossRecipeBoundary(entitiesById, elementId, targetParentId)
	) {
		const candidate = getRecipeSlotCandidateForExistingNode(
			entitiesById,
			elementId,
		);
		if (candidate) {
			assertRecipeSlotAllowsChild(entitiesById, targetParentId, candidate);
		}
		return;
	}

	const entity = entitiesById[elementId];
	if (isRecipeOwnedStructuralNode(entity)) {
		throw new DesignTransformError(
			"RECIPE_STRUCTURAL_NODE_LOCKED",
			`Element "${elementId}" is recipe-owned structure and cannot be moved.${getRecipeLockGuidance(entitiesById, elementId)}`,
		);
	}

	throw new DesignTransformError(
		"RECIPE_STRUCTURE_LOCKED",
		`Cannot move element "${elementId}" into recipe-owned structure "${targetParentId}". Add authored content to a declared recipe slot instead.${targetParentId ? getRecipeLockGuidance(entitiesById, targetParentId) : ""}`,
	);
};

const assertCanMoveAcrossSystemComponentStructure = (
	entitiesById: Record<string, FlatEntity>,
	elementId: string,
	targetParentId: string | null,
) => {
	if (
		canMoveElementAcrossSystemComponentBoundary(
			entitiesById,
			elementId,
			targetParentId,
		)
	) {
		return;
	}

	const entity = entitiesById[elementId];
	if (isSystemComponentOwnedStructuralNode(entity)) {
		throw new DesignTransformError(
			"COMPONENT_STRUCTURAL_NODE_LOCKED",
			`Element "${elementId}" is component-owned structure and cannot be moved.${getSystemComponentLockGuidance(entitiesById, elementId)}`,
		);
	}

	throw new DesignTransformError(
		"COMPONENT_STRUCTURE_LOCKED",
		`Cannot move element "${elementId}" into component-owned structure "${targetParentId}". Add authored content to a declared component slot instead.${targetParentId ? getSystemComponentLockGuidance(entitiesById, targetParentId) : ""}`,
	);
};

const assertCanDeleteAcrossRecipeStructure = (
	entitiesById: Record<string, FlatEntity>,
	elementId: string,
) => {
	if (canDeleteElementAcrossRecipeBoundary(entitiesById, elementId)) {
		return;
	}

	throw new DesignTransformError(
		"RECIPE_STRUCTURAL_NODE_LOCKED",
		`Element "${elementId}" is recipe-owned structure and cannot be deleted directly.${getRecipeLockGuidance(entitiesById, elementId)}`,
	);
};

const assertCanDeleteAcrossSystemComponentStructure = (
	entitiesById: Record<string, FlatEntity>,
	elementId: string,
) => {
	if (canDeleteElementAcrossSystemComponentBoundary(entitiesById, elementId)) {
		return;
	}

	throw new DesignTransformError(
		"COMPONENT_STRUCTURAL_NODE_LOCKED",
		`Element "${elementId}" is component-owned structure and cannot be deleted directly.${getSystemComponentLockGuidance(entitiesById, elementId)}`,
	);
};

const assertCanUpdateRecipeStructuralProps = (
	entitiesById: Record<string, FlatEntity>,
	elementId: string,
	params: UpdateElementPropsParams,
	definition: RegistryComponentDefinition,
) => {
	const entity = entitiesById[elementId];
	if (!isRecipeOwnedStructuralNode(entity)) {
		return;
	}

	const metadata = getElementRecipeMetadata(entity);
	const library = metadata?.recipeId.split("/")[0] ?? "";
	const recipeResolution = metadata
		? resolveRegistryRecipe(library, metadata.recipeId)
		: null;
	const recipeControlProps =
		metadata && recipeResolution?.status === "known"
			? Object.values(recipeResolution.definition.controls ?? {})
					.filter((control) => control.path === metadata.path)
					.map((control) => control.prop)
			: [];
	const mutableStructuralPropKeys = new Set([
		...RECIPE_STRUCTURAL_STYLE_PROP_KEYS,
		...Object.values(definition.controls ?? {}).map((control) => control.prop),
		...recipeControlProps,
	]);
	const structuralPropKeys = Object.keys(params.props ?? {}).filter(
		(key) => !mutableStructuralPropKeys.has(key),
	);
	if (structuralPropKeys.length === 0) {
		return;
	}

	throw new DesignTransformError(
		"RECIPE_STRUCTURAL_NODE_LOCKED",
		`Element "${elementId}" is recipe-owned structure. Only layer name, className, and declared registry controls may be changed while the recipe is attached.${getRecipeLockGuidance(entitiesById, elementId)}`,
	);
};

const assertCanUpdateSystemComponentStructuralProps = (
	entitiesById: Record<string, FlatEntity>,
	elementId: string,
	params: UpdateElementPropsParams,
) => {
	if (canUpdateSystemComponentStructuralNode(entitiesById, elementId)) {
		return;
	}

	if (
		params.name === undefined &&
		params.className === undefined &&
		Object.keys(params.props ?? {}).length === 0
	) {
		return;
	}

	throw new DesignTransformError(
		"COMPONENT_STRUCTURAL_NODE_LOCKED",
		`Element "${elementId}" is component-owned structure and cannot be changed through generic element prop updates.${getSystemComponentLockGuidance(entitiesById, elementId)}`,
	);
};

const assertValidInstanceProps = (
	props: Record<string, JsonPrimitive>,
	definition: RegistryComponentDefinition,
) => {
	for (const key of Object.keys(props)) {
		if (REGISTRY_PROP_KEYS.has(key)) {
			throw new DesignTransformError(
				"INVALID_PROP_KEY",
				`Prop key "${key}" is not allowed. Registry-reference props (${[...REGISTRY_PROP_KEYS].join(", ")}) are set automatically.`,
			);
		}

		if (SYSTEM_PROP_KEYS.has(key)) {
			throw new DesignTransformError(
				"INVALID_PROP_KEY",
				`Prop key "${key}" is system-owned and cannot be written through instance props.`,
			);
		}

		if (isSystemComponentMarkerPropKey(key)) {
			throw new DesignTransformError(
				"INVALID_PROP_KEY",
				`Prop key "${key}" is component-owned and cannot be written through generic element props.`,
			);
		}

		if (ALLOWED_INSTANCE_PROP_KEYS.has(key)) {
			if (typeof props[key] !== "string") {
				throw new DesignTransformError(
					"INVALID_PROP_VALUE",
					`Prop "${key}" must be a string.`,
				);
			}
			continue;
		}

		const control = getControlByProp(definition, key);
		if (!control) {
			const allowedControlProps = Object.values(definition.controls ?? {})
				.map((entry) => entry.prop)
				.sort();
			throw new DesignTransformError(
				"INVALID_PROP_KEY",
				`Prop key "${key}" is not allowed. Allowed instance props: ${[
					...ALLOWED_INSTANCE_PROP_KEYS,
					...allowedControlProps,
				].join(
					", ",
				)}. Registry-reference props (${[...REGISTRY_PROP_KEYS].join(", ")}) are set automatically.`,
			);
		}

		if (!isValidControlValue(control, props[key])) {
			throw new DesignTransformError(
				"INVALID_PROP_VALUE",
				`Prop "${key}" must be a valid ${control.valueType} value${
					control.options
						? ` (${control.options.map((option) => String(option.value)).join(", ")})`
						: ""
				}.`,
			);
		}
	}
};

const validateExtraProps = (
	props: Record<string, JsonPrimitive>,
	definition: RegistryComponentDefinition,
) => assertValidInstanceProps(props, definition);

const createSubtreeDiagnostic = (
	code: string,
	message: string,
	path: string,
	tempId?: string,
	details?: Record<string, unknown>,
): SubtreeDiagnostic => ({
	severity: "error",
	code,
	message,
	path,
	...(tempId !== undefined ? { tempId } : {}),
	...(details !== undefined ? { details } : {}),
});

const appendTransformDiagnostic = (
	diagnostics: SubtreeDiagnostic[],
	error: unknown,
	path: string,
	tempId?: string,
) => {
	if (error instanceof DesignTransformError) {
		diagnostics.push(
			createSubtreeDiagnostic(error.code, error.message, path, tempId),
		);
		return;
	}

	throw error;
};

const appendPath = (path: string, segment: string | number) =>
	`${path}/${String(segment).replaceAll("~", "~0").replaceAll("/", "~1")}`;

type SubtreeBuildState = {
	entitiesById: Record<string, FlatEntity>;
	diagnostics: SubtreeDiagnostic[];
	tempIdPaths: Map<string, string>;
	stats: SubtreeStats;
	recipeExpansions: RecipeExpansionSummary[];
	addSubtreeRecipeExpansions: AddSubtreeRecipeExpansion[];
	candidateElementIds: string[];
	idMap: Record<string, string>;
	maxNodes: number;
	maxDepth: number;
	includeNormalizedTree: boolean;
	allowRecipes: boolean;
	nextSyntheticId: number;
	createElementId: (path: string) => string;
	createRecipeInstanceId: (path: string) => string;
};

const getSubtreeValidationOptions = (
	options: ValidateSubtreeOptions | undefined,
) => ({
	maxNodes: options?.maxNodes ?? DEFAULT_SUBTREE_MAX_NODES,
	maxDepth: options?.maxDepth ?? DEFAULT_SUBTREE_MAX_DEPTH,
	includeNormalizedTree: options?.includeNormalizedTree ?? false,
	allowRecipes: options?.allowRecipes ?? true,
});

const createValidationElementId = (state: SubtreeBuildState, path: string) => {
	let id: string;
	do {
		id = `__trickroom_validation_${state.nextSyntheticId++}_${path
			.replaceAll("/", "_")
			.replaceAll("~", "_")}`;
	} while (Object.hasOwn(state.entitiesById, id));

	return id;
};

const collectNodePreorderIds = (root: Node) => {
	const ids: string[] = [];
	const visit = (node: Node) => {
		ids.push(node.id);
		if (Array.isArray(node.children)) {
			for (const child of node.children) {
				visit(child);
			}
		}
	};
	visit(root);
	return ids;
};

const recordSubtreeNodeStats = (
	state: SubtreeBuildState,
	count: number,
	depth: number,
	path: string,
	tempId?: string,
) => {
	state.stats.nodeCount += count;
	state.stats.maxDepth = Math.max(state.stats.maxDepth, depth);

	if (state.stats.nodeCount > state.maxNodes) {
		state.diagnostics.push(
			createSubtreeDiagnostic(
				"SUBTREE_TOO_LARGE",
				`Subtree contains ${state.stats.nodeCount} nodes, exceeding the limit of ${state.maxNodes}.`,
				path,
				tempId,
				{ maxNodes: state.maxNodes, nodeCount: state.stats.nodeCount },
			),
		);
	}

	if (state.stats.maxDepth > state.maxDepth) {
		state.diagnostics.push(
			createSubtreeDiagnostic(
				"SUBTREE_TOO_DEEP",
				`Subtree depth ${state.stats.maxDepth} exceeds the limit of ${state.maxDepth}.`,
				path,
				tempId,
				{ maxDepth: state.maxDepth, depth: state.stats.maxDepth },
			),
		);
	}
};

const recordTempId = (
	state: SubtreeBuildState,
	tempId: string | undefined,
	path: string,
) => {
	if (tempId === undefined) {
		return;
	}

	const firstPath = state.tempIdPaths.get(tempId);
	if (firstPath) {
		state.diagnostics.push(
			createSubtreeDiagnostic(
				"DUPLICATE_TEMP_ID",
				`tempId "${tempId}" is already used at ${firstPath}.`,
				appendPath(path, "tempId"),
				tempId,
				{ firstPath },
			),
		);
		return;
	}

	state.tempIdPaths.set(tempId, path);
};

const getRecipeExpansionStats = (root: Node) => {
	let nodeCount = 0;
	let maxDepth = 0;
	const visit = (node: Node, depth: number) => {
		nodeCount += 1;
		maxDepth = Math.max(maxDepth, depth);
		if (Array.isArray(node.children)) {
			for (const child of node.children) {
				visit(child, depth + 1);
			}
		}
	};

	visit(root, 1);
	return { nodeCount, maxDepth };
};

const buildElementSubtreeNode = (
	node: ProposedElementNode,
	parentId: string | null,
	path: string,
	depth: number,
	state: SubtreeBuildState,
): { rootId: string | null; normalized?: NormalizedElementSubtreeNode } => {
	recordSubtreeNodeStats(state, 1, depth, path, node.tempId);
	recordTempId(state, node.tempId, path);

	let definition: RegistryComponentDefinition;
	try {
		definition = getRegistryDefinition(node.library, node.component);
	} catch (error) {
		appendTransformDiagnostic(state.diagnostics, error, path, node.tempId);
		return { rootId: null };
	}

	const propsFromNode = node.props ?? {};
	try {
		assertValidInstanceProps(propsFromNode, definition);
	} catch (error) {
		appendTransformDiagnostic(
			state.diagnostics,
			error,
			appendPath(path, "props"),
			node.tempId,
		);
	}

	const role = normalizeRole(definition.role);
	const children = node.children ?? [];
	if (node.text !== undefined && role !== "text") {
		state.diagnostics.push(
			createSubtreeDiagnostic(
				"INVALID_TEXT_CONTENT",
				`Text content is only supported for text role elements, not ${role} role component "${node.library}/${node.component}".`,
				appendPath(path, "text"),
				node.tempId,
				{ role },
			),
		);
	}

	if (children.length > 0 && !canHaveElementChildren(role)) {
		state.diagnostics.push(
			createSubtreeDiagnostic(
				"PARENT_CANNOT_HAVE_CHILDREN",
				`Cannot add child elements to ${role} role component "${node.library}/${node.component}".`,
				appendPath(path, "children"),
				node.tempId,
				{ role },
			),
		);
	}

	const resolvedName =
		node.name ??
		(typeof propsFromNode["data-trickroom-name"] === "string"
			? propsFromNode["data-trickroom-name"]
			: undefined) ??
		definition.label;
	const resolvedClassName =
		node.className ??
		(typeof propsFromNode.className === "string"
			? propsFromNode.className
			: undefined);
	const props: Props = {
		...getDefaultProps(node.library, node.component, definition, resolvedName),
		...getControlProps(definition),
		...propsFromNode,
		"data-trickroom-name": resolvedName,
		"data-trickroom-library": node.library,
		"data-trickroom-component": node.component,
		"data-trickroom-role": role,
		...(resolvedClassName !== undefined
			? { className: resolvedClassName }
			: {}),
	};
	const id = state.createElementId(path);
	if (node.tempId !== undefined) {
		state.idMap[node.tempId] = id;
	}
	const entity: FlatEntity = {
		id,
		props,
		parentId,
		role,
	};

	state.entitiesById[id] = entity;
	state.candidateElementIds.push(id);

	const normalizedChildren: NormalizedSubtreeNode[] = [];
	if (role === "text") {
		entity.text = node.text ?? getDefaultText(role);
	} else {
		const childIds: string[] = [];
		if (canHaveElementChildren(role)) {
			for (const [index, child] of children.entries()) {
				const result = buildSubtreeNode(
					child,
					id,
					appendPath(appendPath(path, "children"), index),
					depth + 1,
					state,
				);
				if (result.rootId) {
					childIds.push(result.rootId);
				}
				if (result.normalized) {
					normalizedChildren.push(result.normalized);
				}
			}
		}
		entity.childIds = childIds;
	}
	const normalized: NormalizedElementSubtreeNode | undefined =
		state.includeNormalizedTree
			? {
					kind: "element",
					...(node.tempId !== undefined ? { tempId: node.tempId } : {}),
					library: node.library,
					component: node.component,
					role,
					props,
					...(role === "text" ? { text: entity.text ?? "" } : {}),
					children: normalizedChildren,
				}
			: undefined;

	return { rootId: id, normalized };
};

const buildRecipeSubtreeNode = (
	node: ProposedRecipeNode,
	parentId: string | null,
	path: string,
	depth: number,
	state: SubtreeBuildState,
): { rootId: string | null; normalized?: NormalizedRecipeSubtreeNode } => {
	recordTempId(state, node.tempId, path);
	state.stats.recipeCount += 1;

	if (!state.allowRecipes) {
		state.diagnostics.push(
			createSubtreeDiagnostic(
				"RECIPE_NODES_NOT_ALLOWED",
				"Recipe nodes are disabled for this subtree validation.",
				path,
				node.tempId,
			),
		);
		recordSubtreeNodeStats(state, 1, depth, path, node.tempId);
		return { rootId: null };
	}

	try {
		assertRegistryRecipeExists(node.library, node.recipe);
	} catch (error) {
		appendTransformDiagnostic(state.diagnostics, error, path, node.tempId);
		recordSubtreeNodeStats(state, 1, depth, path, node.tempId);
		return { rootId: null };
	}

	const expansion = expandRegistryRecipe(node.library, node.recipe, {
		createElementId: () => state.createElementId(path),
		createRecipeInstanceId: () => state.createRecipeInstanceId(path),
	});
	const expansionStats = getRecipeExpansionStats(expansion.root);
	recordSubtreeNodeStats(
		state,
		expansionStats.nodeCount,
		depth + expansionStats.maxDepth - 1,
		path,
		node.tempId,
	);
	normalizeNode(expansion.root, parentId, state.entitiesById);
	const preorderIds = collectNodePreorderIds(expansion.root);
	state.candidateElementIds.push(...preorderIds);
	if (node.tempId !== undefined) {
		state.idMap[node.tempId] = expansion.root.id;
	}

	const summary: RecipeExpansionSummary = {
		...(node.tempId !== undefined ? { tempId: node.tempId } : {}),
		library: node.library,
		recipe: node.recipe,
		recipeId: expansion.recipeId,
		nodeCount: expansionStats.nodeCount,
		maxDepth: expansionStats.maxDepth,
	};
	state.recipeExpansions.push(summary);
	state.addSubtreeRecipeExpansions.push({
		...(node.tempId !== undefined ? { tempId: node.tempId } : {}),
		recipeId: expansion.recipeId,
		instanceId: expansion.instanceId,
		rootElementId: expansion.root.id,
		elementIdsByPath: expansion.elementIdsByPath,
	});

	return {
		rootId: expansion.root.id,
		normalized: state.includeNormalizedTree
			? {
					kind: "recipe",
					...(node.tempId !== undefined ? { tempId: node.tempId } : {}),
					library: node.library,
					recipe: node.recipe,
					expansion: summary,
				}
			: undefined,
	};
};

const buildSubtreeNode = (
	node: ProposedSubtreeNode,
	parentId: string | null,
	path: string,
	depth: number,
	state: SubtreeBuildState,
): { rootId: string | null; normalized?: NormalizedSubtreeNode } =>
	node.kind === "recipe"
		? buildRecipeSubtreeNode(node, parentId, path, depth, state)
		: buildElementSubtreeNode(node, parentId, path, depth, state);

const getProposedSubtreeRootCandidate = (
	node: ProposedSubtreeNode,
): RecipeSlotChildRef =>
	node.kind === "recipe"
		? {
				kind: "recipe",
				library: node.library,
				recipe: node.recipe,
			}
		: {
				kind: "component",
				library: node.library,
				component: node.component,
			};

const validateStrictInsertionTarget = (
	flat: FlatDesign,
	parentId: string | null,
	index: number,
	diagnostics: SubtreeDiagnostic[],
	candidate?: RecipeSlotChildRef,
) => {
	if (!Number.isInteger(index)) {
		diagnostics.push(
			createSubtreeDiagnostic(
				"INVALID_INDEX",
				"Index must be an integer.",
				"/index",
				undefined,
				{ index },
			),
		);
		return false;
	}

	if (index < 0) {
		diagnostics.push(
			createSubtreeDiagnostic(
				"INDEX_OUT_OF_BOUNDS",
				`Insertion index ${index} is outside the valid range.`,
				"/index",
				undefined,
				{ index, min: 0 },
			),
		);
		return false;
	}

	const childCount =
		parentId === null
			? flat.rootIds.length
			: flat.entitiesById[parentId]?.childIds?.length;
	if (parentId !== null && !flat.entitiesById[parentId]) {
		diagnostics.push(
			createSubtreeDiagnostic(
				"PARENT_NOT_FOUND",
				`Parent element "${parentId}" not found.`,
				"/parentId",
			),
		);
		return false;
	}

	if (parentId !== null) {
		try {
			assertCanInsertIntoRecipeStructure(flat.entitiesById, parentId);
			assertCanInsertIntoSystemComponentStructure(flat.entitiesById, parentId);
			if (candidate) {
				assertRecipeSlotAllowsChild(flat.entitiesById, parentId, candidate);
			}
		} catch (error) {
			appendTransformDiagnostic(diagnostics, error, "/parentId");
			return false;
		}

		const parent = flat.entitiesById[parentId];
		if (!canHaveElementChildren(parent.role)) {
			diagnostics.push(
				createSubtreeDiagnostic(
					"PARENT_CANNOT_HAVE_CHILDREN",
					`Cannot add a subtree to ${parent.role} role element "${parentId}".`,
					"/parentId",
					undefined,
					{ parentId, role: parent.role },
				),
			);
			return false;
		}
	}

	if (childCount === undefined) {
		diagnostics.push(
			createSubtreeDiagnostic(
				"PARENT_NOT_FOUND",
				`Parent element "${parentId}" has inconsistent child state.`,
				"/parentId",
			),
		);
		return false;
	}

	if (index > childCount) {
		diagnostics.push(
			createSubtreeDiagnostic(
				"INDEX_OUT_OF_BOUNDS",
				`Insertion index ${index} is outside the valid range 0..${childCount}.`,
				"/index",
				undefined,
				{ index, min: 0, max: childCount },
			),
		);
		return false;
	}

	return true;
};

export const validateProposedSubtreeForInsertion = (
	design: TrickroomDesign,
	params: ValidateSubtreeParams,
): SubtreeValidationResult => {
	const options = getSubtreeValidationOptions(params.options);
	const flat = normalizeDesignForMutation(design);
	const entitiesById = { ...flat.entitiesById };
	const diagnostics: SubtreeDiagnostic[] = [];
	let state: SubtreeBuildState;
	state = {
		entitiesById,
		diagnostics,
		tempIdPaths: new Map(),
		stats: { nodeCount: 0, maxDepth: 0, recipeCount: 0 },
		recipeExpansions: [],
		addSubtreeRecipeExpansions: [],
		candidateElementIds: [],
		idMap: {},
		maxNodes: options.maxNodes,
		maxDepth: options.maxDepth,
		includeNormalizedTree: options.includeNormalizedTree,
		allowRecipes: options.allowRecipes,
		nextSyntheticId: 1,
		createElementId: (path) => createValidationElementId(state, path),
		createRecipeInstanceId: (path) => createValidationElementId(state, path),
	};

	const targetIsValid = validateStrictInsertionTarget(
		flat,
		params.parentId,
		params.index,
		diagnostics,
		getProposedSubtreeRootCandidate(params.subtree),
	);
	const built = buildSubtreeNode(
		params.subtree,
		params.parentId,
		"/subtree",
		1,
		state,
	);
	const valid = diagnostics.every(
		(diagnostic) => diagnostic.severity !== "error",
	);

	let candidateDesign: TrickroomDesign | null = null;
	if (valid && targetIsValid && built.rootId) {
		const nextRootIds =
			params.parentId === null
				? insertAt(flat.rootIds, built.rootId, params.index)
				: flat.rootIds;
		if (params.parentId !== null) {
			const parent = entitiesById[params.parentId];
			entitiesById[params.parentId] = {
				...parent,
				childIds: insertAt(parent.childIds ?? [], built.rootId, params.index),
			};
		}

		candidateDesign = serializeFlatDesign({
			...flat,
			rootIds: nextRootIds,
			entitiesById,
		});
	}

	return {
		valid,
		diagnostics,
		stats: state.stats,
		...(built.normalized !== undefined
			? { normalizedSubtree: built.normalized }
			: {}),
		recipeExpansions: state.recipeExpansions,
		candidateDesign,
		candidateRootId: candidateDesign ? built.rootId : null,
		candidateElementIds: candidateDesign ? state.candidateElementIds : [],
	};
};

const throwFirstSubtreeValidationError = (
	diagnostics: SubtreeDiagnostic[],
): never => {
	const diagnostic =
		diagnostics.find((entry) => entry.severity === "error") ?? diagnostics[0];
	throw new DesignTransformError(
		diagnostic.code as DesignTransformErrorCode,
		diagnostic.message,
	);
};

export const applyAddSubtree = (
	design: TrickroomDesign,
	params: AddSubtreeParams,
): AddSubtreeMutationResult => {
	const validation = validateProposedSubtreeForInsertion(design, {
		parentId: params.parentId,
		index: params.index,
		subtree: params.subtree,
		options: params.options,
	});

	if (!validation.valid) {
		throwFirstSubtreeValidationError(validation.diagnostics);
	}

	const options = getSubtreeValidationOptions(params.options);
	const flat = normalizeDesignForMutation(design);
	const nextEntitiesById = { ...flat.entitiesById };
	const diagnostics: SubtreeDiagnostic[] = [];
	const state: SubtreeBuildState = {
		entitiesById: nextEntitiesById,
		diagnostics,
		tempIdPaths: new Map(),
		stats: { nodeCount: 0, maxDepth: 0, recipeCount: 0 },
		recipeExpansions: [],
		addSubtreeRecipeExpansions: [],
		candidateElementIds: [],
		idMap: {},
		maxNodes: options.maxNodes,
		maxDepth: options.maxDepth,
		includeNormalizedTree: false,
		allowRecipes: options.allowRecipes,
		nextSyntheticId: 1,
		createElementId: () => createDesignElementId(),
		createRecipeInstanceId: () => createDesignElementId(),
	};

	const built = buildSubtreeNode(
		params.subtree,
		params.parentId,
		"/subtree",
		1,
		state,
	);
	if (
		!built.rootId ||
		diagnostics.some((diagnostic) => diagnostic.severity === "error")
	) {
		throwFirstSubtreeValidationError(diagnostics);
	}

	const nextRootIds =
		params.parentId === null
			? insertAt(flat.rootIds, built.rootId, params.index)
			: flat.rootIds;
	if (params.parentId !== null) {
		const parent = nextEntitiesById[params.parentId];
		nextEntitiesById[params.parentId] = {
			...parent,
			childIds: insertAt(parent.childIds ?? [], built.rootId, params.index),
		};
	}

	return {
		design: serializeFlatDesign({
			...flat,
			rootIds: nextRootIds,
			entitiesById: nextEntitiesById,
		}),
		changedElementId: built.rootId,
		rootElementId: built.rootId,
		idMap: state.idMap,
		inserted: {
			nodeCount: state.candidateElementIds.length,
			rootElementId: built.rootId,
			elementIds: state.candidateElementIds,
		},
		recipeExpansions: state.addSubtreeRecipeExpansions,
	};
};

export const applyAddElement = (
	design: TrickroomDesign,
	params: AddElementParams,
): MutationResult => {
	const definition = getRegistryDefinition(params.library, params.component);

	// Validate extra props before any design mutation.
	if (params.props) {
		validateExtraProps(params.props, definition);
	}

	const role = definition.role;

	const flat = normalizeDesignForMutation(design);
	const { entitiesById, rootIds } = flat;

	if (params.parentId !== null) {
		const parent = entitiesById[params.parentId];
		if (!parent) {
			throw new DesignTransformError(
				"PARENT_NOT_FOUND",
				`Parent element "${params.parentId}" not found.`,
			);
		}
		assertCanInsertIntoRecipeStructure(entitiesById, params.parentId);
		assertCanInsertIntoSystemComponentStructure(entitiesById, params.parentId);
		assertRecipeSlotAllowsChild(entitiesById, params.parentId, {
			kind: "component",
			library: params.library,
			component: params.component,
		});
		if (!canHaveElementChildren(parent.role)) {
			throw new DesignTransformError(
				"PARENT_CANNOT_HAVE_CHILDREN",
				`Cannot add a child element to ${parent.role} role element "${params.parentId}".`,
			);
		}
	}

	const id = createDesignElementId();

	// Shortcuts take precedence over same keys in `props`.
	const propsFromParams = params.props ?? {};
	const resolvedName =
		params.name ??
		(typeof propsFromParams["data-trickroom-name"] === "string"
			? propsFromParams["data-trickroom-name"]
			: undefined) ??
		definition.label;
	const resolvedClassName =
		params.className ??
		(typeof propsFromParams.className === "string"
			? propsFromParams.className
			: undefined);

	const props: Props = {
		...getDefaultProps(
			params.library,
			params.component,
			definition,
			resolvedName,
		),
		...getControlProps(definition),
		...propsFromParams,
		"data-trickroom-name": resolvedName,
		"data-trickroom-library": params.library,
		"data-trickroom-component": params.component,
		"data-trickroom-role": role,
		...(resolvedClassName !== undefined
			? { className: resolvedClassName }
			: {}),
	};

	const newEntity: FlatEntity = {
		id,
		props,
		parentId: params.parentId,
		role,
	};

	if (role === "text") {
		newEntity.text = params.text ?? getDefaultText(role);
	} else {
		newEntity.childIds = [];
	}

	const nextEntitiesById = { ...entitiesById, [id]: newEntity };
	let nextRootIds = rootIds;

	if (params.parentId === null) {
		nextRootIds = insertAt(rootIds, id, params.index);
	} else {
		const parent = nextEntitiesById[params.parentId];
		nextEntitiesById[params.parentId] = {
			...parent,
			childIds: insertAt(parent.childIds ?? [], id, params.index),
		};
	}

	const nextFlat: FlatDesign = {
		...flat,
		rootIds: nextRootIds,
		entitiesById: nextEntitiesById,
	};

	return { design: serializeFlatDesign(nextFlat), changedElementId: id };
};

export const applyAddRecipe = (
	design: TrickroomDesign,
	params: AddRecipeParams,
): AddRecipeMutationResult => {
	assertRegistryRecipeExists(params.library, params.recipe);

	const flat = normalizeDesignForMutation(design);
	const { entitiesById, rootIds } = flat;

	if (params.parentId !== null) {
		const parent = entitiesById[params.parentId];
		if (!parent) {
			throw new DesignTransformError(
				"PARENT_NOT_FOUND",
				`Parent element "${params.parentId}" not found.`,
			);
		}
		assertCanInsertIntoRecipeStructure(entitiesById, params.parentId);
		assertCanInsertIntoSystemComponentStructure(entitiesById, params.parentId);
		assertRecipeSlotAllowsChild(entitiesById, params.parentId, {
			kind: "recipe",
			library: params.library,
			recipe: params.recipe,
		});
		if (!canHaveElementChildren(parent.role)) {
			throw new DesignTransformError(
				"PARENT_CANNOT_HAVE_CHILDREN",
				`Cannot add a recipe to ${parent.role} role element "${params.parentId}".`,
			);
		}
	}

	const expansion = expandRegistryRecipe(params.library, params.recipe, {
		createElementId: createDesignElementId,
		createRecipeInstanceId: createDesignElementId,
	});
	const nextEntitiesById = { ...entitiesById };
	normalizeNode(expansion.root, params.parentId, nextEntitiesById);

	let nextRootIds = rootIds;
	if (params.parentId === null) {
		nextRootIds = insertAt(rootIds, expansion.root.id, params.index);
	} else {
		const parent = nextEntitiesById[params.parentId];
		nextEntitiesById[params.parentId] = {
			...parent,
			childIds: insertAt(
				parent.childIds ?? [],
				expansion.root.id,
				params.index,
			),
		};
	}

	return {
		design: serializeFlatDesign({
			...flat,
			rootIds: nextRootIds,
			entitiesById: nextEntitiesById,
		}),
		changedElementId: expansion.root.id,
		recipeId: expansion.recipeId,
		instanceId: expansion.instanceId,
		elementIdsByPath: expansion.elementIdsByPath,
	};
};

const assertDesignLinkedToSystemHandle = async (
	projectRoot: string,
	design: Pick<TrickroomDesign, "systemId" | "systemName">,
	systemHandle: string,
) => {
	const system = await findDesignSystem(projectRoot, systemHandle);
	if (!designReferencesSystemHandle(design, systemHandle, system)) {
		const designHandle = design.systemId ?? design.systemName ?? null;
		throw new DesignTransformError(
			"DESIGN_NOT_LINKED_TO_SYSTEM",
			designHandle === null
				? `Cannot insert a system component from "${systemHandle}" because the design is not linked to a design system.`
				: `Cannot insert a system component from "${systemHandle}" because the design is linked to "${designHandle}" instead.`,
		);
	}
};

export const applyAddSystemComponent = async (
	design: TrickroomDesign,
	params: AddSystemComponentParams,
): Promise<AddSystemComponentMutationResult> => {
	await assertDesignLinkedToSystemHandle(
		params.projectRoot,
		design,
		params.systemId,
	);

	const flat = normalizeDesignForMutation(design);
	const { entitiesById, rootIds } = flat;

	if (params.parentId !== null) {
		const parent = entitiesById[params.parentId];
		if (!parent) {
			throw new DesignTransformError(
				"PARENT_NOT_FOUND",
				`Parent element "${params.parentId}" not found.`,
			);
		}
		assertCanInsertIntoRecipeStructure(entitiesById, params.parentId);
		assertCanInsertIntoSystemComponentStructure(entitiesById, params.parentId);
		if (!canHaveElementChildren(parent.role)) {
			throw new DesignTransformError(
				"PARENT_CANNOT_HAVE_CHILDREN",
				`Cannot add a system component to ${parent.role} role element "${params.parentId}".`,
			);
		}
	}

	let expansion: Awaited<
		ReturnType<typeof expandPublishedSystemComponentVersion>
	>;
	const selectedVariantValues =
		params.unsetVariantAxes === undefined
			? params.variantValues
			: { ...(params.variantValues ?? {}) };
	if (params.unsetVariantAxes !== undefined) {
		for (const axisKey of params.unsetVariantAxes) {
			delete selectedVariantValues[axisKey];
		}
	}
	try {
		expansion = await expandPublishedSystemComponentVersion(
			params.projectRoot,
			params.systemId,
			params.componentId,
			params.version,
			{
				createElementId: createDesignElementId,
				createInstanceId: createDesignElementId,
				variantValues: selectedVariantValues,
				overrides: params.overrides,
			},
		);
	} catch (error) {
		if (error instanceof SystemComponentResolutionError) {
			throw mapSystemComponentResolutionError(error);
		}
		throw error;
	}
	assertRecipeSlotAllowsChild(
		entitiesById,
		params.parentId,
		getRecipeSlotCandidateFromProps(expansion.root.props),
	);

	const nextEntitiesById = { ...entitiesById };
	normalizeNode(expansion.root, params.parentId, nextEntitiesById);

	let nextRootIds = rootIds;
	if (params.parentId === null) {
		nextRootIds = insertAt(rootIds, expansion.root.id, params.index);
	} else {
		const parent = nextEntitiesById[params.parentId];
		nextEntitiesById[params.parentId] = {
			...parent,
			childIds: insertAt(
				parent.childIds ?? [],
				expansion.root.id,
				params.index,
			),
		};
	}

	return {
		design: serializeFlatDesign({
			...flat,
			rootIds: nextRootIds,
			entitiesById: nextEntitiesById,
		}),
		changedElementId: expansion.root.id,
		systemId: expansion.systemId,
		componentId: expansion.componentId,
		version: expansion.version,
		instanceId: expansion.instanceId,
		elementIdsByPath: expansion.elementIdsByPath,
		variantValues: expansion.variantValues,
		overrides: expansion.overrides,
	};
};

const resolveAttachedSystemComponentVersion = async (
	projectRoot: string,
	metadata: NonNullable<
		ReturnType<typeof getSystemComponentStructuralMetadata>
	>,
) => {
	try {
		const resolved = await resolvePublishedSystemComponentVersion(
			projectRoot,
			metadata.systemId,
			metadata.componentId,
			metadata.version,
		);
		return resolved.version;
	} catch (error) {
		if (error instanceof SystemComponentResolutionError) {
			throw mapSystemComponentResolutionError(error);
		}
		throw error;
	}
};

export const applyUpdateSystemComponentInstance = async (
	design: TrickroomDesign,
	params: UpdateSystemComponentInstanceParams,
): Promise<UpdateSystemComponentInstanceMutationResult> => {
	const flat = normalizeDesignForMutation(design);
	const entity = flat.entitiesById[params.rootElementId];
	if (!entity) {
		throw new DesignTransformError(
			"ELEMENT_NOT_FOUND",
			`Element "${params.rootElementId}" not found.`,
		);
	}

	const metadata = getSystemComponentStructuralMetadata(entity.props);
	if (!metadata?.isRoot) {
		throw new DesignTransformError(
			"SYSTEM_COMPONENT_INSTANCE_NOT_FOUND",
			`Element "${params.rootElementId}" is not an attached system component root.`,
		);
	}

	if (
		params.variantValues === undefined &&
		params.unsetVariantAxes === undefined &&
		params.overrides === undefined
	) {
		throw new DesignTransformError(
			"INVALID_OPERATION_PARAMETERS",
			'At least one of "variantValues", "unsetVariantAxes", or "overrides" must be provided.',
		);
	}

	let version: PublishedSystemComponentVersion;
	try {
		version = await resolveAttachedSystemComponentVersion(
			params.projectRoot,
			metadata,
		);

		if (params.overrides !== undefined) {
			assertValidSystemComponentInstanceOverrides(version, params.overrides);
		}

		const result = updateSystemComponentInstanceOnRoots(
			design.boards,
			params.rootElementId,
			version,
			{
				...(params.variantValues !== undefined
					? { variantValues: params.variantValues }
					: {}),
				...(params.unsetVariantAxes !== undefined
					? { unsetVariantAxes: params.unsetVariantAxes }
					: {}),
				...(params.overrides !== undefined
					? { overrides: params.overrides }
					: {}),
			},
		);
		if (!result) {
			throw new DesignTransformError(
				"SYSTEM_COMPONENT_INSTANCE_NOT_FOUND",
				`Element "${params.rootElementId}" is not an attached system component root.`,
			);
		}

		return {
			design: {
				...design,
				boards: result.roots,
			},
			changedElementId: result.rootElementId,
			systemId: metadata.systemId,
			componentId: metadata.componentId,
			version: metadata.version,
			instanceId: result.instanceId,
			rootElementId: result.rootElementId,
			changedElementIds: result.changedElementIds,
			variantValues: result.variantValues,
			overrides: result.overrides,
		};
	} catch (error) {
		if (error instanceof SystemComponentResolutionError) {
			throw mapSystemComponentResolutionError(error);
		}
		throw error;
	}
};

const cloneNodeDeepForMigrationTrial = (node: Node): Node => ({
	id: node.id,
	props:
		node.props === undefined || node.props === null
			? node.props
			: structuredClone(node.props),
	children: Array.isArray(node.children)
		? node.children.map(cloneNodeDeepForMigrationTrial)
		: node.children,
});

export const cloneBoardForMigrationTrial = (board: Node): Node =>
	cloneNodeDeepForMigrationTrial(board);

const mapSystemComponentInstanceMigrationError = (
	error: SystemComponentInstanceMigrationError,
): DesignTransformError => {
	switch (error.code) {
		case "ELEMENT_NOT_FOUND":
			return new DesignTransformError("ELEMENT_NOT_FOUND", error.message);
		case "INSTANCE_NOT_FOUND":
			return new DesignTransformError(
				"SYSTEM_COMPONENT_INSTANCE_NOT_FOUND",
				error.message,
			);
		case "INSTANCE_NOT_STALE":
			return new DesignTransformError(
				"SYSTEM_COMPONENT_INSTANCE_NOT_STALE",
				error.message,
			);
		case "MISSING_TARGET_VERSION":
			return new DesignTransformError(
				"UNKNOWN_SYSTEM_COMPONENT_VERSION",
				error.message,
			);
		default:
			return new DesignTransformError(
				"INVALID_SYSTEM_COMPONENT_INSTANCE_STATE",
				error.message,
			);
	}
};

export const applyMigrateSystemComponentInstance = async (
	design: TrickroomDesign,
	params: MigrateSystemComponentInstanceParams,
): Promise<MigrateSystemComponentInstanceMutationResult> => {
	const flat = normalizeDesignForMutation(design);
	const entity = flat.entitiesById[params.rootElementId];
	if (!entity) {
		throw new DesignTransformError(
			"ELEMENT_NOT_FOUND",
			`Element "${params.rootElementId}" not found.`,
		);
	}

	const metadata = getSystemComponentStructuralMetadata(entity.props);
	if (!metadata?.isRoot) {
		throw new DesignTransformError(
			"SYSTEM_COMPONENT_INSTANCE_NOT_FOUND",
			`Element "${params.rootElementId}" is not an attached system component root.`,
		);
	}

	const onlySafe = params.onlySafe !== false;
	const dryRun = params.dryRun ?? false;

	let manifestRead: Awaited<ReturnType<typeof readSystemComponentManifest>>;
	try {
		manifestRead = await readSystemComponentManifest(
			params.projectRoot,
			metadata.systemId,
		);
	} catch (error) {
		throw new DesignTransformError(
			"UNKNOWN_DESIGN_SYSTEM",
			error instanceof Error
				? error.message
				: "Failed to read system component manifest.",
		);
	}

	const migrationContext = resolveSystemComponentInstanceMigrationContext(
		metadata,
		manifestRead.manifest,
	);
	if (!migrationContext) {
		throw new DesignTransformError(
			"UNKNOWN_SYSTEM_COMPONENT_VERSION",
			`Published component version metadata is unavailable for migration.`,
		);
	}

	let preview: SystemComponentInstanceMigrationPreview;
	try {
		preview = previewSystemComponentInstanceMigration(
			design.boards,
			params.rootElementId,
			migrationContext,
		);
	} catch (error) {
		if (error instanceof SystemComponentInstanceMigrationError) {
			throw mapSystemComponentInstanceMigrationError(error);
		}
		throw error;
	}

	const previewPayload = {
		classification: preview.classification,
		migrationDiagnostics: preview.migrationDiagnostics,
		blocked: preview.blocked,
		blockMessage: preview.blockMessage,
	};

	if (preview.blocked) {
		throw new DesignTransformError(
			"SYSTEM_COMPONENT_MIGRATION_UNSAFE",
			preview.blockMessage ??
				"Migration is blocked because authored content cannot be mapped safely.",
		);
	}

	let trialMigration: ReturnType<typeof updateStaleSystemComponentInstance>;
	try {
		trialMigration = updateStaleSystemComponentInstance(
			design.boards.map(cloneBoardForMigrationTrial),
			params.rootElementId,
			migrationContext,
		);
	} catch (error) {
		if (error instanceof SystemComponentInstanceMigrationError) {
			throw mapSystemComponentInstanceMigrationError(error);
		}
		if (error instanceof SystemComponentMigrationError) {
			if (error.code === "MIGRATION_UNSAFE") {
				throw new DesignTransformError(
					"SYSTEM_COMPONENT_MIGRATION_UNSAFE",
					error.message,
				);
			}
			throw new DesignTransformError(
				"INVALID_SYSTEM_COMPONENT_INSTANCE_STATE",
				error.message,
			);
		}
		throw error;
	}

	const migratedRootElementId = trialMigration.metadata.rootElementId;
	const prospectiveDesign: TrickroomDesign = {
		...design,
		boards: trialMigration.roots,
	};

	if (onlySafe && preview.classification.safety === "requires-review") {
		return {
			design,
			prospectiveDesign,
			changedElementId: trialMigration.changedElementId,
			applied: false,
			outcome: "review-required",
			systemId: metadata.systemId,
			componentId: metadata.componentId,
			instanceId: metadata.instanceId,
			rootElementId: migratedRootElementId,
			fromVersion: migrationContext.sourceVersion.version,
			toVersion: migrationContext.targetVersion.version,
			preview: previewPayload,
		};
	}

	if (dryRun) {
		return {
			design,
			prospectiveDesign,
			changedElementId: trialMigration.changedElementId,
			applied: false,
			outcome: "dry-run-preview",
			systemId: metadata.systemId,
			componentId: metadata.componentId,
			instanceId: metadata.instanceId,
			rootElementId: migratedRootElementId,
			fromVersion: migrationContext.sourceVersion.version,
			toVersion: migrationContext.targetVersion.version,
			preview: previewPayload,
		};
	}

	return {
		design: prospectiveDesign,
		changedElementId: trialMigration.changedElementId,
		applied: true,
		outcome: "migrated",
		systemId: metadata.systemId,
		componentId: metadata.componentId,
		instanceId: metadata.instanceId,
		rootElementId: migratedRootElementId,
		fromVersion: migrationContext.sourceVersion.version,
		toVersion: migrationContext.targetVersion.version,
		componentMigration: trialMigration.metadata,
		preview: previewPayload,
	};
};

export const applyDetachSystemComponent = async (
	design: TrickroomDesign,
	params: DetachSystemComponentParams,
): Promise<DetachSystemComponentMutationResult> => {
	const flat = normalizeDesignForMutation(design);
	if (!flat.entitiesById[params.elementId]) {
		throw new DesignTransformError(
			"ELEMENT_NOT_FOUND",
			`Element "${params.elementId}" not found.`,
		);
	}

	const metadata = getSystemComponentStructuralMetadata(
		flat.entitiesById[params.elementId].props,
	);
	let version: PublishedSystemComponentVersion | undefined;
	if (metadata) {
		try {
			const resolved = await resolvePublishedSystemComponentVersion(
				params.projectRoot,
				metadata.systemId,
				metadata.componentId,
				metadata.version,
			);
			version = resolved.version;
		} catch (error) {
			if (!(error instanceof SystemComponentResolutionError)) {
				throw error;
			}
			version = undefined;
		}
	}

	const result = detachSystemComponentInstance(
		design.boards,
		params.elementId,
		version,
	);
	if (!result) {
		throw new DesignTransformError(
			"SYSTEM_COMPONENT_INSTANCE_NOT_FOUND",
			`Element "${params.elementId}" is not part of an attached system component instance.`,
		);
	}

	return {
		design: {
			...design,
			boards: result.roots,
		},
		changedElementId: result.changedElementId,
		systemId: result.systemId,
		componentId: result.componentId,
		instanceId: result.instanceId,
		rootElementId: result.rootElementId,
		detachedElementIds: result.detachedElementIds,
	};
};

export const applyUpdateElementProps = (
	design: TrickroomDesign,
	params: UpdateElementPropsParams,
): MutationResult => {
	const flat = normalizeDesignForMutation(design);
	const entity = flat.entitiesById[params.elementId];
	if (!entity) {
		throw new DesignTransformError(
			"ELEMENT_NOT_FOUND",
			`Element "${params.elementId}" not found.`,
		);
	}

	const definition = getRegistryDefinition(
		entity.props["data-trickroom-library"],
		entity.props["data-trickroom-component"],
	);
	if (params.props) {
		validateExtraProps(params.props, definition);
	}
	assertCanUpdateRecipeStructuralProps(
		flat.entitiesById,
		params.elementId,
		params,
		definition,
	);
	assertCanUpdateSystemComponentStructuralProps(
		flat.entitiesById,
		params.elementId,
		params,
	);

	const patch: Partial<Props> = { ...(params.props ?? {}) };
	if (params.name !== undefined) patch["data-trickroom-name"] = params.name;
	if (params.className !== undefined) patch.className = params.className;

	flat.entitiesById[params.elementId] = {
		...entity,
		props: { ...entity.props, ...patch },
	};

	return {
		design: serializeFlatDesign(flat),
		changedElementId: params.elementId,
	};
};

export const applyUpdateRecipeControl = (
	design: TrickroomDesign,
	params: UpdateRecipeControlParams,
): MutationResult => {
	const flat = normalizeDesignForMutation(design);
	const target = findRecipeControlTargetElement(
		flat.entitiesById,
		params.instanceId,
		params.path,
	);
	if (!target) {
		throw new DesignTransformError(
			"RECIPE_INSTANCE_NOT_FOUND",
			`Recipe instance "${params.instanceId}" does not contain path "${params.path}".`,
		);
	}

	const metadata = getElementRecipeMetadata(target);
	const control = metadata
		? getRecipeControlByPathAndProp(metadata.recipeId, params.path, params.prop)
		: null;
	if (!metadata || !control) {
		throw new DesignTransformError(
			"RECIPE_CONTROL_NOT_FOUND",
			`Recipe instance "${params.instanceId}" does not declare control "${params.prop}" at path "${params.path}".`,
		);
	}

	if (!isValidControlValue(control, params.value)) {
		throw new DesignTransformError(
			"INVALID_PROP_VALUE",
			`Recipe control "${params.prop}" must be a valid ${control.valueType} value${
				control.options
					? ` (${control.options.map((option) => String(option.value)).join(", ")})`
					: ""
			}.`,
		);
	}

	flat.entitiesById[target.id] = {
		...target,
		props: {
			...target.props,
			[params.prop]: params.value,
		},
	};

	return {
		design: serializeFlatDesign(flat),
		changedElementId: target.id,
	};
};

export const applyUpdateElementText = (
	design: TrickroomDesign,
	params: UpdateElementTextParams,
): MutationResult => {
	const flat = normalizeDesignForMutation(design);
	const entity = flat.entitiesById[params.elementId];
	if (!entity) {
		throw new DesignTransformError(
			"ELEMENT_NOT_FOUND",
			`Element "${params.elementId}" not found.`,
		);
	}

	if (isRecipeOwnedStructuralNode(entity)) {
		throw new DesignTransformError(
			"RECIPE_STRUCTURAL_NODE_LOCKED",
			`Element "${params.elementId}" is recipe-owned structure and cannot have its text content changed directly.${getRecipeLockGuidance(flat.entitiesById, params.elementId)}`,
		);
	}

	if (isSystemComponentOwnedStructuralNode(entity)) {
		throw new DesignTransformError(
			"COMPONENT_STRUCTURAL_NODE_LOCKED",
			`Element "${params.elementId}" is component-owned structure and cannot have its text content changed directly.${getSystemComponentLockGuidance(flat.entitiesById, params.elementId)}`,
		);
	}

	if (entity.role !== "text") {
		throw new DesignTransformError(
			"INVALID_TEXT_UPDATE",
			`Cannot update text on element "${params.elementId}" — only text role elements support text updates.`,
		);
	}

	flat.entitiesById[params.elementId] = { ...entity, text: params.text };

	return {
		design: serializeFlatDesign(flat),
		changedElementId: params.elementId,
	};
};

export const applyMoveElement = (
	design: TrickroomDesign,
	params: MoveElementParams,
): MutationResult => {
	const flat = normalizeDesignForMutation(design);
	const { entitiesById } = flat;

	const entity = entitiesById[params.elementId];
	if (!entity) {
		throw new DesignTransformError(
			"ELEMENT_NOT_FOUND",
			`Element "${params.elementId}" not found.`,
		);
	}

	if (params.targetParentId === params.elementId) {
		throw new DesignTransformError(
			"CYCLE_DETECTED",
			`Cannot move element "${params.elementId}" into itself.`,
		);
	}

	if (
		params.targetParentId !== null &&
		isDescendantOf(entitiesById, params.targetParentId, params.elementId)
	) {
		throw new DesignTransformError(
			"CYCLE_DETECTED",
			`Cannot move element "${params.elementId}" into its own descendant "${params.targetParentId}".`,
		);
	}

	if (params.targetParentId !== null) {
		const targetParent = entitiesById[params.targetParentId];
		if (!targetParent) {
			throw new DesignTransformError(
				"PARENT_NOT_FOUND",
				`Target parent element "${params.targetParentId}" not found.`,
			);
		}
		assertCanMoveAcrossRecipeStructure(
			entitiesById,
			params.elementId,
			params.targetParentId,
		);
		assertCanMoveAcrossSystemComponentStructure(
			entitiesById,
			params.elementId,
			params.targetParentId,
		);
		if (!canHaveElementChildren(targetParent.role)) {
			throw new DesignTransformError(
				"PARENT_CANNOT_HAVE_CHILDREN",
				`Cannot move element into ${targetParent.role} role element "${params.targetParentId}".`,
			);
		}
	}

	if (params.targetParentId === null) {
		assertCanMoveAcrossRecipeStructure(entitiesById, params.elementId, null);
		assertCanMoveAcrossSystemComponentStructure(
			entitiesById,
			params.elementId,
			null,
		);
	}

	const nextEntitiesById = {
		...entitiesById,
		[params.elementId]: {
			...entity,
			parentId: params.targetParentId,
		},
	};

	let nextRootIds = flat.rootIds;

	if (entity.parentId === null) {
		nextRootIds = withoutId(nextRootIds, params.elementId);
	} else {
		const previousParent = nextEntitiesById[entity.parentId];
		if (!previousParent?.childIds) {
			throw new DesignTransformError(
				"PARENT_NOT_FOUND",
				`Previous parent "${entity.parentId}" has inconsistent state.`,
			);
		}
		nextEntitiesById[entity.parentId] = {
			...previousParent,
			childIds: withoutId(previousParent.childIds, params.elementId),
		};
	}

	if (params.targetParentId === null) {
		nextRootIds = insertAt(nextRootIds, params.elementId, params.index);
	} else {
		const parent = nextEntitiesById[params.targetParentId];
		if (!parent?.childIds) {
			throw new DesignTransformError(
				"PARENT_NOT_FOUND",
				`Target parent "${params.targetParentId}" has inconsistent state.`,
			);
		}
		nextEntitiesById[params.targetParentId] = {
			...parent,
			childIds: insertAt(
				withoutId(parent.childIds, params.elementId),
				params.elementId,
				params.index,
			),
		};
	}

	const nextFlat: FlatDesign = {
		...flat,
		rootIds: nextRootIds,
		entitiesById: nextEntitiesById,
	};

	return {
		design: serializeFlatDesign(nextFlat),
		changedElementId: params.elementId,
	};
};

export const applyDeleteElement = (
	design: TrickroomDesign,
	params: DeleteElementParams,
): DeleteMutationResult => {
	const flat = normalizeDesignForMutation(design);
	const { entitiesById } = flat;

	const entity = entitiesById[params.elementId];
	if (!entity) {
		throw new DesignTransformError(
			"ELEMENT_NOT_FOUND",
			`Element "${params.elementId}" not found.`,
		);
	}

	assertCanDeleteAcrossRecipeStructure(entitiesById, params.elementId);
	assertCanDeleteAcrossSystemComponentStructure(entitiesById, params.elementId);

	const deletedIds = new Set<string>();
	collectDescendantIds(entitiesById, params.elementId, deletedIds);

	const nextEntitiesById = { ...entitiesById };
	for (const deletedId of deletedIds) {
		delete nextEntitiesById[deletedId];
	}

	let nextRootIds = flat.rootIds;

	if (entity.parentId === null) {
		nextRootIds = withoutId(nextRootIds, params.elementId);
	} else {
		const parent = entitiesById[entity.parentId];
		if (parent?.childIds) {
			nextEntitiesById[entity.parentId] = {
				...parent,
				childIds: withoutId(parent.childIds, params.elementId),
			};
		}
	}

	const nextFlat: FlatDesign = {
		...flat,
		rootIds: nextRootIds,
		entitiesById: nextEntitiesById,
	};

	return {
		design: serializeFlatDesign(nextFlat),
		changedElementId: params.elementId,
		deletedIds: [...deletedIds],
	};
};

export const applyDetachRecipeInstance = (
	design: TrickroomDesign,
	params: DetachRecipeInstanceParams,
): DetachRecipeInstanceMutationResult => {
	const flat = normalizeDesignForMutation(design);
	if (!flat.entitiesById[params.elementId]) {
		throw new DesignTransformError(
			"ELEMENT_NOT_FOUND",
			`Element "${params.elementId}" not found.`,
		);
	}

	const result = detachRecipeInstance(design.boards, params.elementId);
	if (!result) {
		throw new DesignTransformError(
			"RECIPE_INSTANCE_NOT_FOUND",
			`Element "${params.elementId}" is not part of an attached recipe instance.`,
		);
	}

	return {
		design: {
			...design,
			boards: result.roots,
		},
		changedElementId: result.selectionElementId,
		recipeId: result.recipeId,
		instanceId: result.instanceId,
		rootElementId: result.rootElementId,
		detachedElementIds: result.detachedElementIds,
	};
};

export const applyUpdateRecipeInstance = (
	design: TrickroomDesign,
	params: UpdateRecipeInstanceParams,
): UpdateRecipeInstanceMutationResult => {
	try {
		const result = updateStaleRecipeInstance(design, params.elementId, {
			createElementId: createDesignElementId,
		});
		return {
			design: result.design,
			changedElementId: result.changedElementId,
			recipeMigration: result.metadata,
		};
	} catch (error) {
		if (error instanceof RecipeMigrationError) {
			throw new DesignTransformError(error.code, error.message);
		}
		throw error;
	}
};

const getExtractedDesignName = (
	entity: FlatEntity,
	requestedName: string | undefined,
) => {
	const rawName = requestedName ?? entity.props["data-trickroom-name"];
	const name = rawName.trim();
	if (name.length === 0) {
		if (requestedName !== undefined) {
			throw new DesignTransformError(
				"INVALID_OPERATION_PARAMETERS",
				'Parameter "name" must not be blank.',
			);
		}

		return "Untitled";
	}

	return name;
};

const normalizeExtractedSystemName = (
	systemName: string | null | undefined,
) => {
	if (systemName === undefined || systemName === null) {
		return systemName;
	}

	const trimmed = systemName.trim();
	if (trimmed.length === 0) {
		throw new DesignTransformError(
			"INVALID_OPERATION_PARAMETERS",
			'Parameter "systemName" must not be blank when provided.',
		);
	}

	return trimmed;
};

const cloneEntitySubtree = (
	sourceId: string,
	parentId: string | null,
	sourceEntitiesById: Record<string, FlatEntity>,
	targetEntitiesById: Record<string, FlatEntity>,
	idMap: Record<string, string>,
	recipeClonePolicy: RecipeClonePolicy,
	systemComponentClonePolicy: SystemComponentClonePolicy,
) => {
	const source = sourceEntitiesById[sourceId];
	if (!source) {
		throw new DesignTransformError(
			"ELEMENT_NOT_FOUND",
			`Element "${sourceId}" not found.`,
		);
	}

	const id = createDesignElementId();
	idMap[sourceId] = id;
	const target: FlatEntity = {
		...source,
		id,
		parentId,
		props: cloneExtractedEntityProps(
			source,
			recipeClonePolicy,
			systemComponentClonePolicy,
		),
	};
	targetEntitiesById[id] = target;

	if (source.role === "text") {
		target.text = source.text ?? "";
		delete target.childIds;
		return id;
	}

	target.childIds = (source.childIds ?? []).map((childId) =>
		cloneEntitySubtree(
			childId,
			id,
			sourceEntitiesById,
			targetEntitiesById,
			idMap,
			recipeClonePolicy,
			systemComponentClonePolicy,
		),
	);
	delete target.text;
	return id;
};

type RecipeClonePolicy = {
	preserveInstanceIds: Record<string, string | null>;
	stripInstanceIds: Set<string>;
};

type PartialRecipeCloneBehavior = "reject" | "strip";

type SystemComponentClonePolicy = {
	preserveInstanceIds: Record<string, string | null>;
	stripInstanceIds: Set<string>;
};

type PartialSystemComponentCloneBehavior = "reject" | "strip";

const collectSubtreeIds = (
	rootId: string,
	entitiesById: Record<string, FlatEntity>,
) => {
	const ids = new Set<string>();
	const visit = (id: string) => {
		const entity = entitiesById[id];
		if (!entity || ids.has(id)) {
			return;
		}

		ids.add(id);
		for (const childId of entity.childIds ?? []) {
			visit(childId);
		}
	};

	visit(rootId);
	return ids;
};

const getSubtreeIdsPreOrder = (
	rootId: string,
	entitiesById: Record<string, FlatEntity>,
) => {
	const ids: string[] = [];
	const visit = (id: string) => {
		const entity = entitiesById[id];
		if (!entity) {
			return;
		}

		ids.push(id);
		for (const childId of entity.childIds ?? []) {
			visit(childId);
		}
	};

	visit(rootId);
	return ids;
};

const getRecipeClonePolicy = (
	rootId: string,
	entitiesById: Record<string, FlatEntity>,
	partialBehavior: PartialRecipeCloneBehavior,
): RecipeClonePolicy => {
	const subtreeIds = collectSubtreeIds(rootId, entitiesById);
	const recipeInstanceIds = new Set<string>();
	for (const id of subtreeIds) {
		const metadata = getElementRecipeMetadata(entitiesById[id]);
		if (metadata) {
			recipeInstanceIds.add(metadata.instanceId);
		}
	}

	const policy: RecipeClonePolicy = {
		preserveInstanceIds: {},
		stripInstanceIds: new Set(),
	};

	for (const instanceId of recipeInstanceIds) {
		const structuralIds = getRecipeOwnedStructuralIds(entitiesById, instanceId);
		const hasCompleteRecipeStructure =
			structuralIds.length > 0 &&
			structuralIds.every((structuralId) => subtreeIds.has(structuralId)) &&
			structuralIds.some((structuralId) =>
				isRecipeRoot(entitiesById[structuralId]),
			);

		if (hasCompleteRecipeStructure) {
			policy.preserveInstanceIds[instanceId] = null;
			continue;
		}

		if (partialBehavior === "reject") {
			throw new DesignTransformError(
				"RECIPE_STRUCTURAL_NODE_LOCKED",
				`Cannot copy subtree "${rootId}" because it contains only part of attached recipe instance "${instanceId}". Copy the recipe root or detach the recipe before copying partial recipe-owned structure.`,
			);
		}

		policy.stripInstanceIds.add(instanceId);
	}

	return policy;
};

const getSystemComponentClonePolicy = (
	rootId: string,
	entitiesById: Record<string, FlatEntity>,
	partialBehavior: PartialSystemComponentCloneBehavior,
): SystemComponentClonePolicy => {
	const subtreeIds = collectSubtreeIds(rootId, entitiesById);
	const instanceIds = new Set<string>();
	for (const id of subtreeIds) {
		const metadata = getElementSystemComponentMetadata(entitiesById[id]);
		if (metadata) {
			instanceIds.add(metadata.instanceId);
		}
	}

	const policy: SystemComponentClonePolicy = {
		preserveInstanceIds: {},
		stripInstanceIds: new Set(),
	};

	for (const instanceId of instanceIds) {
		const structuralIds = getSystemComponentOwnedStructuralIds(
			entitiesById,
			instanceId,
		);
		const hasCompleteStructure =
			structuralIds.length > 0 &&
			structuralIds.every((structuralId) => subtreeIds.has(structuralId)) &&
			structuralIds.some((structuralId) =>
				isSystemComponentRoot(entitiesById[structuralId]),
			);

		if (hasCompleteStructure) {
			policy.preserveInstanceIds[instanceId] = null;
			continue;
		}

		if (partialBehavior === "reject") {
			throw new DesignTransformError(
				"COMPONENT_STRUCTURE_LOCKED",
				`Cannot copy subtree "${rootId}" because it contains only part of attached system component instance "${instanceId}". Copy the component root or detach the component before copying partial component-owned structure.`,
			);
		}

		policy.stripInstanceIds.add(instanceId);
	}

	return policy;
};

const getPreservedSystemComponentSystemIds = (
	policy: SystemComponentClonePolicy,
	sourceEntitiesById: Record<string, FlatEntity>,
): string[] => {
	const systemIds = new Set<string>();

	for (const instanceId of Object.keys(policy.preserveInstanceIds)) {
		const structuralIds = getSystemComponentOwnedStructuralIds(
			sourceEntitiesById,
			instanceId,
		);
		const rootId = structuralIds.find((structuralId) =>
			isSystemComponentRoot(sourceEntitiesById[structuralId]),
		);
		const metadata = rootId
			? getElementSystemComponentMetadata(sourceEntitiesById[rootId])
			: null;
		if (metadata?.systemId) {
			systemIds.add(metadata.systemId);
		}
	}

	return [...systemIds];
};

const assertAllPreservedSystemComponentRootsTargetLinked = async (
	projectRoot: string | undefined,
	targetDesign: Pick<TrickroomDesign, "systemId" | "systemName">,
	componentSystemIds: string[],
) => {
	for (const componentSystemId of componentSystemIds) {
		await assertPreservedSystemComponentRootsTargetLinked(
			projectRoot,
			targetDesign,
			componentSystemId,
		);
	}
};

const assertPreservedSystemComponentRootsTargetLinked = async (
	projectRoot: string | undefined,
	targetDesign: Pick<TrickroomDesign, "systemId" | "systemName">,
	componentSystemId: string,
) => {
	if (projectRoot) {
		await assertDesignLinkedToSystemHandle(
			projectRoot,
			targetDesign,
			componentSystemId,
		);
		return;
	}

	if (!designReferencesSystemHandle(targetDesign, componentSystemId, null)) {
		const designHandle =
			targetDesign.systemId ?? targetDesign.systemName ?? null;
		throw new DesignTransformError(
			"DESIGN_NOT_LINKED_TO_SYSTEM",
			designHandle === null
				? `Cannot preserve an attached system component from "${componentSystemId}" because the target design is not linked to a design system.`
				: `Cannot preserve an attached system component from "${componentSystemId}" because the target design is linked to "${designHandle}" instead.`,
		);
	}
};

const cloneExtractedEntityProps = (
	source: FlatEntity,
	recipeClonePolicy: RecipeClonePolicy,
	systemComponentClonePolicy: SystemComponentClonePolicy,
): Props => {
	let props = { ...source.props };
	const metadata = getElementRecipeMetadata(source);
	if (metadata) {
		if (
			Object.hasOwn(recipeClonePolicy.preserveInstanceIds, metadata.instanceId)
		) {
			const targetInstanceId =
				recipeClonePolicy.preserveInstanceIds[metadata.instanceId] ??
				createDesignElementId();
			recipeClonePolicy.preserveInstanceIds[metadata.instanceId] =
				targetInstanceId;
			props = { ...props, [recipeInstanceProp]: targetInstanceId };
		} else if (recipeClonePolicy.stripInstanceIds.has(metadata.instanceId)) {
			props = omitRecipeMarkerProps(props);
		}
	}

	const componentMetadata = getElementSystemComponentMetadata(source);
	if (componentMetadata) {
		if (
			Object.hasOwn(
				systemComponentClonePolicy.preserveInstanceIds,
				componentMetadata.instanceId,
			)
		) {
			const targetInstanceId =
				systemComponentClonePolicy.preserveInstanceIds[
					componentMetadata.instanceId
				] ?? createDesignElementId();
			systemComponentClonePolicy.preserveInstanceIds[
				componentMetadata.instanceId
			] = targetInstanceId;
			props = { ...props, [systemComponentInstanceProp]: targetInstanceId };
		} else if (
			systemComponentClonePolicy.stripInstanceIds.has(
				componentMetadata.instanceId,
			)
		) {
			props = omitSystemComponentMarkerProps(props);
		}
	}

	return props;
};

export const applyExtractSubtree = async (
	design: TrickroomDesign,
	params: ExtractSubtreeParams,
): Promise<ExtractSubtreeResult> => {
	const flat = normalizeDesignForMutation(design);
	const entity = flat.entitiesById[params.elementId];
	if (!entity) {
		throw new DesignTransformError(
			"ELEMENT_NOT_FOUND",
			`Element "${params.elementId}" not found.`,
		);
	}
	const name = getExtractedDesignName(entity, params.name);
	const targetSystemId =
		params.systemId === undefined ? flat.systemId : params.systemId;
	const targetSystemName =
		params.systemId !== undefined
			? undefined
			: params.systemName === undefined
				? flat.systemName
				: normalizeExtractedSystemName(params.systemName);
	const targetLinkageDesign: Pick<TrickroomDesign, "systemId" | "systemName"> =
		{
			...(targetSystemId !== undefined ? { systemId: targetSystemId } : {}),
			...(targetSystemName !== undefined
				? { systemName: targetSystemName }
				: {}),
		};

	const targetEntitiesById: Record<string, FlatEntity> = {};
	const idMap: Record<string, string> = {};
	const recipeClonePolicy = getRecipeClonePolicy(
		params.elementId,
		flat.entitiesById,
		"strip",
	);
	const systemComponentClonePolicy = getSystemComponentClonePolicy(
		params.elementId,
		flat.entitiesById,
		"strip",
	);
	const preservedComponentSystemIds = getPreservedSystemComponentSystemIds(
		systemComponentClonePolicy,
		flat.entitiesById,
	);
	if (preservedComponentSystemIds.length > 0) {
		await assertAllPreservedSystemComponentRootsTargetLinked(
			params.projectRoot,
			targetLinkageDesign,
			preservedComponentSystemIds,
		);
	}
	const rootId = cloneEntitySubtree(
		params.elementId,
		null,
		flat.entitiesById,
		targetEntitiesById,
		idMap,
		recipeClonePolicy,
		systemComponentClonePolicy,
	);
	const newDesign = serializeFlatDesign({
		name,
		...(targetSystemId !== undefined ? { systemId: targetSystemId } : {}),
		...(targetSystemName !== undefined ? { systemName: targetSystemName } : {}),
		...(flat.componentMigrationPolicy !== undefined
			? { componentMigrationPolicy: flat.componentMigrationPolicy }
			: {}),
		rootIds: [rootId],
		entitiesById: targetEntitiesById,
	});

	return {
		newDesign,
		changedElementId: rootId,
		idMap,
	};
};

const assertValidCopyInsertionTarget = (
	flat: FlatDesign,
	parentId: string | null,
	index: number,
	candidate: RecipeSlotChildRef,
) => {
	if (!Number.isInteger(index)) {
		throw new DesignTransformError(
			"INVALID_INDEX",
			"Index must be an integer.",
		);
	}

	if (index < 0) {
		throw new DesignTransformError(
			"INDEX_OUT_OF_BOUNDS",
			`Insertion index ${index} is outside the valid range.`,
		);
	}

	if (parentId === null) {
		if (index > flat.rootIds.length) {
			throw new DesignTransformError(
				"INDEX_OUT_OF_BOUNDS",
				`Insertion index ${index} is outside the valid range 0..${flat.rootIds.length}.`,
			);
		}
		return;
	}

	const parent = flat.entitiesById[parentId];
	if (!parent) {
		throw new DesignTransformError(
			"PARENT_NOT_FOUND",
			`Parent element "${parentId}" not found.`,
		);
	}

	assertCanInsertIntoRecipeStructure(flat.entitiesById, parentId);
	assertCanInsertIntoSystemComponentStructure(flat.entitiesById, parentId);
	assertRecipeSlotAllowsChild(flat.entitiesById, parentId, candidate);
	if (!canHaveElementChildren(parent.role)) {
		throw new DesignTransformError(
			"PARENT_CANNOT_HAVE_CHILDREN",
			`Cannot copy a subtree into ${parent.role} role element "${parentId}".`,
		);
	}

	const childCount = parent.childIds?.length;
	if (childCount === undefined) {
		throw new DesignTransformError(
			"PARENT_NOT_FOUND",
			`Parent element "${parentId}" has inconsistent child state.`,
		);
	}

	if (index > childCount) {
		throw new DesignTransformError(
			"INDEX_OUT_OF_BOUNDS",
			`Insertion index ${index} is outside the valid range 0..${childCount}.`,
		);
	}
};

export const applyCopySubtree = async (
	sourceDesign: TrickroomDesign,
	targetDesign: TrickroomDesign,
	params: CopySubtreeParams,
): Promise<CopySubtreeResult> => {
	const sourceFlat = normalizeDesignForMutation(sourceDesign);
	const targetFlat = normalizeDesignForMutation(targetDesign);
	const sourceRoot = sourceFlat.entitiesById[params.sourceElementId];
	if (!sourceRoot) {
		throw new DesignTransformError(
			"ELEMENT_NOT_FOUND",
			`Element "${params.sourceElementId}" not found.`,
		);
	}

	assertValidCopyInsertionTarget(
		targetFlat,
		params.parentId,
		params.index,
		getRecipeSlotCandidateFromProps(sourceRoot.props),
	);

	const sameDesign =
		params.sameDesign === true || sourceDesign === targetDesign;
	const sourceSubtreeIds = collectSubtreeIds(
		params.sourceElementId,
		sourceFlat.entitiesById,
	);
	if (
		sameDesign &&
		params.parentId !== null &&
		sourceSubtreeIds.has(params.parentId)
	) {
		throw new DesignTransformError(
			"CYCLE_DETECTED",
			`Cannot copy element "${params.sourceElementId}" into its own subtree.`,
		);
	}

	const idMap: Record<string, string> = {};
	const targetEntitiesById = { ...targetFlat.entitiesById };
	const recipeClonePolicy = getRecipeClonePolicy(
		params.sourceElementId,
		sourceFlat.entitiesById,
		"reject",
	);
	const systemComponentClonePolicy = getSystemComponentClonePolicy(
		params.sourceElementId,
		sourceFlat.entitiesById,
		"reject",
	);
	const preservedComponentSystemIds = getPreservedSystemComponentSystemIds(
		systemComponentClonePolicy,
		sourceFlat.entitiesById,
	);
	if (preservedComponentSystemIds.length > 0) {
		await assertAllPreservedSystemComponentRootsTargetLinked(
			params.projectRoot,
			targetDesign,
			preservedComponentSystemIds,
		);
	}
	const rootElementId = cloneEntitySubtree(
		params.sourceElementId,
		params.parentId,
		sourceFlat.entitiesById,
		targetEntitiesById,
		idMap,
		recipeClonePolicy,
		systemComponentClonePolicy,
	);

	if (sameDesign) {
		const copiedRoot = targetEntitiesById[rootElementId];
		const originalName =
			typeof sourceRoot.props["data-trickroom-name"] === "string"
				? sourceRoot.props["data-trickroom-name"]
				: "";
		targetEntitiesById[rootElementId] = {
			...copiedRoot,
			props: {
				...copiedRoot.props,
				"data-trickroom-name": `${originalName} Copy`,
			},
		};
	}

	const nextRootIds =
		params.parentId === null
			? insertAt(targetFlat.rootIds, rootElementId, params.index)
			: targetFlat.rootIds;
	if (params.parentId !== null) {
		const parent = targetEntitiesById[params.parentId];
		targetEntitiesById[params.parentId] = {
			...parent,
			childIds: insertAt(parent.childIds ?? [], rootElementId, params.index),
		};
	}

	const sourceElementIds = getSubtreeIdsPreOrder(
		params.sourceElementId,
		sourceFlat.entitiesById,
	);
	const elementIds = sourceElementIds.map((sourceId) => idMap[sourceId]);

	return {
		design: serializeFlatDesign({
			...targetFlat,
			rootIds: nextRootIds,
			entitiesById: targetEntitiesById,
		}),
		changedElementId: rootElementId,
		sourceElementId: params.sourceElementId,
		rootElementId,
		idMap,
		inserted: {
			nodeCount: elementIds.length,
			rootElementId,
			elementIds,
		},
	};
};
