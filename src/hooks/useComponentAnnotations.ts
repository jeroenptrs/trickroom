import { useEffect, useMemo } from "react";
import { useProjectScope } from "../components/contexts";
import { loadAnnotationDrafts } from "../stores/annotation-draft-store";
import { componentDraftStore } from "../stores/component-draft-store";
import {
	editorAnnotationsStore,
	refreshAnnotationMarkers,
} from "../stores/editor-annotations-store";
import { componentDraftTargetLocator } from "../utils/component-annotation-targets";
import { useAnnotationLiveSync } from "./useAnnotationLiveSync";

/**
 * The annotations of the component open in the component editor: listed
 * and kept live (`useAnnotationLiveSync`, the component container), this
 * project's drafts loaded, and the draft rail's markers derived against
 * the draft store whenever the annotations or the template change.
 * `systemId` is the design system's manifest id, the one MCP uses.
 */
export function useComponentAnnotations(
	systemId: string,
	componentId: string | null,
) {
	const projectScope = useProjectScope();
	const container = useMemo(
		() =>
			componentId
				? { kind: "component" as const, systemId, componentId }
				: null,
		[componentId, systemId],
	);
	useAnnotationLiveSync(container);

	useEffect(() => {
		loadAnnotationDrafts(projectScope ?? null);
	}, [projectScope]);

	useEffect(() => {
		let { entitiesByPath, rootPath, variants } = componentDraftStore.get();
		let { byId, showResolved } = editorAnnotationsStore.get();
		const refresh = () =>
			refreshAnnotationMarkers(
				componentDraftTargetLocator({ entitiesByPath, rootPath, variants }),
			);
		refresh();
		const draftSubscription = componentDraftStore.subscribe(() => {
			const next = componentDraftStore.get();
			if (
				next.entitiesByPath === entitiesByPath &&
				next.rootPath === rootPath &&
				next.variants === variants
			) {
				return;
			}
			({ entitiesByPath, rootPath, variants } = next);
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
			draftSubscription.unsubscribe();
			annotationSubscription.unsubscribe();
		};
	}, []);
}
