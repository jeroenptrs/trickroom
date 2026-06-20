import type {
	TailwindSyncResult,
	TailwindSystemTarget,
} from "../hooks/useTailwindSyncController";
import type { ProjectQueryScope } from "../queries/project-scope";

export type SystemAttentionSummary = {
	issueNames: string[];
	reviewNames: string[];
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
		}
	}

	return {
		issueNames,
		reviewNames,
		issueKey: issueNames.join("\0"),
		reviewKey: reviewNames.join("\0"),
	};
};
