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
