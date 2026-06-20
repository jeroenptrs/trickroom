import { MATERIALIZED_BASE_CLASS_PROP } from "../libraries/registry";
import type { Node, RecipeTemplateNode } from "../types";
import { assetIdProp, iconIdProp } from "./resource-props";
import { resolveSystemComponentInstanceNodeClassProps } from "./system-component-instance-update";
import {
	getSystemComponentStructuralMetadata,
	omitSystemComponentMarkerProps,
	type SystemComponentStructuralMetadata,
	systemComponentInstanceProp,
} from "./system-component-markers";
import {
	resolveSystemComponentOverrideValue,
	resolveSystemComponentTargetPropValues,
} from "./system-component-override-targets";
import type { PublishedSystemComponentVersion } from "./system-components";

export type DetachSystemComponentInstanceTarget = string | Pick<Node, "id">;

export type DetachSystemComponentInstanceResult = {
	roots: Node[];
	systemId: string;
	componentId: string;
	instanceId: string;
	targetElementId: string;
	changedElementId: string;
	selectionElementId: string;
	rootElementId: string | null;
	detachedElementIds: string[];
};

type SystemComponentTarget = {
	metadata: SystemComponentStructuralMetadata;
};

const getTemplateNodesByPath = (version: PublishedSystemComponentVersion) => {
	const nodes = new Map<string, RecipeTemplateNode>();
	const visit = (template: RecipeTemplateNode) => {
		nodes.set(template.path, template);
		for (const child of template.children ?? []) {
			visit(child);
		}
	};
	visit(version.root);
	return nodes;
};

const getTargetElementId = (target: DetachSystemComponentInstanceTarget) =>
	typeof target === "string" ? target : target.id;

const findSystemComponentTarget = (
	node: Node,
	targetElementId: string,
): SystemComponentTarget | null => {
	if (node.id === targetElementId) {
		const metadata = getSystemComponentStructuralMetadata(node.props);
		return metadata ? { metadata } : null;
	}

	if (Array.isArray(node.children)) {
		for (const child of node.children) {
			const target = findSystemComponentTarget(child, targetElementId);
			if (target) {
				return target;
			}
		}
	}

	return null;
};

const findSystemComponentTargetInRoots = (
	roots: readonly Node[],
	targetElementId: string,
) => {
	for (const root of roots) {
		const target = findSystemComponentTarget(root, targetElementId);
		if (target) {
			return target;
		}
	}

	return null;
};

const findSystemComponentRootMetadata = (
	roots: readonly Node[],
	instanceId: string,
) => {
	for (const root of roots) {
		const stack: Node[] = [root];
		while (stack.length > 0) {
			const node = stack.pop();
			if (!node) {
				continue;
			}
			const metadata = getSystemComponentStructuralMetadata(node.props);
			if (metadata?.instanceId === instanceId && metadata.isRoot) {
				return metadata;
			}
			if (Array.isArray(node.children)) {
				stack.push(...node.children);
			}
		}
	}
	return null;
};

export const detachSystemComponentInstance = (
	roots: readonly Node[],
	target: DetachSystemComponentInstanceTarget,
	version?: PublishedSystemComponentVersion,
): DetachSystemComponentInstanceResult | null => {
	const targetElementId = getTargetElementId(target);
	const componentTarget = findSystemComponentTargetInRoots(
		roots,
		targetElementId,
	);
	if (!componentTarget) {
		return null;
	}

	const { systemId, componentId, instanceId } = componentTarget.metadata;
	const rootMetadata =
		findSystemComponentRootMetadata(roots, instanceId) ??
		componentTarget.metadata;
	const variantValues = rootMetadata.variantValues;
	const overrides = rootMetadata.overrides;
	const resolvedVersion = version;
	const templatesByPath = resolvedVersion
		? getTemplateNodesByPath(resolvedVersion)
		: null;
	const detachedElementIds: string[] = [];
	let rootElementId: string | null = null;

	const stripInstanceMarkers = (node: Node): Node => {
		const metadata = getSystemComponentStructuralMetadata(node.props);
		const isTargetInstance =
			node.props[systemComponentInstanceProp] === instanceId;
		if (isTargetInstance) {
			detachedElementIds.push(node.id);
			if (metadata?.isRoot) {
				rootElementId = node.id;
			}
		}

		const children = Array.isArray(node.children)
			? node.children.map(stripInstanceMarkers)
			: node.children;

		const nextProps = isTargetInstance
			? omitSystemComponentMarkerProps(node.props)
			: node.props;
		if (isTargetInstance && metadata && resolvedVersion && templatesByPath) {
			const template = templatesByPath.get(metadata.path);
			const classNameProps = resolveSystemComponentInstanceNodeClassProps(
				resolvedVersion,
				template,
				metadata.path,
				variantValues,
				overrides,
				{
					systemId,
					componentId,
					instanceId,
				},
			);
			delete nextProps.className;
			delete nextProps[MATERIALIZED_BASE_CLASS_PROP];
			Object.assign(nextProps, classNameProps);
			if (template) {
				for (const [prop, value] of Object.entries(
					resolveSystemComponentTargetPropValues(
						resolvedVersion,
						template,
						overrides,
					),
				)) {
					if (value === undefined) {
						delete nextProps[prop];
					} else {
						nextProps[prop] = value;
					}
				}
			}
			const iconOverride = resolveSystemComponentOverrideValue(
				resolvedVersion,
				metadata.path,
				"icon",
				overrides,
			);
			if (iconOverride !== undefined) {
				nextProps[iconIdProp] = iconOverride;
			}
			const assetOverride = resolveSystemComponentOverrideValue(
				resolvedVersion,
				metadata.path,
				"asset",
				overrides,
			);
			if (assetOverride !== undefined) {
				nextProps[assetIdProp] = assetOverride;
			}
		}

		let nextChildren = children;
		if (isTargetInstance && metadata && resolvedVersion) {
			const textOverride = resolveSystemComponentOverrideValue(
				resolvedVersion,
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
		}

		return {
			...node,
			props: nextProps,
			children: nextChildren,
		};
	};

	return {
		roots: roots.map(stripInstanceMarkers),
		systemId,
		componentId,
		instanceId,
		targetElementId,
		changedElementId: targetElementId,
		selectionElementId: targetElementId,
		rootElementId,
		detachedElementIds,
	};
};
