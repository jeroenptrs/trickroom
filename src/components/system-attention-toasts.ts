import type {
	TailwindSyncResult,
	TailwindSystemTarget,
} from "../hooks/useTailwindSyncController";
import type { ProjectQueryScope } from "../queries/project-scope";

export type SystemAttentionSummary = {
	issueNames: string[];
	reviewNames: string[];
	reviewSystemIds: string[];
	issueKey: string;
	reviewKey: string;
};

export const getSystemAttentionToastIds = (projectScope: ProjectQueryScope) => {
	const normalized =
		typeof projectScope === "string" && projectScope.trim().length > 0
			? projectScope.trim()
			: "no-active-project";

	return {
		issues: `trickroom-system-sync-issues:${normalized}`,
		review: `trickroom-system-sync-review:${normalized}`,
	};
};

export const getSystemAttentionSummary = (
	systems: TailwindSystemTarget[],
	results: Record<string, TailwindSyncResult>,
): SystemAttentionSummary => {
	const issueNames: string[] = [];
	const reviewNames: string[] = [];
	const reviewSystemIds: string[] = [];

	for (const system of systems) {
		const result = results[system.systemId];
		if (!result) {
			continue;
		}

		const displayName = system.systemName || system.systemId;
		if (result.status === "error") {
			issueNames.push(displayName);
		}
		if (result.data?.reviewRequired) {
			reviewNames.push(displayName);
			reviewSystemIds.push(system.systemId);
		}
	}

	return {
		issueNames,
		reviewNames,
		reviewSystemIds,
		issueKey: issueNames.join("\0"),
		reviewKey: reviewNames.join("\0"),
	};
};

const MAX_LISTED_NAMES = 3;

/** "A, B, C", or "A, B, C and N more" past three names. */
const listNames = (names: string[]) => {
	if (names.length <= MAX_LISTED_NAMES) {
		return names.join(", ");
	}
	const rest = names.length - MAX_LISTED_NAMES;
	return `${names.slice(0, MAX_LISTED_NAMES).join(", ")}, and ${rest} more`;
};

/**
 * The fact goes in the title. One system names it there; several give the
 * count in the title and the names in the description.
 */
export const getSystemAttentionToastCopy = (
	kind: "issues" | "review",
	names: string[],
): { title: string; description?: string } => {
	if (names.length === 1) {
		return {
			title:
				kind === "issues"
					? `${names[0]} tokens not synced`
					: `${names[0]} has token changes to review`,
		};
	}
	return {
		title:
			kind === "issues"
				? `Tokens not synced for ${names.length} systems`
				: `${names.length} systems have token changes to review`,
		description: listNames(names),
	};
};
