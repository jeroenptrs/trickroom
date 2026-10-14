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

/** A UUID, the shape of every id Trickroom mints. */
const UUID =
	"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";

const escapeRegExp = (text: string) =>
	text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Quoted runs (class strings, text content): never rewritten. A single
 * quote inside a word ("don't") is an apostrophe, not a quote.
 */
const QUOTED = /"[^"]*"|`[^`]*`|(?<![\w])'[^']*'(?![\w])/g;

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
 * Free text from a change record with the layer ids in it replaced by the
 * layers' names. Only whole tokens are replaced (an id `text` leaves
 * `text-3xl` alone), and never inside quotes, where class strings and text
 * content live.
 *
 * - `"ids"` (operation lines and the record's summary, which name layers
 *   by id): the record's own layer and board ids, and any UUID.
 * - `"uuids"` (an agent's prose reply): only UUIDs, so a layer whose id is
 *   a plain word does not rewrite that word in a sentence.
 */
export function nameLayersInText(
	text: string,
	change: Pick<AnnotationChangeRecord, "layerIds" | "boards">,
	annotation: Pick<AnnotationView, "target" | "snapshot">,
	lookup?: LayerNameLookup,
	mode: "ids" | "uuids" = "ids",
) {
	const known =
		mode === "ids"
			? [...new Set([...change.layerIds, ...change.boards])]
					.filter((id) => id.length > 0)
					// Longest first, so an id that prefixes another does not win.
					.sort((a, b) => b.length - a.length)
					.map(escapeRegExp)
			: [];
	const token = new RegExp(
		`(?<![\\w-])(?:${[UUID, ...known].join("|")})(?![\\w-])`,
		// Ids are case-sensitive.
		"g",
	);
	const name = (unquoted: string) =>
		unquoted.replace(
			token,
			(id) => resolveChangeLayerName(id, annotation, lookup).name,
		);
	let result = "";
	let last = 0;
	for (const quoted of text.matchAll(QUOTED)) {
		const at = quoted.index ?? 0;
		result += name(text.slice(last, at)) + quoted[0];
		last = at + quoted[0].length;
	}
	return result + name(text.slice(last));
}
