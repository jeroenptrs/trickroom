import type { QueryClient } from "@tanstack/react-query";
import { clearDirty, setPersistedDesignRevision } from "../stores/design-store";
import { type DesignFileSnapshot, designFileQueryKey } from "./design-file";
import type { ProjectQueryScope } from "./project-scope";

/**
 * Records a completed design save everywhere the editor reads persisted state.
 * The design query cache must move to the saved snapshot together with the
 * store's persisted revision: the editor compares the two to decide whether a
 * snapshot came from disk, so a stale cache entry would read as an external
 * change and revert the save (or raise a false conflict when the user kept
 * editing during the request).
 */
export function commitDesignSave(
	queryClient: QueryClient,
	{
		designFile,
		projectScope,
		saved,
		savedStoreRevision,
	}: {
		designFile: string;
		projectScope?: ProjectQueryScope;
		saved: DesignFileSnapshot;
		/** Store revision that was serialized for this save. */
		savedStoreRevision: number;
	},
) {
	queryClient.setQueryData(designFileQueryKey(designFile, projectScope), saved);
	setPersistedDesignRevision(saved.revision);
	clearDirty(savedStoreRevision);
}
