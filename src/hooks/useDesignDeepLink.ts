import { type RefObject, useEffect } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router";
import { toast } from "sonner";
import { designStore, selectElement } from "../stores/design-store";
import {
	requestStageReveal,
	setActiveBoardId,
} from "../stores/stage-view-store";
import {
	designDeepLinkBoardParam,
	designDeepLinkLayerParam,
	resolveDesignDeepLink,
} from "../utils/design-deep-link";

/**
 * Applies `?board=<id>&layer=<id>` on the design route once the design is
 * hydrated: switches to the board, selects the layer and asks the stage and
 * layers panel to reveal it. The parameters are consumed, so later selection
 * changes do not fight a stale URL. Focus requests from agents arrive the same
 * way.
 */
export function useDesignDeepLink({
	designFile,
	hydratedDesignFileRef,
	rootIds,
}: {
	designFile: string | null;
	/** The design file whose snapshot `designStore` currently holds. */
	hydratedDesignFileRef: RefObject<string | null>;
	rootIds: readonly string[];
}) {
	const [searchParams] = useSearchParams();
	const location = useLocation();
	const navigate = useNavigate();
	const boardId = searchParams.get(designDeepLinkBoardParam);
	const layerId = searchParams.get(designDeepLinkLayerParam);

	useEffect(() => {
		if (!boardId && !layerId) {
			return;
		}
		// Wait for this design's snapshot; `rootIds` changes when it lands.
		if (
			!designFile ||
			hydratedDesignFileRef.current !== designFile ||
			rootIds.length === 0
		) {
			return;
		}

		const target = resolveDesignDeepLink(designStore.get(), {
			boardId,
			layerId,
		});
		if (target.boardId) {
			setActiveBoardId(target.boardId);
		}
		if (target.layerId) {
			selectElement(target.layerId);
		}
		const revealId = target.layerId ?? target.boardId;
		if (revealId) {
			requestStageReveal({ requestId: location.key, elementId: revealId });
		}
		if (target.missing.length > 0) {
			toast.warning(
				target.missing.includes("layer")
					? "That layer is not in this design"
					: "That board is not in this design",
				{ id: "design-deep-link-missing" },
			);
		}

		const remaining = new URLSearchParams(searchParams);
		remaining.delete(designDeepLinkBoardParam);
		remaining.delete(designDeepLinkLayerParam);
		const search = remaining.toString();
		navigate(
			{ pathname: location.pathname, search: search ? `?${search}` : "" },
			{ replace: true },
		);
	}, [
		boardId,
		designFile,
		hydratedDesignFileRef,
		layerId,
		location.key,
		location.pathname,
		navigate,
		rootIds,
		searchParams,
	]);
}
