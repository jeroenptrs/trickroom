import { queryOptions } from "@tanstack/react-query";
import type {
	ProjectCheckout,
	WorkspaceProject,
} from "../services/project-checkouts";
import { readJsonOrThrow } from "../utils/readJsonOrThrow";
import { apiFetch } from "../utils/tab-location";

export type { ProjectCheckout, WorkspaceProject };

export type WorkspaceResponse = {
	/** Most recently opened project first. */
	projects: WorkspaceProject[];
	/** The checkout the server has open, if any. */
	activeLocationId: string | null;
};

export const workspaceQueryKey = ["trickroom-workspace"];

export const workspaceEventsUrl = "/api/trickroom/workspace/events";

export const workspaceQueryOptions = () =>
	queryOptions({
		queryKey: workspaceQueryKey,
		queryFn: async () =>
			readJsonOrThrow<WorkspaceResponse>(
				await apiFetch("/api/trickroom/workspace"),
			),
		retry: false,
	});

export const removeWorkspaceProject = async (projectId: string) => {
	const response = await apiFetch(
		`/api/trickroom/workspace/projects/${encodeURIComponent(projectId)}/remove`,
		{ method: "POST" },
	);

	return readJsonOrThrow<{ removedLocations: number }>(response);
};

/**
 * What to call a checkout: its branch, the commit of a detached HEAD, or,
 * without git, the folder name.
 */
export const getCheckoutLabel = (
	checkout: Pick<ProjectCheckout, "branch" | "detachedHead" | "projectRoot">,
) =>
	checkout.branch ??
	(checkout.detachedHead
		? `Detached at ${checkout.detachedHead}`
		: (checkout.projectRoot.split(/[\\/]/u).filter(Boolean).at(-1) ??
			checkout.projectRoot));
