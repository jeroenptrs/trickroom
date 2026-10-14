import { isStageStylesReady } from "../../hooks/useStageNavigation";
import {
	attachStageInteraction,
	createStageNodeLookup,
	createStageOverlayProbe,
	type StageSelectionSource,
} from "./stage-interaction";
import {
	applyStageOverlayBox,
	applyStageOverlayLabelScale,
	isSameStageOverlayGeometry,
	measureStageOverlayBox,
	type StageOverlayGeometry,
} from "./stage-overlay";

/** An outline box with its layer name label. */
export type StageOutline = { box: HTMLElement; label: HTMLElement };

type PaintedOutline = StageOutline & {
	border: number;
	id: string | null;
	geometry: StageOverlayGeometry | null;
};

function hideOutline(outline: PaintedOutline) {
	if (outline.id === null && outline.geometry === null) {
		return;
	}
	outline.box.style.display = "none";
	outline.id = null;
	outline.geometry = null;
}

/**
 * Runs the stage's selection and hover outlines: wires the pointer and
 * keyboard (`attachStageInteraction`) and paints both outlines in animation
 * frames while something is selected or hovered, idling otherwise.
 * Geometry is read in the frame, never in render, and styles are written
 * only when an outline moved. Every frame re-checks hover suppression, so an
 * overlay that opens under a resting pointer hides the hover outline.
 *
 * Returns the cleanup.
 */
export function startStageSelectionOverlay({
	document,
	window,
	origin,
	selection,
	hover,
	source,
	host = null,
}: {
	document: Document;
	window: Window;
	/** The zero-size origin the outlines are positioned from. */
	origin: HTMLElement;
	selection: StageOutline;
	hover: StageOutline;
	source: StageSelectionSource;
	host?: Document | null;
}) {
	const lookup = createStageNodeLookup(document);
	const overlayProbe = createStageOverlayProbe();
	const selectionOutline: PaintedOutline = {
		...selection,
		border: 2,
		id: null,
		geometry: null,
	};
	const hoverOutline: PaintedOutline = {
		...hover,
		border: 1,
		id: null,
		geometry: null,
	};
	let hoverId: string | null = null;
	let frame = 0;

	const paint = (
		outline: PaintedOutline,
		id: string | null,
		isBlocked?: (element: HTMLElement) => boolean,
	) => {
		const element = id && source.has(id) ? lookup(id) : null;
		if (
			!id ||
			!element ||
			!isStageStylesReady(document) ||
			isBlocked?.(element)
		) {
			hideOutline(outline);
			return;
		}
		const name = source.getName(id);
		if (outline.label.textContent !== name) {
			outline.label.textContent = name;
		}
		const geometry = measureStageOverlayBox(origin, element);
		if (
			outline.id === id &&
			isSameStageOverlayGeometry(outline.geometry, geometry)
		) {
			return;
		}
		outline.id = id;
		outline.geometry = geometry;
		applyStageOverlayBox(outline.box, geometry, outline.border);
		applyStageOverlayLabelScale(outline.label, geometry.scale);
	};

	const step = () => {
		frame = 0;
		const selectedId = source.getSelectedId();
		paint(selectionOutline, selectedId);
		paint(
			hoverOutline,
			hoverId === selectedId ? null : hoverId,
			overlayProbe.isHoverBlockedAt,
		);
		if (selectedId || hoverId) {
			frame = window.requestAnimationFrame(step);
		}
	};

	const schedule = () => {
		if (!frame) {
			frame = window.requestAnimationFrame(step);
		}
	};

	const detach = attachStageInteraction({
		document,
		window,
		source,
		host,
		overlayProbe,
		onHoverChange: (id) => {
			hoverId = id;
			schedule();
		},
	});
	const unsubscribe = source.subscribe(schedule);
	schedule();

	return () => {
		detach();
		unsubscribe();
		window.cancelAnimationFrame(frame);
		overlayProbe.dispose();
		hideOutline(selectionOutline);
		hideOutline(hoverOutline);
	};
}
