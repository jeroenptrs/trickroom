import {
	getControlDefinitions,
	getLibraryComponent,
	isJsonPrimitive,
	isRegistryId,
	resolveRegistryComponent,
	SYSTEM_PROP_KEYS,
} from "../libraries/registry";
import {
	getElementRecipeMetadata,
	getRecipeOwnedStructuralIds,
	isRecipeRoot,
} from "../recipes/ownership";
import { omitRecipeMarkerProps } from "../recipes/markers";
import type { JsonPrimitive, Props, RecipeTemplateNode, Role } from "../types";
import { assetIdProp, iconIdProp } from "./resource-props";
import {
	getElementSystemComponentMetadata,
	getSystemComponentOwnedStructuralIds,
	isSystemComponentRoot,
} from "./system-component-ownership";
import { omitSystemComponentMarkerProps } from "./system-component-markers";

/**
 * Component-draft extraction always strips recipe and system-component instance
 * markers from every node in the selected subtree.
 *
 * - Partial recipe/component instances: markers removed; structural nodes kept.
 * - Complete recipe/component instances: markers removed; structural nodes kept.
 *   Unlike design-file extract, instance ids are never preserved on templates.
 * - Slot host markers are not promoted into draft slot definitions in v1.
 *   Authored `template.slot` is preserved when a stripped node had a slot name.
 */
export const DESIGN_SUBTREE_TO_COMPONENT_DRAFT_MARKER_POLICY =
	"strip-all-instance-markers" as const;

export type DesignSubtreeToComponentDraftMarkerPolicy =
	typeof DESIGN_SUBTREE_TO_COMPONENT_DRAFT_MARKER_POLICY;

export type DesignSubtreeEntity = {
	id: string;
	props: Props;
	parentId: string | null;
	role: Role;
	childIds?: string[];
	text?: string;
};

export type DesignSubtreeToComponentDraftMarkerSummary = {
	policy: DesignSubtreeToComponentDraftMarkerPolicy;
	recipeInstanceIds: string[];
	partialRecipeInstanceIds: string[];
	completeRecipeInstanceIds: string[];
	componentInstanceIds: string[];
	partialComponentInstanceIds: string[];
	completeComponentInstanceIds: string[];
};

export type ConvertDesignSubtreeToComponentDraftRootResult = {
	root: RecipeTemplateNode;
	markers: DesignSubtreeToComponentDraftMarkerSummary;
	pathByEntityId: Record<string, string>;
};

const RESOURCE_PROP_KEYS = new Set([assetIdProp, iconIdProp]);

const collectSubtreeEntityIds = (
	rootId: string,
	entitiesById: Record<string, DesignSubtreeEntity | undefined>,
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

const isValidTemplatePath = (pathValue: string) =>
	pathValue.length > 0 && !pathValue.includes("/");

const collectTemplateNodes = (root: RecipeTemplateNode): RecipeTemplateNode[] => {
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

const slugifyPathBase = (name: string, component: string) => {
	const fromName = name
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/gu, "-")
		.replace(/^-+|-+$/gu, "");
	if (fromName) {
		return fromName;
	}

	const fromComponent = component
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/gu, "-")
		.replace(/^-+|-+$/gu, "");
	return fromComponent || "node";
};

const recipePathSegment = (path: string | null) => {
	if (!path) {
		return null;
	}

	const segments = path.split(".").filter(Boolean);
	return segments.length > 0 ? segments[segments.length - 1] : null;
};

const allocateTemplatePath = (usedPaths: Set<string>, base: string) => {
	let index = 1;
	let candidate = base;
	while (usedPaths.has(candidate)) {
		candidate = `${base}-${index}`;
		index += 1;
	}
	usedPaths.add(candidate);
	return candidate;
};

const stripInstanceMarkers = (props: Props): Props => {
	let nextProps = omitRecipeMarkerProps(props);
	nextProps = omitSystemComponentMarkerProps(nextProps);
	return nextProps;
};

const getPathBase = (
	entity: DesignSubtreeEntity,
	recipePath: string | null,
	componentPath: string | null,
) => {
	const name =
		typeof entity.props["data-trickroom-name"] === "string"
			? entity.props["data-trickroom-name"]
			: "";
	const component = entity.props["data-trickroom-component"] ?? "node";
	const fromRecipe = recipePathSegment(recipePath);
	const fromComponent = recipePathSegment(componentPath);
	if (fromRecipe) {
		return slugifyPathBase(fromRecipe, component);
	}
	if (fromComponent && fromComponent !== "root") {
		return slugifyPathBase(fromComponent, component);
	}
	return slugifyPathBase(name, component);
};

const extractAuthoredTemplateProps = (
	props: Props,
	library: string,
	component: string,
) => {
	if (!isRegistryId(library)) {
		return undefined;
	}

	const definition = getLibraryComponent(library, component);
	const allowedControlProps = new Set(
		getControlDefinitions(definition).map((control) => control.prop),
	);
	const nextProps: Record<string, JsonPrimitive | undefined> = {};

	for (const [key, value] of Object.entries(props)) {
		if (
			SYSTEM_PROP_KEYS.has(key) ||
			key === "className" ||
			key === "data-trickroom-name" ||
			key === "data-trickroom-library" ||
			key === "data-trickroom-component" ||
			key === "data-trickroom-role"
		) {
			continue;
		}

		if (
			!allowedControlProps.has(key) &&
			!RESOURCE_PROP_KEYS.has(key)
		) {
			continue;
		}

		if (value !== undefined && isJsonPrimitive(value)) {
			nextProps[key] = value;
		}
	}

	return Object.keys(nextProps).length > 0 ? nextProps : undefined;
};

const summarizeMarkerPolicy = (
	rootId: string,
	entitiesById: Record<string, DesignSubtreeEntity | undefined>,
): DesignSubtreeToComponentDraftMarkerSummary => {
	const subtreeIds = collectSubtreeEntityIds(rootId, entitiesById);
	const recipeInstanceIds = new Set<string>();
	const componentInstanceIds = new Set<string>();

	for (const id of subtreeIds) {
		const entity = entitiesById[id];
		if (!entity) {
			continue;
		}
		const recipeMetadata = getElementRecipeMetadata(entity);
		if (recipeMetadata) {
			recipeInstanceIds.add(recipeMetadata.instanceId);
		}
		const componentMetadata = getElementSystemComponentMetadata(entity);
		if (componentMetadata) {
			componentInstanceIds.add(componentMetadata.instanceId);
		}
	}

	const partialRecipeInstanceIds: string[] = [];
	const completeRecipeInstanceIds: string[] = [];
	for (const instanceId of recipeInstanceIds) {
		const structuralIds = getRecipeOwnedStructuralIds(entitiesById, instanceId);
		const hasCompleteStructure =
			structuralIds.length > 0 &&
			structuralIds.every((structuralId) => subtreeIds.has(structuralId)) &&
			structuralIds.some((structuralId) =>
				isRecipeRoot(entitiesById[structuralId]),
			);
		if (hasCompleteStructure) {
			completeRecipeInstanceIds.push(instanceId);
		} else {
			partialRecipeInstanceIds.push(instanceId);
		}
	}

	const partialComponentInstanceIds: string[] = [];
	const completeComponentInstanceIds: string[] = [];
	for (const instanceId of componentInstanceIds) {
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
			completeComponentInstanceIds.push(instanceId);
		} else {
			partialComponentInstanceIds.push(instanceId);
		}
	}

	return {
		policy: DESIGN_SUBTREE_TO_COMPONENT_DRAFT_MARKER_POLICY,
		recipeInstanceIds: [...recipeInstanceIds].sort(),
		partialRecipeInstanceIds: partialRecipeInstanceIds.sort(),
		completeRecipeInstanceIds: completeRecipeInstanceIds.sort(),
		componentInstanceIds: [...componentInstanceIds].sort(),
		partialComponentInstanceIds: partialComponentInstanceIds.sort(),
		completeComponentInstanceIds: completeComponentInstanceIds.sort(),
	};
};

const convertEntity = (
	entityId: string,
	entitiesById: Record<string, DesignSubtreeEntity | undefined>,
	usedPaths: Set<string>,
	pathByEntityId: Record<string, string>,
	isRoot: boolean,
): RecipeTemplateNode => {
	const entity = entitiesById[entityId];
	if (!entity) {
		throw new Error(`Cannot convert missing design entity: ${entityId}`);
	}

	const library = entity.props["data-trickroom-library"];
	const component = entity.props["data-trickroom-component"];
	if (!library || !component) {
		throw new Error(
			`Cannot convert design entity "${entityId}" without registry references.`,
		);
	}

	const recipeMetadata = getElementRecipeMetadata(entity);
	const componentMetadata = getElementSystemComponentMetadata(entity);
	const strippedProps = stripInstanceMarkers(entity.props);
	const path = isRoot
		? "root"
		: allocateTemplatePath(
				usedPaths,
				getPathBase(
					entity,
					recipeMetadata?.path ?? null,
					componentMetadata?.path ?? null,
				),
			);
	if (isRoot) {
		usedPaths.add(path);
	}
	pathByEntityId[entityId] = path;

	const name =
		typeof strippedProps["data-trickroom-name"] === "string"
			? strippedProps["data-trickroom-name"]
			: getLibraryComponent(library, component).label;
	const className =
		typeof strippedProps.className === "string"
			? strippedProps.className
			: undefined;
	const slot = recipeMetadata?.slotName ?? componentMetadata?.slotName;
	const props = extractAuthoredTemplateProps(strippedProps, library, component);

	const node: RecipeTemplateNode = {
		path,
		library,
		component,
		name,
	};

	if (className !== undefined) {
		node.className = className;
	}
	if (props !== undefined) {
		node.props = props;
	}
	if (slot) {
		node.slot = slot;
	}

	if (entity.role === "text") {
		node.text = entity.text ?? "";
		return node;
	}

	if (entity.role === "leaf") {
		return node;
	}

	const children = (entity.childIds ?? []).map((childId) =>
		convertEntity(childId, entitiesById, usedPaths, pathByEntityId, false),
	);
	if (children.length > 0) {
		node.children = children;
	}

	return node;
};

export function summarizeDesignSubtreeToComponentDraftMarkers(
	rootId: string,
	entitiesById: Record<string, DesignSubtreeEntity | undefined>,
): DesignSubtreeToComponentDraftMarkerSummary {
	const entity = entitiesById[rootId];
	if (!entity) {
		throw new Error(`Cannot convert missing design entity: ${rootId}`);
	}

	return summarizeMarkerPolicy(rootId, entitiesById);
}

export function convertDesignSubtreeToComponentDraftRoot(
	rootId: string,
	entitiesById: Record<string, DesignSubtreeEntity | undefined>,
): ConvertDesignSubtreeToComponentDraftRootResult {
	const entity = entitiesById[rootId];
	if (!entity) {
		throw new Error(`Cannot convert missing design entity: ${rootId}`);
	}

	const usedPaths = new Set<string>();
	const pathByEntityId: Record<string, string> = {};
	const root = convertEntity(
		rootId,
		entitiesById,
		usedPaths,
		pathByEntityId,
		true,
	);

	return {
		root,
		markers: summarizeMarkerPolicy(rootId, entitiesById),
		pathByEntityId,
	};
}

export function validateComponentDraftTemplateRoot(root: RecipeTemplateNode): {
	valid: boolean;
	errors: string[];
} {
	const errors: string[] = [];
	const nodes = collectTemplateNodes(root);
	const pathCounts = new Map<string, number>();

	for (const node of nodes) {
		pathCounts.set(node.path, (pathCounts.get(node.path) ?? 0) + 1);
		if (!isValidTemplatePath(node.path)) {
			errors.push(
				`Template path "${node.path}" must be a non-empty identifier without slashes.`,
			);
		}

		const resolution = resolveRegistryComponent(node.library, node.component);
		if (resolution.status === "unknown-library") {
			errors.push(
				`Unknown registry library "${node.library}" at path "${node.path}".`,
			);
		} else if (resolution.status === "unknown-component") {
			errors.push(
				`Unknown component "${node.component}" in registry "${node.library}" at path "${node.path}".`,
			);
		} else if (resolution.definition.role === "text" && node.text === undefined) {
			errors.push(`Text node "${node.path}" is missing text content.`);
		}
	}

	for (const [pathValue, count] of pathCounts.entries()) {
		if (count > 1) {
			errors.push(`Template path "${pathValue}" is duplicated ${count} times.`);
		}
	}

	if ((pathCounts.get(root.path) ?? 0) !== 1) {
		errors.push(`Template must contain exactly one root node at path "${root.path}".`);
	}

	return {
		valid: errors.length === 0,
		errors,
	};
}
