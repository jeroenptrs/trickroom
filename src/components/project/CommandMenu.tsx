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
	Settings2,
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
import { toast } from "sonner";
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
import { openMcpToolSettings } from "../AppDialogHost";
import { Alert } from "../ui/alert";
import { Button } from "../ui/button";
import {
	CommandDialogBackdrop,
	CommandDialogPopup,
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
import { Kbd } from "../ui/kbd";
import { Separator } from "../ui/separator";
import { CreateSystemDialog } from "./CreateSystemDialog";

type CommandPage = "home" | "switcher";
const NO_COMMAND_SELECTION = "__trickroom_no_command_selection__";
const SWITCH_PROJECT_COMMAND_VALUE = "Switch project";
const OPEN_ANOTHER_FOLDER_COMMAND_VALUE = "Open another folder";
const CREATE_NEW_PROJECT_COMMAND_VALUE = "Create new project";
const CREATE_NEW_SYSTEM_COMMAND_VALUE = "Add system";
const MCP_TOOLS_COMMAND_VALUE = "MCP tools";

/** Router state for `/new` when the menu closed a project to create one. */
export type CreateProjectRouteState = { reopenProjectPath?: string };

export function CommandMenu() {
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
	const [pathError, setPathError] = useState<string | null>(null);
	const postCloseDestinationRef = useRef<{
		path: string;
		state?: CreateProjectRouteState;
	}>({ path: "/" });
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
		const destination = postCloseDestinationRef.current;
		navigate(destination.path, { replace: true, state: destination.state });
		postCloseDestinationRef.current = { path: "/" };
	};

	const openMutation = useMutation({
		mutationFn: (targetPath: string) => openProject({ path: targetPath }),
		onSuccess: async () => {
			setPathDialogOpen(false);
			setPath("");
			setPathError(null);
			await refreshProjectQueries();
		},
	});

	const closeMutation = useMutation({
		mutationFn: closeProject,
		onSuccess: refreshProjectQueries,
		onError: (error) => {
			postCloseDestinationRef.current = { path: "/" };
			toast.error("Could not close the project", {
				description: error instanceof Error ? error.message : undefined,
			});
		},
	});

	const isMutating = openMutation.isPending || closeMutation.isPending;

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

	// A switch from the menu has no dialog to hold its error, so it toasts.
	const switchToProject = (project: { name: string; projectRoot: string }) => {
		openMutation.mutate(project.projectRoot, {
			onError: (error) => {
				toast.error(`Could not open ${project.name}`, {
					description: error instanceof Error ? error.message : undefined,
				});
			},
		});
	};

	const handleOpenAnotherFolder = () => {
		setOpen(false);
		openMutation.reset();
		setPathError(null);
		setPathDialogOpen(true);
	};

	const handleCloseProject = () => {
		setOpen(false);
		postCloseDestinationRef.current = { path: "/" };
		closeMutation.mutate();
	};

	// The create form needs no open project. Cancel there reopens this one.
	const handleCreateNewProject = () => {
		setOpen(false);
		postCloseDestinationRef.current = {
			path: "/new",
			state: currentProjectRoot
				? { reopenProjectPath: currentProjectRoot }
				: undefined,
		};
		closeMutation.mutate();
	};

	const handleOpenMcpTools = () => {
		setOpen(false);
		openMcpToolSettings();
	};

	const handleCreateNewSystem = () => {
		setOpen(false);
		setCreateSystemDialogOpen(true);
	};

	const handlePathSubmit = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		const nextPath = path.trim();
		if (openMutation.isPending) return;
		if (!nextPath) {
			setPathError("Enter the project folder.");
			return;
		}
		openMutation.mutate(nextPath);
	};

	const footerLabel = page === "switcher" ? "Project switcher" : null;

	return (
		<>
			<Button
				type="button"
				variant="outlined"
				className="flex items-center gap-2"
				disabled={isMutating}
				aria-keyshortcuts="Meta+P"
				onClick={() => openMenu("switcher")}
			>
				Switch project
				<Kbd aria-hidden="true">⌘P</Kbd>
			</Button>

			<BaseUiDialog.Root open={open} onOpenChange={handleOpenChange}>
				<BaseUiDialog.Portal>
					<CommandDialogBackdrop />
					<CommandDialogPopup
						data-shortcuts-disabled=""
						aria-label={
							page === "switcher" ? "Project switcher" : "Command menu"
						}
						initialFocus={inputRef}
						onKeyDownCapture={handleMenuKeyDown}
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
								<CommandEmpty>No matching commands</CommandEmpty>

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
													Add system…
												</span>
												<span
													data-item-secondary=""
													className="shrink-0 font-mono text-[10px] text-slate-400"
												>
													⌘⇧N
												</span>
											</CommandItem>
										</CommandGroup>
										<CommandGroup>
											<CommandGroupLabel>Agents</CommandGroupLabel>

											<CommandItem
												value={MCP_TOOLS_COMMAND_VALUE}
												onSelect={handleOpenMcpTools}
											>
												<Settings2
													className="size-4 shrink-0 text-slate-500"
													aria-hidden="true"
												/>
												<span data-item-name="" className="flex-1 text-sm">
													MCP tools…
												</span>
												<span
													data-item-secondary=""
													className="shrink-0 font-mono text-[10px] text-slate-400"
												>
													⌘,
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
													switchToProject(project);
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
										</CommandItem>
									</CommandGroup>
								)}
							</CommandList>

							<CommandFooter>
								<CommandFooterLeft>
									<CommandFooterHint>
										<CommandKeyBadge>↑↓</CommandKeyBadge>
										<span>Navigate</span>
									</CommandFooterHint>
									<CommandFooterHint>
										<CommandKeyBadge>↵</CommandKeyBadge>
										<span>Open</span>
									</CommandFooterHint>
									<CommandFooterHint>
										<CommandKeyBadge>esc</CommandKeyBadge>
										<span>{page === "switcher" ? "Back" : "Close"}</span>
									</CommandFooterHint>
								</CommandFooterLeft>
								{footerLabel ? (
									<CommandFooterRight>
										<span>{footerLabel}</span>
									</CommandFooterRight>
								) : null}
							</CommandFooter>
						</CommandRoot>
					</CommandDialogPopup>
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
								onChange={(event) => {
									setPath(event.target.value);
									if (pathError && event.target.value.trim()) {
										setPathError(null);
									}
								}}
								error={pathError}
								disabled={openMutation.isPending}
							/>
							{openErrorMessage ? (
								<Alert variant="panel">
									Could not open {path.trim()}: {openErrorMessage}
								</Alert>
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
									disabled={openMutation.isPending}
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
