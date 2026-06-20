import { randomUUID } from "node:crypto";
import { registries } from "../libraries/registry";
import type { Node, Props, Role, TrickroomDesign } from "../types";

export type DesignTransformErrorCode =
	| "ELEMENT_NOT_FOUND"
	| "PARENT_NOT_FOUND"
	| "PARENT_CANNOT_HAVE_CHILDREN"
	| "CYCLE_DETECTED"
	| "TEXT_ROLE_PARENT"
	| "INVALID_TEXT_UPDATE"
	| "UNKNOWN_REGISTRY_LIBRARY"
	| "UNKNOWN_REGISTRY_COMPONENT"
	| "BUILT_IN_REGISTRY_EDIT"
	| "INVALID_PROP_KEY";

export class DesignTransformError extends Error {
	readonly code: DesignTransformErrorCode;

	constructor(code: DesignTransformErrorCode, message: string) {
		super(message);
		this.name = "DesignTransformError";
		this.code = code;
	}
}

type FlatEntity = {
	id: string;
	props: Props;
	parentId: string | null;
	role: Role | undefined;
	childIds?: string[];
	text?: string;
};

type FlatDesign = {
	name: string;
	systemName?: string | null;
	rootIds: string[];
	entitiesById: Record<string, FlatEntity>;
};

const isTextRole = (role: Role | undefined): role is "text" => role === "text";

const normalizeNode = (
	node: Node,
	parentId: string | null,
	entitiesById: Record<string, FlatEntity>,
) => {
	const role = node.props["data-trickroom-role"];
	const entity: FlatEntity = {
		id: node.id,
		props: { ...node.props },
		parentId,
		role,
	};

	entitiesById[node.id] = entity;

	if (isTextRole(role)) {
		entity.text = typeof node.children === "string" ? node.children : "";
		return;
	}

	if (typeof node.children === "string") {
		entity.childIds = [];
		return;
	}

	entity.childIds = node.children.map((child) => child.id);
	for (const child of node.children) {
		normalizeNode(child, node.id, entitiesById);
	}
};

export const normalizeDesignForMutation = (design: TrickroomDesign): FlatDesign => {
	const entitiesById: Record<string, FlatEntity> = {};
	for (const board of design.boards) {
		normalizeNode(board, null, entitiesById);
	}

	return {
		name: design.name,
		...(design.systemName !== undefined ? { systemName: design.systemName } : {}),
		rootIds: design.boards.map((board) => board.id),
		entitiesById,
	};
};

const serializeEntity = (
	entityId: string,
	entitiesById: Record<string, FlatEntity>,
): Node => {
	const entity = entitiesById[entityId];
	if (!entity) {
		throw new Error(`Cannot serialize missing design entity: ${entityId}`);
	}

	const children = isTextRole(entity.role)
		? (entity.text ?? "")
		: (entity.childIds ?? []).map((childId) =>
				serializeEntity(childId, entitiesById),
			);

	return {
		id: entity.id,
		props: entity.props,
		children: children as string | Node[],
	};
};

export const serializeFlatDesign = (flat: FlatDesign): TrickroomDesign => ({
	name: flat.name,
	...(flat.systemName !== undefined ? { systemName: flat.systemName } : {}),
	boards: flat.rootIds.map((rootId) =>
		serializeEntity(rootId, flat.entitiesById),
	),
});

const withoutId = (ids: string[], id: string) =>
	ids.filter((currentId) => currentId !== id);

const insertAt = (ids: string[], id: string, index: number) => {
	const nextIds = [...ids];
	const boundedIndex = Math.max(0, Math.min(index, nextIds.length));
	nextIds.splice(boundedIndex, 0, id);
	return nextIds;
};

const isDescendantOf = (
	entitiesById: Record<string, FlatEntity>,
	id: string,
	ancestorId: string,
) => {
	let current = entitiesById[id] ?? null;

	while (current?.parentId) {
		if (current.parentId === ancestorId) {
			return true;
		}
		current = entitiesById[current.parentId] ?? null;
	}

	return false;
};

const collectDescendantIds = (
	entitiesById: Record<string, FlatEntity>,
	id: string,
	ids: Set<string>,
) => {
	if (ids.has(id)) return;

	ids.add(id);
	const entity = entitiesById[id];
	for (const childId of entity?.childIds ?? []) {
		collectDescendantIds(entitiesById, childId, ids);
	}
};

const getRegistryRole = (library: string, component: string): Role | undefined => {
	if (!Object.hasOwn(registries, library)) {
		throw new DesignTransformError(
			"UNKNOWN_REGISTRY_LIBRARY",
			`Unknown registry library "${library}".`,
		);
	}

	const registry = registries[library as keyof typeof registries];
	if (!Object.hasOwn(registry, component)) {
		throw new DesignTransformError(
			"UNKNOWN_REGISTRY_COMPONENT",
			`Unknown component "${component}" in registry "${library}".`,
		);
	}

	return registry[component as keyof typeof registry].role;
};

export type MutationResult = {
	design: TrickroomDesign;
	changedElementId: string;
};

export type DeleteMutationResult = MutationResult & {
	deletedIds: string[];
};

export type AddElementParams = {
	parentId: string | null;
	index: number;
	library: string;
	component: string;
	/** Convenience alias for `data-trickroom-name`. Takes precedence over `props["data-trickroom-name"]`. */
	name?: string;
	/** Convenience alias for `className`. Takes precedence over `props.className`. */
	className?: string;
	text?: string;
	/**
	 * Optional extra instance props (allowed: `className`, `data-trickroom-name`).
	 * Shortcuts `name`/`className` override the same keys when both are supplied.
	 * Registry-reference keys and unknown keys throw INVALID_PROP_KEY.
	 */
	props?: Record<string, string>;
};

export type UpdateElementPropsParams = {
	elementId: string;
	name?: string;
	className?: string;
};

export type UpdateElementTextParams = {
	elementId: string;
	text: string;
};

export type MoveElementParams = {
	elementId: string;
	targetParentId: string | null;
	index: number;
};

export type DeleteElementParams = {
	elementId: string;
};

export const REGISTRY_PROP_KEYS = new Set([
	"data-trickroom-library",
	"data-trickroom-component",
	"data-trickroom-role",
]);

export const ALLOWED_INSTANCE_PROP_KEYS = new Set(["className", "data-trickroom-name"]);

const validateExtraProps = (props: Record<string, string>) => {
	for (const key of Object.keys(props)) {
		if (REGISTRY_PROP_KEYS.has(key) || !ALLOWED_INSTANCE_PROP_KEYS.has(key)) {
			throw new DesignTransformError(
				"INVALID_PROP_KEY",
				`Prop key "${key}" is not allowed. Allowed instance props: ${[...ALLOWED_INSTANCE_PROP_KEYS].join(", ")}. Registry-reference props (${[...REGISTRY_PROP_KEYS].join(", ")}) are set automatically.`,
			);
		}
	}
};

export const applyAddElement = (
	design: TrickroomDesign,
	params: AddElementParams,
): MutationResult => {
	// Validate extra props before any design mutation.
	if (params.props) {
		validateExtraProps(params.props);
	}

	const role = getRegistryRole(params.library, params.component);

	const flat = normalizeDesignForMutation(design);
	const { entitiesById, rootIds } = flat;

	if (params.parentId !== null) {
		const parent = entitiesById[params.parentId];
		if (!parent) {
			throw new DesignTransformError(
				"PARENT_NOT_FOUND",
				`Parent element "${params.parentId}" not found.`,
			);
		}
		if (isTextRole(parent.role)) {
			throw new DesignTransformError(
				"TEXT_ROLE_PARENT",
				`Cannot add a child element to text role element "${params.parentId}".`,
			);
		}
	}

	const id = randomUUID();

	// Shortcuts take precedence over same keys in `props`.
	const resolvedName =
		params.name ?? params.props?.["data-trickroom-name"] ?? params.component;
	const resolvedClassName = params.className ?? params.props?.className;

	const props: Props = {
		"data-trickroom-name": resolvedName,
		"data-trickroom-library": params.library as Props["data-trickroom-library"],
		"data-trickroom-component":
			params.component as Props["data-trickroom-component"],
		...(role ? { "data-trickroom-role": role } : {}),
		...(resolvedClassName !== undefined ? { className: resolvedClassName } : {}),
	};

	const newEntity: FlatEntity = {
		id,
		props,
		parentId: params.parentId,
		role,
	};

	if (isTextRole(role)) {
		newEntity.text = params.text ?? "Text";
	} else {
		newEntity.childIds = [];
	}

	const nextEntitiesById = { ...entitiesById, [id]: newEntity };
	let nextRootIds = rootIds;

	if (params.parentId === null) {
		nextRootIds = insertAt(rootIds, id, params.index);
	} else {
		const parent = nextEntitiesById[params.parentId];
		nextEntitiesById[params.parentId] = {
			...parent,
			childIds: insertAt(parent.childIds ?? [], id, params.index),
		};
	}

	const nextFlat: FlatDesign = {
		...flat,
		rootIds: nextRootIds,
		entitiesById: nextEntitiesById,
	};

	return { design: serializeFlatDesign(nextFlat), changedElementId: id };
};

export const applyUpdateElementProps = (
	design: TrickroomDesign,
	params: UpdateElementPropsParams,
): MutationResult => {
	const flat = normalizeDesignForMutation(design);
	const entity = flat.entitiesById[params.elementId];
	if (!entity) {
		throw new DesignTransformError(
			"ELEMENT_NOT_FOUND",
			`Element "${params.elementId}" not found.`,
		);
	}

	const patch: Partial<Props> = {};
	if (params.name !== undefined) patch["data-trickroom-name"] = params.name;
	if (params.className !== undefined) patch.className = params.className;

	flat.entitiesById[params.elementId] = {
		...entity,
		props: { ...entity.props, ...patch },
	};

	return {
		design: serializeFlatDesign(flat),
		changedElementId: params.elementId,
	};
};

export const applyUpdateElementText = (
	design: TrickroomDesign,
	params: UpdateElementTextParams,
): MutationResult => {
	const flat = normalizeDesignForMutation(design);
	const entity = flat.entitiesById[params.elementId];
	if (!entity) {
		throw new DesignTransformError(
			"ELEMENT_NOT_FOUND",
			`Element "${params.elementId}" not found.`,
		);
	}

	if (!isTextRole(entity.role)) {
		throw new DesignTransformError(
			"INVALID_TEXT_UPDATE",
			`Cannot update text on element "${params.elementId}" — only text role elements support text updates.`,
		);
	}

	flat.entitiesById[params.elementId] = { ...entity, text: params.text };

	return {
		design: serializeFlatDesign(flat),
		changedElementId: params.elementId,
	};
};

export const applyMoveElement = (
	design: TrickroomDesign,
	params: MoveElementParams,
): MutationResult => {
	const flat = normalizeDesignForMutation(design);
	const { entitiesById } = flat;

	const entity = entitiesById[params.elementId];
	if (!entity) {
		throw new DesignTransformError(
			"ELEMENT_NOT_FOUND",
			`Element "${params.elementId}" not found.`,
		);
	}

	if (params.targetParentId === params.elementId) {
		throw new DesignTransformError(
			"CYCLE_DETECTED",
			`Cannot move element "${params.elementId}" into itself.`,
		);
	}

	if (
		params.targetParentId !== null &&
		isDescendantOf(entitiesById, params.targetParentId, params.elementId)
	) {
		throw new DesignTransformError(
			"CYCLE_DETECTED",
			`Cannot move element "${params.elementId}" into its own descendant "${params.targetParentId}".`,
		);
	}

	if (params.targetParentId !== null) {
		const targetParent = entitiesById[params.targetParentId];
		if (!targetParent) {
			throw new DesignTransformError(
				"PARENT_NOT_FOUND",
				`Target parent element "${params.targetParentId}" not found.`,
			);
		}
		if (isTextRole(targetParent.role)) {
			throw new DesignTransformError(
				"TEXT_ROLE_PARENT",
				`Cannot move element into text role element "${params.targetParentId}".`,
			);
		}
	}

	const nextEntitiesById = {
		...entitiesById,
		[params.elementId]: {
			...entity,
			parentId: params.targetParentId,
		},
	};

	let nextRootIds = flat.rootIds;

	if (entity.parentId === null) {
		nextRootIds = withoutId(nextRootIds, params.elementId);
	} else {
		const previousParent = nextEntitiesById[entity.parentId];
		if (!previousParent?.childIds) {
			throw new DesignTransformError(
				"PARENT_NOT_FOUND",
				`Previous parent "${entity.parentId}" has inconsistent state.`,
			);
		}
		nextEntitiesById[entity.parentId] = {
			...previousParent,
			childIds: withoutId(previousParent.childIds, params.elementId),
		};
	}

	if (params.targetParentId === null) {
		nextRootIds = insertAt(nextRootIds, params.elementId, params.index);
	} else {
		const parent = nextEntitiesById[params.targetParentId];
		if (!parent?.childIds) {
			throw new DesignTransformError(
				"PARENT_NOT_FOUND",
				`Target parent "${params.targetParentId}" has inconsistent state.`,
			);
		}
		nextEntitiesById[params.targetParentId] = {
			...parent,
			childIds: insertAt(
				withoutId(parent.childIds, params.elementId),
				params.elementId,
				params.index,
			),
		};
	}

	const nextFlat: FlatDesign = {
		...flat,
		rootIds: nextRootIds,
		entitiesById: nextEntitiesById,
	};

	return {
		design: serializeFlatDesign(nextFlat),
		changedElementId: params.elementId,
	};
};

export const applyDeleteElement = (
	design: TrickroomDesign,
	params: DeleteElementParams,
): DeleteMutationResult => {
	const flat = normalizeDesignForMutation(design);
	const { entitiesById } = flat;

	const entity = entitiesById[params.elementId];
	if (!entity) {
		throw new DesignTransformError(
			"ELEMENT_NOT_FOUND",
			`Element "${params.elementId}" not found.`,
		);
	}

	const deletedIds = new Set<string>();
	collectDescendantIds(entitiesById, params.elementId, deletedIds);

	const nextEntitiesById = { ...entitiesById };
	for (const deletedId of deletedIds) {
		delete nextEntitiesById[deletedId];
	}

	let nextRootIds = flat.rootIds;

	if (entity.parentId === null) {
		nextRootIds = withoutId(nextRootIds, params.elementId);
	} else {
		const parent = entitiesById[entity.parentId];
		if (parent?.childIds) {
			nextEntitiesById[entity.parentId] = {
				...parent,
				childIds: withoutId(parent.childIds, params.elementId),
			};
		}
	}

	const nextFlat: FlatDesign = {
		...flat,
		rootIds: nextRootIds,
		entitiesById: nextEntitiesById,
	};

	return {
		design: serializeFlatDesign(nextFlat),
		changedElementId: params.elementId,
		deletedIds: [...deletedIds],
	};
};

