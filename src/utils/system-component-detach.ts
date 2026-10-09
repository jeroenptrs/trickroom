import {
	getRenderedClassName,
	MATERIALIZED_BASE_CLASS_PROP,
	resolveRegistryComponent,
} from "../libraries/registry";
import type { Node, Props, RecipeTemplateNode } from "../types";
import {
	type ComponentClassSource,
	collectInstanceRootMarkers,
	type InstanceRootMarkers,
} from "./class-merge";
import { assetIdProp, iconIdProp } from "./resource-props";
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

/**
 * The className a detached node keeps: exactly what it renders with
 * (`getRenderedClassName`, with the canvas's component class source), the
 * registry base classes leading and marked materialized, so the plain
 * element looks the same.
 */
const renderedClassNameProps = (
	node: Node,
	source: ComponentClassSource | null,
	root: InstanceRootMarkers | null,
): Partial<Props> | null => {
	const resolution = resolveRegistryComponent(
		node.props["data-trickroom-library"],
		node.props["data-trickroom-component"],
	);
	if (resolution.status !== "known") return null;
	const className = getRenderedClassName(
		node.props,
		resolution.definition,
		source ? { source, root } : null,
	);
	return {
		...(className ? { className } : {}),
		...(resolution.definition.baseClassName?.trim()
			? { [MATERIALIZED_BASE_CLASS_PROP]: "true" }
			: {}),
	};
};

/**
 * Turns an instance into plain elements. Each node keeps the className it
 * renders with: pass the `source` the canvas renders with (null when it
 * renders stored classes), so detaching never changes how a layer looks.
 * Text, icon, asset and prop overrides come from `version`. Nested
 * instances and slot content keep their props.
 */
export const detachSystemComponentInstance = (
	roots: readonly Node[],
	target: DetachSystemComponentInstanceTarget,
	version?: PublishedSystemComponentVersion,
	source?: ComponentClassSource | null,
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
	const overrides = rootMetadata.overrides;
	const resolvedVersion = version;
	const templatesByPath = resolvedVersion
		? getTemplateNodesByPath(resolvedVersion)
		: null;
	const instanceRoot =
		collectInstanceRootMarkers(roots).get(instanceId) ?? null;
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
		if (isTargetInstance) {
			const classNameProps = renderedClassNameProps(
				node,
				source ?? null,
				instanceRoot,
			);
			if (classNameProps) {
				delete nextProps.className;
				delete nextProps[MATERIALIZED_BASE_CLASS_PROP];
				Object.assign(nextProps, classNameProps);
			}
		}
		if (isTargetInstance && metadata && resolvedVersion && templatesByPath) {
			const template = templatesByPath.get(metadata.path);
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
