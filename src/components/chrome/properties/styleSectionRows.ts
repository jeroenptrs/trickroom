/**
 * Section-level row registry for set-only rendering (right-rail P1): every
 * override-aware property row registers itself with the enclosing
 * `StyleSection`, hides while its property is unset, and the section offers
 * the hidden rest as ghost chips plus an add-property menu.
 *
 * The registry actions and the revealed-id set live in separate contexts so
 * that registration effects can depend on a stable actions object — a single
 * combined context value would change on every reveal and re-run the
 * mount/unmount effects in a loop.
 */

import { createContext, useContext, useEffect } from "react";

export type SectionRowInfo = {
	/** Stable id — the property key, unique within a section. */
	id: string;
	/** User-facing row label, reused by ghost chips and the add menu. */
	label: string;
	/** Whether any slot (base or override) currently has a value. */
	isSet: boolean;
	/** Offer as a dashed ghost chip (likely-next property), not only in the add menu. */
	likely: boolean;
};

export type SectionRowsRegistry = {
	/** Reserve a slot in render order; returns the unmount cleanup. */
	mount: (id: string) => () => void;
	/** Upsert the row's current info; preserves registration order. */
	update: (info: SectionRowInfo) => void;
	/** Show an unset row so the user can give it a value. */
	reveal: (id: string) => void;
};

export const SectionRowsRegistryContext =
	createContext<SectionRowsRegistry | null>(null);

const EMPTY_REVEALED: ReadonlySet<string> = new Set();

export const SectionRevealedContext =
	createContext<ReadonlySet<string>>(EMPTY_REVEALED);

/** Revealed row ids of the enclosing section (empty outside a section). */
export function useRevealedRows(): ReadonlySet<string> {
	return useContext(SectionRevealedContext);
}

/**
 * Register a property row with the enclosing section and report whether the
 * row should render. Outside a section (no provider) rows always render.
 */
export function useSectionRow(info: SectionRowInfo): boolean {
	const registry = useContext(SectionRowsRegistryContext);
	const revealed = useContext(SectionRevealedContext);
	const { id, label, isSet, likely } = info;

	useEffect(() => {
		if (!registry) return;
		return registry.mount(id);
	}, [registry, id]);

	useEffect(() => {
		if (!registry) return;
		registry.update({ id, label, isSet, likely });
	}, [registry, id, label, isSet, likely]);

	if (!registry) return true;
	return isSet || revealed.has(id);
}

/** Rows that are currently hidden: registered, unset, and not revealed. */
export function hiddenSectionRows(
	rows: ReadonlyMap<string, SectionRowInfo | null>,
	revealed: ReadonlySet<string>,
): SectionRowInfo[] {
	return [...rows.values()].filter(
		(row): row is SectionRowInfo =>
			row !== null && !row.isSet && !revealed.has(row.id),
	);
}
