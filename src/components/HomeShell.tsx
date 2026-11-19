import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { GitBranch, X } from "lucide-react";
import { useState } from "react";
import { Outlet, useNavigate } from "react-router";
import { toast } from "sonner";
import { openProject, sessionQueryKey } from "../queries/projects";
import {
	getCheckoutLabel,
	type ProjectCheckout,
	removeWorkspaceProject,
	type WorkspaceProject,
	workspaceQueryKey,
	workspaceQueryOptions,
} from "../queries/workspace";
import { openCheckoutInTab } from "../utils/tab-location";
import { MCPSetupDialog } from "./MCPSetupDialog";
import { Button } from "./ui/button";
import { Row } from "./ui/row";
import { Skeleton } from "./ui/skeleton";
import { Text } from "./ui/text";
import { Tooltip } from "./ui/tooltip";

type ProjectGroupProps = {
	project: WorkspaceProject;
	disabled: boolean;
	onOpen: (checkout: ProjectCheckout) => void;
	onRemove: () => void;
};

/** One project and the folders it is checked out in, a row per branch. */
function ProjectGroup({
	project,
	disabled,
	onOpen,
	onRemove,
}: ProjectGroupProps) {
	return (
		<div className="flex flex-col">
			<div className="group flex items-center">
				<Text
					tone="foreground"
					className="block min-w-0 flex-1 truncate px-2 py-1.5 text-sm"
				>
					{project.name}
				</Text>
				<Tooltip content="Remove from this list">
					<Button
						variant="ghost"
						className="shrink-0 items-center justify-center px-2"
						disabled={disabled}
						onClick={onRemove}
						aria-label={`Remove ${project.name} from this list`}
					>
						<X className="size-3.5" aria-hidden="true" />
					</Button>
				</Tooltip>
			</div>
			{project.checkouts.map((checkout) => (
				<Row key={checkout.locationId} state="default">
					<button
						type="button"
						className="flex min-w-0 flex-1 items-center gap-1.5 px-2 py-1 text-left focus-visible:outline-none focus-visible:inset-shadow-[0_0_0_1px] focus-visible:inset-shadow-cyan-500 disabled:pointer-events-none disabled:opacity-50"
						disabled={disabled}
						title={checkout.projectRoot}
						onClick={() => onOpen(checkout)}
					>
						<GitBranch
							className="size-3 shrink-0 text-slate-500"
							aria-hidden="true"
						/>
						<Text
							tone="muted"
							className="block min-w-0 truncate font-mono text-[11px]"
						>
							{getCheckoutLabel(checkout)}
						</Text>
					</button>
				</Row>
			))}
		</div>
	);
}

export function HomeShell() {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const workspaceQuery = useQuery(workspaceQueryOptions());
	const projects = workspaceQuery.data?.projects ?? [];
	const [mcpSetupOpen, setMcpSetupOpen] = useState(false);

	const openMutation = useMutation({
		mutationFn: (target: { name: string; checkout: ProjectCheckout }) =>
			openProject({ path: target.checkout.projectRoot }),
		// The tab loads the checkout under its own URL, so other tabs keep theirs.
		onSuccess: (response) => openCheckoutInTab(response.project.locationId),
		onError: (error, target) => {
			toast.error(
				`Could not open ${target.name} on ${getCheckoutLabel(target.checkout)}`,
				{ description: error instanceof Error ? error.message : undefined },
			);
		},
	});
	// Removing a project leaves its files on disk and can be undone by
	// opening the folder again, so it needs no confirmation.
	const removeMutation = useMutation({
		mutationFn: (project: WorkspaceProject) =>
			removeWorkspaceProject(project.projectId),
		onSuccess: async (_response, project) => {
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: workspaceQueryKey }),
				queryClient.invalidateQueries({ queryKey: sessionQueryKey }),
			]);
			toast.success(`${project.name} removed`);
		},
		onError: (error, project) => {
			toast.error(`Could not remove ${project.name}`, {
				description: error instanceof Error ? error.message : undefined,
			});
		},
	});

	const rowsDisabled = openMutation.isPending || removeMutation.isPending;

	return (
		<main className="flex min-h-screen items-center justify-center bg-slate-50 text-slate-950">
			<div className="flex w-full max-w-5xl flex-col gap-4 px-12 py-16">
				<section className="flex min-h-104 w-full bg-white inset-shadow-[0_0_0_1px] inset-shadow-slate-200">
					<aside className="flex w-64 shrink-0 flex-col border-r border-slate-200">
						<button
							type="button"
							className="flex min-h-20 items-center gap-2 border-b border-slate-200 px-5 text-left focus-visible:outline-none focus-visible:inset-shadow-[0_0_0_1px] focus-visible:inset-shadow-cyan-500"
							onClick={() => navigate("/", { replace: true })}
						>
							<img
								src="/trickroom-mark.svg"
								alt="Trickroom logo"
								className="size-6 shrink-0"
							/>
							<Text
								tone="foreground"
								className="text-base font-medium tracking-tight"
							>
								Trickroom
							</Text>
						</button>
						<div className="flex max-h-[70vh] min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-5 py-5">
							<Text variant="section-header">Projects</Text>
							{workspaceQuery.isPending ? (
								<div className="mt-1 flex flex-col gap-2" aria-busy="true">
									<Skeleton className="h-3 w-24" />
									<Skeleton className="h-3 w-32" />
								</div>
							) : workspaceQuery.isError ? (
								<Text tone="danger" className="mt-1 text-xs" role="alert">
									Could not load your projects
								</Text>
							) : projects.length === 0 ? (
								<Text tone="faint" className="mt-1 text-xs">
									No projects yet
								</Text>
							) : (
								<div className="-mx-2 flex flex-col gap-3">
									{projects.map((project) => (
										<ProjectGroup
											key={project.projectId}
											project={project}
											disabled={rowsDisabled}
											onOpen={(checkout) =>
												openMutation.mutate({ name: project.name, checkout })
											}
											onRemove={() => removeMutation.mutate(project)}
										/>
									))}
								</div>
							)}
						</div>
						<div className="border-t border-slate-200 px-5 py-4">
							<Button
								type="button"
								variant="outlined"
								className="w-full justify-center"
								onClick={() => setMcpSetupOpen(true)}
							>
								MCP setup
							</Button>
						</div>
					</aside>

					<Outlet />
				</section>
			</div>

			<MCPSetupDialog open={mcpSetupOpen} onOpenChange={setMcpSetupOpen} />
		</main>
	);
}
