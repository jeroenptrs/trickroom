import {
	availableRegistries,
	getControlDefinitions,
	getDefaultProps,
	getDefaultText,
	type RegistryId,
	resolveRegistryComponent,
	resolveRegistryRecipe,
} from "../libraries/registry";
import type {
	JsonPrimitive,
	Node,
	Props,
	RecipeDefinition,
	RecipeTemplateNode,
	RegistryComponentDefinition,
	Role,
} from "../types";
import {
	getRecipeMarkerProps,
	getRecipeStructuralMetadata,
	type RecipeStructuralMetadata,
	recipeRootProp,
} from "./markers";
import {
	getRecipeSlotCandidateFromProps,
	getRecipeSlotDefinitionForHost,
	isRecipeSlotChildAllowed,
} from "./slot-allowlist";

export type RecipeInstanceValidationStatus =
	| "attached-valid"
	| "attached-stale"
	| "invalid-known"
	| "unknown-recipe";

export type RecipeInstanceValidationIssueCode =
	| "UNKNOWN_RECIPE_ID"
	| "RECIPE_TEMPLATE_STALE"
	| "MISMATCHED_RECIPE_ID"
	| "MISSING_RECIPE_ROOT"
	| "MULTIPLE_RECIPE_ROOTS"
	| "MISSING_RECIPE_NODE"
	| "DUPLICATE_RECIPE_PATH"
	| "UNEXPECTED_RECIPE_PATH"
	| "RECIPE_SLOT_DISALLOWED_CHILD"
	| "RECIPE_NODE_PROPS_MISMATCH"
	| "RECIPE_NODE_CHILDREN_MISMATCH";

export type RecipeInstanceValidationIssue = {
	code: RecipeInstanceValidationIssueCode;
	message: string;
	elementId?: string;
	path?: string;
	expected?: JsonPrimitive | JsonPrimitive[] | Record<string, JsonPrimitive>;
	actual?: JsonPrimitive | JsonPrimitive[] | Record<string, JsonPrimitive>;
};

export type RecipeInstanceValidationReport = {
	status: RecipeInstanceValidationStatus;
	recipeId: string;
	instanceId: string;
	rootElementId: string | null;
	structuralElementIds: string[];
	currentVersion: string | null;
	matchedTemplateVersion: string | null;
	issues: RecipeInstanceValidationIssue[];
};

export type ValidateRecipeInstancesResult = {
	instances: RecipeInstanceValidationReport[];
	valid: RecipeInstanceValidationReport[];
	stale: RecipeInstanceValidationReport[];
	invalidKnown: RecipeInstanceValidationReport[];
	unknown: RecipeInstanceValidationReport[];
};

type RecipeNodeReference = {
	node: Node;
	metadata: RecipeStructuralMetadata;
	parentId: string | null;
};

type RecipeInstanceGroup = {
	instanceId: string;
	nodes: RecipeNodeReference[];
	recipeIds: Set<string>;
};

type ExpectedRecipeNode = {
	path: string;
	library: RegistryId;
	component: string;
	role: Role;
	isRoot: boolean;
	slotName: string | null;
	props: Record<string, JsonPrimitive>;
	childPaths: string[];
	text: string | undefined;
	mutableProps: Set<string>;
};

type ComparableRecipeTemplate = {
	root: RecipeTemplateNode;
	slots?: RecipeDefinition["slots"];
	controls?: RecipeDefinition["controls"];
};

const mutableStructuralProps = new Set(["className", "data-trickroom-name"]);

const getTemplateSlotName = (
	recipe: ComparableRecipeTemplate,
	template: RecipeTemplateNode,
) =>
	template.slot ??
	Object.values(recipe.slots ?? {}).find(
		(slot) => slot.hostPath === template.path,
	)?.name ??
	null;

const getComparablePropValue = (key: string, value: unknown) => {
	if (key === recipeRootProp && value === true) {
		return "true";
	}

	return value;
};

const getComparableProps = (
	props: Props,
	mutableProps: ReadonlySet<string>,
): Record<string, JsonPrimitive> =>
	Object.fromEntries(
		Object.entries(props)
			.filter((entry): entry is [string, JsonPrimitive] => {
				const [key, value] = entry;
				return !mutableProps.has(key) && value !== undefined;
			})
			.map(([key, value]) => [key, getComparablePropValue(key, value)])
			.sort(([a], [b]) => a.localeCompare(b)),
	);

const getMutablePropsForTemplate = (
	recipe: ComparableRecipeTemplate,
	template: RecipeTemplateNode,
	definition: RegistryComponentDefinition,
) => {
	const props = new Set(mutableStructuralProps);
	for (const control of getControlDefinitions(definition)) {
		props.add(control.prop);
	}
	for (const control of Object.values(recipe.controls ?? {})) {
		if (control.path === template.path) {
			props.add(control.prop);
		}
	}
	return props;
};

const getExpectedTemplateProps = (
	recipe: RecipeDefinition,
	template: RecipeTemplateNode,
	instanceId: string,
	library: RegistryId,
	definition: RegistryComponentDefinition,
	isRoot: boolean,
	slotName: string | null,
) => {
	const name = template.name ?? definition.label;
	return {
		...getDefaultProps(library, template.component, definition, name),
		...(template.props ?? {}),
		...(template.className !== undefined
			? { className: template.className }
			: {}),
		"data-trickroom-name": name,
		"data-trickroom-library": library,
		"data-trickroom-component": template.component,
		"data-trickroom-role": definition.role,
		...getRecipeMarkerProps({
			recipeId: recipe.id,
			instanceId,
			path: template.path,
			isRoot,
			slotName,
		}),
	} satisfies Props;
};

const buildExpectedRecipeSkeleton = (
	recipe: RecipeDefinition,
	templateSet: ComparableRecipeTemplate,
	instanceId: string,
) => {
	const expectedByPath = new Map<string, ExpectedRecipeNode>();

	const visit = (
		template: RecipeTemplateNode,
		isRoot: boolean,
	): ExpectedRecipeNode => {
		const resolution = resolveRegistryComponent(
			template.library,
			template.component,
		);
		if (resolution.status !== "known") {
			throw new Error(
				`Recipe "${recipe.id}" references unknown component "${template.library}/${template.component}".`,
			);
		}

		const slotName = getTemplateSlotName(templateSet, template);
		const mutableProps = getMutablePropsForTemplate(
			templateSet,
			template,
			resolution.definition,
		);
		const expectedProps = getExpectedTemplateProps(
			recipe,
			template,
			instanceId,
			resolution.library,
			resolution.definition,
			isRoot,
			slotName,
		);
		const expected: ExpectedRecipeNode = {
			path: template.path,
			library: resolution.library,
			component: template.component,
			role: resolution.definition.role,
			isRoot,
			slotName,
			props: getComparableProps(expectedProps, mutableProps),
			childPaths:
				resolution.definition.role === "branch"
					? (template.children ?? []).map((child) => child.path)
					: [],
			text:
				resolution.definition.role === "text"
					? (template.text ?? getDefaultText(resolution.definition.role))
					: undefined,
			mutableProps,
		};

		expectedByPath.set(template.path, expected);
		for (const child of template.children ?? []) {
			visit(child, false);
		}

		return expected;
	};

	visit(templateSet.root, true);
	return expectedByPath;
};

const collectRecipeInstanceGroups = (roots: readonly Node[]) => {
	const groups = new Map<string, RecipeInstanceGroup>();

	const visit = (node: Node, parentId: string | null) => {
		const metadata = getRecipeStructuralMetadata(node.props);
		if (metadata) {
			const group = groups.get(metadata.instanceId) ?? {
				instanceId: metadata.instanceId,
				nodes: [],
				recipeIds: new Set<string>(),
			};
			group.nodes.push({ node, metadata, parentId });
			group.recipeIds.add(metadata.recipeId);
			groups.set(metadata.instanceId, group);
		}

		if (Array.isArray(node.children)) {
			for (const child of node.children) {
				visit(child, node.id);
			}
		}
	};

	for (const root of roots) {
		visit(root, null);
	}

	return [...groups.values()];
};

const getPrimaryRecipeId = (group: RecipeInstanceGroup) =>
	group.nodes.find(({ metadata }) => metadata.isRoot)?.metadata.recipeId ??
	group.nodes[0]?.metadata.recipeId ??
	"";

const getRootElementId = (group: RecipeInstanceGroup) =>
	group.nodes.find(({ metadata }) => metadata.isRoot)?.node.id ?? null;

const resolveRecipeById = (recipeId: string) => {
	const resolutions = availableRegistries
		.map((library) => resolveRegistryRecipe(library, recipeId))
		.filter((resolution) => resolution.status === "known");

	return (
		resolutions.find((resolution) => resolution.definition.id === recipeId) ??
		resolutions[0] ??
		null
	);
};

const getActualChildPaths = (node: Node, instanceId: string) => {
	if (!Array.isArray(node.children)) {
		return null;
	}

	return node.children.map((child) => {
		const metadata = getRecipeStructuralMetadata(child.props);
		if (metadata?.instanceId === instanceId) {
			return metadata.path;
		}
		return null;
	});
};

const describeActualChildPaths = (childPaths: (string | null)[] | null) =>
	childPaths === null ? "text" : childPaths.map((path) => path ?? "<authored>");

const describeSlotCandidate = (
	candidate: ReturnType<typeof getRecipeSlotCandidateFromProps>,
) =>
	candidate.kind === "recipe"
		? `${candidate.library}/${candidate.recipe}`
		: `${candidate.library}/${candidate.component}`;

const pushIssue = (
	issues: RecipeInstanceValidationIssue[],
	issue: RecipeInstanceValidationIssue,
) => {
	issues.push(issue);
};

const isSlotPolicyIssue = (issue: RecipeInstanceValidationIssue) =>
	issue.code === "RECIPE_SLOT_DISALLOWED_CHILD";

const getStructuralIssues = (issues: RecipeInstanceValidationIssue[]) =>
	issues.filter((issue) => !isSlotPolicyIssue(issue));

const validateKnownRecipeInstanceAgainstTemplate = (
	group: RecipeInstanceGroup,
	recipe: RecipeDefinition,
	templateSet: ComparableRecipeTemplate,
): {
	issues: RecipeInstanceValidationIssue[];
	rootElementId: string | null;
	structuralElementIds: string[];
} => {
	const rootNodes = group.nodes.filter(({ metadata }) => metadata.isRoot);
	const rootElementId = rootNodes[0]?.node.id ?? null;
	const structuralElementIds = group.nodes.map(({ node }) => node.id);
	const issues: RecipeInstanceValidationIssue[] = [];

	if (rootNodes.length === 0) {
		pushIssue(issues, {
			code: "MISSING_RECIPE_ROOT",
			message: `Recipe instance "${group.instanceId}" does not have a recipe root marker.`,
		});
	} else if (rootNodes.length > 1) {
		pushIssue(issues, {
			code: "MULTIPLE_RECIPE_ROOTS",
			message: `Recipe instance "${group.instanceId}" has multiple recipe root markers.`,
			actual: rootNodes.map(({ node }) => node.id),
		});
	}

	for (const recipeId of group.recipeIds) {
		if (recipeId !== recipe.id) {
			pushIssue(issues, {
				code: "MISMATCHED_RECIPE_ID",
				message: `Recipe instance "${group.instanceId}" mixes recipe id "${recipeId}" with expected "${recipe.id}".`,
				expected: recipe.id,
				actual: recipeId,
			});
		}
	}

	const expectedByPath = buildExpectedRecipeSkeleton(
		recipe,
		templateSet,
		group.instanceId,
	);
	const actualByPath = new Map<string, RecipeNodeReference[]>();
	for (const reference of group.nodes) {
		const references = actualByPath.get(reference.metadata.path) ?? [];
		references.push(reference);
		actualByPath.set(reference.metadata.path, references);
	}

	for (const [path, references] of actualByPath) {
		if (!expectedByPath.has(path)) {
			for (const reference of references) {
				pushIssue(issues, {
					code: "UNEXPECTED_RECIPE_PATH",
					message: `Recipe instance "${group.instanceId}" has unexpected structural path "${path}".`,
					elementId: reference.node.id,
					path,
				});
			}
			continue;
		}

		if (references.length > 1) {
			pushIssue(issues, {
				code: "DUPLICATE_RECIPE_PATH",
				message: `Recipe instance "${group.instanceId}" has multiple nodes for structural path "${path}".`,
				path,
				actual: references.map(({ node }) => node.id),
			});
		}
	}

	for (const [path, expected] of expectedByPath) {
		const actual = actualByPath.get(path)?.[0] ?? null;
		if (!actual) {
			pushIssue(issues, {
				code: "MISSING_RECIPE_NODE",
				message: `Recipe instance "${group.instanceId}" is missing structural path "${path}".`,
				path,
			});
			continue;
		}

		const actualProps = getComparableProps(
			actual.node.props,
			expected.mutableProps,
		);
		if (JSON.stringify(actualProps) !== JSON.stringify(expected.props)) {
			pushIssue(issues, {
				code: "RECIPE_NODE_PROPS_MISMATCH",
				message: `Recipe instance "${group.instanceId}" path "${path}" does not match the recipe structural props.`,
				elementId: actual.node.id,
				path,
				expected: expected.props,
				actual: actualProps,
			});
		}

		if (expected.slotName !== null) {
			const slot = getRecipeSlotDefinitionForHost(recipe, expected.slotName);
			if (slot?.allowedChildren && Array.isArray(actual.node.children)) {
				for (const child of actual.node.children) {
					const childMetadata = getRecipeStructuralMetadata(child.props);
					if (childMetadata?.instanceId === group.instanceId) {
						continue;
					}

					const candidate = getRecipeSlotCandidateFromProps(child.props);
					if (!isRecipeSlotChildAllowed(slot.allowedChildren, candidate)) {
						pushIssue(issues, {
							code: "RECIPE_SLOT_DISALLOWED_CHILD",
							message: `Recipe instance "${group.instanceId}" slot "${expected.slotName}" does not allow child "${describeSlotCandidate(candidate)}".`,
							elementId: child.id,
							path,
							expected: slot.allowedChildren.map((entry) =>
								entry.kind === "recipe"
									? `${entry.library}/${entry.recipe}`
									: `${entry.library}/${entry.component}`,
							),
							actual: describeSlotCandidate(candidate),
						});
					}
				}
			}
			continue;
		}

		if (expected.role === "text") {
			if (actual.node.children !== expected.text) {
				pushIssue(issues, {
					code: "RECIPE_NODE_CHILDREN_MISMATCH",
					message: `Recipe instance "${group.instanceId}" path "${path}" text content does not match the recipe structure.`,
					elementId: actual.node.id,
					path,
					expected: expected.text ?? "",
					actual:
						typeof actual.node.children === "string"
							? actual.node.children
							: "<element-children>",
				});
			}
			continue;
		}

		const actualChildPaths = getActualChildPaths(actual.node, group.instanceId);
		const expectedChildPaths =
			expected.role === "leaf" ? [] : expected.childPaths;
		if (
			JSON.stringify(actualChildPaths) !== JSON.stringify(expectedChildPaths)
		) {
			pushIssue(issues, {
				code: "RECIPE_NODE_CHILDREN_MISMATCH",
				message: `Recipe instance "${group.instanceId}" path "${path}" children do not match the recipe structure.`,
				elementId: actual.node.id,
				path,
				expected: expectedChildPaths,
				actual: describeActualChildPaths(actualChildPaths),
			});
		}
	}

	return { issues, rootElementId, structuralElementIds };
};

const getRecipeVersion = (recipe: RecipeDefinition) => String(recipe.version);

const validateKnownRecipeInstance = (
	group: RecipeInstanceGroup,
	recipe: RecipeDefinition,
): RecipeInstanceValidationReport => {
	const currentVersion = getRecipeVersion(recipe);
	const current = validateKnownRecipeInstanceAgainstTemplate(
		group,
		recipe,
		recipe,
	);
	const currentStructuralIssues = getStructuralIssues(current.issues);
	if (currentStructuralIssues.length === 0) {
		return {
			status: "attached-valid",
			recipeId: recipe.id,
			instanceId: group.instanceId,
			rootElementId: current.rootElementId,
			structuralElementIds: current.structuralElementIds,
			currentVersion,
			matchedTemplateVersion: currentVersion,
			issues: current.issues,
		};
	}

	for (const previousTemplate of recipe.previousTemplates ?? []) {
		const previous = validateKnownRecipeInstanceAgainstTemplate(
			group,
			recipe,
			previousTemplate,
		);
		const previousStructuralIssues = getStructuralIssues(previous.issues);
		if (previousStructuralIssues.length === 0) {
			return {
				status: "attached-stale",
				recipeId: recipe.id,
				instanceId: group.instanceId,
				rootElementId: previous.rootElementId,
				structuralElementIds: previous.structuralElementIds,
				currentVersion,
				matchedTemplateVersion: previousTemplate.version,
				issues: [
					{
						code: "RECIPE_TEMPLATE_STALE",
						message: `Recipe instance "${group.instanceId}" matches previous template version "${previousTemplate.version}" for recipe "${recipe.id}" instead of current version "${currentVersion}".`,
						expected: currentVersion,
						actual: previousTemplate.version,
					},
					...previous.issues,
				],
			};
		}
	}

	return {
		status: "invalid-known",
		recipeId: recipe.id,
		instanceId: group.instanceId,
		rootElementId: current.rootElementId,
		structuralElementIds: current.structuralElementIds,
		currentVersion,
		matchedTemplateVersion: null,
		issues: current.issues,
	};
};

const validateRecipeInstanceGroup = (
	group: RecipeInstanceGroup,
): RecipeInstanceValidationReport => {
	const recipeId = getPrimaryRecipeId(group);
	const resolution = resolveRecipeById(recipeId);
	if (!resolution) {
		return {
			status: "unknown-recipe",
			recipeId,
			instanceId: group.instanceId,
			rootElementId: getRootElementId(group),
			structuralElementIds: group.nodes.map(({ node }) => node.id),
			currentVersion: null,
			matchedTemplateVersion: null,
			issues: [
				{
					code: "UNKNOWN_RECIPE_ID",
					message: `Recipe instance "${group.instanceId}" references unknown recipe id "${recipeId}".`,
					expected: null,
					actual: recipeId,
				},
			],
		};
	}

	return validateKnownRecipeInstance(group, resolution.definition);
};

export const validateRecipeInstances = (
	roots: readonly Node[],
): ValidateRecipeInstancesResult => {
	const instances = collectRecipeInstanceGroups(roots).map(
		validateRecipeInstanceGroup,
	);

	return {
		instances,
		valid: instances.filter((instance) => instance.status === "attached-valid"),
		stale: instances.filter((instance) => instance.status === "attached-stale"),
		invalidKnown: instances.filter(
			(instance) => instance.status === "invalid-known",
		),
		unknown: instances.filter(
			(instance) => instance.status === "unknown-recipe",
		),
	};
};
