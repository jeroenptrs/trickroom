import {
	getControlDefinitions,
	getDefaultProps,
	getDefaultText,
	isRegistryId,
	resolveRegistryComponent,
	resolveRegistryRecipe,
} from "../libraries/registry";
import type {
	JsonPrimitive,
	Node,
	Props,
	RecipeDefinition,
	RecipeSlotDefinition,
	RecipeTemplateHistoryEntry,
	RecipeTemplateNode,
	RegistryComponentDefinition,
	TrickroomDesign,
} from "../types";
import { getRecipeMarkerProps, getRecipeStructuralMetadata } from "./markers";
import { validateRecipeInstances } from "./validation";

export type RecipeMigrationPathMapping = {
	fromPath: string;
	toPath: string;
	elementId: string;
};

export type RecipeMigrationSlotMapping = {
	slotName: string;
	fromPath: string;
	toPath: string;
	preservedChildIds: string[];
};

export type RecipeMigrationMetadata = {
	recipeId: string;
	instanceId: string;
	rootElementId: string;
	fromVersion: string;
	toVersion: string;
	fromTemplateHash: string;
	toTemplateHash: string;
	preservedPaths: RecipeMigrationPathMapping[];
	remappedPaths: RecipeMigrationPathMapping[];
	addedPaths: RecipeMigrationPathMapping[];
	removedPaths: string[];
	preservedSlots: RecipeMigrationSlotMapping[];
};

export type RecipeMigrationResult = {
	design: TrickroomDesign;
	changedElementId: string;
	metadata: RecipeMigrationMetadata;
};

export class RecipeMigrationError extends Error {
	readonly code:
		| "ELEMENT_NOT_FOUND"
		| "RECIPE_INSTANCE_NOT_FOUND"
		| "RECIPE_INSTANCE_NOT_STALE"
		| "RECIPE_MIGRATION_UNSAFE";

	constructor(code: RecipeMigrationError["code"], message: string) {
		super(message);
		this.name = "RecipeMigrationError";
		this.code = code;
	}
}

type NodeReference = {
	node: Node;
	parent: Node | null;
	metadata: NonNullable<ReturnType<typeof getRecipeStructuralMetadata>>;
};

type TemplateSet = Pick<RecipeDefinition, "root" | "slots" | "controls"> &
	Pick<RecipeTemplateHistoryEntry, "version">;

const mutableStructuralProps = new Set(["className", "data-trickroom-name"]);

const stableStringify = (value: unknown): string => {
	if (Array.isArray(value)) {
		return `[${value.map(stableStringify).join(",")}]`;
	}
	if (value && typeof value === "object") {
		return `{${Object.entries(value as Record<string, unknown>)
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
			.join(",")}}`;
	}
	return JSON.stringify(value);
};

const getTemplateHash = (templateSet: TemplateSet) => {
	let hash = 5381;
	const input = stableStringify({
		root: templateSet.root,
		slots: templateSet.slots ?? {},
		controls: templateSet.controls ?? {},
	});
	for (let index = 0; index < input.length; index += 1) {
		hash = (hash * 33) ^ input.charCodeAt(index);
	}
	return `trh1:${(hash >>> 0).toString(16).padStart(8, "0")}`;
};

const getTemplateSlotName = (
	recipe: Pick<RecipeDefinition, "slots">,
	template: RecipeTemplateNode,
) =>
	template.slot ??
	Object.values(recipe.slots ?? {}).find(
		(slot) => slot.hostPath === template.path,
	)?.name ??
	null;

const getTemplateSlotDefinition = (
	recipe: Pick<RecipeDefinition, "slots">,
	slotName: string,
): RecipeSlotDefinition | null =>
	recipe.slots?.[slotName] ??
	Object.values(recipe.slots ?? {}).find((slot) => slot.name === slotName) ??
	null;

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

const collectReferences = (roots: readonly Node[]) => {
	const byId = new Map<string, NodeReference>();
	const visit = (node: Node, parent: Node | null) => {
		const metadata = getRecipeStructuralMetadata(node.props);
		if (metadata) {
			byId.set(node.id, { node, parent, metadata });
		}
		if (Array.isArray(node.children)) {
			for (const child of node.children) {
				visit(child, node);
			}
		}
	};
	for (const root of roots) {
		visit(root, null);
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

const findCurrentRecipe = (recipeId: string) => {
	const library = recipeId.split("/")[0];
	const resolution = resolveRegistryRecipe(library, recipeId);
	return resolution.status === "known" ? resolution.definition : null;
};

const findPreviousTemplate = (
	recipe: RecipeDefinition,
	version: string,
): TemplateSet | null => {
	const previous = recipe.previousTemplates?.find(
		(template) => template.version === version,
	);
	return previous
		? previous
		: String(recipe.version) === version
			? { version: String(recipe.version), ...recipe }
			: null;
};

const getMutablePropsForTemplate = (
	templateSet: Pick<RecipeDefinition, "controls">,
	template: RecipeTemplateNode,
	definition: RegistryComponentDefinition,
) => {
	const props = new Set(mutableStructuralProps);
	for (const control of getControlDefinitions(definition)) {
		props.add(control.prop);
	}
	for (const control of Object.values(templateSet.controls ?? {})) {
		if (control.path === template.path) {
			props.add(control.prop);
		}
	}
	return props;
};

const getTemplateName = (
	template: RecipeTemplateNode,
	definition: RegistryComponentDefinition,
) => template.name ?? definition.label;

const getBaseProps = (
	recipe: RecipeDefinition,
	templateSet: Pick<RecipeDefinition, "slots">,
	template: RecipeTemplateNode,
	definition: RegistryComponentDefinition,
	instanceId: string,
	isRoot: boolean,
) => {
	const name = getTemplateName(template, definition);
	return {
		...getDefaultProps(template.library, template.component, definition, name),
		...(template.props ?? {}),
		...(template.className !== undefined
			? { className: template.className }
			: {}),
		"data-trickroom-name": name,
		...getRecipeMarkerProps({
			recipeId: recipe.id,
			instanceId,
			path: template.path,
			isRoot,
			slotName: getTemplateSlotName(templateSet, template),
		}),
	} satisfies Props;
};

const getAuthoredTemplateNode = (
	template: RecipeTemplateNode,
	createElementId: () => string,
): Node => {
	if (!isRegistryId(template.library)) {
		throw new RecipeMigrationError(
			"RECIPE_MIGRATION_UNSAFE",
			`Recipe template references unknown registry library "${template.library}".`,
		);
	}
	const resolution = resolveRegistryComponent(
		template.library,
		template.component,
	);
	if (resolution.status !== "known") {
		throw new RecipeMigrationError(
			"RECIPE_MIGRATION_UNSAFE",
			`Recipe template references unknown component "${template.component}" in registry "${template.library}".`,
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
							getAuthoredTemplateNode(child, createElementId),
						),
	};
};

const getMappedCurrentPathByPreviousPath = (
	previous: TemplateSet,
	current: RecipeDefinition,
) => {
	const currentByPath = getTemplateNodesByPath(current.root);
	const map = new Map<string, string>();
	for (const path of getTemplateNodesByPath(previous.root).keys()) {
		if (currentByPath.has(path)) {
			map.set(path, path);
		}
	}
	for (const previousSlot of Object.values(previous.slots ?? {})) {
		const currentSlot = getTemplateSlotDefinition(current, previousSlot.name);
		if (currentSlot) {
			map.set(previousSlot.hostPath, currentSlot.hostPath);
		}
	}
	for (const currentSlot of Object.values(current.slots ?? {})) {
		const previousPath = currentSlot.history?.previousTemplatePath;
		if (
			previousPath &&
			(!currentSlot.history.previousTemplateVersion ||
				currentSlot.history.previousTemplateVersion === previous.version)
		) {
			map.set(previousPath, currentSlot.hostPath);
		}
	}
	return map;
};

const getAuthoredSlotChildren = (node: Node, instanceId: string) =>
	Array.isArray(node.children)
		? node.children.filter(
				(child) =>
					getRecipeStructuralMetadata(child.props)?.instanceId !== instanceId,
			)
		: [];

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

export const updateStaleRecipeInstance = (
	design: TrickroomDesign,
	elementId: string,
	options: { createElementId?: () => string } = {},
): RecipeMigrationResult => {
	const targetMetadata = findTargetMetadata(design.boards, elementId);
	if (!targetMetadata) {
		const exists = (roots: readonly Node[]): boolean =>
			roots.some(
				(node) =>
					node.id === elementId ||
					(Array.isArray(node.children) && exists(node.children)),
			);
		throw new RecipeMigrationError(
			exists(design.boards) ? "RECIPE_INSTANCE_NOT_FOUND" : "ELEMENT_NOT_FOUND",
			exists(design.boards)
				? `Element "${elementId}" is not part of an attached recipe instance.`
				: `Element "${elementId}" not found.`,
		);
	}

	const validation = validateRecipeInstances(design.boards);
	const report = validation.instances.find(
		(instance) => instance.instanceId === targetMetadata.instanceId,
	);
	if (!report || report.status !== "attached-stale") {
		throw new RecipeMigrationError(
			"RECIPE_INSTANCE_NOT_STALE",
			report
				? `Recipe instance "${targetMetadata.instanceId}" is "${report.status}" and cannot be updated. Only stale known recipe instances can be migrated.`
				: `Recipe instance "${targetMetadata.instanceId}" was not found by recipe validation.`,
		);
	}
	if (!report.rootElementId || !report.matchedTemplateVersion) {
		throw new RecipeMigrationError(
			"RECIPE_MIGRATION_UNSAFE",
			`Recipe instance "${targetMetadata.instanceId}" is missing migration metadata.`,
		);
	}

	const recipe = findCurrentRecipe(report.recipeId);
	const previous = recipe
		? findPreviousTemplate(recipe, report.matchedTemplateVersion)
		: null;
	if (!recipe || !previous) {
		throw new RecipeMigrationError(
			"RECIPE_MIGRATION_UNSAFE",
			`Recipe instance "${targetMetadata.instanceId}" cannot resolve previous/current recipe templates.`,
		);
	}

	const instanceReferences = collectInstanceReferences(
		design.boards,
		targetMetadata.instanceId,
	);
	const oldByPath = new Map(
		instanceReferences.map((reference) => [reference.metadata.path, reference]),
	);
	const currentPathByPreviousPath = getMappedCurrentPathByPreviousPath(
		previous,
		recipe,
	);
	const previousPathByCurrentPath = new Map(
		[...currentPathByPreviousPath].map(([from, to]) => [to, from]),
	);
	const currentNodesByPath = getTemplateNodesByPath(recipe.root);
	const previousNodesByPath = getTemplateNodesByPath(previous.root);
	const preservedSlots: RecipeMigrationSlotMapping[] = [];
	const authoredChildrenByTargetPath = new Map<string, Node[]>();

	for (const previousSlot of Object.values(previous.slots ?? {})) {
		const targetSlot = getTemplateSlotDefinition(recipe, previousSlot.name);
		const previousHost = oldByPath.get(previousSlot.hostPath);
		const authoredChildren = previousHost
			? getAuthoredSlotChildren(previousHost.node, targetMetadata.instanceId)
			: [];
		if (authoredChildren.length === 0) {
			continue;
		}
		if (!targetSlot || !currentNodesByPath.has(targetSlot.hostPath)) {
			throw new RecipeMigrationError(
				"RECIPE_MIGRATION_UNSAFE",
				`Recipe instance "${targetMetadata.instanceId}" slot "${previousSlot.name}" contains authored content that cannot be mapped to the current recipe template.`,
			);
		}
		authoredChildrenByTargetPath.set(
			targetSlot.hostPath,
			authoredChildren.map(cloneNode),
		);
		preservedSlots.push({
			slotName: previousSlot.name,
			fromPath: previousSlot.hostPath,
			toPath: targetSlot.hostPath,
			preservedChildIds: authoredChildren.map((child) => child.id),
		});
	}

	const preservedPaths: RecipeMigrationPathMapping[] = [];
	const remappedPaths: RecipeMigrationPathMapping[] = [];
	const addedPaths: RecipeMigrationPathMapping[] = [];
	const removedPaths = [...previousNodesByPath.keys()].filter(
		(path) => !currentPathByPreviousPath.has(path),
	);
	const createElementId =
		options.createElementId ?? (() => crypto.randomUUID());

	const buildCurrentNode = (
		template: RecipeTemplateNode,
		isRoot: boolean,
	): Node => {
		if (!isRegistryId(template.library)) {
			throw new RecipeMigrationError(
				"RECIPE_MIGRATION_UNSAFE",
				`Recipe "${recipe.id}" references unknown registry library "${template.library}".`,
			);
		}
		const resolution = resolveRegistryComponent(
			template.library,
			template.component,
		);
		if (resolution.status !== "known") {
			throw new RecipeMigrationError(
				"RECIPE_MIGRATION_UNSAFE",
				`Recipe "${recipe.id}" references unknown component "${template.component}" in registry "${template.library}".`,
			);
		}
		const previousPath = previousPathByCurrentPath.get(template.path);
		const previousReference = previousPath ? oldByPath.get(previousPath) : null;
		const id = previousReference?.node.id ?? createElementId();
		const props = getBaseProps(
			recipe,
			recipe,
			template,
			resolution.definition,
			targetMetadata.instanceId,
			isRoot,
		);
		if (previousReference) {
			const previousTemplate =
				previousNodesByPath.get(previousReference.metadata.path) ?? template;
			const previousResolution = resolveRegistryComponent(
				previousTemplate.library,
				previousTemplate.component,
			);
			const previousDefinition =
				previousResolution.status === "known"
					? previousResolution.definition
					: resolution.definition;
			const mutableProps = getMutablePropsForTemplate(
				previous,
				previousTemplate,
				previousDefinition,
			);
			const currentMutableProps = getMutablePropsForTemplate(
				recipe,
				template,
				resolution.definition,
			);
			for (const prop of new Set([...mutableProps, ...currentMutableProps])) {
				const value = previousReference.node.props[prop];
				if (value !== undefined) {
					props[prop] = value as JsonPrimitive;
				}
			}
		}

		if (previousReference) {
			const mapping = {
				fromPath: previousPath ?? template.path,
				toPath: template.path,
				elementId: id,
			};
			if (mapping.fromPath === mapping.toPath) {
				preservedPaths.push(mapping);
			} else {
				remappedPaths.push(mapping);
			}
		} else {
			addedPaths.push({ fromPath: "", toPath: template.path, elementId: id });
		}

		const authoredChildren = authoredChildrenByTargetPath.get(template.path);
		const defaultChildren =
			authoredChildren === undefined
				? (
						getTemplateSlotDefinition(
							recipe,
							getTemplateSlotName(recipe, template) ?? "",
						)?.defaultChildren ?? []
					).map((child) => getAuthoredTemplateNode(child, createElementId))
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
									buildCurrentNode(child, false),
								),
								...defaultChildren,
							],
		};
	};

	const migratedRoot = buildCurrentNode(recipe.root, true);
	const nextDesign = {
		...design,
		boards: replaceNode(design.boards, report.rootElementId, migratedRoot),
	};
	return {
		design: nextDesign,
		changedElementId:
			collectReferences([migratedRoot]).has(elementId) ||
			migratedRoot.id === elementId
				? elementId
				: migratedRoot.id,
		metadata: {
			recipeId: recipe.id,
			instanceId: targetMetadata.instanceId,
			rootElementId: migratedRoot.id,
			fromVersion: previous.version,
			toVersion: String(recipe.version),
			fromTemplateHash: getTemplateHash(previous),
			toTemplateHash: getTemplateHash({
				version: String(recipe.version),
				...recipe,
			}),
			preservedPaths,
			remappedPaths,
			addedPaths,
			removedPaths,
			preservedSlots,
		},
	};
};
