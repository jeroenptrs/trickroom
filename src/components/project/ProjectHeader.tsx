import { useHotkey } from "@tanstack/react-hotkeys";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
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
import { Button } from "../ui/button";
import { CommandMenu } from "./CommandMenu";

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
	const [isRenaming, setIsRenaming] = useState(false);
	const [draftName, setDraftName] = useState(name);
	const inputRef = useRef<HTMLInputElement>(null);
	const cancelledRef = useRef(false);
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

	const startRenaming = () => {
		if (!locationId || renameMutation.isPending) {
			return;
		}

		cancelledRef.current = false;
		setDraftName(name);
		setIsRenaming(true);
	};

	const confirmRename = () => {
		const nextName = draftName.trim();
		setIsRenaming(false);
		if (nextName.length === 0 || nextName === name) {
			return;
		}

		renameMutation.mutate(nextName);
	};

	const cancelRename = () => {
		cancelledRef.current = true;
		setIsRenaming(false);
	};

	useHotkey("Enter", confirmRename, {
		enabled: isRenaming,
		ignoreInputs: false,
	});
	useHotkey("Escape", cancelRename, { enabled: isRenaming });
	useEffect(() => {
		if (!isRenaming) {
			return;
		}

		inputRef.current?.focus();
		inputRef.current?.select();
	}, [isRenaming]);

	return (
		<div className="min-w-0">
			<div className="grid max-w-[16rem]">
				<button
					type="button"
					className="[grid-area:1/1] truncate border-none bg-transparent px-2 py-1 text-left text-base font-medium text-slate-950 hover:bg-slate-100 focus-visible:outline-none focus-visible:inset-shadow-[0_0_0_1px] focus-visible:inset-shadow-cyan-500 disabled:pointer-events-none disabled:opacity-60"
					style={{ visibility: isRenaming ? "hidden" : "visible" }}
					disabled={!locationId || renameMutation.isPending}
					onClick={startRenaming}
				>
					{name}
				</button>
				<input
					ref={inputRef}
					className="[grid-area:1/1] w-full min-w-0 border-none bg-transparent px-2 py-1 text-base font-medium text-slate-950 outline-none focus-visible:outline-none"
					style={{ visibility: isRenaming ? "visible" : "hidden" }}
					size={1}
					value={draftName}
					onChange={(event) => setDraftName(event.target.value)}
					onBlur={() => {
						if (!cancelledRef.current) confirmRename();
					}}
					aria-label="Project name"
				/>
			</div>
			{errorMessage ? (
				<div className="mt-1 w-fit bg-red-500 px-2 py-1 text-xs text-white">
					{errorMessage}
				</div>
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
				<span className="ml-2 truncate font-mono text-[11px] text-slate-500">
					{activeProject?.projectRoot ?? "Project path unavailable"}
				</span>
			</div>
			<div className="flex-1" />
			<div className="flex items-center gap-3">
				<div className="flex items-center gap-1.5 font-mono text-[10px] text-slate-500">
					<span>switch</span>
					<span className="bg-slate-100 px-1 py-0.5 font-medium text-slate-600">
						⌘P
					</span>
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
