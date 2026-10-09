import {
	type DefaultClassGroupIds,
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
 * - `theme`: per tailwind-merge theme key, the keys of the Tailwind theme
 *   namespace of the same name (`color` ↔ `--color-*`, `text` ↔ `--text-*`).
 * - `classGroups`: per tailwind-merge class group, the custom `@utility`
 *   classes that merge like it, classified by the CSS Tailwind generates.
 *
 * Only tailwind-merge's own theme keys and class group ids are used, so the
 * extension needs no new conflict rules. Keys and values are sorted.
 */
export type TwMergeConfig = {
	extend: {
		theme: Partial<Record<DefaultThemeGroupIds, string[]>>;
		classGroups: Partial<Record<DefaultClassGroupIds, string[]>>;
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
		merge = extendTailwindMerge(config);
		merges.set(config, merge);
	}
	return merge;
};
