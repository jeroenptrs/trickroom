import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCcw } from "lucide-react";
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
import { Alert } from "../ui/alert";
import { Button } from "../ui/button";
import { EditableTitle } from "../ui/editable-title";
import { Kbd } from "../ui/kbd";
import { Text } from "../ui/text";
import { CommandMenu } from "./CommandMenu";
import { MemoryNotesButton } from "./memory/MemoryNotesButton";

type ProjectMcpMode = "off" | "read-only" | "read-write";

const getMcpMode = (config: TrickroomConfig): ProjectMcpMode =>
	config.mcp?.enabled === true ? (config.mcp.mode ?? "read-write") : "off";

const getNextMcpSettings = (mode: ProjectMcpMode): ProjectMcpSettings => {
	if (mode === "off") {
		return { enabled: true, mode: "read-only" };
	}

	if (mode === "read-only") {
		return { enabled: true, mode: "read-write" };
	}

	return { enabled: false };
};

const getMcpTone = (mode: ProjectMcpMode) => {
	if (mode === "read-write") {
		return {
			text: "text-cyan-700",
			dot: "bg-cyan-500",
		};
	}

	if (mode === "read-only") {
		return {
			text: "text-orange-700",
			dot: "bg-orange-500",
		};
	}

	return {
		text: "text-slate-500",
		dot: "bg-slate-300",
	};
};

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
				throw new Error("Project location unavailable.");
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
	});
	const errorMessage = (renameMutation.error as Error | null)?.message;

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
			{errorMessage ? (
				<Alert variant="inline" className="mt-1">
					{errorMessage}
				</Alert>
			) : null}
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
	const mcpTone = getMcpTone(mcpMode);
	const updateMcpMutation = useMutation({
		mutationFn: updateProjectMcpSettings,
		onSuccess: (nextConfig) => {
			queryClient.setQueryData(
				configFileProjectQueryKey(projectScope),
				nextConfig,
			);
			queryClient.invalidateQueries({ queryKey: configFileQueryKey });
		},
	});

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
				<CommandMenu />
				<Text tone="faint" className="ml-2 truncate font-mono text-[11px]">
					{activeProject?.projectRoot ?? "Project path unavailable"}
				</Text>
			</div>
			<div className="flex-1" />
			<div className="flex items-center gap-3">
				<MemoryNotesButton
					scope={{ kind: "project" }}
					projectScope={projectScope}
					title={projectName}
					subtitle={activeProject?.projectRoot}
					variant="outlined"
				/>
				<div className="flex items-center gap-1.5">
					<Text tone="faint" className="font-mono text-[10px]">
						switch
					</Text>
					<Kbd>⌘P</Kbd>
				</div>
				<Button
					type="button"
					variant="outlined"
					className={`flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider ${mcpTone.text}`}
					disabled={updateMcpMutation.isPending}
					aria-label={`Set MCP mode after ${mcpMode}`}
					onClick={() => updateMcpMutation.mutate(getNextMcpSettings(mcpMode))}
				>
					<span className={`size-1.5 rounded-full ${mcpTone.dot}`} />
					MCP{" · "}
					{mcpMode}
					<RefreshCcw
						className={`size-3 ${mcpTone.text} ${updateMcpMutation.isPending ? "animate-spin" : ""}`}
						aria-hidden="true"
					/>
				</Button>
			</div>
		</header>
	);
}
