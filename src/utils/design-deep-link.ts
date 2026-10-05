// Deep links into a design: `/design/<id>?board=<boardId>&layer=<layerId>`.
// Both parameters are optional; a layer implies its board.

export const designDeepLinkBoardParam = "board";
export const designDeepLinkLayerParam = "layer";

export type DesignDeepLinkTarget = {
	boardId?: string | null;
	layerId?: string | null;
};

/** Builds the in-app path of a design, optionally pointing at a board and layer. */
export function buildDesignPath(
	designId: string,
	{ boardId, layerId }: DesignDeepLinkTarget = {},
) {
	const params = new URLSearchParams();
	if (boardId) {
		params.set(designDeepLinkBoardParam, boardId);
	}
	if (layerId) {
		params.set(designDeepLinkLayerParam, layerId);
	}
	const search = params.toString();
	return `/design/${encodeURIComponent(designId)}${search ? `?${search}` : ""}`;
}

type DeepLinkEntity = { parentId: string | null };

export type ResolvedDesignDeepLink = {
	boardId: string | null;
	layerId: string | null;
	/** Requested ids that are not in the design. */
	missing: Array<"board" | "layer">;
};

/**
 * Resolves a deep link against the loaded design. A layer that exists wins and
 * selects its own board, whatever board was asked for.
 */
export function resolveDesignDeepLink(
	design: {
		rootIds: readonly string[];
		entitiesById: Readonly<Record<string, DeepLinkEntity | undefined>>;
	},
	{ boardId, layerId }: DesignDeepLinkTarget,
): ResolvedDesignDeepLink {
	const missing: ResolvedDesignDeepLink["missing"] = [];

	if (layerId) {
		if (design.entitiesById[layerId]) {
			let rootId = layerId;
			let parentId = design.entitiesById[layerId]?.parentId ?? null;
			while (parentId) {
				rootId = parentId;
				parentId = design.entitiesById[parentId]?.parentId ?? null;
			}
			return { boardId: rootId, layerId, missing };
		}
		missing.push("layer");
	}

	if (boardId) {
		if (design.rootIds.includes(boardId)) {
			return { boardId, layerId: null, missing };
		}
		missing.push("board");
	}

	return { boardId: null, layerId: null, missing };
}
