import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
	configFileProjectQueryKey,
	configFileQueryKey,
	type ProjectMcpSettings,
	updateProjectMcpSettings,
} from "../../queries/config-file";
import {
	renameProjectLocation,
	sessionQueryKey,
	sessionQueryOptions,
} from "../../queries/projects";
import type { TrickroomConfig } from "../../types";
import { useProjectConfig, useProjectScope } from "../contexts";
import { EditableTitle } from "../ui/editable-title";
import { Segmented, type SegmentedOption } from "../ui/segmented";
import { Text } from "../ui/text";
import { CommandMenu } from "./CommandMenu";
import { MemoryNotesButton } from "./memory/MemoryNotesButton";

type ProjectMcpMode = "off" | "read-only" | "read-write";

const getMcpMode = (config: TrickroomConfig): ProjectMcpMode =>
	config.mcp?.enabled === true ? (config.mcp.mode ?? "read-write") : "off";

// One choice of three, so going from read-only to off never passes through
// read-write on the way.
const MCP_MODE_OPTIONS: readonly SegmentedOption<ProjectMcpMode>[] = [
	{ value: "off", label: "Off" },
	{ value: "read-only", label: "Read only" },
	{ value: "read-write", label: "Read and write" },
];

const getMcpSettings = (mode: ProjectMcpMode): ProjectMcpSettings =>
	mode === "off" ? { enabled: false } : { enabled: true, mode };

function ProjectTitle({
	name,
	locationId,
}: {
	name: string;
	locationId: string | null;
}) {
	const queryClient = useQueryClient();
	const projectScope = useProjectScope();
	const renameMutation = useMutation({
		mutationFn: (nextName: string) => {
			if (!locationId) {
				throw new Error("Reopen the project and try again.");
			}

			return renameProjectLocation({ locationId, name: nextName });
		},
		onSuccess: async (response) => {
			queryClient.setQueryData(
				configFileProjectQueryKey(projectScope),
				response.config,
			);
			queryClient.setQueryData(sessionQueryKey, {
				activeProject: response.activeProject,
				recentProjects: response.recentProjects,
			});
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: configFileQueryKey }),
				queryClient.invalidateQueries({ queryKey: sessionQueryKey }),
			]);
		},
		// A toast keeps the header one line tall.
		onError: (error) => {
			toast.error("Could not rename the project", {
				description: error instanceof Error ? error.message : undefined,
			});
		},
	});

	return (
		<div className="min-w-0">
			<div className="max-w-[16rem]">
				<EditableTitle
					value={name}
					size="md"
					aria-label="Project name"
					disabled={!locationId || renameMutation.isPending}
					onRename={(nextName) => renameMutation.mutate(nextName)}
				/>
			</div>
		</div>
	);
}

export function ProjectHeader() {
	const config = useProjectConfig();
	const projectScope = useProjectScope();
	const queryClient = useQueryClient();
	const sessionQuery = useQuery(sessionQueryOptions());
	const activeProject = sessionQuery.data?.activeProject;
	const projectName = activeProject?.name ?? config.name;
	const mcpMode = getMcpMode(config);
	const updateMcpMutation = useMutation({
		mutationFn: updateProjectMcpSettings,
		onSuccess: (nextConfig) => {
			queryClient.setQueryData(
				configFileProjectQueryKey(projectScope),
				nextConfig,
			);
			queryClient.invalidateQueries({ queryKey: configFileQueryKey });
		},
		onError: (error) => {
			toast.error("Could not change MCP access", {
				description: error instanceof Error ? error.message : undefined,
			});
		},
	});
	// While a change saves, show the mode it is moving to.
	const pendingMcpSettings = updateMcpMutation.isPending
		? updateMcpMutation.variables
		: undefined;
	const displayedMcpMode: ProjectMcpMode = pendingMcpSettings
		? pendingMcpSettings.enabled
			? pendingMcpSettings.mode
			: "off"
		: mcpMode;
	const changeMcpMode = (nextMode: ProjectMcpMode | null) => {
		// Clicking the active option keeps it; there is no unset state.
		if (!nextMode || nextMode === mcpMode || updateMcpMutation.isPending) {
			return;
		}
		updateMcpMutation.mutate(getMcpSettings(nextMode));
	};

	return (
		<header className="flex items-center gap-3 border-b border-slate-200 bg-white px-6 py-3">
			<img
				src="/trickroom-mark.svg"
				alt="Trickroom logo"
				className="size-6 shrink-0"
			/>
			<div className="flex min-w-0 items-center">
				<ProjectTitle
					name={projectName}
					locationId={activeProject?.locationId ?? null}
				/>
				<Text tone="faint" className="ml-2 truncate font-mono text-[11px]">
					{activeProject?.projectRoot ?? "Project path unavailable"}
				</Text>
			</div>
			<div className="flex-1" />
			<div className="flex shrink-0 items-center gap-3 whitespace-nowrap">
				<MemoryNotesButton
					scope={{ kind: "project" }}
					projectScope={projectScope}
					title={projectName}
					subtitle={activeProject?.projectRoot}
					variant="outlined"
				/>
				<CommandMenu />
				<div
					className="flex items-center gap-2"
					aria-busy={updateMcpMutation.isPending}
				>
					<Text variant="group-label" aria-hidden="true">
						MCP
					</Text>
					<Segmented
						ariaLabel="MCP access for agents"
						options={MCP_MODE_OPTIONS}
						value={displayedMcpMode}
						onChange={changeMcpMode}
					/>
				</div>
			</div>
		</header>
	);
}
