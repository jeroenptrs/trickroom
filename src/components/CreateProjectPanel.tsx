import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FilePlus2, FolderPlus, Plus, X } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import {
	configFileQueryKey,
	configFileQueryOptions,
	createConfigFile,
} from "../queries/config-file";
import {
	openProject,
	sessionQueryKey,
	type TrickroomProjectSummary,
} from "../queries/projects";
import { systemsQueryKey } from "../queries/systems";
import type { TrickroomConfig } from "../types";
import { HttpError } from "../utils/readJsonOrThrow";
import {
	systemNameHasStorageKey,
	systemNameStorageKeyError,
} from "../utils/system-name";
import { openCheckoutInTab, tabLocationId } from "../utils/tab-location";
import { Alert } from "./ui/alert";
import { Button } from "./ui/button";
import Checkbox from "./ui/checkbox";
import { Field } from "./ui/field";
import { FieldControl } from "./ui/input";
import { InputGroup } from "./ui/input-group";
import { Text } from "./ui/text";

type FieldName = "name" | "projectFolder" | "systemName" | "systemCssPath";
const fieldOrder: FieldName[] = [
	"name",
	"projectFolder",
	"systemName",
	"systemCssPath",
];

export function CreateProjectPanel() {
	const [name, setName] = useState("");
	const [projectFolder, setProjectFolder] = useState("");
	const [systemName, setSystemName] = useState("");
	const [systemCssPath, setSystemCssPath] = useState("");
	const [setSystemAsDefault, setSetSystemAsDefault] = useState(true);
	const [showSystem, setShowSystem] = useState(false);
	// Validate a field once it loses focus, and every field on submit.
	const [touched, setTouched] = useState<Set<FieldName>>(() => new Set());
	const fieldRefs = useRef<Partial<Record<FieldName, HTMLInputElement | null>>>(
		{},
	);
	const queryClient = useQueryClient();
	const navigate = useNavigate();
	const location = useLocation();
	// The checkout the command menu came from; Cancel goes back to it.
	const reopenLocationId = new URLSearchParams(location.search).get("reopen");
	const configQuery = useQuery(configFileQueryOptions());

	// A tab that is not pinned to a checkout always creates a project in a
	// folder the form asks for, whatever project the server has active.
	const isNoProjectCreate =
		!tabLocationId ||
		(configQuery.isError &&
			configQuery.error instanceof HttpError &&
			configQuery.error.status === 409);
	const hasActiveConfig = Boolean(tabLocationId) && configQuery.isSuccess;
	const errors: Partial<Record<FieldName, string>> = {};
	if (!name.trim()) {
		errors.name = "Enter a project name.";
	}
	if (isNoProjectCreate && !projectFolder.trim()) {
		errors.projectFolder = "Enter the project folder.";
	}
	if (showSystem) {
		if (!systemName.trim()) {
			errors.systemName = "Enter a system name, or remove the system.";
		} else if (!systemNameHasStorageKey(systemName)) {
			errors.systemName = systemNameStorageKeyError;
		}
		if (!systemCssPath.trim()) {
			errors.systemCssPath =
				"Enter a CSS file for this system, or remove the system.";
		}
	}
	const visibleError = (field: FieldName) =>
		touched.has(field) ? errors[field] : undefined;
	const markTouched = (field: FieldName) =>
		setTouched((current) =>
			current.has(field) ? current : new Set(current).add(field),
		);

	const createProjectMutation = useMutation({
		mutationFn: async (): Promise<
			TrickroomConfig | { project: TrickroomProjectSummary }
		> => {
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
		onSuccess: async (result) => {
			if ("project" in result) {
				// A new project: the tab loads it under its own URL.
				openCheckoutInTab(result.project.locationId);
				return;
			}
			await queryClient.invalidateQueries({ queryKey: configFileQueryKey });
			await queryClient.invalidateQueries({ queryKey: sessionQueryKey });
			await queryClient.invalidateQueries({ queryKey: systemsQueryKey });
			navigate("/", { replace: true });
		},
	});

	useEffect(() => {
		if (configQuery.isError) {
			fieldRefs.current.name?.focus();
		}
	}, [configQuery.isError]);

	useEffect(() => {
		if (hasActiveConfig) {
			navigate("/", { replace: true });
		}
	}, [hasActiveConfig, navigate]);

	const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (createProjectMutation.isPending || configQuery.isPending) {
			return;
		}
		const firstInvalid = fieldOrder.find((field) => errors[field]);
		if (firstInvalid) {
			setTouched(new Set(fieldOrder));
			fieldRefs.current[firstInvalid]?.focus();
			return;
		}
		createProjectMutation.mutate();
	};

	// Cancel goes back to the project the command menu closed, if any.
	const handleCancel = () => {
		if (reopenLocationId) {
			openCheckoutInTab(reopenLocationId);
			return;
		}
		navigate("/");
	};

	const handleToggleSystem = () => {
		if (showSystem) {
			setSystemName("");
			setSystemCssPath("");
			setSetSystemAsDefault(true);
			setTouched((current) => {
				const next = new Set(current);
				next.delete("systemName");
				next.delete("systemCssPath");
				return next;
			});
		}
		setShowSystem(!showSystem);
	};

	const createErrorMessage = (createProjectMutation.error as Error | null)
		?.message;
	const inputsDisabled =
		createProjectMutation.isPending || configQuery.isPending;

	return (
		<form className="flex flex-1 flex-col" onSubmit={handleSubmit}>
			<div className="flex min-h-20 flex-col justify-center gap-1 border-b border-slate-200 px-8">
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
					<Text tone="foreground" className="text-sm font-semibold">
						Project
					</Text>

					<Field label="Project name" error={visibleError("name")}>
						<FieldControl
							ref={(element) => {
								fieldRefs.current.name = element;
							}}
							type="text"
							variant="form"
							placeholder="acme-dashboard"
							value={name}
							onChange={(event) => setName(event.target.value)}
							onBlur={() => markTouched("name")}
							disabled={inputsDisabled}
						/>
					</Field>

					{isNoProjectCreate ? (
						<Field label="Location" error={visibleError("projectFolder")}>
							<InputGroup icon={FolderPlus}>
								<FieldControl
									ref={(element) => {
										fieldRefs.current.projectFolder = element;
									}}
									type="text"
									variant="formEmbedded"
									placeholder="/absolute/path/to/project"
									value={projectFolder}
									onChange={(event) => setProjectFolder(event.target.value)}
									onBlur={() => markTouched("projectFolder")}
									disabled={inputsDisabled}
									className="min-w-0 flex-1 truncate aria-invalid:inset-shadow-transparent"
								/>
							</InputGroup>
						</Field>
					) : null}
				</div>

				<div className="flex flex-col gap-2 border-t border-slate-200 pt-5">
					<div className="flex items-center justify-between">
						<Text tone="foreground" className="text-sm font-semibold">
							System
						</Text>
						<Button
							type="button"
							variant="ghost"
							className="flex items-center gap-1.5"
							onClick={handleToggleSystem}
							disabled={inputsDisabled}
						>
							{showSystem ? (
								<X className="size-3.5" aria-hidden="true" />
							) : (
								<Plus className="size-3.5" aria-hidden="true" />
							)}
							{showSystem ? "Remove system" : "Add system"}
						</Button>
					</div>

					{showSystem ? (
						<div className="flex flex-col gap-2">
							<Field label="System name" error={visibleError("systemName")}>
								<FieldControl
									ref={(element) => {
										fieldRefs.current.systemName = element;
									}}
									type="text"
									variant="form"
									placeholder="System name"
									value={systemName}
									onChange={(event) => setSystemName(event.target.value)}
									onBlur={() => markTouched("systemName")}
									disabled={inputsDisabled}
								/>
							</Field>
							<Field
								label="CSS file"
								description="Relative to the project folder."
								error={visibleError("systemCssPath")}
							>
								<InputGroup icon={FilePlus2}>
									<FieldControl
										ref={(element) => {
											fieldRefs.current.systemCssPath = element;
										}}
										type="text"
										variant="formEmbedded"
										placeholder="src/index.css"
										value={systemCssPath}
										onChange={(event) => setSystemCssPath(event.target.value)}
										onBlur={() => markTouched("systemCssPath")}
										disabled={inputsDisabled}
										className="min-w-0 flex-1 truncate aria-invalid:inset-shadow-transparent"
									/>
								</InputGroup>
							</Field>
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
										New designs link to this system.
									</Text>
								</span>
							</label>
						</div>
					) : (
						<Text variant="meta">Optional. You can add a system later.</Text>
					)}
				</div>

				{createProjectMutation.isError ? (
					<Alert variant="panel">
						Could not create {name.trim()}: {createErrorMessage}
					</Alert>
				) : null}
			</div>

			<div className="flex items-center justify-end gap-2 border-t border-slate-200 px-8 py-4">
				<Button
					type="button"
					variant="ghost"
					onClick={handleCancel}
					disabled={createProjectMutation.isPending}
				>
					Cancel
				</Button>
				<Button
					type="submit"
					variant="filled"
					disabled={createProjectMutation.isPending}
				>
					{createProjectMutation.isPending ? "Creating…" : "Create project"}
				</Button>
			</div>
		</form>
	);
}
