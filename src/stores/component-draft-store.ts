import { createStore, shallow, useSelector } from "@tanstack/react-store";
import {
	canHaveElementChildren,
	getDefaultText,
	getLibraryComponent,
	SYSTEM_PROP_KEYS,
} from "../libraries/registry";
import type { JsonPrimitive, Props, RecipeTemplateNode, Role } from "../types";
import { type ClassLayer, flattenClassLayers } from "../utils/class-layers";
import { convertDesignSubtreeToComponentDraftRoot } from "../utils/design-subtree-to-component-draft";
import { compoundWhenSignature } from "../utils/system-component-compound-signature";
import { inferOverrideTargetCapabilities } from "../utils/system-component-override-targets";
import { hashComponentDraftSnapshot } from "../utils/system-component-template-hash";
import { composeSystemComponentVariantClassLayers } from "../utils/system-component-variant-class-layers";
import type {
	SystemComponentCompoundVariant,
	SystemComponentOverrideTarget,
	SystemComponentSlotDefinition,
	SystemComponentVariantAxis,
	SystemComponentVariantSchema,
} from "../utils/system-components";

export type ComponentDraftStyleTab =
	| { kind: "base" }
	| { kind: "axis"; axisKey: string }
	| { kind: "compound" };

export type ComponentDraftStyleTarget = {
	base: boolean;
	axisValues: Record<string, string>;
	compoundAxes: string[];
	activeTab: ComponentDraftStyleTab;
};

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

const baseStyleTarget: ComponentDraftStyleTarget = {
	base: true,
	axisValues: {},
	compoundAxes: [],
	activeTab: { kind: "base" },
};

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
		styleTarget: baseStyleTarget,
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

export function serializeComponentDraftVariants(
	state: ComponentDraftStoreState,
): SystemComponentVariantSchema | null {
	return serializeComponentDraftVariantsSchema(state.variants);
}

const hasTemplateDirtyChanges = (state: ComponentDraftStoreState) =>
	state.templateDirty || Object.keys(state.dirtyPaths).length > 0;

const hasDirtyChanges = (state: ComponentDraftStoreState) =>
	hasTemplateDirtyChanges(state) || state.variantsDirty;

const stableVariantSchemaSignature = (
	variants: SystemComponentVariantSchema | null,
) => JSON.stringify(variants ?? null);

const sortKeys = (keys: string[]) =>
	[...keys].sort((left, right) => left.localeCompare(right));

const hasCompoundClasses = (compound: SystemComponentCompoundVariant) =>
	Object.keys(compound.classesByPath).length > 0;

const pruneEmptyCompoundVariants = (
	compounds: SystemComponentVariantSchema["compoundVariants"] | undefined,
) => compounds?.filter(hasCompoundClasses);

function serializeComponentDraftVariantsSchema(
	variants: SystemComponentVariantSchema | null,
): SystemComponentVariantSchema | null {
	if (!variants) {
		return null;
	}

	const nextCompoundVariants = pruneEmptyCompoundVariants(
		variants.compoundVariants,
	);
	const { compoundVariants: _compoundVariants, ...rest } = variants;

	return {
		...rest,
		...(nextCompoundVariants && nextCompoundVariants.length > 0
			? { compoundVariants: nextCompoundVariants }
			: {}),
	};
}

function deriveCompoundWhenFromStyleTarget(
	target: ComponentDraftStyleTarget,
): Record<string, string> | null {
	const when: Record<string, string> = {};
	for (const axisKey of target.compoundAxes) {
		const valueKey = target.axisValues[axisKey];
		if (!valueKey) {
			return null;
		}
		when[axisKey] = valueKey;
	}

	return Object.keys(when).length >= 2 ? when : null;
}

function findCompoundIndexByWhen(
	compounds: SystemComponentVariantSchema["compoundVariants"] | undefined,
	when: Record<string, string | string[]>,
) {
	const signature = compoundWhenSignature(when);
	return (compounds ?? []).findIndex(
		(compound) => compoundWhenSignature(compound.when) === signature,
	);
}

function reconcileStyleTarget(
	target: ComponentDraftStyleTarget,
	variants: SystemComponentVariantSchema | null,
): ComponentDraftStyleTarget {
	const axes = variants?.axes ?? {};
	const axisValues: Record<string, string> = {};
	for (const axisKey of sortKeys(Object.keys(target.axisValues))) {
		const valueKey = target.axisValues[axisKey];
		if (axes[axisKey]?.values[valueKey]) {
			axisValues[axisKey] = valueKey;
		}
	}

	const compoundAxes = sortKeys(
		Array.from(
			new Set(
				target.compoundAxes.filter(
					(axisKey) => axisValues[axisKey] !== undefined,
				),
			),
		),
	);
	const compoundIsValid = compoundAxes.length >= 2;
	const base = target.base || Object.keys(axisValues).length === 0;
	let activeTab: ComponentDraftStyleTab = target.activeTab;

	if (activeTab.kind === "base") {
		if (!base) {
			const firstAxisKey = sortKeys(Object.keys(axisValues))[0];
			activeTab = firstAxisKey
				? { kind: "axis", axisKey: firstAxisKey }
				: { kind: "base" };
		}
	} else if (activeTab.kind === "axis") {
		if (axisValues[activeTab.axisKey] === undefined) {
			activeTab = base ? { kind: "base" } : { kind: "compound" };
		}
	} else if (!compoundIsValid) {
		activeTab = base ? { kind: "base" } : { kind: "axis", axisKey: "" };
	}

	if (
		activeTab.kind === "axis" &&
		axisValues[activeTab.axisKey] === undefined
	) {
		const firstAxisKey = sortKeys(Object.keys(axisValues))[0];
		activeTab = firstAxisKey
			? { kind: "axis", axisKey: firstAxisKey }
			: { kind: "base" };
	}
	if (activeTab.kind === "compound" && !compoundIsValid) {
		activeTab = base ? { kind: "base" } : { kind: "base" };
	}

	return {
		base,
		axisValues,
		compoundAxes,
		activeTab,
	};
}

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

const styleTargetsEqual = (
	left: ComponentDraftStyleTarget,
	right: ComponentDraftStyleTarget,
) => {
	if (left.base !== right.base) {
		return false;
	}
	if (JSON.stringify(left.axisValues) !== JSON.stringify(right.axisValues)) {
		return false;
	}
	if (
		JSON.stringify(left.compoundAxes) !== JSON.stringify(right.compoundAxes)
	) {
		return false;
	}
	return JSON.stringify(left.activeTab) === JSON.stringify(right.activeTab);
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
			state.componentId === nextState.componentId
				? reconcileStyleTarget(state.styleTarget, nextState.variants)
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

export function getCompoundClassNameForWhen(
	state: ComponentDraftStoreState,
	when: Record<string, string | string[]>,
	path: string,
) {
	const compoundIndex = findCompoundIndexByWhen(
		state.variants?.compoundVariants,
		when,
	);
	return compoundIndex >= 0
		? getCompoundClassNameForPath(state, compoundIndex, path)
		: "";
}

export function getEffectiveDraftNodeClassName(
	state: ComponentDraftStoreState,
	path: string,
) {
	return getDraftClassNameForStyleTab(
		state,
		state.styleTarget.activeTab,
		path,
	);
}

export function getDraftClassNameForStyleTab(
	state: ComponentDraftStoreState,
	tab: ComponentDraftStyleTab,
	path: string,
) {
	if (tab.kind === "axis") {
		const { axisKey } = tab;
		const valueKey = state.styleTarget.axisValues[axisKey];
		return getVariantClassNameForPath(state, axisKey, valueKey ?? "", path);
	}

	if (tab.kind === "compound") {
		const when = deriveCompoundWhenFromStyleTarget(state.styleTarget);
		return when ? getCompoundClassNameForWhen(state, when, path) : "";
	}

	return state.entitiesByPath[path]?.className ?? "";
}

export function getComponentDraftPreviewClassLayers(
	state: ComponentDraftStoreState,
	path: string,
): ClassLayer[] {
	const entity = state.entitiesByPath[path];
	if (!entity) {
		return [];
	}

	const metadata = {
		...(state.componentId ? { componentId: state.componentId } : {}),
		library: entity.library,
		component: entity.component,
	};

	return composeSystemComponentVariantClassLayers({
		variants: state.variants ?? undefined,
		path,
		templateClassName: state.styleTarget.base ? entity.className : undefined,
		variantValues: state.styleTarget.axisValues,
		context: metadata,
	});
}

export function getComponentDraftPreviewClassName(
	state: ComponentDraftStoreState,
	path: string,
) {
	return (
		flattenClassLayers(getComponentDraftPreviewClassLayers(state, path)) ?? ""
	);
}

export function focusCompoundInDraft(when: Record<string, string>) {
	const state = componentDraftStore.get();
	const compoundAxes = sortKeys(Object.keys(when));

	setComponentDraftStyleTarget({
		base: true,
		axisValues: { ...when },
		compoundAxes,
		activeTab: { kind: "compound" },
	});

	if (!state.selectedPath && state.rootPath) {
		selectTemplateNode(state.rootPath);
	}
}

export function removeCompoundVariantByWhen(
	when: Record<string, string | string[]>,
) {
	componentDraftStore.setState((state) => {
		const variants = state.variants;
		if (!variants?.compoundVariants?.length) {
			return state;
		}

		const signature = compoundWhenSignature(when);
		const nextCompounds = variants.compoundVariants.filter(
			(compound) => compoundWhenSignature(compound.when) !== signature,
		);
		if (nextCompounds.length === variants.compoundVariants.length) {
			return state;
		}

		const prunedCompounds = pruneEmptyCompoundVariants(nextCompounds) ?? [];
		const { compoundVariants: _compoundVariants, ...rest } = variants;
		const nextVariants: SystemComponentVariantSchema = {
			...rest,
			...(prunedCompounds.length > 0
				? { compoundVariants: prunedCompounds }
				: {}),
		};

		return {
			...state,
			variants: nextVariants,
			variantsDirty: true,
			styleTarget: reconcileStyleTarget(state.styleTarget, nextVariants),
			revision: state.revision + 1,
		};
	});
}

export function setComponentDraftStyleTarget(
	target: ComponentDraftStyleTarget,
) {
	componentDraftStore.setState((state) => {
		const nextTarget = reconcileStyleTarget(target, state.variants);
		if (styleTargetsEqual(state.styleTarget, nextTarget)) {
			return state;
		}

		return {
			...state,
			styleTarget: nextTarget,
		};
	});
}

export function replaceComponentDraftVariants(
	variants: SystemComponentVariantSchema | null,
) {
	componentDraftStore.setState((state) => {
		const nextVariants = serializeComponentDraftVariantsSchema(
			cloneVariants(variants),
		);
		if (
			stableVariantSchemaSignature(state.variants) ===
			stableVariantSchemaSignature(nextVariants)
		) {
			return state;
		}

		const nextStyleTarget = reconcileStyleTarget(
			state.styleTarget,
			nextVariants,
		);

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

export function updateCompoundClassesByWhen(
	when: Record<string, string>,
	path: string,
	className: string,
) {
	componentDraftStore.setState((state) => {
		const variants = state.variants;
		if (!variants) {
			return state;
		}

		const compoundIndex = findCompoundIndexByWhen(
			variants.compoundVariants,
			when,
		);
		if (compoundIndex < 0 && !className.trim()) {
			return state;
		}

		const existingCompound =
			compoundIndex >= 0
				? variants.compoundVariants?.[compoundIndex]
				: undefined;
		const nextClassesByPath = { ...(existingCompound?.classesByPath ?? {}) };
		if (className.trim()) {
			nextClassesByPath[path] = className;
		} else {
			delete nextClassesByPath[path];
		}

		let nextCompounds = [...(variants.compoundVariants ?? [])];
		if (compoundIndex >= 0) {
			if (Object.keys(nextClassesByPath).length > 0) {
				nextCompounds[compoundIndex] = {
					...(existingCompound ?? { when }),
					classesByPath: nextClassesByPath,
				};
			} else {
				nextCompounds.splice(compoundIndex, 1);
			}
		} else {
			nextCompounds.push({
				when: { ...when },
				classesByPath: { [path]: className },
			});
		}

		nextCompounds = pruneEmptyCompoundVariants(nextCompounds) ?? [];
		const { compoundVariants: _compoundVariants, ...rest } = variants;

		return {
			...state,
			variants: {
				...rest,
				...(nextCompounds.length > 0
					? { compoundVariants: nextCompounds }
					: {}),
			},
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
	setDraftClassNameForStyleTab(state.styleTarget.activeTab, path, className);
}

export function setDraftClassNameForStyleTab(
	tab: ComponentDraftStyleTab,
	path: string,
	className: string,
) {
	const state = componentDraftStore.get();
	if (tab.kind === "axis") {
		const { axisKey } = tab;
		const valueKey = state.styleTarget.axisValues[axisKey];
		if (!valueKey) {
			return;
		}
		updateVariantClassesByPath(axisKey, valueKey, path, className);
		return;
	}

	if (tab.kind === "compound") {
		const when = deriveCompoundWhenFromStyleTarget(state.styleTarget);
		if (!when) {
			return;
		}
		updateCompoundClassesByWhen(when, path, className);
		return;
	}

	setTemplateNodeClassName(path, className);
}

function setTemplateNodeClassName(path: string, className: string) {
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

export function updateTemplateNodeClassName(path: string, className: string) {
	if (componentDraftStore.get().styleTarget.activeTab.kind !== "base") {
		return;
	}

	setTemplateNodeClassName(path, className);
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
	path?: string,
) {
	componentDraftStore.setState((state) => {
		const targetParent = targetParentPath
			? state.entitiesByPath[targetParentPath]
			: null;
		const nextPath =
			path ??
			allocateTemplatePath(
				state.entitiesByPath,
				targetParentPath === null ? "root" : "node",
			);

		if (targetParentPath && !canHaveChildren(targetParent)) {
			return state;
		}

		if (state.entitiesByPath[nextPath]) {
			return state;
		}

		if (targetParentPath === null && state.rootPath !== null) {
			return state;
		}

		const nextEntity = createTemplateEntity(
			nextPath,
			selection,
			targetParentPath,
		);
		const nextEntitiesByPath: Record<string, ComponentDraftEntity> = {
			...state.entitiesByPath,
			[nextPath]: nextEntity,
		};
		const nextDirtyPaths: Record<string, true> = {
			...state.dirtyPaths,
			[nextPath]: true,
		};

		let nextRootPath = state.rootPath;
		if (targetParentPath === null) {
			nextRootPath = nextPath;
		} else if (targetParent) {
			const parentChildPaths = targetParent.childPaths ?? [];
			nextEntitiesByPath[targetParentPath] = {
				...targetParent,
				childPaths: insertAt(parentChildPaths, nextPath, index),
			};
			nextDirtyPaths[targetParentPath] = true;
		}

		return {
			...state,
			rootPath: nextRootPath,
			entitiesByPath: nextEntitiesByPath,
			selectedPath: nextPath,
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

function removeDeletedVariantClassTargets(
	variants: SystemComponentVariantSchema | null,
	deletedPaths: Set<string>,
) {
	if (!variants) {
		return variants;
	}

	let changed = false;
	const nextAxes: SystemComponentVariantSchema["axes"] = {};

	for (const [axisKey, axis] of Object.entries(variants.axes)) {
		const nextValues: SystemComponentVariantAxis["values"] = {};

		for (const [valueKey, value] of Object.entries(axis.values)) {
			if (!value.classesByPath) {
				nextValues[valueKey] = value;
				continue;
			}

			const nextClassesByPath = Object.fromEntries(
				Object.entries(value.classesByPath).filter(
					([path]) => !deletedPaths.has(path),
				),
			);
			if (
				Object.keys(nextClassesByPath).length ===
				Object.keys(value.classesByPath).length
			) {
				nextValues[valueKey] = value;
				continue;
			}

			changed = true;
			if (Object.keys(nextClassesByPath).length > 0) {
				nextValues[valueKey] = {
					...value,
					classesByPath: nextClassesByPath,
				};
			} else {
				const { classesByPath: _classesByPath, ...nextValue } = value;
				nextValues[valueKey] = nextValue;
			}
		}

		nextAxes[axisKey] = { ...axis, values: nextValues };
	}

	let nextCompoundVariants = variants.compoundVariants;
	if (variants.compoundVariants) {
		nextCompoundVariants = variants.compoundVariants.flatMap(
			(compoundVariant) => {
				const nextClassesByPath = Object.fromEntries(
					Object.entries(compoundVariant.classesByPath).filter(
						([path]) => !deletedPaths.has(path),
					),
				);
				if (
					Object.keys(nextClassesByPath).length ===
					Object.keys(compoundVariant.classesByPath).length
				) {
					return [compoundVariant];
				}

				changed = true;
				if (Object.keys(nextClassesByPath).length === 0) {
					return [];
				}
				return [{ ...compoundVariant, classesByPath: nextClassesByPath }];
			},
		);
	}

	if (!changed) {
		return variants;
	}

	const { compoundVariants: _compoundVariants, ...rest } = variants;

	return {
		...rest,
		axes: nextAxes,
		...(nextCompoundVariants && nextCompoundVariants.length > 0
			? { compoundVariants: nextCompoundVariants }
			: {}),
	};
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
		if (!entity) {
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
		const nextVariants = removeDeletedVariantClassTargets(
			state.variants,
			deletedPaths,
		);
		const isDeletingRoot = path === state.rootPath;

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

		const nextDirtyPaths: Record<string, true> = Object.fromEntries(
			Object.entries(state.dirtyPaths).filter(
				([dirtyPath]) => !deletedPaths.has(dirtyPath),
			),
		);
		if (!isDeletingRoot) {
			nextDirtyPaths[dirtyTargetPath] = true;
		}

		return {
			...state,
			rootPath: isDeletingRoot ? null : state.rootPath,
			entitiesByPath: nextEntitiesByPath,
			overrideTargets: nextOverrideTargets,
			slots: nextSlots,
			variants: nextVariants,
			variantsDirty: state.variantsDirty || nextVariants !== state.variants,
			selectedPath:
				state.selectedPath && deletedPaths.has(state.selectedPath)
					? null
					: state.selectedPath,
			dirtyPaths: nextDirtyPaths,
			templateDirty: isDeletingRoot ? true : state.templateDirty,
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

export function useComponentDraftClassNameForStyleTab(
	tab: ComponentDraftStyleTab,
	path: string,
) {
	return useSelector(componentDraftStore, (state) =>
		getDraftClassNameForStyleTab(state, tab, path),
	);
}

export function useComponentDraftPreviewClassName(path: string) {
	return useSelector(componentDraftStore, (state) =>
		getComponentDraftPreviewClassName(state, path),
	);
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
