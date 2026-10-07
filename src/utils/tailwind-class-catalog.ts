/**
 * Server-side class catalog for the inspector's class field: every utility and
 * variant the project's compiled Tailwind design system knows (theme tokens and
 * custom `@utility` roots included), plus per-class validation with nearest
 * matches. Built from Tailwind's own `getClassList()` / `getVariants()` /
 * `parseCandidate()`, never from a hand-maintained list.
 */

import { statSync } from "node:fs";
import { suggestTailwindClasses } from "./class-token-diagnostics";
import {
	loadCanvasTailwindDesignSystem,
	type TailwindDesignSystem,
} from "./tailwind-design-system";
import { inspectTailwindUtilityCandidate } from "./tailwind-utility-inspector";

export type TailwindClassCatalog = {
	/** Utility class names in Tailwind's own order (no variants). */
	classes: string[];
	/** Variant names usable as `name:` prefixes, values expanded. */
	variants: string[];
};

export type TailwindClassInspection = {
	candidate: string;
	supported: boolean;
	suggestions?: string[];
};

type TailwindVariantEntry = ReturnType<
	TailwindDesignSystem["getVariants"]
>[number];

/**
 * Expand `getVariants()` into the prefixes a user types: `hover`, `md`,
 * `group-hover`, `max-md`, `@lg`. Arbitrary-only variants (`data-[…]`) stay as
 * their bare name since their values are free-form.
 */
export function expandVariantNames(
	variants: readonly TailwindVariantEntry[],
): string[] {
	const names = new Set<string>();
	for (const variant of variants) {
		if (variant.values.length === 0) {
			names.add(variant.name);
			continue;
		}
		for (const value of variant.values) {
			names.add(
				value === "DEFAULT"
					? variant.name
					: `${variant.name}${variant.hasDash ? "-" : ""}${value}`,
			);
		}
	}
	return [...names];
}

export function buildTailwindClassCatalog(
	designSystem: TailwindDesignSystem,
): TailwindClassCatalog {
	return {
		classes: designSystem.getClassList().map(([name]) => name),
		variants: expandVariantNames(designSystem.getVariants()),
	};
}

export function inspectTailwindClasses(
	designSystem: TailwindDesignSystem,
	catalog: TailwindClassCatalog,
	candidates: readonly string[],
): TailwindClassInspection[] {
	return candidates.map((candidate) => {
		const { supported } = inspectTailwindUtilityCandidate(
			designSystem,
			candidate,
		);
		if (supported) {
			return { candidate, supported };
		}
		const suggestions = suggestTailwindClasses(catalog.classes, candidate);
		return suggestions.length > 0
			? { candidate, supported, suggestions }
			: { candidate, supported };
	});
}

type CatalogCacheEntry = {
	themeOverrides: string;
	fileMtimes: Map<string, number>;
	designSystem: TailwindDesignSystem;
	catalog: TailwindClassCatalog;
};

// Loading a design system parses the whole stylesheet, so keep one per entry
// file and reuse it until the theme or any file it read changes.
const catalogCache = new Map<string, Promise<CatalogCacheEntry>>();

function mtimeOrNull(filePath: string) {
	try {
		return statSync(filePath).mtimeMs;
	} catch {
		return null;
	}
}

function isFresh(entry: CatalogCacheEntry, themeOverrides: string) {
	if (entry.themeOverrides !== themeOverrides) {
		return false;
	}
	for (const [filePath, mtimeMs] of entry.fileMtimes) {
		if (mtimeOrNull(filePath) !== mtimeMs) {
			return false;
		}
	}
	return true;
}

export async function getCachedTailwindClassCatalog({
	projectRoot,
	cssPath,
	themeOverrides = "",
}: {
	projectRoot: string;
	/** System entry CSS, or null for baseline Tailwind. */
	cssPath: string | null;
	themeOverrides?: string;
}): Promise<CatalogCacheEntry> {
	const key = `${projectRoot}\0${cssPath ?? ""}`;
	const cached = catalogCache.get(key);
	if (cached) {
		const entry = await cached.catch(() => null);
		if (entry && isFresh(entry, themeOverrides)) {
			return entry;
		}
	}

	const pending = loadCanvasTailwindDesignSystem({
		projectRoot,
		cssPath,
		themeOverrides,
	}).then(({ designSystem, fileMtimes }) => ({
		themeOverrides,
		fileMtimes,
		designSystem,
		catalog: buildTailwindClassCatalog(designSystem),
	}));
	catalogCache.set(key, pending);
	pending.catch(() => {
		if (catalogCache.get(key) === pending) {
			catalogCache.delete(key);
		}
	});
	return pending;
}
