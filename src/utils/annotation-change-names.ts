import type {
	AnnotationChangeRecord,
	AnnotationView,
} from "../services/annotations.types";

/**
 * Names for the layers a change record mentions. Change records store ids
 * (and an agent's free-text summaries that often quote them); designers
 * should read layer names. Resolution order: the layer's current name in
 * the open design, then what the record itself knows (the annotation's
 * snapshot name when the id is its own target), then a short id
 * (`#e1a28cc2`) for a layer that no longer exists. Display only: the stored
 * change record is unchanged.
 */

/** The layer's current name in the open design, or null when it is not there. */
export type LayerNameLookup = (layerId: string) => string | null | undefined;

export type ChangeLayerName = {
	id: string;
	name: string;
	/** Still in the open design (it can be revealed). */
	present: boolean;
};

export const shortLayerId = (id: string) => `#${id.slice(0, 8)}`;

/** Ids an agent may have written: UUIDs and the record's own layer ids. */
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

const escapeRegExp = (text: string) =>
	text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** What the annotation itself knows about a layer id. */
const recordedName = (
	annotation: Pick<AnnotationView, "target" | "snapshot">,
	id: string,
) => {
	const { target, snapshot } = annotation;
	const own =
		target.kind === "layer"
			? target.elementId
			: target.kind === "board"
				? target.boardId
				: null;
	return own === id ? snapshot.layerName?.trim() || null : null;
};

/** One id's display name, by the order above. */
export function resolveChangeLayerName(
	id: string,
	annotation: Pick<AnnotationView, "target" | "snapshot">,
	lookup?: LayerNameLookup,
): ChangeLayerName {
	const live = lookup?.(id)?.trim();
	if (live) return { id, name: live, present: true };
	return {
		id,
		name: recordedName(annotation, id) ?? shortLayerId(id),
		present: false,
	};
}

/** The layers a change touched, named, in the record's order. */
export function describeChangeLayers(
	change: Pick<AnnotationChangeRecord, "layerIds">,
	annotation: Pick<AnnotationView, "target" | "snapshot">,
	lookup?: LayerNameLookup,
): ChangeLayerName[] {
	return [...new Set(change.layerIds)].map((id) =>
		resolveChangeLayerName(id, annotation, lookup),
	);
}

/**
 * Free text from a change record (its summary, an operation's summary) with
 * every layer id in it replaced by that layer's name: the record's own
 * layer and board ids, and any other UUID.
 */
export function nameLayersInText(
	text: string,
	change: Pick<AnnotationChangeRecord, "layerIds" | "boards">,
	annotation: Pick<AnnotationView, "target" | "snapshot">,
	lookup?: LayerNameLookup,
) {
	const known = [...new Set([...change.layerIds, ...change.boards])].filter(
		(id) => id.length > 0,
	);
	const pattern = new RegExp(
		[UUID.source, ...known.map(escapeRegExp)].join("|"),
		"gi",
	);
	return text.replace(
		pattern,
		(id) => resolveChangeLayerName(id, annotation, lookup).name,
	);
}
