import {
	type AnnotationTargetLocator,
	hasPinnedVariants,
	normalizePinnedVariants,
} from "../services/annotation-model";
import type { AnnotationTarget } from "../services/annotations.types";
import type {
	ComponentDraftEntity,
	ComponentDraftStoreState,
} from "../stores/component-draft-store";

/**
 * Annotation targets in the component editor, answered from the draft
 * store (not a read of the manifest), so a node added, deleted or undone
 * locally shows where it is before the draft is saved. A node path is the
 * node's id; the root node plays the board.
 */

type DraftTree = Pick<
	ComponentDraftStoreState,
	"entitiesByPath" | "rootPath" | "variants"
>;

const hasPath = (state: DraftTree, path: string) =>
	Object.hasOwn(state.entitiesByPath, path);

export function componentDraftTargetLocator(
	state: DraftTree,
): AnnotationTargetLocator {
	return {
		boardOfLayer: (path) =>
			hasPath(state, path) && state.rootPath ? state.rootPath : null,
		hasBoard: (id) => id === state.rootPath && state.rootPath !== null,
		hasComponentNode: (path, variants) =>
			hasPath(state, path) && hasPinnedVariants(variants, state.variants),
	};
}

/**
 * What a new annotation in the component editor is about: the selected
 * node, or the root when nothing is selected. Null without a root.
 */
export function getComponentSelectionTarget(
	systemId: string,
	componentId: string,
	state: Pick<ComponentDraftStoreState, "entitiesByPath" | "rootPath"> & {
		selectedPath: string | null;
	},
): AnnotationTarget | null {
	const path =
		state.selectedPath &&
		Object.hasOwn(state.entitiesByPath, state.selectedPath)
			? state.selectedPath
			: state.rootPath;
	return path
		? { kind: "componentNode", systemId, componentId, nodePath: path }
		: null;
}

const entityName = (entity: ComponentDraftEntity) =>
	entity.name?.trim() || entity.component;

/**
 * The name of a component node target as the editor shows it: the node's
 * current name while it exists, else the name it had when the annotation
 * was made.
 */
export function getComponentTargetName(
	target: AnnotationTarget,
	entitiesByPath: Record<string, ComponentDraftEntity>,
	snapshotName?: string,
) {
	const entity =
		target.kind === "componentNode" &&
		Object.hasOwn(entitiesByPath, target.nodePath)
			? entitiesByPath[target.nodePath]
			: undefined;
	return (entity ? entityName(entity) : snapshotName) || "Node";
}

/**
 * The configuration in view: the variant values the Style target has
 * selected (unselected axes are left out). Null when none is selected.
 */
export const getVariantsInView = (
	axisValues: Readonly<Record<string, string>>,
) => normalizePinnedVariants(axisValues);
