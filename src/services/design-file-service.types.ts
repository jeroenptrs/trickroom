import type { TrickroomDesignSummary } from "../types";

/**
 * A design revision. Opaque: compare revisions for equality and hand them back
 * to the service, but do not parse them or assume a format.
 */
export type DesignFileRevision = string;

/**
 * What listing a design needs without loading it: its id, its name and where
 * it is stored. Read from `design.json` alone, so it costs one small file per
 * design whatever the size of its boards.
 */
export type DesignFileHeader = {
	uuid: string;
	/** Path relative to `designs/`, as in `DesignFileSummary.file`. */
	file: string;
	/** The stored name, or the id when the manifest has none or cannot be read. */
	name: string;
};

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
