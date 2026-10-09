import type { TailwindDesignSystem } from "./tailwind-design-system";

export type TailwindUtilityInspection = {
	candidate: string;
	supported: boolean;
	parsedCandidateCount: number;
	css: string | null;
};

export function inspectTailwindUtilityCandidate(
	designSystem: TailwindDesignSystem,
	candidate: string,
): TailwindUtilityInspection {
	const parsedCandidateCount = Array.from(
		designSystem.parseCandidate(candidate),
	).length;
	const css = designSystem.candidatesToCss([candidate])[0] ?? null;

	return {
		candidate,
		supported: parsedCandidateCount > 0 && css !== null,
		parsedCandidateCount,
		css,
	};
}

export function inspectTailwindUtilityCandidates(
	designSystem: TailwindDesignSystem,
	candidates: readonly string[],
): TailwindUtilityInspection[] {
	return candidates.map((candidate) =>
		inspectTailwindUtilityCandidate(designSystem, candidate),
	);
}

/**
 * The class as Tailwind would write it (`bg-[#FFF]` → `bg-white`,
 * `[&:has(.x)]:p-2` → `has-[.x]:p-2`), from the design system's own
 * `canonicalizeCandidates`. One candidate at a time with the default
 * options: no `rem` (px values stay px, they only equal rem values at one
 * root font size) and no `collapse` (merging several classes into one is a
 * question about the whole class list, not a class). A class Tailwind does
 * not know comes back unchanged, as does anything canonicalization fails on.
 */
export function canonicalizeTailwindCandidate(
	designSystem: TailwindDesignSystem,
	candidate: string,
): string {
	try {
		const result = designSystem.canonicalizeCandidates([candidate]);
		return result.length === 1 && result[0] ? result[0] : candidate;
	} catch {
		return candidate;
	}
}
