import type { TrickroomDesignSummary } from "../types";

/**
 * A design revision. Opaque: compare revisions for equality and hand them back
 * to the service, but do not parse them or assume a format.
 */
export type DesignFileRevision = string;

export type DesignFileSummary = TrickroomDesignSummary & {
	revision: DesignFileRevision;
};
