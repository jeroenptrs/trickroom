import type { QueryClient } from "@tanstack/react-query";
import { commitDesignSaveResult } from "../stores/design-sync";
import type { TrickroomDesign } from "../types";
import { type DesignFileSnapshot, designFileQueryKey } from "./design-file";
import type { ProjectQueryScope } from "./project-scope";

/**
 * Records a completed design save everywhere the editor reads persisted state:
 * the design query cache moves to the stored design, and the store takes the
 * saved parts as its base (see `commitDesignSaveResult`). A save that kept
 * another writer's boards (`merged`) applies those boards to the editor like
 * any external change, without reloading the rest.
 */
export function commitDesignSave(
	queryClient: QueryClient,
	{
		designId,
		projectScope,
		sent,
		saved,
		savedStoreRevision,
	}: {
		designId: string;
		projectScope?: ProjectQueryScope;
		/** The design the save sent. */
		sent: TrickroomDesign;
		saved: DesignFileSnapshot;
		/** Store revision that was serialized for this save. */
		savedStoreRevision: number;
	},
) {
	queryClient.setQueryData(designFileQueryKey(designId, projectScope), saved);
	return commitDesignSaveResult({ sent, savedStoreRevision, saved });
}
