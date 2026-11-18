import { createStore, shallow, useSelector } from "@tanstack/react-store";
import { Trash2 } from "lucide-react";
import { canDeleteElementAcrossRecipeBoundary } from "../../recipes/ownership";
import {
	collectDescendantIds,
	type DesignEntity,
	deleteElement,
	designStore,
} from "../../stores/design-store";
import { canDeleteElementAcrossSystemComponentBoundary } from "../../utils/system-component-ownership";
import { getDesignLayerName } from "../stage/stage-selection-sources";
import { ConfirmationDialog } from "../ui/alert-dialog";

// The layer waiting on the delete confirmation. The design store has no undo,
// so a board or a layer with children asks first; a leaf layer goes at once.
const pendingLayerDeleteStore = createStore<string | null>(null);

/** Whether deleting `entity` asks first: a board, or a layer with children. */
export function layerDeleteNeedsConfirmation(entity: DesignEntity) {
	return entity.parentId === null || (entity.childIds?.length ?? 0) > 0;
}

/**
 * Deletes layer `id`, or opens the confirmation when it is a board or has
 * children. Every delete path in the design editor goes through here.
 */
export function requestLayerDelete(id: string) {
	const { entitiesById } = designStore.get();
	const entity = entitiesById[id];
	// Recipe and component structure can't be deleted; don't ask about it.
	if (
		!entity ||
		!canDeleteElementAcrossRecipeBoundary(entitiesById, id) ||
		!canDeleteElementAcrossSystemComponentBoundary(entitiesById, id)
	) {
		return;
	}

	if (layerDeleteNeedsConfirmation(entity)) {
		pendingLayerDeleteStore.setState(() => id);
		return;
	}

	deleteElement(id);
}

function closeLayerDelete() {
	pendingLayerDeleteStore.setState(() => null);
}

/** The confirmation for `requestLayerDelete`. Mount it once per editor. */
export function LayerDeleteDialog() {
	const pendingId = useSelector(pendingLayerDeleteStore, (id) => id);
	const target = useSelector(
		designStore,
		(state) => {
			const entity = pendingId ? state.entitiesById[pendingId] : undefined;
			if (!entity) {
				return null;
			}

			const ids = new Set<string>();
			collectDescendantIds(state.entitiesById, entity.id, ids);
			return {
				id: entity.id,
				name: getDesignLayerName(entity),
				isBoard: entity.parentId === null,
				// Every layer under the target, not counting the target itself.
				innerCount: ids.size - 1,
			};
		},
		{ compare: shallow },
	);

	const noun = target?.isBoard ? "board" : "layer";
	const inner = target?.innerCount ?? 0;
	const description =
		inner > 0
			? `${inner} ${inner === 1 ? "layer is" : "layers are"} deleted with it. This can't be undone.`
			: "This can't be undone.";

	return (
		<ConfirmationDialog
			open={target !== null}
			onOpenChange={(open) => {
				if (!open) closeLayerDelete();
			}}
			tone="destructive"
			title={target ? `Delete ${noun} ${target.name}` : ""}
			description={description}
			icon={<Trash2 className="size-4" aria-hidden="true" />}
			actionLabel={`Delete ${noun}`}
			onAction={() => {
				if (target) deleteElement(target.id);
				closeLayerDelete();
			}}
		/>
	);
}
