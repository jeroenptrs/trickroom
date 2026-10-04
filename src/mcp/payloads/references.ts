import {
	CORE_PROP_KEYS,
	getControlDefinitions,
	isValidControlValue,
	normalizeRole,
	resolveRegistryComponent,
	SYSTEM_PROP_KEYS,
} from "../../libraries/registry";
import { DesignTransformError } from "../../services/design-transform-service";
import type { Node as DesignNode, TrickroomDesign } from "../../types";
import {
	normalizeAssetId,
	readAsset,
} from "../../utils/asset-manifest-service";
import {
	componentAllowsBlankResourceId,
	getResourceIdProp,
	getResourceKindForComponent,
} from "../../utils/design-resource-references";
import { normalizeIconId, readIcon } from "../../utils/icon-manifest-service";
import type { McpDesignIssue } from "../diagnostics";
import { assertCanUseComponent, type McpPolicy } from "../governance";
import type { TrickroomMcpServerContext } from "../server-types";
import { assertConfiguredSystem } from "./design-system";
import { findElementContext, getDesignSystemHandle } from "./design-tree";

export type ValidationIssue = McpDesignIssue;

const getElementResourceReference = (element: DesignNode) => {
	const library = element.props["data-trickroom-library"];
	const component = element.props["data-trickroom-component"];
	const kind = getResourceKindForComponent(library, component);
	if (!kind) {
		return null;
	}

	const idProp = getResourceIdProp(kind);
	const resourceId = element.props[idProp];
	return {
		kind,
		idProp,
		allowsBlank: componentAllowsBlankResourceId(library, component, kind),
		resourceId:
			typeof resourceId === "string" && resourceId.trim().length > 0
				? resourceId.trim()
				: null,
	};
};

export const assertResourceElementReferenceExists = async (
	context: TrickroomMcpServerContext,
	design: TrickroomDesign,
	elementId: string | undefined,
) => {
	if (elementId === undefined) {
		return;
	}

	const elementContext = findElementContext(design, elementId);
	if (!elementContext) {
		return;
	}

	const reference = getElementResourceReference(elementContext.element);
	if (!reference) {
		return;
	}

	const systemHandle = getDesignSystemHandle(design);
	if (!systemHandle) {
		if (reference.resourceId === null && reference.allowsBlank) {
			return;
		}

		throw new DesignTransformError(
			"DESIGN_SYSTEM_REQUIRED",
			`${reference.kind === "asset" ? "Asset" : "Icon"} elements require the design to be linked to a system.`,
		);
	}
	const system = await assertConfiguredSystem(context, systemHandle);
	const systemId = system.manifest.systemId;
	const systemName = system.manifest.systemName;

	if (!reference.resourceId) {
		if (reference.allowsBlank) {
			return;
		}

		throw new DesignTransformError(
			reference.kind === "asset" ? "MISSING_ASSET_ID" : "MISSING_ICON_ID",
			`${reference.kind === "asset" ? "Asset" : "Icon"} elements require ${reference.idProp}.`,
		);
	}
	const normalizedResourceId = normalizeResourceIdForMutation(
		reference.kind,
		reference.resourceId,
	);

	if (reference.kind === "asset") {
		const asset = await readAsset(
			context.projectRoot,
			systemId,
			normalizedResourceId,
		);
		if (!asset) {
			throw new DesignTransformError(
				"UNKNOWN_ASSET_ID",
				`Asset id "${reference.resourceId}" does not exist in system "${systemName}".`,
			);
		}
		return;
	}

	const icon = await readIcon(
		context.projectRoot,
		systemId,
		normalizedResourceId,
	);
	if (!icon) {
		throw new DesignTransformError(
			"UNKNOWN_ICON_ID",
			`Icon id "${reference.resourceId}" does not exist in system "${systemName}".`,
		);
	}
};

const normalizeResourceIdForMutation = (
	kind: "asset" | "icon",
	resourceId: string,
) => {
	let normalizedResourceId: string;
	try {
		normalizedResourceId =
			kind === "asset"
				? normalizeAssetId(resourceId)
				: normalizeIconId(resourceId);
	} catch {
		throw new DesignTransformError(
			kind === "asset" ? "INVALID_ASSET_ID" : "INVALID_ICON_ID",
			`${kind === "asset" ? "Asset" : "Icon"} id "${resourceId}" is not valid.`,
		);
	}

	if (normalizedResourceId !== resourceId) {
		throw new DesignTransformError(
			kind === "asset" ? "INVALID_ASSET_ID" : "INVALID_ICON_ID",
			`${kind === "asset" ? "Asset" : "Icon"} id "${resourceId}" must be written as canonical id "${normalizedResourceId}".`,
		);
	}

	return normalizedResourceId;
};

const walkElementTree = (
	node: DesignNode,
	visit: (element: DesignNode) => void,
) => {
	visit(node);
	if (typeof node.children === "string") {
		return;
	}

	for (const child of node.children) {
		walkElementTree(child, visit);
	}
};

export const getSubtreeElementIds = (
	design: TrickroomDesign,
	rootElementId: string,
): string[] => {
	const root = findElementContext(design, rootElementId)?.element;
	if (!root) {
		return [rootElementId];
	}
	const ids: string[] = [];
	walkElementTree(root, (element) => ids.push(element.id));
	return ids;
};

export const assertCanUseSubtreeComponents = (
	policy: McpPolicy,
	subtree: DesignNode,
) => {
	walkElementTree(subtree, (element) => {
		assertCanUseComponent(
			policy,
			element.props["data-trickroom-library"],
			element.props["data-trickroom-component"],
		);
	});
};

export const assertResourceReferencesExist = async (
	context: TrickroomMcpServerContext,
	design: TrickroomDesign,
) => {
	for (const board of design.boards) {
		const elementIds: string[] = [];
		walkElementTree(board, (element) => elementIds.push(element.id));
		for (const elementId of elementIds) {
			await assertResourceElementReferenceExists(context, design, elementId);
		}
	}
};

export const validateElementReferences = (
	node: DesignNode,
	path: string,
	seenElementIds: Map<string, string>,
	issues: ValidationIssue[],
	componentUsage: Map<string, number>,
) => {
	const library = node.props["data-trickroom-library"];
	const component = node.props["data-trickroom-component"];
	const role = node.props["data-trickroom-role"];
	const normalizedRole = normalizeRole(role);
	const componentKey = `${library}/${component}`;
	componentUsage.set(componentKey, (componentUsage.get(componentKey) ?? 0) + 1);

	const firstPath = seenElementIds.get(node.id);
	if (firstPath) {
		issues.push({
			severity: "error",
			code: "DUPLICATE_ELEMENT_ID",
			message: `Element id "${node.id}" is already used at ${firstPath}.`,
			path,
			elementId: node.id,
		});
	} else {
		seenElementIds.set(node.id, path);
	}

	const resolution = resolveRegistryComponent(library, component);
	if (resolution.status === "unknown-library") {
		issues.push({
			severity: "error",
			code: "UNKNOWN_REGISTRY_LIBRARY",
			message: `Element references unknown registry "${library}".`,
			path,
			elementId: node.id,
		});
	} else if (resolution.status === "unknown-component") {
		issues.push({
			severity: "error",
			code: "UNKNOWN_REGISTRY_COMPONENT",
			message: `Element references unknown component "${component}" in registry "${library}".`,
			path,
			elementId: node.id,
		});
	} else {
		const expectedRole = resolution.definition.role;
		if (normalizedRole !== expectedRole) {
			issues.push({
				severity: "error",
				code: "REGISTRY_ROLE_MISMATCH",
				message: `Element role does not match registry metadata for "${componentKey}".`,
				path,
				elementId: node.id,
			});
		}

		const controlProps = new Map(
			getControlDefinitions(resolution.definition).map((control) => [
				control.prop,
				control,
			]),
		);
		// Registry defaultProps (e.g. type="button" on triggers) are written onto
		// every instance by getDefaultProps, so they are supported props too.
		const defaultProps = resolution.definition.defaultProps ?? {};
		for (const [propName, propValue] of Object.entries(node.props)) {
			if (
				CORE_PROP_KEYS.has(propName) ||
				SYSTEM_PROP_KEYS.has(propName) ||
				(Object.hasOwn(defaultProps, propName) && !controlProps.has(propName))
			) {
				continue;
			}

			const control = controlProps.get(propName);
			if (!control) {
				issues.push({
					severity: "error",
					code: "UNSUPPORTED_PROP",
					message: `Prop "${propName}" is not supported by "${componentKey}".`,
					path: `${path}.props.${propName}`,
					elementId: node.id,
				});
				continue;
			}

			if (!isValidControlValue(control, propValue)) {
				issues.push({
					severity: "error",
					code: "INVALID_PROP_VALUE",
					message: `Prop "${propName}" does not match the registry control contract for "${componentKey}".`,
					path: `${path}.props.${propName}`,
					elementId: node.id,
				});
			}
		}
	}

	if (normalizedRole === "text" && typeof node.children !== "string") {
		issues.push({
			severity: "error",
			code: "INVALID_CHILDREN_SHAPE",
			message: "Text role elements must serialize children as a string.",
			path: `${path}.children`,
			elementId: node.id,
		});
	}

	if (normalizedRole === "branch" && !Array.isArray(node.children)) {
		issues.push({
			severity: "error",
			code: "INVALID_CHILDREN_SHAPE",
			message: "Branch role elements must serialize children as an array.",
			path: `${path}.children`,
			elementId: node.id,
		});
	}

	if (
		normalizedRole === "leaf" &&
		(!Array.isArray(node.children) || node.children.length > 0)
	) {
		issues.push({
			severity: "error",
			code: "INVALID_CHILDREN_SHAPE",
			message: "Leaf role elements must serialize children as an empty array.",
			path: `${path}.children`,
			elementId: node.id,
		});
	}

	if (Array.isArray(node.children)) {
		for (const [childIndex, child] of node.children.entries()) {
			validateElementReferences(
				child,
				`${path}.children[${childIndex}]`,
				seenElementIds,
				issues,
				componentUsage,
			);
		}
	}
};
