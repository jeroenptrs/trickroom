import { Dialog as BaseUiDialog } from "@base-ui/react/dialog";
import { useHotkey } from "@tanstack/react-hotkeys";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
	CornerDownLeft,
	FileCode2,
	Folder,
	FolderPlus,
	Folders,
	GitBranch,
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
import { toast } from "sonner";
import {
	closeProject,
	openProject,
	sessionQueryOptions,
} from "../../queries/projects";
import {
	getCheckoutLabel,
	workspaceQueryOptions,
} from "../../queries/workspace";
import { openCheckoutInTab } from "../../utils/tab-location";
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
import { Tooltip } from "../ui/tooltip";
import { CreateSystemDialog } from "./CreateSystemDialog";

type CommandPage = "home" | "switcher";
const NO_COMMAND_SELECTION = "__trickroom_no_command_selection__";
const SWITCH_PROJECT_COMMAND_VALUE = "Switch project";
const OPEN_ANOTHER_FOLDER_COMMAND_VALUE = "Open another folder";
const CREATE_NEW_PROJECT_COMMAND_VALUE = "Create new project";
const CREATE_NEW_SYSTEM_COMMAND_VALUE = "Add system";
const MCP_TOOLS_COMMAND_VALUE = "MCP tools";

// Unique per checkout: several checkouts share a project name.
const getCheckoutCommandValue = (locationId: string) =>
	`checkout ${locationId}`;

export function CommandMenu() {
	const sessionQuery = useQuery(sessionQueryOptions());
	const activeProject = sessionQuery.data?.activeProject;
	const workspaceQuery = useQuery(workspaceQueryOptions());

	const [open, setOpen] = useState(false);
	const [page, setPage] = useState<CommandPage>("home");
	const [selectedCommandValue, setSelectedCommandValue] =
		useState(NO_COMMAND_SELECTION);
	const [keyboardSelectionActive, setKeyboardSelectionActive] = useState(false);
	const [pathDialogOpen, setPathDialogOpen] = useState(false);
	const [createSystemDialogOpen, setCreateSystemDialogOpen] = useState(false);
	const [path, setPath] = useState("");
	const [pathError, setPathError] = useState<string | null>(null);
	const inputRef = useRef<HTMLInputElement>(null);

	// Refocus the search input whenever the dialog opens.
	useEffect(() => {
		if (!open) return;
		const id = setTimeout(() => inputRef.current?.focus(), 0);
		return () => clearTimeout(id);
	}, [open]);

	const openMutation = useMutation({
		mutationFn: (targetPath: string) => openProject({ path: targetPath }),
		// The tab loads the other checkout under its own URL. Tabs that show
		// this one keep it.
		onSuccess: (response) => openCheckoutInTab(response.project.locationId),
	});

	const closeMutation = useMutation({
		mutationFn: closeProject,
		onSuccess: () => window.location.assign("/"),
		onError: (error) => {
			toast.error("Could not close the project", {
				description: error instanceof Error ? error.message : undefined,
			});
		},
	});

	const isMutating = openMutation.isPending || closeMutation.isPending;

	const currentLocationId = activeProject?.locationId;
	const workspaceProjects = workspaceQuery.data?.projects ?? [];
	const currentCheckout = workspaceProjects
		.flatMap((project) => project.checkouts)
		.find((checkout) => checkout.locationId === currentLocationId);
	const currentBranchLabel = currentCheckout
		? getCheckoutLabel(currentCheckout)
		: null;
	// The open project first, so its other branches are one keystroke away.
	// The open checkout itself is left out.
	const switcherGroups = workspaceProjects
		.map((project) => ({
			...project,
			isCurrent: project.projectId === activeProject?.projectId,
			checkouts: project.checkouts.filter(
				(checkout) => checkout.locationId !== currentLocationId,
			),
		}))
		.filter((project) => project.checkouts.length > 0)
		.sort((a, b) => Number(b.isCurrent) - Number(a.isCurrent));
	const firstSwitcherCheckout = switcherGroups[0]?.checkouts[0];
	const firstSwitcherCommandValue = firstSwitcherCheckout
		? getCheckoutCommandValue(firstSwitcherCheckout.locationId)
		: OPEN_ANOTHER_FOLDER_COMMAND_VALUE;

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
		closeMutation.mutate();
	};

	// The create form is outside any checkout. Cancel there comes back here.
	const handleCreateNewProject = () => {
		setOpen(false);
		window.location.assign(
			currentLocationId
				? `/new?reopen=${encodeURIComponent(currentLocationId)}`
				: "/new",
		);
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

	const footerLabel =
		page === "switcher" ? "Project and branch switcher" : null;

	return (
		<>
			{currentBranchLabel ? (
				<Tooltip content="Switch project or branch">
					<Button
						type="button"
						variant="outlined"
						className="flex items-center gap-2"
						disabled={isMutating}
						aria-keyshortcuts="Meta+P"
						aria-label={`Switch project or branch. Open: ${currentBranchLabel}`}
						onClick={() => openMenu("switcher")}
					>
						<GitBranch
							className="size-3.5 shrink-0 text-slate-500"
							aria-hidden="true"
						/>
						<span className="max-w-56 truncate font-mono text-xs">
							{currentBranchLabel}
						</span>
						<Kbd aria-hidden="true">⌘P</Kbd>
					</Button>
				</Tooltip>
			) : (
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
			)}

			<BaseUiDialog.Root open={open} onOpenChange={handleOpenChange}>
				<BaseUiDialog.Portal>
					<CommandDialogBackdrop />
					<CommandDialogPopup
						data-shortcuts-disabled=""
						aria-label={
							page === "switcher"
								? "Project and branch switcher"
								: "Command menu"
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
									page === "switcher"
										? "Search projects and branches…"
										: "Search commands…"
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
													Switch project or branch
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
									<>
										{switcherGroups.map((project) => (
											<CommandGroup key={project.projectId}>
												<CommandGroupLabel>{project.name}</CommandGroupLabel>

												{project.checkouts.map((checkout) => {
													const label = getCheckoutLabel(checkout);
													return (
														<CommandItem
															key={checkout.locationId}
															value={getCheckoutCommandValue(
																checkout.locationId,
															)}
															keywords={[
																project.name,
																label,
																checkout.projectRoot,
															]}
															onSelect={() => {
																setOpen(false);
																switchToProject({
																	name: `${project.name} on ${label}`,
																	projectRoot: checkout.projectRoot,
																});
															}}
														>
															{checkout.branch || checkout.detachedHead ? (
																<GitBranch
																	className="size-4 shrink-0 text-slate-500"
																	aria-hidden="true"
																/>
															) : (
																<Folder
																	className="size-4 shrink-0 text-slate-500"
																	aria-hidden="true"
																/>
															)}
															<span className="flex min-w-0 flex-1 flex-col">
																<span
																	data-item-name=""
																	className="truncate text-sm"
																>
																	{label}
																</span>
																<span
																	data-item-secondary=""
																	className="truncate font-mono text-[10px] text-slate-500"
																>
																	{checkout.projectRoot}
																</span>
															</span>
															<CornerDownLeft
																data-item-arrow=""
																className="size-3.5 shrink-0 text-cyan-700 opacity-0"
																aria-hidden="true"
															/>
														</CommandItem>
													);
												})}
											</CommandGroup>
										))}

										<CommandSeparator />

										<CommandGroup>
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
									</>
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
