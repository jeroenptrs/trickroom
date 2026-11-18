import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { useState } from "react";
import { Outlet, useNavigate } from "react-router";
import { toast } from "sonner";
import { configFileQueryKey } from "../queries/config-file";
import {
	deleteProjectLocation,
	openProject,
	sessionQueryKey,
	sessionQueryOptions,
	type TrickroomProjectSummary,
} from "../queries/projects";
import { systemsQueryKey } from "../queries/systems";
import { MCPSetupDialog } from "./MCPSetupDialog";
import { Button } from "./ui/button";
import { Row } from "./ui/row";
import { Text } from "./ui/text";
import { Tooltip } from "./ui/tooltip";

type RecentProjectRowProps = {
	project: TrickroomProjectSummary;
	disabled: boolean;
	onOpen: () => void;
	onRemove: () => void;
};

function RecentProjectRow({
	project,
	disabled,
	onOpen,
	onRemove,
}: RecentProjectRowProps) {
	return (
		<Row state="default" className="group">
			<button
				type="button"
				className="flex min-w-0 flex-1 flex-col items-start gap-0.5 px-2 py-1.5 text-left focus-visible:outline-none focus-visible:inset-shadow-[0_0_0_1px] focus-visible:inset-shadow-cyan-500 disabled:pointer-events-none disabled:opacity-50"
				disabled={disabled}
				onClick={onOpen}
			>
				<Text tone="foreground" className="block max-w-full truncate text-sm">
					{project.name}
				</Text>
				<Text
					tone="muted"
					className="block max-w-full truncate font-mono text-[10px]"
				>
					{project.projectRoot}
				</Text>
			</button>
			<Tooltip content="Remove from recent projects">
				<Button
					variant="ghost"
					className="shrink-0 items-center justify-center px-2"
					disabled={disabled}
					onClick={onRemove}
					aria-label={`Remove ${project.name} from recent projects`}
				>
					<X className="size-3.5" aria-hidden="true" />
				</Button>
			</Tooltip>
		</Row>
	);
}

export function HomeShell() {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const sessionQuery = useQuery(sessionQueryOptions());
	const recentProjects = sessionQuery.data?.recentProjects ?? [];
	const [mcpSetupOpen, setMcpSetupOpen] = useState(false);

	const openMutation = useMutation({
		mutationFn: (project: TrickroomProjectSummary) =>
			openProject({ path: project.projectRoot }),
		onSuccess: async () => {
			await queryClient.invalidateQueries({ queryKey: sessionQueryKey });
			await queryClient.invalidateQueries({ queryKey: configFileQueryKey });
			await queryClient.invalidateQueries({ queryKey: systemsQueryKey });
			navigate("/", { replace: true });
		},
		onError: (error, project) => {
			toast.error(`Could not open ${project.name}`, {
				description: error instanceof Error ? error.message : undefined,
			});
		},
	});
	// Removing a recent project leaves its files on disk and can be undone by
	// opening the folder again, so it needs no confirmation.
	const removeMutation = useMutation({
		mutationFn: (project: TrickroomProjectSummary) =>
			deleteProjectLocation(project.locationId),
		onSuccess: async (_response, project) => {
			await queryClient.invalidateQueries({ queryKey: sessionQueryKey });
			toast.success(`${project.name} removed from recent projects`);
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
					<aside className="flex w-56 shrink-0 flex-col border-r border-slate-200">
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
						<div className="flex flex-1 flex-col gap-2 px-5 py-5">
							<Text variant="section-header">Recent</Text>
							{recentProjects.length === 0 ? (
								<Text tone="faint" className="mt-1 text-xs">
									No recent projects
								</Text>
							) : (
								<div className="-mx-2 flex flex-col">
									{recentProjects.map((project) => (
										<RecentProjectRow
											key={`${project.projectId}-${project.locationId}`}
											project={project}
											disabled={rowsDisabled}
											onOpen={() => openMutation.mutate(project)}
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
