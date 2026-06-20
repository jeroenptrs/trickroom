import { createStore, shallow, useSelector } from "@tanstack/react-store";
import {
	canHaveElementChildren,
	getDefaultText,
	getLibraryComponent,
	SYSTEM_PROP_KEYS,
} from "../libraries/registry";
import type { JsonPrimitive, Props, RecipeTemplateNode, Role } from "../types";
import { convertDesignSubtreeToComponentDraftRoot } from "../utils/design-subtree-to-component-draft";
import { hashComponentDraftSnapshot } from "../utils/system-component-template-hash";
import { inferOverrideTargetCapabilities } from "../utils/system-component-override-targets";
import type {
	SystemComponentOverrideTarget,
	SystemComponentSlotDefinition,
	SystemComponentVariantSchema,
} from "../utils/system-components";

export type ComponentDraftStyleTarget =
	| { mode: "base" }
	| { mode: "variant"; axisKey: string; valueKey: string }
	| { mode: "compound"; compoundIndex: number };

export type ComponentTemplateSelection = {
	library: string;
	component: string;
};

export type ComponentDraftEntity = {
	path: string;
	library: string;
	component: string;
	parentPath: string | null;
	role: Role;
	name?: string;
	className?: string;
	props?: Record<string, JsonPrimitive | undefined>;
	slot?: string;
	childPaths?: string[];
	text?: string;
};

export type ComponentDraftStoreState = {
	componentId: string | null;
	baseVersion?: string;
	slots: Record<string, SystemComponentSlotDefinition>;
	overrideTargets: Record<string, SystemComponentOverrideTarget>;
	variants: SystemComponentVariantSchema | null;
	variantsDirty: boolean;
	styleTarget: ComponentDraftStyleTarget;
	rootPath: string | null;
	entitiesByPath: Record<string, ComponentDraftEntity>;
	selectedPath: string | null;
	dirtyPaths: Record<string, true>;
	templateDirty: boolean;
	revision: number;
};

const baseStyleTarget: ComponentDraftStyleTarget = { mode: "base" };

export type HydrateComponentDraftInput = {
	componentId: string;
	root: RecipeTemplateNode;
	baseVersion?: string;
	slots?: Record<string, SystemComponentSlotDefinition>;
	overrideTargets?: Record<string, SystemComponentOverrideTarget>;
	variants?: SystemComponentVariantSchema | null;
};

function cloneVariants(
	variants: SystemComponentVariantSchema | null | undefined,
): SystemComponentVariantSchema | null {
	return variants ? structuredClone(variants) : null;
}

export type HydrateComponentDraftResult =
	| "hydrated"
	| "unchanged"
	| "dirty-skipped";

const emptyState: ComponentDraftStoreState = {
	componentId: null,
	slots: {},
	overrideTargets: {},
	variants: null,
	variantsDirty: false,
	styleTarget: baseStyleTarget,
	rootPath: null,
	entitiesByPath: {},
	selectedPath: null,
	dirtyPaths: {},
	templateDirty: false,
	revision: 0,
};
const emptyPaths: string[] = [];

export const componentDraftStore =
	createStore<ComponentDraftStoreState>(emptyState);

const canHaveChildren = (entity: ComponentDraftEntity | null | undefined) =>
	!!entity && canHaveElementChildren(entity.role);

function normalizeTemplateNode(
	node: RecipeTemplateNode,
	parentPath: string | null,
	entitiesByPath: Record<string, ComponentDraftEntity>,
) {
	const role = getLibraryComponent(node.library, node.component).role;
	const entity: ComponentDraftEntity = {
		path: node.path,
		library: node.library,
		component: node.component,
		parentPath,
		role,
	};

	if (node.name !== undefined) {
		entity.name = node.name;
	}
	if (node.className !== undefined) {
		entity.className = node.className;
	}
	if (node.props !== undefined) {
		entity.props = { ...node.props };
	}
	if (node.slot !== undefined) {
		entity.slot = node.slot;
	}

	entitiesByPath[node.path] = entity;

	if (role === "text") {
		entity.text = node.text ?? "";
		return;
	}

	if (role === "leaf") {
		entity.childPaths = [];
		return;
	}

	entity.childPaths = (node.children ?? []).map((child) => child.path);
	for (const child of node.children ?? []) {
		normalizeTemplateNode(child, node.path, entitiesByPath);
	}
}

function cloneSlots(
	slots: Record<string, SystemComponentSlotDefinition> | undefined,
) {
	return slots ? structuredClone(slots) : {};
}

function cloneOverrideTargets(
	overrideTargets: Record<string, SystemComponentOverrideTarget> | undefined,
) {
	return overrideTargets ? structuredClone(overrideTargets) : {};
}

export function normalizeComponentDraft(
	input: HydrateComponentDraftInput,
): ComponentDraftStoreState {
	const entitiesByPath: Record<string, ComponentDraftEntity> = {};
	normalizeTemplateNode(input.root, null, entitiesByPath);

	return {
		componentId: input.componentId,
		...(input.baseVersion !== undefined
			? { baseVersion: input.baseVersion }
			: {}),
		slots: cloneSlots(input.slots),
		overrideTargets: cloneOverrideTargets(input.overrideTargets),
		variants: cloneVariants(input.variants),
		variantsDirty: false,
		styleTarget: { mode: "base" },
		rootPath: input.root.path,
		entitiesByPath,
		selectedPath: null,
		dirtyPaths: {},
		templateDirty: false,
		revision: 0,
	};
}

function serializeTemplateNode(
	path: string,
	entitiesByPath: Record<string, ComponentDraftEntity>,
): RecipeTemplateNode {
	const entity = entitiesByPath[path];
	if (!entity) {
		throw new Error(`Cannot serialize missing component draft node: ${path}`);
	}

	const node: RecipeTemplateNode = {
		path: entity.path,
		library: entity.library,
		component: entity.component,
	};

	if (entity.name !== undefined) {
		node.name = entity.name;
	}
	if (entity.className !== undefined) {
		node.className = entity.className;
	}
	if (entity.props !== undefined && Object.keys(entity.props).length > 0) {
		node.props = { ...entity.props };
	}
	if (entity.slot !== undefined) {
		node.slot = entity.slot;
	}

	if (entity.role === "text") {
		if (entity.text !== undefined) {
			node.text = entity.text;
		}
		return node;
	}

	const children = (entity.childPaths ?? []).map((childPath) =>
		serializeTemplateNode(childPath, entitiesByPath),
	);
	if (children.length > 0) {
		node.children = children;
	}

	return node;
}

export function serializeComponentDraftState(
	state: ComponentDraftStoreState,
): RecipeTemplateNode {
	if (!state.rootPath) {
		throw new Error(
			"Cannot serialize component draft without a root template.",
		);
	}

	return serializeTemplateNode(state.rootPath, state.entitiesByPath);
}

const hasTemplateDirtyChanges = (state: ComponentDraftStoreState) =>
	state.templateDirty || Object.keys(state.dirtyPaths).length > 0;

const hasDirtyChanges = (state: ComponentDraftStoreState) =>
	hasTemplateDirtyChanges(state) || state.variantsDirty;

const stableVariantSchemaSignature = (
	variants: SystemComponentVariantSchema | null,
) => JSON.stringify(variants ?? null);

const isSameCleanDraft = (
	state: ComponentDraftStoreState,
	nextState: ComponentDraftStoreState,
) => {
	if (!state.rootPath || !nextState.rootPath) {
		return false;
	}

	return (
		state.componentId === nextState.componentId &&
		state.baseVersion === nextState.baseVersion &&
		JSON.stringify(state.slots) === JSON.stringify(nextState.slots) &&
		JSON.stringify(state.overrideTargets) ===
			JSON.stringify(nextState.overrideTargets) &&
		stableVariantSchemaSignature(state.variants) ===
			stableVariantSchemaSignature(nextState.variants) &&
		JSON.stringify(serializeComponentDraftState(state)) ===
			JSON.stringify(serializeComponentDraftState(nextState))
	);
};

const styleTargetExists = (
	target: ComponentDraftStyleTarget,
	variants: SystemComponentVariantSchema | null,
) => {
	if (target.mode === "base") {
		return true;
	}
	if (target.mode === "variant") {
		return Boolean(variants?.axes[target.axisKey]?.values[target.valueKey]);
	}
	return Boolean(variants?.compoundVariants?.[target.compoundIndex]);
};

const styleTargetsEqual = (
	left: ComponentDraftStyleTarget,
	right: ComponentDraftStyleTarget,
) => {
	if (left.mode !== right.mode) {
		return false;
	}
	if (left.mode === "variant" && right.mode === "variant") {
		return left.axisKey === right.axisKey && left.valueKey === right.valueKey;
	}
	if (left.mode === "compound" && right.mode === "compound") {
		return left.compoundIndex === right.compoundIndex;
	}
	return true;
};

export function hydrateComponentDraft(
	input: HydrateComponentDraftInput,
): HydrateComponentDraftResult {
	let result: HydrateComponentDraftResult = "unchanged";
	componentDraftStore.setState((state) => {
		if (hasDirtyChanges(state)) {
			result = "dirty-skipped";
			return state;
		}

		const nextState = normalizeComponentDraft(input);

		if (isSameCleanDraft(state, nextState)) {
			result = "unchanged";
			return state;
		}

		const nextStyleTarget =
			state.componentId === nextState.componentId &&
			styleTargetExists(state.styleTarget, nextState.variants)
				? state.styleTarget
				: baseStyleTarget;

		result = "hydrated";
		return {
			...nextState,
			revision: state.revision + 1,
			selectedPath:
				state.componentId === nextState.componentId &&
				state.selectedPath &&
				nextState.entitiesByPath[state.selectedPath]
					? state.selectedPath
					: null,
			styleTarget: nextStyleTarget,
		};
	});
	return result;
}

export type HydrateComponentDraftFromDesignSubtreeInput = {
	componentId: string;
	rootId: string;
	entitiesById: Record<
		string,
		{
			id: string;
			props: Props;
			parentId: string | null;
			role: Role;
			childIds?: string[];
			text?: string;
		}
	>;
	baseVersion?: string;
};

export function hydrateComponentDraftFromDesignSubtree(
	input: HydrateComponentDraftFromDesignSubtreeInput,
): HydrateComponentDraftResult {
	const { root } = convertDesignSubtreeToComponentDraftRoot(
		input.rootId,
		input.entitiesById,
	);

	return hydrateComponentDraft({
		componentId: input.componentId,
		root,
		...(input.baseVersion !== undefined
			? { baseVersion: input.baseVersion }
			: {}),
		slots: {},
		overrideTargets: {},
		variants: null,
	});
}

export function resetComponentDraftStore() {
	componentDraftStore.setState(() => emptyState);
}

export function selectTemplateNode(path: string | null) {
	componentDraftStore.setState((state) => {
		if (state.selectedPath === path) {
			return state;
		}

		return {
			...state,
			selectedPath: path && state.entitiesByPath[path] ? path : null,
		};
	});
}

function filterWritableTemplateNodeProps(
	patch: Record<string, JsonPrimitive | undefined>,
) {
	const nextPatch: Record<string, JsonPrimitive | undefined> = {};
	for (const [key, value] of Object.entries(patch)) {
		if (!SYSTEM_PROP_KEYS.has(key)) {
			nextPatch[key] = value;
		}
	}
	return nextPatch;
}

export function updateTemplateNodeProps(
	path: string,
	patch: Record<string, JsonPrimitive | undefined>,
) {
	const writablePatch = filterWritableTemplateNodeProps(patch);
	if (Object.keys(writablePatch).length === 0) {
		return;
	}

	componentDraftStore.setState((state) => {
		const entity = state.entitiesByPath[path];
		if (!entity) {
			return state;
		}

		return {
			...state,
			entitiesByPath: {
				...state.entitiesByPath,
				[path]: {
					...entity,
					props: {
						...(entity.props ?? {}),
						...writablePatch,
					},
				},
			},
			dirtyPaths: {
				...state.dirtyPaths,
				[path]: true,
			},
			revision: state.revision + 1,
		};
	});
}

export function getVariantClassNameForPath(
	state: ComponentDraftStoreState,
	axisKey: string,
	valueKey: string,
	path: string,
) {
	return (
		state.variants?.axes[axisKey]?.values[valueKey]?.classesByPath?.[path] ?? ""
	);
}

export function getCompoundClassNameForPath(
	state: ComponentDraftStoreState,
	compoundIndex: number,
	path: string,
) {
	return (
		state.variants?.compoundVariants?.[compoundIndex]?.classesByPath?.[path] ??
		""
	);
}

export function getEffectiveDraftNodeClassName(
	state: ComponentDraftStoreState,
	path: string,
) {
	if (state.styleTarget.mode === "variant") {
		return getVariantClassNameForPath(
			state,
			state.styleTarget.axisKey,
			state.styleTarget.valueKey,
			path,
		);
	}

	if (state.styleTarget.mode === "compound") {
		return getCompoundClassNameForPath(
			state,
			state.styleTarget.compoundIndex,
			path,
		);
	}

	return state.entitiesByPath[path]?.className ?? "";
}

export function setComponentDraftStyleTarget(
	target: ComponentDraftStyleTarget,
) {
	componentDraftStore.setState((state) => {
		if (!styleTargetExists(target, state.variants)) {
			return state;
		}

		if (styleTargetsEqual(state.styleTarget, target)) {
			return state;
		}

		return {
			...state,
			styleTarget: target,
		};
	});
}

export function replaceComponentDraftVariants(
	variants: SystemComponentVariantSchema | null,
) {
	componentDraftStore.setState((state) => {
		const nextVariants = cloneVariants(variants);
		if (
			stableVariantSchemaSignature(state.variants) ===
			stableVariantSchemaSignature(nextVariants)
		) {
			return state;
		}

		let nextStyleTarget = state.styleTarget;
		if (state.styleTarget.mode === "variant") {
			const { axisKey, valueKey } = state.styleTarget;
			if (!nextVariants?.axes[axisKey]?.values[valueKey]) {
				nextStyleTarget = { mode: "base" };
			}
		} else if (state.styleTarget.mode === "compound") {
			// Compounds are an ordered list, so editing a single compound's
			// conditions keeps every index aligned, but adding or removing one
			// shifts indices. Reset to base whenever the count changes (or the
			// targeted compound disappears) rather than risk pointing at a
			// different compound than the user selected.
			const previousCount = state.variants?.compoundVariants?.length ?? 0;
			const nextCount = nextVariants?.compoundVariants?.length ?? 0;
			if (
				previousCount !== nextCount ||
				!nextVariants?.compoundVariants?.[state.styleTarget.compoundIndex]
			) {
				nextStyleTarget = { mode: "base" };
			}
		}

		return {
			...state,
			variants: nextVariants,
			variantsDirty: true,
			styleTarget: nextStyleTarget,
			revision: state.revision + 1,
		};
	});
}

export function updateVariantClassesByPath(
	axisKey: string,
	valueKey: string,
	path: string,
	className: string,
) {
	componentDraftStore.setState((state) => {
		const variants = state.variants;
		const axis = variants?.axes[axisKey];
		const value = axis?.values[valueKey];
		if (!variants || !axis || !value) {
			return state;
		}

		const nextClassesByPath = { ...(value.classesByPath ?? {}) };
		if (className.trim()) {
			nextClassesByPath[path] = className;
		} else {
			delete nextClassesByPath[path];
		}

		const nextValue = { ...value };
		if (Object.keys(nextClassesByPath).length > 0) {
			nextValue.classesByPath = nextClassesByPath;
		} else {
			delete nextValue.classesByPath;
		}

		return {
			...state,
			variants: {
				...variants,
				axes: {
					...variants.axes,
					[axisKey]: {
						...axis,
						values: {
							...axis.values,
							[valueKey]: nextValue,
						},
					},
				},
			},
			variantsDirty: true,
			revision: state.revision + 1,
		};
	});
}

export function updateCompoundClassesByPath(
	compoundIndex: number,
	path: string,
	className: string,
) {
	componentDraftStore.setState((state) => {
		const variants = state.variants;
		const compound = variants?.compoundVariants?.[compoundIndex];
		if (!variants || !compound) {
			return state;
		}

		const nextClassesByPath = { ...compound.classesByPath };
		if (className.trim()) {
			nextClassesByPath[path] = className;
		} else {
			delete nextClassesByPath[path];
		}

		const nextCompound = { ...compound, classesByPath: nextClassesByPath };
		const nextCompounds = (variants.compoundVariants ?? []).map(
			(entry, index) => (index === compoundIndex ? nextCompound : entry),
		);

		return {
			...state,
			variants: { ...variants, compoundVariants: nextCompounds },
			variantsDirty: true,
			revision: state.revision + 1,
		};
	});
}

export function setComponentDraftStyleClassName(
	path: string,
	className: string,
) {
	const state = componentDraftStore.get();
	if (state.styleTarget.mode === "variant") {
		updateVariantClassesByPath(
			state.styleTarget.axisKey,
			state.styleTarget.valueKey,
			path,
			className,
		);
		return;
	}

	if (state.styleTarget.mode === "compound") {
		updateCompoundClassesByPath(
			state.styleTarget.compoundIndex,
			path,
			className,
		);
		return;
	}

	updateTemplateNodeClassName(path, className);
}

export function updateTemplateNodeClassName(path: string, className: string) {
	if (componentDraftStore.get().styleTarget.mode !== "base") {
		return;
	}

	componentDraftStore.setState((state) => {
		const entity = state.entitiesByPath[path];
		if (!entity) {
			return state;
		}

		return {
			...state,
			entitiesByPath: {
				...state.entitiesByPath,
				[path]: {
					...entity,
					className,
				},
			},
			dirtyPaths: {
				...state.dirtyPaths,
				[path]: true,
			},
			revision: state.revision + 1,
		};
	});
}

export function updateTemplateNodeName(path: string, name: string) {
	componentDraftStore.setState((state) => {
		const entity = state.entitiesByPath[path];
		if (!entity) {
			return state;
		}

		const trimmed = name.trim();
		if (!trimmed) {
			return state;
		}

		return {
			...state,
			entitiesByPath: {
				...state.entitiesByPath,
				[path]: {
					...entity,
					name: trimmed,
				},
			},
			dirtyPaths: {
				...state.dirtyPaths,
				[path]: true,
			},
			revision: state.revision + 1,
		};
	});
}

export function updateTemplateNodeText(path: string, text: string) {
	componentDraftStore.setState((state) => {
		const entity = state.entitiesByPath[path];
		if (!entity || entity.role !== "text") {
			return state;
		}

		return {
			...state,
			entitiesByPath: {
				...state.entitiesByPath,
				[path]: {
					...entity,
					text,
				},
			},
			dirtyPaths: {
				...state.dirtyPaths,
				[path]: true,
			},
			revision: state.revision + 1,
		};
	});
}

function defaultOverrideTargetId(
	path: string,
	overrideTargets: Record<string, SystemComponentOverrideTarget>,
) {
	let candidate = path;
	let index = 1;
	while (overrideTargets[candidate]) {
		candidate = `${path}-${index}`;
		index += 1;
	}
	return candidate;
}

export function addTemplateNodeOverrideTarget(path: string) {
	componentDraftStore.setState((state) => {
		const entity = state.entitiesByPath[path];
		if (!entity) {
			return state;
		}
		const existing = Object.values(state.overrideTargets).find(
			(target) => target.path === path,
		);
		if (existing) {
			return state;
		}

		const targetId = defaultOverrideTargetId(path, state.overrideTargets);
		const label = entity.name?.trim() || entity.component || targetId;
		return {
			...state,
			overrideTargets: {
				...state.overrideTargets,
				[targetId]: {
					targetId,
					label,
					path,
					capabilities: inferOverrideTargetCapabilities(entity),
				},
			},
			templateDirty: true,
			revision: state.revision + 1,
		};
	});
}

export function removeTemplateNodeOverrideTarget(targetId: string) {
	componentDraftStore.setState((state) => {
		if (!state.overrideTargets[targetId]) {
			return state;
		}
		const nextTargets = { ...state.overrideTargets };
		delete nextTargets[targetId];
		return {
			...state,
			overrideTargets: nextTargets,
			templateDirty: true,
			revision: state.revision + 1,
		};
	});
}

export function updateTemplateNodeOverrideTarget(
	currentTargetId: string,
	patch: { targetId?: string; label?: string },
) {
	componentDraftStore.setState((state) => {
		const target = state.overrideTargets[currentTargetId];
		if (!target) {
			return state;
		}

		const nextTargetId = patch.targetId?.trim() ?? currentTargetId;
		const nextLabel = patch.label?.trim() ?? target.label;
		if (
			nextTargetId.length === 0 ||
			nextLabel.length === 0 ||
			(nextTargetId !== currentTargetId && state.overrideTargets[nextTargetId])
		) {
			return state;
		}

		const nextTargets = { ...state.overrideTargets };
		delete nextTargets[currentTargetId];
		nextTargets[nextTargetId] = {
			...target,
			targetId: nextTargetId,
			label: nextLabel,
		};
		return {
			...state,
			overrideTargets: nextTargets,
			templateDirty: true,
			revision: state.revision + 1,
		};
	});
}

function normalizeSlotName(value: string) {
	return value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9_-]+/gu, "-")
		.replace(/^-+|-+$/gu, "");
}

function nextSlotName(
	slots: Record<string, SystemComponentSlotDefinition>,
	base: string,
) {
	const normalizedBase = normalizeSlotName(base) || "slot";
	let candidate = normalizedBase;
	let index = 1;
	while (slots[candidate]) {
		candidate = `${normalizedBase}-${index}`;
		index += 1;
	}
	return candidate;
}

export function markTemplateNodeAsSlotHost(path: string) {
	componentDraftStore.setState((state) => {
		const entity = state.entitiesByPath[path];
		if (!entity) {
			return state;
		}

		if (entity.slot && state.slots[entity.slot]?.hostPath === path) {
			return state;
		}

		const slotName = nextSlotName(
			state.slots,
			entity.name ?? entity.component ?? path,
		);
		return {
			...state,
			slots: {
				...state.slots,
				[slotName]: {
					name: slotName,
					label: entity.name?.trim() || entity.component,
					hostPath: path,
				},
			},
			entitiesByPath: {
				...state.entitiesByPath,
				[path]: {
					...entity,
					slot: slotName,
				},
			},
			dirtyPaths: {
				...state.dirtyPaths,
				[path]: true,
			},
			templateDirty: true,
			revision: state.revision + 1,
		};
	});
}

export function removeTemplateNodeSlotHost(path: string) {
	componentDraftStore.setState((state) => {
		const entity = state.entitiesByPath[path];
		if (!entity?.slot) {
			return state;
		}

		const nextSlots = { ...state.slots };
		delete nextSlots[entity.slot];
		const { slot: _slot, ...nextEntity } = entity;

		return {
			...state,
			slots: nextSlots,
			entitiesByPath: {
				...state.entitiesByPath,
				[path]: nextEntity,
			},
			dirtyPaths: {
				...state.dirtyPaths,
				[path]: true,
			},
			templateDirty: true,
			revision: state.revision + 1,
		};
	});
}

export function updateTemplateNodeSlotMetadata(
	path: string,
	metadata: { name?: string; label?: string },
) {
	componentDraftStore.setState((state) => {
		const entity = state.entitiesByPath[path];
		const currentName = entity?.slot;
		const currentSlot = currentName ? state.slots[currentName] : null;
		if (!entity || !currentName || !currentSlot) {
			return state;
		}

		const requestedName =
			metadata.name === undefined
				? currentName
				: normalizeSlotName(metadata.name);
		if (!requestedName) {
			return state;
		}
		if (requestedName !== currentName && state.slots[requestedName]) {
			return state;
		}

		const nextSlot: SystemComponentSlotDefinition = {
			...currentSlot,
			name: requestedName,
			hostPath: path,
		};
		if (metadata.label !== undefined) {
			const label = metadata.label.trim();
			if (label) {
				nextSlot.label = label;
			} else {
				delete nextSlot.label;
			}
		}

		const nextSlots = { ...state.slots };
		delete nextSlots[currentName];
		nextSlots[requestedName] = nextSlot;

		return {
			...state,
			slots: nextSlots,
			entitiesByPath: {
				...state.entitiesByPath,
				[path]: {
					...entity,
					slot: requestedName,
				},
			},
			dirtyPaths: {
				...state.dirtyPaths,
				[path]: true,
			},
			templateDirty: true,
			revision: state.revision + 1,
		};
	});
}

function withoutPath(paths: string[], path: string) {
	return paths.filter((currentPath) => currentPath !== path);
}

function insertAt(paths: string[], path: string, index: number) {
	const nextPaths = [...paths];
	const boundedIndex = Math.max(0, Math.min(index, nextPaths.length));
	nextPaths.splice(boundedIndex, 0, path);
	return nextPaths;
}

function allocateTemplatePath(
	entitiesByPath: Record<string, ComponentDraftEntity>,
	base = "node",
) {
	let index = 1;
	let candidate = base;
	while (entitiesByPath[candidate]) {
		candidate = `${base}-${index}`;
		index += 1;
	}
	return candidate;
}

function createTemplateEntity(
	path: string,
	selection: ComponentTemplateSelection,
	parentPath: string | null,
): ComponentDraftEntity {
	const definition = getLibraryComponent(
		selection.library,
		selection.component,
	);
	const role = definition.role;
	const entity: ComponentDraftEntity = {
		path,
		library: selection.library,
		component: selection.component,
		parentPath,
		role,
		name: definition.label,
	};

	if (role === "text") {
		entity.text = getDefaultText(role) ?? "";
	} else {
		entity.childPaths = [];
	}

	return entity;
}

export function addTemplateNode(
	selection: ComponentTemplateSelection,
	targetParentPath: string | null,
	index: number,
	path = allocateTemplatePath(componentDraftStore.get().entitiesByPath),
) {
	componentDraftStore.setState((state) => {
		const targetParent = targetParentPath
			? state.entitiesByPath[targetParentPath]
			: null;

		if (targetParentPath && !canHaveChildren(targetParent)) {
			return state;
		}

		if (state.entitiesByPath[path]) {
			return state;
		}

		if (targetParentPath === null && state.rootPath !== null) {
			return state;
		}

		const nextEntity = createTemplateEntity(path, selection, targetParentPath);
		const nextEntitiesByPath: Record<string, ComponentDraftEntity> = {
			...state.entitiesByPath,
			[path]: nextEntity,
		};
		const nextDirtyPaths: Record<string, true> = {
			...state.dirtyPaths,
			[path]: true,
		};

		let nextRootPath = state.rootPath;
		if (targetParentPath === null) {
			nextRootPath = path;
		} else if (targetParent) {
			const parentChildPaths = targetParent.childPaths ?? [];
			nextEntitiesByPath[targetParentPath] = {
				...targetParent,
				childPaths: insertAt(parentChildPaths, path, index),
			};
			nextDirtyPaths[targetParentPath] = true;
		}

		return {
			...state,
			rootPath: nextRootPath,
			entitiesByPath: nextEntitiesByPath,
			selectedPath: path,
			dirtyPaths: nextDirtyPaths,
			revision: state.revision + 1,
		};
	});
}

function isDescendantOf(
	entitiesByPath: Record<string, ComponentDraftEntity>,
	path: string,
	ancestorPath: string,
) {
	let current = entitiesByPath[path] ?? null;

	while (current?.parentPath) {
		if (current.parentPath === ancestorPath) {
			return true;
		}

		current = entitiesByPath[current.parentPath] ?? null;
	}

	return false;
}

function collectDescendantPaths(
	entitiesByPath: Record<string, ComponentDraftEntity>,
	path: string,
	paths: Set<string>,
) {
	if (paths.has(path)) {
		return;
	}

	paths.add(path);
	const entity = entitiesByPath[path];
	for (const childPath of entity?.childPaths ?? []) {
		collectDescendantPaths(entitiesByPath, childPath, paths);
	}
}

export function moveTemplateNode(
	path: string,
	targetParentPath: string | null,
	index: number,
) {
	componentDraftStore.setState((state) => {
		const entity = state.entitiesByPath[path];
		const targetParent = targetParentPath
			? state.entitiesByPath[targetParentPath]
			: null;

		if (
			!entity ||
			path === state.rootPath ||
			targetParentPath === null ||
			targetParentPath === path ||
			(targetParentPath &&
				isDescendantOf(state.entitiesByPath, targetParentPath, path))
		) {
			return state;
		}

		if (targetParentPath && !canHaveChildren(targetParent)) {
			return state;
		}

		const nextEntitiesByPath = {
			...state.entitiesByPath,
			[path]: {
				...entity,
				parentPath: targetParentPath,
			},
		};

		if (entity.parentPath) {
			const previousParent = state.entitiesByPath[entity.parentPath];
			if (!previousParent?.childPaths) {
				return state;
			}

			nextEntitiesByPath[entity.parentPath] = {
				...previousParent,
				childPaths: withoutPath(previousParent.childPaths, path),
			};
		}

		if (targetParentPath) {
			const parent = nextEntitiesByPath[targetParentPath];
			if (!parent?.childPaths) {
				return state;
			}

			nextEntitiesByPath[targetParentPath] = {
				...parent,
				childPaths: insertAt(withoutPath(parent.childPaths, path), path, index),
			};
		}

		return {
			...state,
			entitiesByPath: nextEntitiesByPath,
			dirtyPaths: {
				...state.dirtyPaths,
				[path]: true,
				...(entity.parentPath ? { [entity.parentPath]: true } : {}),
				...(targetParentPath ? { [targetParentPath]: true } : {}),
			},
			revision: state.revision + 1,
		};
	});
}

export function deleteTemplateNode(path: string) {
	componentDraftStore.setState((state) => {
		const entity = state.entitiesByPath[path];
		if (!entity || path === state.rootPath) {
			return state;
		}

		const deletedPaths = new Set<string>();
		collectDescendantPaths(state.entitiesByPath, path, deletedPaths);

		const nextEntitiesByPath = { ...state.entitiesByPath };
		for (const deletedPath of deletedPaths) {
			delete nextEntitiesByPath[deletedPath];
		}
		const nextOverrideTargets = Object.fromEntries(
			Object.entries(state.overrideTargets).filter(
				([, target]) => !deletedPaths.has(target.path),
			),
		);
		const nextSlots = Object.fromEntries(
			Object.entries(state.slots).filter(
				([, slot]) => !deletedPaths.has(slot.hostPath),
			),
		);

		const dirtyTargetPath = entity.parentPath ?? path;
		if (entity.parentPath) {
			const parent = state.entitiesByPath[entity.parentPath];
			if (parent?.childPaths) {
				nextEntitiesByPath[entity.parentPath] = {
					...parent,
					childPaths: withoutPath(parent.childPaths, path),
				};
			}
		}

		return {
			...state,
			entitiesByPath: nextEntitiesByPath,
			overrideTargets: nextOverrideTargets,
			slots: nextSlots,
			selectedPath:
				state.selectedPath && deletedPaths.has(state.selectedPath)
					? null
					: state.selectedPath,
			dirtyPaths: {
				...state.dirtyPaths,
				[dirtyTargetPath]: true,
			},
			revision: state.revision + 1,
		};
	});
}

export function clearComponentDraftDirty(expectedRevision?: number) {
	componentDraftStore.setState((state) => {
		if (expectedRevision !== undefined && state.revision !== expectedRevision) {
			return state;
		}

		if (!hasDirtyChanges(state)) {
			return state;
		}

		return {
			...state,
			dirtyPaths: {},
			templateDirty: false,
			variantsDirty: false,
		};
	});
}

// Clears only template-related dirty state, leaving variantsDirty intact. Used
// by save flows that persist the template but not the variant schema, so they
// cannot silently discard unsaved variant edits.
export function clearComponentDraftTemplateDirty(expectedRevision?: number) {
	componentDraftStore.setState((state) => {
		if (expectedRevision !== undefined && state.revision !== expectedRevision) {
			return state;
		}

		if (!hasTemplateDirtyChanges(state)) {
			return state;
		}

		return {
			...state,
			dirtyPaths: {},
			templateDirty: false,
		};
	});
}

export function isComponentDraftCleanAtRevision(expectedRevision: number) {
	const state = componentDraftStore.get();
	return state.revision === expectedRevision && !hasDirtyChanges(state);
}

export function getComponentDraftTemplateHash(
	state: ComponentDraftStoreState = componentDraftStore.get(),
) {
	return hashComponentDraftSnapshot({
		root: serializeComponentDraftState(state),
		slots: state.slots,
		overrideTargets: state.overrideTargets,
	});
}

export function isComponentDraftForComponent(componentId: string | null) {
	const state = componentDraftStore.get();
	return componentId !== null && state.componentId === componentId;
}

export function useComponentDraftComponentId() {
	return useSelector(componentDraftStore, (state) => state.componentId);
}

export function useComponentDraftRevision() {
	return useSelector(componentDraftStore, (state) => state.revision);
}

export function useComponentDraftSelectedPath() {
	return useSelector(componentDraftStore, (state) => state.selectedPath);
}

export function useComponentDraftSelectedEntity() {
	return useSelector(componentDraftStore, (state) => {
		if (!state.selectedPath) {
			return null;
		}

		return state.entitiesByPath[state.selectedPath] ?? null;
	});
}

export function useComponentDraftSelectedOverrideTarget() {
	return useSelector(componentDraftStore, (state) => {
		if (!state.selectedPath) {
			return null;
		}

		return (
			Object.values(state.overrideTargets).find(
				(target) => target.path === state.selectedPath,
			) ?? null
		);
	});
}

export function useComponentDraftSelectedSlot() {
	return useSelector(
		componentDraftStore,
		(state) => {
			if (!state.selectedPath) {
				return null;
			}
			const entity = state.entitiesByPath[state.selectedPath];
			if (!entity?.slot) {
				return null;
			}
			return state.slots[entity.slot] ?? null;
		},
		{ compare: shallow },
	);
}

export function useComponentDraftHasUnsavedChanges() {
	return useSelector(componentDraftStore, hasDirtyChanges);
}

export function useComponentDraftTemplateDirty() {
	return useSelector(componentDraftStore, hasTemplateDirtyChanges);
}

export function useComponentDraftVariants() {
	return useSelector(componentDraftStore, (state) => state.variants, {
		compare: shallow,
	});
}

export function useComponentDraftVariantsDirty() {
	return useSelector(componentDraftStore, (state) => state.variantsDirty);
}

export function useComponentDraftStyleTarget() {
	return useSelector(componentDraftStore, (state) => state.styleTarget, {
		compare: shallow,
	});
}

export function useComponentDraftEffectiveClassName(path: string) {
	return useSelector(componentDraftStore, (state) =>
		getEffectiveDraftNodeClassName(state, path),
	);
}

export function useComponentDraftPreviewClassName(path: string) {
	return useSelector(componentDraftStore, (state) => {
		const baseClassName = state.entitiesByPath[path]?.className ?? "";
		if (state.styleTarget.mode === "variant") {
			const variantClassName = getVariantClassNameForPath(
				state,
				state.styleTarget.axisKey,
				state.styleTarget.valueKey,
				path,
			);
			return [baseClassName, variantClassName].filter(Boolean).join(" ");
		}

		if (state.styleTarget.mode === "compound") {
			const compoundClassName = getCompoundClassNameForPath(
				state,
				state.styleTarget.compoundIndex,
				path,
			);
			return [baseClassName, compoundClassName].filter(Boolean).join(" ");
		}

		return baseClassName;
	});
}

export function useComponentDraftRootPath() {
	return useSelector(componentDraftStore, (state) => state.rootPath);
}

export function useComponentDraftChildPaths(parentPath: string) {
	return useSelector(
		componentDraftStore,
		(state) => state.entitiesByPath[parentPath]?.childPaths ?? emptyPaths,
		{ compare: shallow },
	);
}

export function useComponentDraftEntity(path: string) {
	return useSelector(
		componentDraftStore,
		(state) => state.entitiesByPath[path],
	);
}

export function useComponentDraftLayerTreeSnapshot() {
	return useSelector(
		componentDraftStore,
		(state) => ({
			rootPath: state.rootPath,
			entitiesByPath: state.entitiesByPath,
		}),
		{ compare: shallow },
	);
}

export function useComponentDraftLayerSummary(path: string) {
	return useSelector(
		componentDraftStore,
		(state) => {
			const entity = state.entitiesByPath[path];
			return {
				path,
				name: entity?.name?.trim() || entity?.component || "Untitled",
				parentPath: entity?.parentPath ?? null,
				role: entity?.role,
				canHaveChildren: canHaveChildren(entity),
				childPaths: entity?.childPaths ?? emptyPaths,
				isSelected: state.selectedPath === path,
			};
		},
		{ compare: shallow },
	);
}
