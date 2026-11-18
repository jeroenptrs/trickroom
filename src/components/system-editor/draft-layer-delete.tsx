import { createStore, shallow, useSelector } from "@tanstack/react-store";
import { Trash2 } from "lucide-react";
import {
	type ComponentDraftEntity,
	componentDraftStore,
	deleteTemplateNode,
} from "../../stores/component-draft-store";
import { ConfirmationDialog } from "../ui/alert-dialog";

// The draft layer waiting on the delete confirmation. The draft store has no
// undo, so a layer with children asks first; a leaf layer goes at once.
const pendingDraftLayerDeleteStore = createStore<string | null>(null);

const countInnerLayers = (
	entitiesByPath: Record<string, ComponentDraftEntity>,
	path: string,
): number =>
	(entitiesByPath[path]?.childPaths ?? []).reduce(
		(count, childPath) =>
			count + 1 + countInnerLayers(entitiesByPath, childPath),
		0,
	);

/**
 * Deletes draft layer `path`, or opens the confirmation when it has
 * children. Every delete path in the component editor goes through here.
 */
export function requestDraftLayerDelete(path: string) {
	const entity = componentDraftStore.get().entitiesByPath[path];
	if (!entity) {
		return;
	}
	if ((entity.childPaths?.length ?? 0) > 0) {
		pendingDraftLayerDeleteStore.setState(() => path);
		return;
	}
	deleteTemplateNode(path);
}

function closeDraftLayerDelete() {
	pendingDraftLayerDeleteStore.setState(() => null);
}

/** The confirmation for `requestDraftLayerDelete`. Mount it once. */
export function DraftLayerDeleteDialog() {
	const pendingPath = useSelector(pendingDraftLayerDeleteStore, (path) => path);
	const target = useSelector(
		componentDraftStore,
		(state) => {
			const entity = pendingPath
				? state.entitiesByPath[pendingPath]
				: undefined;
			if (!entity) {
				return null;
			}
			return {
				path: entity.path,
				name: entity.name?.trim() || entity.component,
				innerCount: countInnerLayers(state.entitiesByPath, entity.path),
			};
		},
		{ compare: shallow },
	);
	const inner = target?.innerCount ?? 0;

	return (
		<ConfirmationDialog
			open={target !== null}
			onOpenChange={(open) => {
				if (!open) closeDraftLayerDelete();
			}}
			tone="destructive"
			title={target ? `Delete layer ${target.name}` : ""}
			description={
				inner > 0
					? `${inner} ${inner === 1 ? "layer is" : "layers are"} deleted with it. This can't be undone.`
					: "This can't be undone."
			}
			icon={<Trash2 className="size-4" aria-hidden="true" />}
			actionLabel="Delete layer"
			onAction={() => {
				if (target) deleteTemplateNode(target.path);
				closeDraftLayerDelete();
			}}
		/>
	);
}
