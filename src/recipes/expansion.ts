import {
	getDefaultProps,
	getDefaultText,
	isRegistryId,
	resolveRegistryComponent,
	resolveRegistryRecipe,
} from "../libraries/registry";
import type { Node, RecipeDefinition, RecipeTemplateNode } from "../types";
import { getRecipeMarkerProps } from "./markers";

export type RecipeExpansionOptions = {
	createElementId?: () => string;
	createRecipeInstanceId?: () => string;
};

export type RecipeExpansionResult = {
	recipeId: string;
	instanceId: string;
	root: Node;
	elementIdsByPath: Record<string, string>;
};

const createId = () => globalThis.crypto.randomUUID();

const getTemplateSlotName = (
	recipe: RecipeDefinition,
	template: RecipeTemplateNode,
) =>
	template.slot ??
	Object.values(recipe.slots ?? {}).find(
		(slot) => slot.hostPath === template.path,
	)?.name ??
	null;

const getTemplateSlotDefaultChildren = (
	recipe: RecipeDefinition,
	template: RecipeTemplateNode,
) => {
	const slotName = getTemplateSlotName(recipe, template);
	if (!slotName) {
		return [];
	}

	return (
		(
			recipe.slots?.[slotName] ??
			Object.values(recipe.slots ?? {}).find((slot) => slot.name === slotName)
		)?.defaultChildren ?? []
	);
};

const getAuthoredTemplateName = (
	template: RecipeTemplateNode,
	definitionLabel: string,
) =>
	template.name ??
	(typeof template.props?.["data-trickroom-name"] === "string"
		? template.props["data-trickroom-name"]
		: undefined) ??
	definitionLabel;

const expandAuthoredTemplateNode = (
	recipe: RecipeDefinition,
	template: RecipeTemplateNode,
	options: Required<RecipeExpansionOptions>,
): Node => {
	if (!isRegistryId(template.library)) {
		throw new Error(
			`Recipe "${recipe.id}" references unknown registry library "${template.library}".`,
		);
	}

	const resolution = resolveRegistryComponent(
		template.library,
		template.component,
	);
	if (resolution.status !== "known") {
		throw new Error(
			`Recipe "${recipe.id}" references unknown component "${template.component}" in registry "${template.library}".`,
		);
	}

	const id = options.createElementId();
	const role = resolution.definition.role;
	const name = getAuthoredTemplateName(template, resolution.definition.label);
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
		"data-trickroom-library": template.library,
		"data-trickroom-component": template.component,
		"data-trickroom-role": role,
	};

	const children =
		role === "text"
			? (template.text ?? getDefaultText(role) ?? "")
			: role === "leaf"
				? []
				: (template.children ?? []).map((child) =>
						expandAuthoredTemplateNode(recipe, child, options),
					);

	return {
		id,
		props,
		children,
	};
};

const expandTemplateNode = (
	recipe: RecipeDefinition,
	template: RecipeTemplateNode,
	instanceId: string,
	elementIdsByPath: Record<string, string>,
	options: Required<RecipeExpansionOptions>,
	isRoot: boolean,
): Node => {
	if (!isRegistryId(template.library)) {
		throw new Error(
			`Recipe "${recipe.id}" references unknown registry library "${template.library}".`,
		);
	}

	const resolution = resolveRegistryComponent(
		template.library,
		template.component,
	);
	if (resolution.status !== "known") {
		throw new Error(
			`Recipe "${recipe.id}" references unknown component "${template.component}" in registry "${template.library}".`,
		);
	}

	const id = options.createElementId();
	elementIdsByPath[template.path] = id;
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
		"data-trickroom-library": template.library,
		"data-trickroom-component": template.component,
		"data-trickroom-role": role,
		...getRecipeMarkerProps({
			recipeId: recipe.id,
			instanceId,
			path: template.path,
			isRoot,
			slotName: getTemplateSlotName(recipe, template),
		}),
	};

	const defaultSlotChildren = getTemplateSlotDefaultChildren(recipe, template);
	const children =
		role === "text"
			? (template.text ?? getDefaultText(role) ?? "")
			: role === "leaf"
				? []
				: [
						...(template.children ?? []).map((child) =>
							expandTemplateNode(
								recipe,
								child,
								instanceId,
								elementIdsByPath,
								options,
								false,
							),
						),
						...defaultSlotChildren.map((child) =>
							expandAuthoredTemplateNode(recipe, child, options),
						),
					];

	return {
		id,
		props,
		children,
	};
};

export const expandRecipeDefinition = (
	recipe: RecipeDefinition,
	options: RecipeExpansionOptions = {},
): RecipeExpansionResult => {
	const resolvedOptions: Required<RecipeExpansionOptions> = {
		createElementId: options.createElementId ?? createId,
		createRecipeInstanceId: options.createRecipeInstanceId ?? createId,
	};
	const instanceId = resolvedOptions.createRecipeInstanceId();
	const elementIdsByPath: Record<string, string> = {};
	const root = expandTemplateNode(
		recipe,
		recipe.root,
		instanceId,
		elementIdsByPath,
		resolvedOptions,
		true,
	);

	return {
		recipeId: recipe.id,
		instanceId,
		root,
		elementIdsByPath,
	};
};

export const expandRegistryRecipe = (
	library: string,
	recipe: string,
	options: RecipeExpansionOptions = {},
) => {
	const resolution = resolveRegistryRecipe(library, recipe);
	if (resolution.status !== "known") {
		throw new Error(
			resolution.status === "unknown-library"
				? `Unknown registry library "${library}".`
				: `Unknown recipe "${recipe}" in registry "${library}".`,
		);
	}

	return expandRecipeDefinition(resolution.definition, options);
};
