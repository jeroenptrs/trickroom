import { createContext, useContext } from "react";
import type { ClassMerge } from "../../utils/class-merge";

export type ClassMergeState = {
	/** Null when the design's component classes are not merged. */
	merge: ClassMerge | null;
	/** False while the settings load; a failed load counts as settled. */
	ready: boolean;
};

export const NOT_MERGED: ClassMergeState = { merge: null, ready: true };

/**
 * How the stage merges component classes (`useClassMerge`), provided by the
 * route that owns the stage so the canvas, its iframe and the inspector share
 * it. Without a provider nothing merges.
 */
export const ClassMergeContext = createContext<ClassMergeState>(NOT_MERGED);

export const useClassMergeContext = () => useContext(ClassMergeContext);
