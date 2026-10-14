import { toast } from "sonner";
import type { AnnotationTargetLocator } from "../../services/annotation-model";
import type { AnnotationView } from "../../services/annotations.types";
import {
	designStore,
	getBoardIdOf,
	selectElement,
} from "../../stores/design-store";
import {
	editorAnnotationsStore,
	getAnnotationStateWith,
	openAnnotationThread,
	requestAnnotationComposer,
	setInspectorTab,
} from "../../stores/editor-annotations-store";
import { setEditorPanelOpen } from "../../stores/editor-chrome-store";
import {
	flashStageLayers,
	getOutlinedLayerIds,
} from "../../stores/external-change-store";
import {
	requestStageReveal,
	setActiveBoardId,
	stageViewStore,
} from "../../stores/stage-view-store";
import { compareAnnotationStates } from "../../utils/annotation-presentation";
import { designStoreTargetLocator } from "../../utils/design-annotation-targets";

let revealSequence = 0;

/**
 * Shows the layers a change record touched: pans to the first one (switching
 * boards in the responsive view) and flashes them all, the path external
 * changes use.
 */
export function revealDesignLayers(layerIds: readonly string[]) {
	const { entitiesById } = designStore.get();
	const present = getOutlinedLayerIds(
		layerIds.filter((id) => entitiesById[id]),
		entitiesById,
	);
	const first = present[0];
	if (!first) {
		toast.info("Those layers are no longer in the design", {
			id: "annotation-reveal-missing",
		});
		return;
	}
	const boardId = getBoardIdOf(entitiesById, first);
	if (boardId && stageViewStore.get().stageMode === "responsive") {
		setActiveBoardId(boardId);
	}
	revealSequence += 1;
	requestStageReveal({
		requestId: `annotation-reveal-${revealSequence}`,
		elementId: first,
	});
	flashStageLayers(present);
}

/**
 * Selects `selectId` and opens the Annotations tab at `annotationId` (or
 * at the composer when the pin is a draft): what a pin click does.
 */
export function openDesignAnnotations(
	selectId: string | null,
	annotationId: string | null,
) {
	selectElement(selectId);
	setEditorPanelOpen("design", "inspector", true);
	if (annotationId) {
		openAnnotationThread(annotationId);
	} else {
		requestAnnotationComposer();
	}
}

/** Selects a layer or board and shows its annotations (a rail marker click). */
export function showDesignAnnotationsFor(id: string) {
	selectElement(id);
	setEditorPanelOpen("design", "inspector", true);
	setInspectorTab("annotations");
}

/** Where an annotation is: what selecting it selects. */
const selectionOf = (
	annotation: AnnotationView,
	locator: AnnotationTargetLocator,
) => {
	const { target } = annotation;
	if (target.kind === "layer") {
		return locator.boardOfLayer(target.elementId) !== null
			? target.elementId
			: locator.hasBoard(target.boardId)
				? target.boardId
				: null;
	}
	if (target.kind === "board") {
		return locator.hasBoard(target.boardId) ? target.boardId : null;
	}
	return null;
};

/**
 * The live annotations of the open design in the order the Layers rail
 * shows their targets (design-level first), most urgent first per target.
 */
export function getOrderedLiveDesignAnnotations() {
	const { entitiesById, rootIds } = designStore.get();
	const locator = designStoreTargetLocator(entitiesById);
	const order = new Map<string, number>();
	let index = 0;
	const visit = (id: string) => {
		order.set(id, index);
		index += 1;
		for (const childId of entitiesById[id]?.childIds ?? []) visit(childId);
	};
	for (const rootId of rootIds) visit(rootId);
	const rank = (annotation: AnnotationView) => {
		const id = selectionOf(annotation, locator);
		return id === null ? -1 : (order.get(id) ?? index);
	};
	return Object.values(editorAnnotationsStore.get().byId)
		.map((annotation) => ({
			annotation,
			state: getAnnotationStateWith(annotation, locator),
		}))
		.filter(
			({ state }) =>
				state !== "resolved" &&
				state !== "dismissed" &&
				state !== "agent_resolved",
		)
		.sort(
			(a, b) =>
				rank(a.annotation) - rank(b.annotation) ||
				compareAnnotationStates(a.state, b.state) ||
				a.annotation.createdAt.localeCompare(b.annotation.createdAt),
		)
		.map(({ annotation }) => ({
			annotation,
			selectId: selectionOf(annotation, locator),
		}));
}

/**
 * "Next open annotation": selects the target of the live annotation after
 * the one open in the inspector, in rail order, and opens its thread.
 * Returns false when there is none.
 */
export function openNextDesignAnnotation() {
	const ordered = getOrderedLiveDesignAnnotations();
	if (ordered.length === 0) {
		toast.info("No open annotations in this design", {
			id: "annotation-next-none",
		});
		return false;
	}
	const current = editorAnnotationsStore.get().activeAnnotationId;
	const at = ordered.findIndex(({ annotation }) => annotation.id === current);
	const next = ordered[(at + 1) % ordered.length] ?? ordered[0];
	if (!next) return false;
	openDesignAnnotations(next.selectId, next.annotation.id);
	if (next.selectId) {
		revealSequence += 1;
		requestStageReveal({
			requestId: `annotation-next-${revealSequence}`,
			elementId: next.selectId,
		});
	}
	return true;
}
