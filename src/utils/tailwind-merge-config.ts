import {
	type DefaultThemeGroupIds,
	extendTailwindMerge,
	twMerge,
} from "tailwind-merge";

/**
 * A tailwind-merge configuration derived from a project's Tailwind design
 * system (`deriveTwMergeConfig` in `tailwind-merge-derive.ts`). It is a
 * plain, JSON-serialisable `extendTailwindMerge` extension, so the same
 * object can be written into a generated `tw-merge.ts`, handed to
 * tailwind-variants' `createTV({ twMergeConfig })`, or sent to the browser.
 *
 * - `prefix`: the design system's prefix (`prefix(tw)`), when it has one.
 * - `theme`: per tailwind-merge theme key, the keys of the Tailwind theme
 *   namespace of the same name (`color` ↔ `--color-*`, `text` ↔ `--text-*`).
 * - `classGroups`: custom `@utility` classes, in the stock class group they
 *   merge like, or in a group of their own (`@utility text-label-*`).
 * - `conflictingClassGroups`: per own group, the groups whose every
 *   declaration it overrides, so a later member removes their classes.
 * - `postfixLookupClassGroups`: the groups of classes that have modifier
 *   forms (`badge-sm` for `badge-sm/blue`), so tailwind-merge looks the
 *   full form up in the group the config lists it in. Absent when none.
 *
 * Keys and values are sorted.
 */
export type TwMergeConfig = {
	prefix?: string;
	extend: {
		theme: Partial<Record<DefaultThemeGroupIds, string[]>>;
		classGroups: Record<string, string[]>;
		conflictingClassGroups: Record<string, string[]>;
		postfixLookupClassGroups?: string[];
	};
};

export type TwMergeFunction = (...classLists: string[]) => string;

const merges = new WeakMap<TwMergeConfig, TwMergeFunction>();

/**
 * The merge function for a derived config, or stock `twMerge` without one.
 * Built once per config object: creating a merger builds its class map.
 */
export const createTwMerge = (
	config: TwMergeConfig | null | undefined,
): TwMergeFunction => {
	if (!config) return twMerge;
	let merge = merges.get(config);
	if (!merge) {
		merge = extendTailwindMerge<string>(config);
		merges.set(config, merge);
	}
	return merge;
};
