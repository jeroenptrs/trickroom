import type { TrickroomDesignSummary } from "../types";

export type DesignFileRevision = `sha256:${string}`;

export type DesignFileSummary = TrickroomDesignSummary & {
	revision: DesignFileRevision;
};
