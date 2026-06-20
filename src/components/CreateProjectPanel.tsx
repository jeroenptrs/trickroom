import { Fieldset } from "@base-ui/react/fieldset";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FilePlus2, FolderPlus, Plus } from "lucide-react";
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
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Text } from "./ui/text";

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
	const [cssPickerError, setCssPickerError] = useState<string | null>(null);
	const [isPickingCss, setIsPickingCss] = useState(false);
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
			const config = {
				name: name.trim(),
				...(systemName.trim() && systemCssPath.trim()
					? { systems: { [systemName.trim()]: systemCssPath.trim() } }
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
		<div className="flex flex-1 flex-col gap-5 px-8 pt-4 pb-8">
			<div>
				<Text variant="title" className="text-lg">
					Start a new Trickroom project
				</Text>
				<Text className="mt-1 block text-sm text-slate-700">
					{isNoProjectCreate
						? "Point Trickroom at the folder for your project and, if you have one, link your Tailwind design system."
						: "Trickroom will create the metadata for the open folder. Link a Tailwind design system if you have one."}
				</Text>
			</div>

			<div className="flex flex-col gap-5">
				<Fieldset.Root className="flex flex-col gap-2 border-none p-0 m-0 min-w-0">
					<Fieldset.Legend
						render={<Text variant="label" />}
						className="text-xs font-semibold text-slate-950"
					>
						Project
					</Fieldset.Legend>
					<div
						className={`grid gap-2 ${isNoProjectCreate ? "grid-cols-[minmax(0,12rem)_minmax(0,1fr)]" : "grid-cols-1"}`}
					>
						<Input
							ref={nameInputRef}
							type="text"
							variant="form"
							aria-label="Project name"
							placeholder="Project name"
							value={name}
							onChange={(event) => setName(event.target.value)}
							disabled={inputsDisabled}
						/>
						{isNoProjectCreate ? (
							<div className="group flex min-w-0 items-stretch inset-shadow-[0_0_0_1px] inset-shadow-slate-200 focus-within:inset-shadow-cyan-500">
								<FolderPlus
									className="ml-2 size-4 shrink-0 self-center text-slate-600 group-focus-within:text-cyan-900"
									aria-hidden="true"
								/>
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
									<Button
										type="button"
										variant="block"
										className="shrink-0 inset-shadow-[1px_0_0_0] inset-shadow-slate-200 group-focus-within:inset-shadow-cyan-500 not-disabled:hover:inset-shadow-[0_0_0_1px] not-disabled:active:inset-shadow-[0_0_0_1px] not-disabled:active:inset-shadow-cyan-500"
										disabled={inputsDisabled || isPickingFolder}
										onClick={handlePickProjectFolder}
									>
										{isPickingFolder ? "Browsing" : "Browse"}
									</Button>
								) : null}
							</div>
						) : null}
					</div>
				</Fieldset.Root>

				<Fieldset.Root className="flex flex-col gap-2 border-none p-0 m-0 min-w-0">
					<Fieldset.Legend
						render={<Text variant="label" />}
						className="text-xs font-semibold text-slate-950"
					>
						Design system
					</Fieldset.Legend>
					<div className="grid gap-2 grid-cols-[minmax(0,12rem)_minmax(0,1fr)]">
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
						<div className="group flex min-w-0 items-stretch inset-shadow-[0_0_0_1px] inset-shadow-slate-200 focus-within:inset-shadow-cyan-500">
							<FilePlus2
								className="ml-2 size-4 shrink-0 self-center text-slate-600 group-focus-within:text-cyan-900"
								aria-hidden="true"
							/>
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
								<Button
									type="button"
									variant="block"
									className="shrink-0 inset-shadow-[1px_0_0_0] inset-shadow-slate-200 group-focus-within:inset-shadow-cyan-500 not-disabled:hover:inset-shadow-[0_0_0_1px] not-disabled:active:inset-shadow-[0_0_0_1px] not-disabled:active:inset-shadow-cyan-500"
									disabled={inputsDisabled || isPickingCss || !canPickCss}
									onClick={handlePickCssFile}
									title={
										!canPickCss
											? "Browse for a project folder first."
											: undefined
									}
								>
									{isPickingCss ? "Browsing" : "Browse"}
								</Button>
							) : null}
						</div>
					</div>
					<Text className="text-[11px] text-slate-600">
						Optional. Path is relative to the project folder — e.g.{" "}
						<code className="font-mono">src/index.css</code>.
					</Text>
					{hasPartialSystemLink ? (
						<Text className="text-[11px] text-red-900">
							Provide both a design system name and CSS path, or leave both
							empty.
						</Text>
					) : null}
					{hasInvalidSystemName ? (
						<Text className="text-[11px] text-red-900">
							Use only letters, numbers, dashes, underscores, and at-signs in
							the design system name.
						</Text>
					) : null}
					{cssPickerError ? (
						<Text className="text-[11px] text-red-900">{cssPickerError}</Text>
					) : null}
				</Fieldset.Root>

				{folderPickerError ? (
					<div className="w-fit bg-red-500 px-2 py-1 text-xs text-white">
						{folderPickerError}
					</div>
				) : null}
				{createProjectMutation.isError ? (
					<div className="w-fit bg-red-500 px-2 py-1 text-xs text-white">
						Failed to create project: {createErrorMessage}
					</div>
				) : null}
			</div>

			<div className="flex gap-2">
				<Button
					type="button"
					variant="outlined"
					className="flex-1 justify-center"
					onClick={() => navigate("/")}
					disabled={createProjectMutation.isPending}
				>
					Open project instead
				</Button>
				<Button
					type="button"
					variant="outlined"
					className="flex flex-1 items-center justify-center gap-2"
					onClick={handleCreate}
					disabled={submitDisabled}
				>
					<Plus className="size-3.5" aria-hidden="true" />
					{createProjectMutation.isPending ? "Creating…" : "Create project"}
				</Button>
			</div>
		</div>
	);
}
