import type { DesignFileRevision } from "../services/design-file-service.types";

export type DesignSyncDecision = "ignore" | "reload" | "conflict";

export function getDesignSyncDecision({
	snapshotRevision,
	persistedRevision,
	hasUnsavedChanges,
	savePending,
}: {
	snapshotRevision: DesignFileRevision;
	persistedRevision: DesignFileRevision | null;
	hasUnsavedChanges: boolean;
	savePending: boolean;
}): DesignSyncDecision {
	if (savePending || snapshotRevision === persistedRevision) {
		return "ignore";
	}

	return hasUnsavedChanges ? "conflict" : "reload";
}
