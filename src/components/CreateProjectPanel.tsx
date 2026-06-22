import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FilePlus2, FolderPlus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { getTrickroomDesktopApi } from "../desktop-api";
import {
	configFileQueryKey,
	configFileQueryOptions,
	createConfigFile,
} from "../queries/config-file";
import {
	openProject,
	sessionQueryKey,
	sessionQueryOptions,
} from "../queries/projects";
import { systemsQueryKey } from "../queries/systems";
import { HttpError } from "../utils/readJsonOrThrow";
import { Alert } from "./ui/alert";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { InputGroup, InputGroupButton } from "./ui/input-group";
import { Text } from "./ui/text";
import Checkbox from "./ui/checkbox";

const systemNamePattern = /^[A-Za-z0-9_@-]+$/;

export function CreateProjectPanel() {
	const [name, setName] = useState("");
	const [projectFolder, setProjectFolder] = useState("");
	const [folderPickerError, setFolderPickerError] = useState<string | null>(
		null,
	);
	const [isPickingFolder, setIsPickingFolder] = useState(false);
	const [systemName, setSystemName] = useState("");
	const [systemCssPath, setSystemCssPath] = useState("");
	const [setSystemAsDefault, setSetSystemAsDefault] = useState(true);
	const [cssPickerError, setCssPickerError] = useState<string | null>(null);
	const [isPickingCss, setIsPickingCss] = useState(false);
	const [showSystem, setShowSystem] = useState(false);
	const nameInputRef = useRef<HTMLInputElement>(null);
	const desktopApi = getTrickroomDesktopApi();
	const queryClient = useQueryClient();
	const navigate = useNavigate();
	const configQuery = useQuery(configFileQueryOptions());
	const sessionQuery = useQuery(sessionQueryOptions());

	const isNoProjectCreate =
		configQuery.isError &&
		configQuery.error instanceof HttpError &&
		configQuery.error.status === 409;
	const hasActiveConfig = configQuery.isSuccess;
	const hasPartialSystemLink =
		Boolean(systemName.trim()) !== Boolean(systemCssPath.trim());
	const hasInvalidSystemName =
		Boolean(systemName.trim()) && !systemNamePattern.test(systemName.trim());

	const cssPickerProjectRoot = isNoProjectCreate
		? projectFolder.trim()
		: (sessionQuery.data?.activeProject?.projectRoot ?? "");
	const canPickCss = Boolean(desktopApi) && Boolean(cssPickerProjectRoot);

	const createProjectMutation = useMutation({
		mutationFn: () => {
			const trimmedSystemName = systemName.trim();
			const trimmedSystemCssPath = systemCssPath.trim();
			const config = {
				name: name.trim(),
				...(trimmedSystemName && trimmedSystemCssPath
					? {
							systems: { [trimmedSystemName]: trimmedSystemCssPath },
							...(setSystemAsDefault
								? { defaultSystemName: trimmedSystemName }
								: {}),
						}
					: {}),
			};

			if (isNoProjectCreate) {
				return openProject({
					path: projectFolder.trim(),
					config,
				});
			}

			return createConfigFile(config);
		},
		onSuccess: async () => {
			await queryClient.invalidateQueries({ queryKey: configFileQueryKey });
			await queryClient.invalidateQueries({ queryKey: sessionQueryKey });
			await queryClient.invalidateQueries({ queryKey: systemsQueryKey });
			navigate("/", { replace: true });
		},
	});

	useEffect(() => {
		if (configQuery.isError) {
			nameInputRef.current?.focus();
		}
	}, [configQuery.isError]);

	useEffect(() => {
		if (hasActiveConfig) {
			navigate("/", { replace: true });
		}
	}, [hasActiveConfig, navigate]);

	const handleCreate = () => {
		if (hasPartialSystemLink || hasInvalidSystemName) {
			return;
		}
		createProjectMutation.mutate();
	};

	const handleToggleSystem = () => {
		setShowSystem((shown) => {
			if (shown) {
				setSystemName("");
				setSystemCssPath("");
				setSetSystemAsDefault(true);
				setCssPickerError(null);
			}
			return !shown;
		});
	};

	const handlePickProjectFolder = async () => {
		if (!desktopApi || isPickingFolder || createProjectMutation.isPending) {
			return;
		}

		setFolderPickerError(null);
		setIsPickingFolder(true);
		try {
			const result = await desktopApi.pickProjectFolder();
			if (!result.canceled) {
				setProjectFolder(result.path);
			}
		} catch (error) {
			setFolderPickerError(
				error instanceof Error ? error.message : "Failed to choose folder.",
			);
		} finally {
			setIsPickingFolder(false);
		}
	};

	const handlePickCssFile = async () => {
		if (
			!desktopApi ||
			isPickingCss ||
			createProjectMutation.isPending ||
			!canPickCss
		) {
			return;
		}

		setCssPickerError(null);
		setIsPickingCss(true);
		try {
			const result = await desktopApi.pickCssFile(cssPickerProjectRoot);
			if (!result.canceled) {
				setSystemCssPath(result.relativePath);
			}
		} catch (error) {
			setCssPickerError(
				error instanceof Error ? error.message : "Failed to choose CSS file.",
			);
		} finally {
			setIsPickingCss(false);
		}
	};

	const createErrorMessage = (createProjectMutation.error as Error | null)
		?.message;
	const inputsDisabled =
		createProjectMutation.isPending || configQuery.isPending;
	const submitDisabled =
		createProjectMutation.isPending ||
		configQuery.isPending ||
		!name.trim() ||
		(isNoProjectCreate && !projectFolder.trim()) ||
		hasPartialSystemLink ||
		hasInvalidSystemName;

	return (
		<div className="flex flex-1 flex-col">
			<div className="flex min-h-20 flex-col justify-center gap-1 border-b border-slate-200 px-8">
				<Text variant="eyebrow">New project</Text>
				<Text
					variant="title"
					tone="foreground"
					className="text-xl tracking-tight"
				>
					Create project
				</Text>
			</div>

			<div className="flex flex-1 flex-col gap-6 px-8 py-6">
				<div className="flex flex-col gap-4">
					<div className="flex items-center gap-2">
						<span className="flex size-5 shrink-0 items-center justify-center bg-slate-950 font-mono text-[10px] text-slate-50">
							1
						</span>
						<Text tone="foreground" className="text-sm font-semibold">
							Project
						</Text>
					</div>

					<div className="flex flex-col gap-1.5">
						<Text variant="label" tone="foreground">
							Project name
						</Text>
						<Input
							ref={nameInputRef}
							type="text"
							variant="form"
							aria-label="Project name"
							placeholder="acme-dashboard"
							value={name}
							onChange={(event) => setName(event.target.value)}
							disabled={inputsDisabled}
						/>
					</div>

					{isNoProjectCreate ? (
						<div className="flex flex-col gap-1.5">
							<Text variant="label" tone="foreground">
								Location
							</Text>
							<InputGroup icon={FolderPlus}>
								<Input
									type="text"
									variant="formEmbedded"
									aria-label="Project folder"
									placeholder="/absolute/path/to/project"
									value={projectFolder}
									onChange={(event) => setProjectFolder(event.target.value)}
									disabled={inputsDisabled}
									className="min-w-0 flex-1 truncate"
								/>
								{desktopApi ? (
									<InputGroupButton
										disabled={inputsDisabled || isPickingFolder}
										onClick={handlePickProjectFolder}
									>
										{isPickingFolder ? "Browsing" : "Browse"}
									</InputGroupButton>
								) : null}
							</InputGroup>
						</div>
					) : null}
				</div>

				<div className="flex flex-col gap-2 border-t border-slate-200 pt-5">
					<div className="flex items-center justify-between">
						<div className="flex items-center gap-2">
							<span className="flex size-5 shrink-0 items-center justify-center font-mono text-[10px] text-slate-500 inset-shadow-[0_0_0_1px] inset-shadow-slate-200">
								2
							</span>
							<Text tone="foreground" className="text-sm font-semibold">
								Design system
							</Text>
						</div>
						<Button type="button" variant="link" onClick={handleToggleSystem}>
							{showSystem ? "Remove" : "Add +"}
						</Button>
					</div>

					{showSystem ? (
						<div className="flex flex-col gap-2 pl-7">
							<div className="flex flex-col gap-1.5">
								<Text variant="label" tone="foreground">
									System name
								</Text>
								<Input
									type="text"
									variant="form"
									aria-label="Design system name"
									placeholder="System name"
									value={systemName}
									onChange={(event) => setSystemName(event.target.value)}
									pattern={systemNamePattern.source}
									aria-invalid={hasInvalidSystemName}
									disabled={inputsDisabled}
								/>
							</div>
							<div className="flex flex-col gap-1.5">
								<Text variant="label" tone="foreground">
									CSS file
								</Text>
								<InputGroup icon={FilePlus2}>
									<Input
										type="text"
										variant="formEmbedded"
										aria-label="Design system CSS file"
										placeholder="src/index.css"
										value={systemCssPath}
										onChange={(event) => setSystemCssPath(event.target.value)}
										disabled={inputsDisabled}
										className="min-w-0 flex-1 truncate"
									/>
									{desktopApi ? (
										<InputGroupButton
											disabled={inputsDisabled || isPickingCss || !canPickCss}
											onClick={handlePickCssFile}
											title={
												!canPickCss
													? "Browse for a project folder first."
													: undefined
											}
										>
											{isPickingCss ? "Browsing" : "Browse"}
										</InputGroupButton>
									) : null}
								</InputGroup>
							</div>
							<Text tone="muted" className="text-[11px]">
								Optional. Path is relative to the project folder — e.g.{" "}
								<code className="font-mono">src/index.css</code>.
							</Text>
							{systemName.trim() && systemCssPath.trim() ? (
								<label
									htmlFor="create-project-panel-default-system"
									className="flex items-start gap-3"
								>
									<Checkbox
										id="create-project-panel-default-system"
										checked={setSystemAsDefault}
										onCheckedChange={(checked) =>
											setSetSystemAsDefault(checked === true)
										}
										disabled={inputsDisabled}
									/>
									<span className="flex min-w-0 flex-col gap-0.5">
										<Text variant="label" tone="foreground">
											Set as default system
										</Text>
										<Text tone="muted" className="text-[11px]">
											New designs will automatically link to this system.
										</Text>
									</span>
								</label>
							) : null}
							{hasPartialSystemLink ? (
								<Alert variant="inline">
									Provide both a design system name and CSS path, or leave both
									empty.
								</Alert>
							) : null}
							{hasInvalidSystemName ? (
								<Alert variant="inline">
									Use only letters, numbers, dashes, underscores, and at-signs
									in the design system name.
								</Alert>
							) : null}
							{cssPickerError ? (
								<Alert variant="inline">{cssPickerError}</Alert>
							) : null}
						</div>
					) : (
						<Text tone="muted" className="pl-7 font-mono text-[10px]">
							Link a Tailwind CSS file now, or add one after the project exists.
						</Text>
					)}
				</div>

				{folderPickerError ? (
					<Alert variant="panel">{folderPickerError}</Alert>
				) : null}
				{createProjectMutation.isError ? (
					<Alert variant="panel">
						Failed to create project: {createErrorMessage}
					</Alert>
				) : null}
			</div>

			<div className="flex items-center justify-between border-t border-slate-200 px-8 py-4">
				<Text
					tone="faint"
					className="font-mono text-[10px] uppercase tracking-wider"
				>
					Step {showSystem ? "2" : "1"} of 2
				</Text>
				<div className="flex items-center gap-2">
					<Button
						type="button"
						variant="ghost"
						onClick={() => navigate("/")}
						disabled={createProjectMutation.isPending}
					>
						Cancel
					</Button>
					<Button
						type="button"
						variant="filled"
						onClick={handleCreate}
						disabled={submitDisabled}
					>
						{createProjectMutation.isPending ? "Creating…" : "Create project"}
					</Button>
				</div>
			</div>
		</div>
	);
}
