import { createContext, useContext } from "react";
import type { ClassMerge, ComponentClassSource } from "../../utils/class-merge";

export type ClassMergeState = {
	/** Null when the design's component classes are not merged. */
	merge: ClassMerge | null;
	/**
	 * What component instances resolve their classes from; null when classes
	 * are not merged (instances render their stored className).
	 */
	source: ComponentClassSource | null;
	/** False while the settings load; a failed or timed-out load counts as settled. */
	ready: boolean;
};

export const NOT_MERGED: ClassMergeState = {
	merge: null,
	source: null,
	ready: true,
};

/**
 * How the stage merges component classes (`useClassMerge`), provided by the
 * route that owns the stage so the canvas, its iframe and the inspector share
 * it. Without a provider nothing merges.
 */
export const ClassMergeContext = createContext<ClassMergeState>(NOT_MERGED);

export const useClassMergeContext = () => useContext(ClassMergeContext);
