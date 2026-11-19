import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { sessionQueryKey } from "../queries/projects";
import { workspaceEventsUrl, workspaceQueryKey } from "../queries/workspace";

/**
 * Keeps the project and branch lists, and which checkout is open, in line
 * with the server: a worktree added or removed, a branch checked out, or
 * another tab switching projects. Runs with or without an open project.
 */
export function useWorkspaceEvents() {
	const queryClient = useQueryClient();

	useEffect(() => {
		const source = new EventSource(workspaceEventsUrl);
		let connectedBefore = false;
		const refetchWorkspace = () =>
			queryClient.invalidateQueries({ queryKey: workspaceQueryKey });
		const refetchSession = () =>
			queryClient.invalidateQueries({ queryKey: sessionQueryKey });
		const handleWorkspace = () => {
			void refetchWorkspace();
			void refetchSession();
		};
		// Events sent while the stream was down were missed.
		const handleReady = () => {
			if (connectedBefore) handleWorkspace();
			connectedBefore = true;
		};

		source.addEventListener("ready", handleReady);
		source.addEventListener("workspace", handleWorkspace);
		source.addEventListener("active-project", handleWorkspace);
		return () => {
			source.removeEventListener("ready", handleReady);
			source.removeEventListener("workspace", handleWorkspace);
			source.removeEventListener("active-project", handleWorkspace);
			source.close();
		};
	}, [queryClient]);
}
