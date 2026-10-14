import type { AnnotationTargetLocator } from "../services/annotation-model";
import type { AnnotationTarget } from "../services/annotations.types";
import { type DesignEntity, getBoardIdOf } from "../stores/design-store";

/**
 * Annotation targets in the design editor, answered from the design store
 * (not a design read), so a layer moved, deleted or undone locally shows
 * where it is now before it is saved.
 */

export function designStoreTargetLocator(
	entitiesById: Record<string, DesignEntity>,
): AnnotationTargetLocator {
	return {
		boardOfLayer: (elementId) =>
			entitiesById[elementId] ? getBoardIdOf(entitiesById, elementId) : null,
		hasBoard: (boardId) => entitiesById[boardId]?.parentId === null,
		parentOfLayer: (elementId) => entitiesById[elementId]?.parentId ?? null,
	};
}

/**
 * What a new annotation is about: the selected layer, the selected board,
 * or the design when nothing is selected.
 */
export function getSelectionAnnotationTarget(
	designId: string,
	entitiesById: Record<string, DesignEntity>,
	selectedId: string | null,
): AnnotationTarget {
	const entity = selectedId ? entitiesById[selectedId] : undefined;
	if (!entity) return { kind: "design", designId };
	if (entity.parentId === null) {
		return { kind: "board", designId, boardId: entity.id };
	}
	const boardId = getBoardIdOf(entitiesById, entity.id);
	return boardId
		? { kind: "layer", designId, boardId, elementId: entity.id }
		: { kind: "design", designId };
}

const entityName = (entity: DesignEntity) => {
	const name = entity.props["data-trickroom-name"];
	return (
		(typeof name === "string" ? name.trim() : "") ||
		entity.props["data-trickroom-component"]
	);
};

/**
 * The name of a target as the editor shows it: the layer's current name
 * while it exists, else the name it had when the annotation was made.
 */
export function getDesignTargetName(
	target: AnnotationTarget,
	entitiesById: Record<string, DesignEntity>,
	snapshotName?: string,
	designName?: string,
) {
	if (target.kind === "design") return designName || snapshotName || "Design";
	const id =
		target.kind === "layer"
			? target.elementId
			: target.kind === "board"
				? target.boardId
				: null;
	const entity = id ? entitiesById[id] : undefined;
	return (entity ? entityName(entity) : snapshotName) || "Layer";
}
