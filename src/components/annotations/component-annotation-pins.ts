import { matchesVariantConfiguration } from "../../services/annotation-model";
import { annotationDraftStore } from "../../stores/annotation-draft-store";
import {
	componentDraftStore,
	selectTemplateNode,
	setComponentDraftStyleTarget,
} from "../../stores/component-draft-store";
import {
	editorAnnotationsStore,
	openAnnotationThread,
	requestAnnotationComposer,
} from "../../stores/editor-annotations-store";
import { setEditorPanelOpen } from "../../stores/editor-chrome-store";
import { componentDraftTargetLocator } from "../../utils/component-annotation-targets";
import type { StageAnnotationPinSource } from "../stage/StageAnnotationPins";
import {
	buildStageAnnotationPins,
	type StageAnnotationPin,
} from "../stage/stage-annotation-pins";

const componentOf = () => {
	const { container } = editorAnnotationsStore.get();
	return container?.kind === "component" ? container : null;
};

let cache: {
	byId: unknown;
	drafts: unknown;
	showResolved: boolean;
	entitiesByPath: unknown;
	variants: unknown;
	axisValues: unknown;
	componentKey: string | null;
	pins: readonly StageAnnotationPin[];
} | null = null;

/**
 * The component draft stage's pins: the component's annotations and
 * drafts against the draft store. A pinned one shows only while the
 * configuration in view (the Style target's variant values) has its values
 * on every pinned axis; an unpinned one always shows. Rebuilt only when
 * one of those changed.
 */
function getComponentPins(): readonly StageAnnotationPin[] {
	const { byId, showResolved } = editorAnnotationsStore.get();
	const { drafts } = annotationDraftStore.get();
	const state = componentDraftStore.get();
	const component = componentOf();
	const componentKey =
		component && state.componentId === component.componentId
			? `${component.systemId}/${component.componentId}`
			: null;
	const axisValues = state.styleTarget.axisValues;
	if (
		cache &&
		cache.byId === byId &&
		cache.drafts === drafts &&
		cache.showResolved === showResolved &&
		cache.entitiesByPath === state.entitiesByPath &&
		cache.variants === state.variants &&
		cache.axisValues === axisValues &&
		cache.componentKey === componentKey
	) {
		return cache.pins;
	}
	const inView = (variants: Readonly<Record<string, string>> | undefined) =>
		matchesVariantConfiguration(variants, axisValues);
	const pins =
		component && componentKey
			? buildStageAnnotationPins({
					annotations: Object.values(byId).filter(
						(annotation) =>
							annotation.target.kind === "componentNode" &&
							inView(annotation.target.variants),
					),
					drafts: Object.values(drafts).filter(
						(draft) =>
							draft.target.kind === "componentNode" &&
							draft.target.systemId === component.systemId &&
							draft.target.componentId === component.componentId &&
							inView(draft.target.variants),
					),
					showResolved,
					locator: componentDraftTargetLocator(state),
					componentRootId: state.rootPath,
				})
			: [];
	cache = {
		byId,
		drafts,
		showResolved,
		entitiesByPath: state.entitiesByPath,
		variants: state.variants,
		axisValues,
		componentKey,
		pins,
	};
	return pins;
}

/**
 * Selects a node and opens the Annotations tab at `annotationId` (or at
 * the composer for a draft pin): what a pin click does.
 */
export function openComponentAnnotations(
	path: string | null,
	annotationId: string | null,
) {
	selectTemplateNode(path);
	setEditorPanelOpen("system", "inspector", true);
	if (annotationId) {
		openAnnotationThread(annotationId);
	} else {
		requestAnnotationComposer();
	}
}

/**
 * Switches the configuration in view to a pin's variant values: each
 * pinned axis gets its value, the other axes stay as they are.
 */
export function showVariantConfiguration(
	variants: Readonly<Record<string, string>>,
) {
	const { styleTarget } = componentDraftStore.get();
	setComponentDraftStyleTarget({
		...styleTarget,
		axisValues: { ...styleTarget.axisValues, ...variants },
	});
}

/** Selects the first changed node of a change record that is still there. */
export function revealComponentNodes(paths: readonly string[]) {
	const { entitiesByPath } = componentDraftStore.get();
	const first = paths.find((path) => Object.hasOwn(entitiesByPath, path));
	if (first) selectTemplateNode(first);
}

export const componentAnnotationPinSource: StageAnnotationPinSource = {
	getPins: getComponentPins,
	subscribe: (listener) => {
		const subscriptions = [
			editorAnnotationsStore.subscribe(listener),
			annotationDraftStore.subscribe(listener),
			componentDraftStore.subscribe(listener),
		];
		return () => {
			for (const subscription of subscriptions) subscription.unsubscribe();
		};
	},
	onPinClick: (pin) =>
		openComponentAnnotations(pin.selectId, pin.annotationIds[0] ?? null),
};
