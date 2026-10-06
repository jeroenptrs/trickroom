import type { TrickroomDesignSummary } from "../types";

/**
 * A design revision. Opaque: compare revisions for equality and hand them back
 * to the service, but do not parse them or assume a format.
 */
export type DesignFileRevision = string;

export type DesignFileSummary = TrickroomDesignSummary & {
	revision: DesignFileRevision;
	/**
	 * Each board's id, layer name and revision, in board order. Empty for
	 * designs that cannot be read.
	 */
	boards: { id: string; name: string | null; revision: string }[];
	/** The manifest's `updatedAt`, as stored, when it has one. */
	updatedAt?: string;
};
