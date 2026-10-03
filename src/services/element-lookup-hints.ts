import type { Node, Props, TrickroomDesign } from "../types";
import { DesignTransformError } from "./design-transform-service";

const MAX_MATCHES = 5;
const MIN_TRUNCATED_ID_LENGTH = 4;
const SMALL_BOARD_LIST = 20;

type LookupEntity = { id: string; props: Props };

export type MissingElementIdHints = {
	hint: string;
	details: {
		missingElementId: string;
		truncatedIdMatches?: string[];
		nameMatches?: Array<{ id: string; name: string }>;
		availableBoardIds?: string[];
	};
};

const walkNodes = function* (nodes: readonly Node[]): Generator<Node> {
	for (const node of nodes) {
		yield node;
		if (Array.isArray(node.children)) {
			yield* walkNodes(node.children);
		}
	}
};

export const getDesignLookupEntities = (
	designs: readonly TrickroomDesign[],
): LookupEntity[] => designs.flatMap((design) => [...walkNodes(design.boards)]);

/**
 * Explain why an element id did not resolve: a truncated id (prefix of real
 * ids), a layer name passed where an id is expected, or neither (then point at
 * the read tools and list board ids when there are few).
 */
export const describeMissingElementId = (
	entities: Iterable<LookupEntity>,
	missingId: string,
	boardIds: readonly string[] = [],
): MissingElementIdHints => {
	const truncatedIdMatches: string[] = [];
	const nameMatches: Array<{ id: string; name: string }> = [];
	const needle = missingId.trim().toLowerCase();
	for (const entity of entities) {
		if (
			missingId.length >= MIN_TRUNCATED_ID_LENGTH &&
			entity.id !== missingId &&
			entity.id.startsWith(missingId) &&
			truncatedIdMatches.length < MAX_MATCHES
		) {
			truncatedIdMatches.push(entity.id);
		}
		const name = entity.props["data-trickroom-name"];
		if (
			typeof name === "string" &&
			name.trim().toLowerCase() === needle &&
			nameMatches.length < MAX_MATCHES
		) {
			nameMatches.push({ id: entity.id, name });
		}
	}

	const hints: string[] = [];
	if (truncatedIdMatches.length > 0) {
		hints.push(
			`It looks like a truncated id; full id${truncatedIdMatches.length === 1 ? "" : "s"} with that prefix: ${truncatedIdMatches.map((id) => `"${id}"`).join(", ")}.`,
		);
	}
	if (nameMatches.length > 0) {
		hints.push(
			`It matches the layer name of ${nameMatches.map(({ id }) => `"${id}"`).join(", ")}; pass the element id, not the name.`,
		);
	}
	const includeBoards =
		hints.length === 0 &&
		boardIds.length > 0 &&
		boardIds.length <= SMALL_BOARD_LIST;
	if (hints.length === 0) {
		hints.push(
			"Use the full element id from readSubtree, readElement, or readDesignGraph.",
		);
	}

	return {
		hint: hints.join(" "),
		details: {
			missingElementId: missingId,
			...(truncatedIdMatches.length > 0 ? { truncatedIdMatches } : {}),
			...(nameMatches.length > 0 ? { nameMatches } : {}),
			...(includeBoards ? { availableBoardIds: [...boardIds] } : {}),
		},
	};
};

const ELEMENT_LOOKUP_ERROR_CODES = new Set([
	"ELEMENT_NOT_FOUND",
	"PARENT_NOT_FOUND",
]);

const QUOTED_ID_PATTERN = /"([^"]+)"/u;

/**
 * Add truncated-id and layer-name hints to an ELEMENT_NOT_FOUND or
 * PARENT_NOT_FOUND error. Other errors, errors already carrying hints, and
 * messages without a quoted id are returned unchanged.
 */
export const enrichElementLookupError = (
	error: DesignTransformError,
	designs: readonly TrickroomDesign[],
): DesignTransformError => {
	if (
		!ELEMENT_LOOKUP_ERROR_CODES.has(error.code) ||
		error.details?.missingElementId !== undefined
	) {
		return error;
	}
	const missingId = error.message.match(QUOTED_ID_PATTERN)?.[1];
	if (!missingId || /inconsistent/u.test(error.message)) {
		return error;
	}

	const { hint, details } = describeMissingElementId(
		getDesignLookupEntities(designs),
		missingId,
		designs.flatMap((design) => design.boards.map((board) => board.id)),
	);
	return new DesignTransformError(error.code, `${error.message} ${hint}`, {
		...error.details,
		...details,
	});
};

/** Build an enriched ELEMENT_NOT_FOUND error for a lookup in one design. */
export const createElementNotFoundError = (
	design: TrickroomDesign,
	elementId: string,
): DesignTransformError =>
	enrichElementLookupError(
		new DesignTransformError(
			"ELEMENT_NOT_FOUND",
			`Element "${elementId}" not found.`,
		),
		[design],
	);
