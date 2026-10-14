import { annotationDraftStore } from "../../stores/annotation-draft-store";
import { designStore } from "../../stores/design-store";
import { editorAnnotationsStore } from "../../stores/editor-annotations-store";
import { stageViewStore } from "../../stores/stage-view-store";
import { designStoreTargetLocator } from "../../utils/design-annotation-targets";
import type { StageAnnotationPinSource } from "../stage/StageAnnotationPins";
import {
	buildStageAnnotationPins,
	type StageAnnotationPin,
} from "../stage/stage-annotation-pins";
import { openDesignAnnotations } from "./design-annotation-navigation";

let cache: {
	byId: unknown;
	drafts: unknown;
	showResolved: boolean;
	entitiesById: unknown;
	designId: string | null;
	pins: readonly StageAnnotationPin[];
} | null = null;

const designIdOf = () => {
	const { container } = editorAnnotationsStore.get();
	return container?.kind === "design" ? container.designId : null;
};

/**
 * The design editor's pins: its annotations and this design's drafts
 * against the design store, rebuilt only when one of those changed.
 */
function getDesignPins(): readonly StageAnnotationPin[] {
	const { byId, showResolved } = editorAnnotationsStore.get();
	const { drafts } = annotationDraftStore.get();
	const { entitiesById } = designStore.get();
	const designId = designIdOf();
	if (
		cache &&
		cache.byId === byId &&
		cache.drafts === drafts &&
		cache.showResolved === showResolved &&
		cache.entitiesById === entitiesById &&
		cache.designId === designId
	) {
		return cache.pins;
	}
	const pins = designId
		? buildStageAnnotationPins({
				annotations: Object.values(byId),
				drafts: Object.values(drafts).filter(
					(draft) =>
						draft.target.kind !== "componentNode" &&
						draft.target.designId === designId,
				),
				showResolved,
				locator: designStoreTargetLocator(entitiesById),
			})
		: [];
	cache = { byId, drafts, showResolved, entitiesById, designId, pins };
	return pins;
}

export const designAnnotationPinSource: StageAnnotationPinSource = {
	getPins: getDesignPins,
	subscribe: (listener) => {
		const subscriptions = [
			editorAnnotationsStore.subscribe(listener),
			annotationDraftStore.subscribe(listener),
			designStore.subscribe(listener),
			// The responsive view mounts one board at a time.
			stageViewStore.subscribe(listener),
		];
		return () => {
			for (const subscription of subscriptions) subscription.unsubscribe();
		};
	},
	onPinClick: (pin) =>
		openDesignAnnotations(pin.selectId, pin.annotationIds[0] ?? null),
};
