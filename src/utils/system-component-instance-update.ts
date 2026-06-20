import {
	getMaterializedBaseClassProps,
	MATERIALIZED_BASE_CLASS_PROP,
	resolveRegistryComponent,
} from "../libraries/registry";
import type { Node, Props, RecipeTemplateNode } from "../types";
import { assetIdProp, iconIdProp } from "./resource-props";
import {
	getSystemComponentMarkerProps,
	getSystemComponentStructuralMetadata,
	type SystemComponentInstanceOverrides,
	type SystemComponentInstanceOverrideValues,
} from "./system-component-markers";
import { resolveSystemComponentOverrideValue } from "./system-component-override-targets";
import {
	resolveMaterializedSystemComponentClassComposition,
	resolveSystemComponentClassName,
	resolveSystemComponentVariantValues,
} from "./system-component-resolution";
import type { PublishedSystemComponentVersion } from "./system-components";

// Mirrors expansion (expandTemplateNode): the resolved system className wins
// over authored template props, while empty resolved classes fall back to the
// template's authored props.
export const resolveInstanceNodeClassName = (
	template: RecipeTemplateNode | undefined,
	resolvedSystemClassName: string,
): string | undefined => {
	if (resolvedSystemClassName) {
		return resolvedSystemClassName;
	}
	if (!template) {
		return undefined;
	}
	const templatePropsClassName = template.props?.className;
	if (typeof templatePropsClassName === "string") {
		return templatePropsClassName;
	}
	return undefined;
};

export const resolveMaterializedInstanceNodeClassProps = (
	template: RecipeTemplateNode | undefined,
	resolvedSystemClassName: string,
): Partial<Props> => {
	const className = resolveInstanceNodeClassName(
		template,
		resolvedSystemClassName,
	);
	if (!template) {
		return className ? { className } : {};
	}
	const resolution = resolveRegistryComponent(
		template.library,
		template.component,
	);
	if (resolution.status === "known") {
		return getMaterializedBaseClassProps(className, resolution.definition);
	}
	return className ? { className } : {};
};

export const resolveSystemComponentInstanceNodeClassProps = (
	version: PublishedSystemComponentVersion,
	template: RecipeTemplateNode | undefined,
	path: string,
	variantValues: Record<string, string>,
	overrides: SystemComponentInstanceOverrides,
	context: {
		systemId?: string;
		componentId?: string;
		instanceId?: string;
	},
): Partial<Props> => {
	if (!template) {
		const className = resolveSystemComponentClassName(
			version,
			path,
			undefined,
			variantValues,
			overrides,
		);
		return className ? { className } : {};
	}
	const resolution = resolveRegistryComponent(
		template.library,
		template.component,
	);
	const templatePropsClassName =
		typeof template.props?.className === "string"
			? template.props.className
			: undefined;
	if (resolution.status === "known") {
		return resolveMaterializedSystemComponentClassComposition(
			version,
			path,
			template.className,
			templatePropsClassName,
			variantValues,
			overrides,
			resolution.definition,
			{
				...context,
				library: template.library,
				component: template.component,
			},
		).props;
	}

	const className = resolveInstanceNodeClassName(
		template,
		resolveSystemComponentClassName(
			version,
			path,
			template.className,
			variantValues,
			overrides,
		) ?? "",
	);
	return className ? { className } : {};
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

export type UpdateSystemComponentInstancePatch = {
	variantValues?: Record<string, string>;
	unsetVariantAxes?: string[];
	overrides?: SystemComponentInstanceOverrides;
};

export type UpdateSystemComponentInstanceResult = {
	roots: Node[];
	instanceId: string;
	rootElementId: string;
	changedElementIds: string[];
	variantValues: Record<string, string>;
	overrides: SystemComponentInstanceOverrides;
};

const pickCurrentVariantValues = (
	version: PublishedSystemComponentVersion,
	variantValues: Record<string, string>,
) => {
	const axes = version.variants?.axes ?? {};
	return Object.fromEntries(
		Object.entries(variantValues).filter(([axisKey]) =>
			Object.hasOwn(axes, axisKey),
		),
	);
};

const visitNodes = (
	nodes: readonly Node[],
	visitor: (node: Node) => Node,
): Node[] =>
	nodes.map((node) => {
		const nextNode = visitor(node);
		if (!Array.isArray(nextNode.children)) {
			return nextNode;
		}
		return {
			...nextNode,
			children: visitNodes(nextNode.children, visitor),
		};
	});

export const updateSystemComponentInstanceOnRoots = (
	roots: readonly Node[],
	rootElementId: string,
	version: PublishedSystemComponentVersion,
	patch: UpdateSystemComponentInstancePatch,
): UpdateSystemComponentInstanceResult | null => {
	const templatesByPath = getTemplateNodesByPath(version.root);
	let instanceId: string | null = null;
	let rootMetadata: ReturnType<typeof getSystemComponentStructuralMetadata> =
		null;

	const findRoot = (node: Node): Node | null => {
		if (node.id !== rootElementId) {
			return null;
		}
		const metadata = getSystemComponentStructuralMetadata(node.props);
		if (!metadata?.isRoot) {
			return null;
		}
		instanceId = metadata.instanceId;
		rootMetadata = metadata;
		return node;
	};

	for (const root of roots) {
		const stack: Node[] = [root];
		while (stack.length > 0) {
			const node = stack.pop();
			if (!node) {
				continue;
			}
			if (findRoot(node)) {
				break;
			}
			if (Array.isArray(node.children)) {
				stack.push(...node.children);
			}
		}
		if (instanceId) {
			break;
		}
	}

	if (!instanceId || !rootMetadata) {
		return null;
	}

	const selectedVariantValues = {
		...pickCurrentVariantValues(version, rootMetadata.variantValues),
		...(patch.variantValues ?? {}),
	};
	for (const axisKey of patch.unsetVariantAxes ?? []) {
		delete selectedVariantValues[axisKey];
	}
	const variantValues = resolveSystemComponentVariantValues(
		version.variants,
		selectedVariantValues,
	);
	const overrides = patch.overrides ?? rootMetadata.overrides;
	const changedElementIds = new Set<string>();

	const nextRoots = visitNodes(roots, (node) => {
		const metadata = getSystemComponentStructuralMetadata(node.props);
		if (!metadata || metadata.instanceId !== instanceId) {
			return node;
		}

		const template = templatesByPath.get(metadata.path);
		const classNameProps = resolveSystemComponentInstanceNodeClassProps(
			version,
			template,
			metadata.path,
			variantValues,
			overrides,
			{
				systemId: metadata.systemId,
				componentId: metadata.componentId,
				instanceId: metadata.instanceId,
			},
		);

		const nextProps = { ...node.props };
		delete nextProps.className;
		delete nextProps[MATERIALIZED_BASE_CLASS_PROP];
		Object.assign(nextProps, classNameProps);

		if (metadata.isRoot) {
			Object.assign(
				nextProps,
				getSystemComponentMarkerProps({
					systemId: metadata.systemId,
					componentId: metadata.componentId,
					instanceId: metadata.instanceId,
					version: metadata.version,
					path: metadata.path,
					isRoot: true,
					variantValues,
					overrides,
					templateHash: metadata.templateHash ?? undefined,
					variantSchemaHash: metadata.variantSchemaHash ?? undefined,
				}),
			);
		}

		const iconOverride = resolveSystemComponentOverrideValue(
			version,
			metadata.path,
			"icon",
			overrides,
		);
		if (iconOverride !== undefined) {
			nextProps[iconIdProp] = iconOverride;
		}
		const assetOverride = resolveSystemComponentOverrideValue(
			version,
			metadata.path,
			"asset",
			overrides,
		);
		if (assetOverride !== undefined) {
			nextProps[assetIdProp] = assetOverride;
		}

		let nextChildren = node.children;
		const textOverride = resolveSystemComponentOverrideValue(
			version,
			metadata.path,
			"text",
			overrides,
		);
		if (
			textOverride !== undefined &&
			node.props["data-trickroom-role"] === "text"
		) {
			nextChildren = textOverride;
		}

		if (
			nextProps.className !== node.props.className ||
			nextProps[iconIdProp] !== node.props[iconIdProp] ||
			nextProps[assetIdProp] !== node.props[assetIdProp] ||
			nextProps[MATERIALIZED_BASE_CLASS_PROP] !==
				node.props[MATERIALIZED_BASE_CLASS_PROP] ||
			nextChildren !== node.children ||
			metadata.isRoot
		) {
			changedElementIds.add(node.id);
		}

		return {
			...node,
			props: nextProps,
			children: nextChildren,
		};
	});

	return {
		roots: nextRoots,
		instanceId,
		rootElementId,
		changedElementIds: [...changedElementIds],
		variantValues,
		overrides,
	};
};

export const setSystemComponentVariantValueOnRoots = (
	roots: readonly Node[],
	rootElementId: string,
	version: PublishedSystemComponentVersion,
	axisKey: string,
	value: string | null,
) =>
	updateSystemComponentInstanceOnRoots(roots, rootElementId, version, {
		...(value === null
			? { unsetVariantAxes: [axisKey] }
			: { variantValues: { [axisKey]: value } }),
	});

const patchSystemComponentOverrideOnRoots = (
	roots: readonly Node[],
	rootElementId: string,
	version: PublishedSystemComponentVersion,
	targetId: string,
	patch: SystemComponentInstanceOverrideValues,
) => {
	const rootNode = findNodeById(roots, rootElementId);
	const rootMetadata = rootNode
		? getSystemComponentStructuralMetadata(rootNode.props)
		: null;
	if (!rootMetadata?.isRoot) {
		return null;
	}

	const overrides: SystemComponentInstanceOverrides = {
		...rootMetadata.overrides,
		[targetId]: {
			...rootMetadata.overrides[targetId],
			...patch,
		},
	};

	return updateSystemComponentInstanceOnRoots(roots, rootElementId, version, {
		overrides,
	});
};

export const setSystemComponentOverrideClassNameOnRoots = (
	roots: readonly Node[],
	rootElementId: string,
	version: PublishedSystemComponentVersion,
	targetId: string,
	className: string,
) =>
	patchSystemComponentOverrideOnRoots(roots, rootElementId, version, targetId, {
		className,
	});

export const setSystemComponentOverrideTextOnRoots = (
	roots: readonly Node[],
	rootElementId: string,
	version: PublishedSystemComponentVersion,
	targetId: string,
	text: string,
) =>
	patchSystemComponentOverrideOnRoots(roots, rootElementId, version, targetId, {
		text,
	});

export const setSystemComponentOverrideIconIdOnRoots = (
	roots: readonly Node[],
	rootElementId: string,
	version: PublishedSystemComponentVersion,
	targetId: string,
	iconId: string,
) =>
	patchSystemComponentOverrideOnRoots(roots, rootElementId, version, targetId, {
		[iconIdProp]: iconId,
	});

export const setSystemComponentOverrideAssetIdOnRoots = (
	roots: readonly Node[],
	rootElementId: string,
	version: PublishedSystemComponentVersion,
	targetId: string,
	assetId: string,
) =>
	patchSystemComponentOverrideOnRoots(roots, rootElementId, version, targetId, {
		[assetIdProp]: assetId,
	});

const findNodeById = (roots: readonly Node[], id: string): Node | null => {
	for (const root of roots) {
		const stack: Node[] = [root];
		while (stack.length > 0) {
			const node = stack.pop();
			if (!node) {
				continue;
			}
			if (node.id === id) {
				return node;
			}
			if (Array.isArray(node.children)) {
				stack.push(...node.children);
			}
		}
	}
	return null;
};
