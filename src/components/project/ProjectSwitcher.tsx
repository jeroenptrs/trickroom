import { Menu } from "@base-ui/react/menu";
import { useHotkey } from "@tanstack/react-hotkeys";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronsUpDown } from "lucide-react";
import { type FormEvent, useState } from "react";
import { useNavigate } from "react-router";
import { getTrickroomDesktopApi } from "../../desktop-api";
import { auditLogSummaryQueryKey } from "../../queries/audit-log";
import { configFileQueryKey } from "../../queries/config-file";
import { designSummariesQueryKey } from "../../queries/design-file";
import {
	closeProject,
	openProject,
	sessionQueryKey,
	sessionQueryOptions,
} from "../../queries/projects";
import { systemsQueryKey } from "../../queries/systems";
import { Button } from "../ui/button";
import {
	Dialog,
	DialogContent,
	DialogOverlay,
	DialogPortal,
	DialogTitle,
} from "../ui/dialog";
import { InputField } from "../ui/input";
import { Separator } from "../ui/separator";

const menuItemClassName =
	"flex w-full cursor-pointer items-center justify-between gap-3 px-3 py-2 text-left text-sm focus-visible:outline-none data-[disabled]:cursor-default data-[disabled]:opacity-60 data-[highlighted]:bg-slate-50";

export function ProjectSwitcher() {
	const desktopApi = getTrickroomDesktopApi();
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const sessionQuery = useQuery(sessionQueryOptions());
	const activeProject = sessionQuery.data?.activeProject;
	const recentProjects = sessionQuery.data?.recentProjects ?? [];
	const [menuOpen, setMenuOpen] = useState(false);
	const [pathDialogOpen, setPathDialogOpen] = useState(false);
	const [path, setPath] = useState("");
	const [folderPickerError, setFolderPickerError] = useState<string | null>(
		null,
	);
	const [isPickingFolder, setIsPickingFolder] = useState(false);

	const refreshProjectQueries = async () => {
		await Promise.all([
			queryClient.invalidateQueries({ queryKey: sessionQueryKey }),
			queryClient.invalidateQueries({ queryKey: configFileQueryKey }),
			queryClient.invalidateQueries({ queryKey: designSummariesQueryKey }),
			queryClient.invalidateQueries({ queryKey: systemsQueryKey }),
			queryClient.invalidateQueries({ queryKey: auditLogSummaryQueryKey }),
		]);
		navigate("/", { replace: true });
	};

	const openMutation = useMutation({
		mutationFn: (targetPath: string) =>
			openProject({
				path: targetPath,
			}),
		onSuccess: async () => {
			setPathDialogOpen(false);
			setPath("");
			await refreshProjectQueries();
		},
	});
	const closeMutation = useMutation({
		mutationFn: closeProject,
		onSuccess: refreshProjectQueries,
	});
	const isMutating =
		openMutation.isPending || closeMutation.isPending || isPickingFolder;
	const currentLocationId = activeProject?.locationId;
	const currentProjectRoot = activeProject?.projectRoot ?? "";
	const currentProjectName = activeProject?.name ?? "Project";
	const otherRecentProjects = recentProjects.filter(
		(project) =>
			project.locationId !== currentLocationId &&
			project.projectRoot !== currentProjectRoot,
	);
	const openErrorMessage = (openMutation.error as Error | null)?.message;
	const closeErrorMessage = (closeMutation.error as Error | null)?.message;
	const navigationError =
		openErrorMessage || closeErrorMessage || folderPickerError;

	const openProjectAtPath = (targetPath: string) => {
		setFolderPickerError(null);
		openMutation.mutate(targetPath);
	};

	useHotkey(
		"Mod+K",
		() => {
			if (!isMutating) {
				setMenuOpen((open) => !open);
			}
		},
		{ preventDefault: true },
	);

	const handleOpenAnotherFolder = async () => {
		setFolderPickerError(null);
		if (!desktopApi) {
			setPathDialogOpen(true);
			return;
		}

		setIsPickingFolder(true);
		try {
			const result = await desktopApi.pickProjectFolder();
			if (!result.canceled) {
				openProjectAtPath(result.path);
			}
		} catch (error) {
			setFolderPickerError(
				error instanceof Error ? error.message : "Failed to choose folder.",
			);
		} finally {
			setIsPickingFolder(false);
		}
	};

	const handlePathSubmit = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		const nextPath = path.trim();
		if (!nextPath || openMutation.isPending) {
			return;
		}

		openProjectAtPath(nextPath);
	};

	return (
		<div className="shrink-0">
			<Menu.Root modal={false} open={menuOpen} onOpenChange={setMenuOpen}>
				<Menu.Trigger
					className="flex size-7 shrink-0 items-center justify-center border-none bg-transparent p-0 text-slate-500 hover:bg-slate-100 focus-visible:outline-none"
					disabled={isMutating}
					aria-label="Switch project"
				>
					<ChevronsUpDown className="size-4" aria-hidden="true" />
				</Menu.Trigger>
				<Menu.Portal>
					<Menu.Positioner side="bottom" align="start" sideOffset={8}>
						<Menu.Popup className="z-50 w-80 bg-white text-slate-950 inset-shadow-[0_0_0_1px] inset-shadow-slate-400 focus-visible:outline-none">
							<div className="bg-slate-50 px-3 py-1.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-slate-500">
								Recent
							</div>
							<Menu.Item disabled className={menuItemClassName}>
								<span className="min-w-0">
									<span className="block truncate font-medium">
										{currentProjectName}
									</span>
									<span className="block truncate font-mono text-[11px] text-slate-500">
										{currentProjectRoot}
									</span>
								</span>
								<span className="shrink-0 font-mono text-[11px] text-cyan-700">
									current
								</span>
							</Menu.Item>
							{otherRecentProjects.map((project) => (
								<Menu.Item
									key={`${project.projectId}-${project.locationId}`}
									className={menuItemClassName}
									disabled={isMutating}
									onClick={() => openProjectAtPath(project.projectRoot)}
								>
									<span className="min-w-0">
										<span className="block truncate">{project.name}</span>
										<span className="block truncate font-mono text-[11px] text-slate-500">
											{project.projectRoot}
										</span>
									</span>
								</Menu.Item>
							))}
							<div className="border-t border-slate-200">
								<Menu.Item
									className={menuItemClassName}
									disabled={isMutating}
									onClick={handleOpenAnotherFolder}
								>
									<span>Open another folder...</span>
								</Menu.Item>
								<Menu.Item
									className={menuItemClassName}
									disabled={isMutating}
									onClick={() => closeMutation.mutate()}
								>
									<span>Close project</span>
								</Menu.Item>
							</div>
						</Menu.Popup>
					</Menu.Positioner>
				</Menu.Portal>
			</Menu.Root>
			{navigationError ? (
				<div className="mt-1 w-fit bg-red-500 px-2 py-1 text-xs text-white">
					{navigationError}
				</div>
			) : null}
			<Dialog open={pathDialogOpen} onOpenChange={setPathDialogOpen}>
				<DialogPortal>
					<DialogOverlay />
					<DialogContent initialFocus={false}>
						<DialogTitle className="text-lg font-medium">
							Open project folder
						</DialogTitle>
						<Separator />
						<form
							className="flex flex-col gap-3 p-2"
							onSubmit={handlePathSubmit}
						>
							<InputField
								label="Project folder"
								placeholder="/absolute/path/to/project"
								value={path}
								onChange={(event) => setPath(event.target.value)}
								disabled={openMutation.isPending}
							/>
							{openErrorMessage ? (
								<div className="w-fit bg-red-500 px-2 py-1 text-xs text-white">
									Failed to open project: {openErrorMessage}
								</div>
							) : null}
							<div className="flex">
								<Button
									type="button"
									variant="block"
									className="flex-1 py-2"
									disabled={openMutation.isPending}
									onClick={() => setPathDialogOpen(false)}
								>
									Cancel
								</Button>
								<Separator orientation="vertical" />
								<Button
									type="submit"
									variant="block"
									className="flex-1 py-2"
									disabled={openMutation.isPending || path.trim().length === 0}
								>
									{openMutation.isPending ? "Opening..." : "Open"}
								</Button>
							</div>
						</form>
					</DialogContent>
				</DialogPortal>
			</Dialog>
		</div>
	);
}
