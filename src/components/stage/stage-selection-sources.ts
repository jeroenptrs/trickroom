import {
	type ComponentDraftStoreState,
	componentDraftStore,
	selectTemplateNode,
} from "../../stores/component-draft-store";
import {
	type DesignEntity,
	type DesignStoreState,
	designStore,
	selectElement,
} from "../../stores/design-store";
import type { StageLayerTree, StageSelectionSource } from "./stage-interaction";

const noIds: readonly string[] = [];

export function getDesignLayerName(entity: DesignEntity) {
	const name = entity.props["data-trickroom-name"];
	return (
		(typeof name === "string" ? name.trim() : "") ||
		entity.props["data-trickroom-component"]
	);
}

/** The design editor's layer tree, as of `state`. */
export function designLayerTree(
	state: Pick<DesignStoreState, "entitiesById">,
): StageLayerTree {
	const { entitiesById } = state;
	return {
		has: (id) => entitiesById[id] !== undefined,
		getParentId: (id) => entitiesById[id]?.parentId ?? null,
		getChildIds: (id) => entitiesById[id]?.childIds ?? noIds,
		getName: (id) => {
			const entity = entitiesById[id];
			return entity ? getDesignLayerName(entity) : "Layer";
		},
	};
}

/** The component draft's layer tree (ids are template paths), as of `state`. */
export function draftLayerTree(
	state: Pick<ComponentDraftStoreState, "entitiesByPath">,
): StageLayerTree {
	const { entitiesByPath } = state;
	return {
		has: (path) => entitiesByPath[path] !== undefined,
		getParentId: (path) => entitiesByPath[path]?.parentPath ?? null,
		getChildIds: (path) => entitiesByPath[path]?.childPaths ?? noIds,
		getName: (path) => {
			const entity = entitiesByPath[path];
			return entity?.name?.trim() || entity?.component || "Layer";
		},
	};
}

function liveTree(read: () => StageLayerTree): StageLayerTree {
	return {
		has: (id) => read().has(id),
		getParentId: (id) => read().getParentId(id),
		getChildIds: (id) => read().getChildIds(id),
		getName: (id) => read().getName(id),
	};
}

export const designStageSelection: StageSelectionSource = {
	...liveTree(() => designLayerTree(designStore.get())),
	getSelectedId: () => designStore.get().selectedId,
	select: selectElement,
	subscribe: (listener) => designStore.subscribe(listener).unsubscribe,
};

export const componentDraftStageSelection: StageSelectionSource = {
	...liveTree(() => draftLayerTree(componentDraftStore.get())),
	getSelectedId: () => componentDraftStore.get().selectedPath,
	select: selectTemplateNode,
	subscribe: (listener) => componentDraftStore.subscribe(listener).unsubscribe,
};
