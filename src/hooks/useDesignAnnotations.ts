import { useEffect, useMemo } from "react";
import { useProjectScope } from "../components/contexts";
import { loadAnnotationDrafts } from "../stores/annotation-draft-store";
import { designStore } from "../stores/design-store";
import {
	editorAnnotationsStore,
	refreshAnnotationMarkers,
} from "../stores/editor-annotations-store";
import { designStoreTargetLocator } from "../utils/design-annotation-targets";
import { useAnnotationLiveSync } from "./useAnnotationLiveSync";

/**
 * The annotations of the open design: listed and kept live
 * (`useAnnotationLiveSync`), this project's drafts loaded, and the Layers
 * rail markers derived against the design store whenever the annotations or
 * the tree change. Markers that did not change keep their object, so only
 * the rows whose count or state changed re-render.
 */
export function useDesignAnnotations(designId: string | null) {
	const projectScope = useProjectScope();
	const container = useMemo(
		() => (designId ? { kind: "design" as const, designId } : null),
		[designId],
	);
	useAnnotationLiveSync(container);

	useEffect(() => {
		loadAnnotationDrafts(projectScope ?? null);
	}, [projectScope]);

	useEffect(() => {
		let entitiesById = designStore.get().entitiesById;
		let { byId, showResolved } = editorAnnotationsStore.get();
		const refresh = () =>
			refreshAnnotationMarkers(designStoreTargetLocator(entitiesById));
		refresh();
		const designSubscription = designStore.subscribe(() => {
			const next = designStore.get().entitiesById;
			if (next === entitiesById) return;
			entitiesById = next;
			refresh();
		});
		const annotationSubscription = editorAnnotationsStore.subscribe(() => {
			const state = editorAnnotationsStore.get();
			if (state.byId === byId && state.showResolved === showResolved) return;
			byId = state.byId;
			showResolved = state.showResolved;
			refresh();
		});
		return () => {
			designSubscription.unsubscribe();
			annotationSubscription.unsubscribe();
		};
	}, []);
}
