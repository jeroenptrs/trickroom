import { Dialog as BaseUiDialog } from "@base-ui/react/dialog";
import { useHotkey } from "@tanstack/react-hotkeys";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	CornerDownLeft,
	FileCode2,
	Folder,
	FolderPlus,
	Folders,
	Plus,
	X,
} from "lucide-react";
import {
	type FormEvent,
	type KeyboardEvent,
	useEffect,
	useRef,
	useState,
} from "react";
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
	CommandEmpty,
	CommandFooter,
	CommandFooterHint,
	CommandFooterLeft,
	CommandFooterRight,
	CommandGroup,
	CommandGroupLabel,
	CommandInput,
	CommandItem,
	CommandKeyBadge,
	CommandList,
	CommandRoot,
	CommandSeparator,
} from "../ui/command";
import {
	Dialog,
	DialogContent,
	DialogOverlay,
	DialogPortal,
	DialogTitle,
} from "../ui/dialog";
import { InputField } from "../ui/input";
import { Separator } from "../ui/separator";
import { CreateSystemDialog } from "./CreateSystemDialog";

type CommandPage = "home" | "switcher";
const NO_COMMAND_SELECTION = "__trickroom_no_command_selection__";
const SWITCH_PROJECT_COMMAND_VALUE = "Switch project";
const OPEN_ANOTHER_FOLDER_COMMAND_VALUE = "Open another folder";
const CREATE_NEW_PROJECT_COMMAND_VALUE = "Create new project";
const CREATE_NEW_SYSTEM_COMMAND_VALUE = "Create new system";

export function CommandMenu() {
	const desktopApi = getTrickroomDesktopApi();
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const sessionQuery = useQuery(sessionQueryOptions());
	const activeProject = sessionQuery.data?.activeProject;
	const recentProjects = sessionQuery.data?.recentProjects ?? [];

	const [open, setOpen] = useState(false);
	const [page, setPage] = useState<CommandPage>("home");
	const [selectedCommandValue, setSelectedCommandValue] =
		useState(NO_COMMAND_SELECTION);
	const [keyboardSelectionActive, setKeyboardSelectionActive] = useState(false);
	const [pathDialogOpen, setPathDialogOpen] = useState(false);
	const [createSystemDialogOpen, setCreateSystemDialogOpen] = useState(false);
	const [path, setPath] = useState("");
	const [folderPickerError, setFolderPickerError] = useState<string | null>(
		null,
	);
	const [isPickingFolder, setIsPickingFolder] = useState(false);
	const postCloseDestinationRef = useRef("/");
	const inputRef = useRef<HTMLInputElement>(null);

	// Refocus the search input whenever the dialog opens.
	useEffect(() => {
		if (!open) return;
		const id = setTimeout(() => inputRef.current?.focus(), 0);
		return () => clearTimeout(id);
	}, [open]);

	const refreshProjectQueries = async () => {
		await Promise.all([
			queryClient.invalidateQueries({ queryKey: sessionQueryKey }),
			queryClient.invalidateQueries({ queryKey: configFileQueryKey }),
			queryClient.invalidateQueries({ queryKey: designSummariesQueryKey }),
			queryClient.invalidateQueries({ queryKey: systemsQueryKey }),
			queryClient.invalidateQueries({ queryKey: auditLogSummaryQueryKey }),
		]);
		navigate(postCloseDestinationRef.current, { replace: true });
		postCloseDestinationRef.current = "/";
	};

	const openMutation = useMutation({
		mutationFn: (targetPath: string) => openProject({ path: targetPath }),
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
	// const currentProjectName = activeProject?.name ?? "Project";
	const otherRecentProjects = recentProjects.filter(
		(p) =>
			p.locationId !== currentLocationId &&
			p.projectRoot !== currentProjectRoot,
	);
	const firstSwitcherCommandValue =
		otherRecentProjects[0]?.name ?? OPEN_ANOTHER_FOLDER_COMMAND_VALUE;

	useEffect(() => {
		if (!open) {
			setKeyboardSelectionActive(false);
			setSelectedCommandValue(NO_COMMAND_SELECTION);
			return;
		}

		setKeyboardSelectionActive(true);
		setSelectedCommandValue(
			page === "home"
				? SWITCH_PROJECT_COMMAND_VALUE
				: firstSwitcherCommandValue,
		);
	}, [firstSwitcherCommandValue, open, page]);

	const openErrorMessage = (openMutation.error as Error | null)?.message;
	const closeErrorMessage = (closeMutation.error as Error | null)?.message;
	const navigationError =
		openErrorMessage || closeErrorMessage || folderPickerError;

	const openMenu = (targetPage: CommandPage) => {
		if (!isMutating) {
			setPage(targetPage);
			setOpen(true);
		}
	};

	const handleOpenChange = (nextOpen: boolean) => {
		setOpen(nextOpen);
		if (!nextOpen) {
			setPage("home");
		}
	};

	const handleMenuKeyDown = (event: KeyboardEvent) => {
		if (
			event.key === "ArrowDown" ||
			event.key === "ArrowUp" ||
			event.key === "Home" ||
			event.key === "End"
		) {
			setKeyboardSelectionActive(true);
		}

		if (event.key !== "Escape" || page !== "switcher") {
			return;
		}

		event.preventDefault();
		event.stopPropagation();
		setPage("home");
	};

	useHotkey(
		"Mod+K",
		() => {
			if (open) {
				setOpen(false);
			} else {
				openMenu("home");
			}
		},
		{ preventDefault: true },
	);

	useHotkey(
		"Mod+P",
		() => {
			if (open) {
				setPage("switcher");
			} else {
				openMenu("switcher");
			}
		},
		{ preventDefault: true },
	);

	useHotkey(
		"Mod+Shift+N",
		() => {
			setOpen(false);
			setCreateSystemDialogOpen(true);
		},
		{ preventDefault: true },
	);

	const openProjectAtPath = (targetPath: string) => {
		setFolderPickerError(null);
		openMutation.mutate(targetPath);
	};

	const handleOpenAnotherFolder = async () => {
		setFolderPickerError(null);
		setOpen(false);

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

	const handleCloseProject = () => {
		setOpen(false);
		postCloseDestinationRef.current = "/";
		closeMutation.mutate();
	};

	const handleCreateNewProject = () => {
		setOpen(false);
		postCloseDestinationRef.current = "/new";
		closeMutation.mutate();
	};

	const handleCreateNewSystem = () => {
		setOpen(false);
		setCreateSystemDialogOpen(true);
	};

	const handlePathSubmit = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		const nextPath = path.trim();
		if (!nextPath || openMutation.isPending) return;
		openProjectAtPath(nextPath);
	};

	const footerLabel = page === "switcher" ? "Project switcher" : null;

	return (
		<>
			{navigationError ? (
				<div className="mt-1 w-fit bg-red-500 px-2 py-1 text-xs text-white">
					{navigationError}
				</div>
			) : null}

			<BaseUiDialog.Root open={open} onOpenChange={handleOpenChange}>
				<BaseUiDialog.Portal>
					<BaseUiDialog.Backdrop className="fixed inset-0 bg-slate-950/70 transition-opacity duration-150 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
					<BaseUiDialog.Popup
						aria-label={
							page === "switcher" ? "Project switcher" : "Command menu"
						}
						initialFocus={inputRef}
						onKeyDownCapture={handleMenuKeyDown}
						className="fixed top-24 left-1/2 w-[640px] -translate-x-1/2 shadow-2xl outline-none transition-all duration-150 data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0"
					>
						{/* Key remounts CommandRoot to clear search on page change */}
						{/* disablePointerSelection keeps pointer hover as CSS :hover
						    while keyboard nav drives aria-selected styling. */}
						<CommandRoot
							key={`${open}-${page}`}
							value={selectedCommandValue}
							onValueChange={setSelectedCommandValue}
							loop
							disablePointerSelection
							data-keyboard-selection={keyboardSelectionActive}
						>
							<CommandInput
								ref={inputRef}
								placeholder={
									page === "switcher" ? "Search projects…" : "Search commands…"
								}
							/>

							<CommandList>
								<CommandEmpty>No results found.</CommandEmpty>

								{page === "home" ? (
									<>
										<CommandGroup>
											<CommandGroupLabel>Projects</CommandGroupLabel>

											<CommandItem
												value={SWITCH_PROJECT_COMMAND_VALUE}
												onSelect={() => setPage("switcher")}
											>
												<Folders
													className="size-4 shrink-0 text-slate-500"
													aria-hidden="true"
												/>
												<span data-item-name="" className="flex-1 text-sm">
													Switch project
												</span>
												<span
													data-item-secondary=""
													className="shrink-0 font-mono text-[10px] text-slate-400"
												>
													⌘P
												</span>
											</CommandItem>

											<CommandItem
												value={OPEN_ANOTHER_FOLDER_COMMAND_VALUE}
												onSelect={handleOpenAnotherFolder}
											>
												<FolderPlus
													className="size-4 shrink-0 text-slate-500"
													aria-hidden="true"
												/>
												<span data-item-name="" className="flex-1 text-sm">
													Open another folder…
												</span>
												<span
													data-item-secondary=""
													className="shrink-0 font-mono text-[10px] text-slate-400"
												>
													⌘O
												</span>
											</CommandItem>

											<CommandItem
												value={CREATE_NEW_PROJECT_COMMAND_VALUE}
												onSelect={handleCreateNewProject}
											>
												<Plus
													className="size-4 shrink-0 text-slate-500"
													aria-hidden="true"
												/>
												<span data-item-name="" className="flex-1 text-sm">
													Create new project…
												</span>
												<span
													data-item-secondary=""
													className="shrink-0 font-mono text-[10px] text-slate-400"
												>
													⌘N
												</span>
											</CommandItem>

											<CommandItem
												value="Close current project"
												onSelect={handleCloseProject}
											>
												<X
													className="size-4 shrink-0 text-slate-500"
													aria-hidden="true"
												/>
												<span data-item-name="" className="flex-1 text-sm">
													Close current project
												</span>
											</CommandItem>
										</CommandGroup>
										<CommandGroup>
											<CommandGroupLabel>Systems</CommandGroupLabel>

											<CommandItem
												value={CREATE_NEW_SYSTEM_COMMAND_VALUE}
												onSelect={handleCreateNewSystem}
											>
												<FileCode2
													className="size-4 shrink-0 text-slate-500"
													aria-hidden="true"
												/>
												<span data-item-name="" className="flex-1 text-sm">
													Create new system…
												</span>
												<span
													data-item-secondary=""
													className="shrink-0 font-mono text-[10px] text-slate-400"
												>
													⌘⇧N
												</span>
											</CommandItem>
										</CommandGroup>
									</>
								) : (
									<CommandGroup>
										<CommandGroupLabel>Recent projects</CommandGroupLabel>

										{/**
											{activeProject ? (
												<CommandItem
													value={currentProjectName}
													keywords={[currentProjectRoot]}
													disabled
												>
													<Folder
														className="size-4 shrink-0 text-slate-500"
														aria-hidden="true"
													/>
													<span className="flex min-w-0 flex-1 flex-col">
														<span data-item-name="" className="truncate text-sm">
															{currentProjectName}
														</span>
														<span
															data-item-secondary=""
															className="truncate font-mono text-[10px] text-slate-500"
														>
															{currentProjectRoot}
														</span>
													</span>
													<span className="shrink-0 font-mono text-[10px] text-cyan-700">
														current
													</span>
												</CommandItem>
											) : null}
										*/}

										{otherRecentProjects.map((project) => (
											<CommandItem
												key={`${project.projectId}-${project.locationId}`}
												value={project.name}
												keywords={[project.projectRoot]}
												onSelect={() => {
													setOpen(false);
													openProjectAtPath(project.projectRoot);
												}}
											>
												<Folder
													className="size-4 shrink-0 text-slate-500"
													aria-hidden="true"
												/>
												<span className="flex min-w-0 flex-1 flex-col">
													<span data-item-name="" className="truncate text-sm">
														{project.name}
													</span>
													<span
														data-item-secondary=""
														className="truncate font-mono text-[10px] text-slate-500"
													>
														{project.projectRoot}
													</span>
												</span>
												<CornerDownLeft
													data-item-arrow=""
													className="size-3.5 shrink-0 text-cyan-700 opacity-0"
													aria-hidden="true"
												/>
											</CommandItem>
										))}

										<CommandSeparator />

										<CommandItem
											value={OPEN_ANOTHER_FOLDER_COMMAND_VALUE}
											onSelect={handleOpenAnotherFolder}
										>
											<FolderPlus
												className="size-4 shrink-0 text-slate-500"
												aria-hidden="true"
											/>
											<span data-item-name="" className="flex-1 text-sm">
												Open another folder…
											</span>
											<span
												data-item-secondary=""
												className="shrink-0 font-mono text-[10px] text-slate-400"
											>
												⌘O
											</span>
										</CommandItem>

										<CommandItem
											value={CREATE_NEW_PROJECT_COMMAND_VALUE}
											onSelect={handleCreateNewProject}
										>
											<Plus
												className="size-4 shrink-0 text-slate-500"
												aria-hidden="true"
											/>
											<span data-item-name="" className="flex-1 text-sm">
												Create new project…
											</span>
											<span
												data-item-secondary=""
												className="shrink-0 font-mono text-[10px] text-slate-400"
											>
												⌘N
											</span>
										</CommandItem>
									</CommandGroup>
								)}
							</CommandList>

							<CommandFooter>
								<CommandFooterLeft>
									<CommandFooterHint>
										<CommandKeyBadge>↑↓</CommandKeyBadge>
										<span>navigate</span>
									</CommandFooterHint>
									<CommandFooterHint>
										<CommandKeyBadge>↵</CommandKeyBadge>
										<span>open</span>
									</CommandFooterHint>
									<CommandFooterHint>
										<CommandKeyBadge>esc</CommandKeyBadge>
										<span>{page === "switcher" ? "back" : "close"}</span>
									</CommandFooterHint>
								</CommandFooterLeft>
								{footerLabel ? (
									<CommandFooterRight>
										<span>{footerLabel}</span>
									</CommandFooterRight>
								) : null}
							</CommandFooter>
						</CommandRoot>
					</BaseUiDialog.Popup>
				</BaseUiDialog.Portal>
			</BaseUiDialog.Root>

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
									{openMutation.isPending ? "Opening…" : "Open"}
								</Button>
							</div>
						</form>
					</DialogContent>
				</DialogPortal>
			</Dialog>
			<CreateSystemDialog
				open={createSystemDialogOpen}
				onOpenChange={setCreateSystemDialogOpen}
			/>
		</>
	);
}
