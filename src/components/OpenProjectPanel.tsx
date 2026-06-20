import { Field } from "@base-ui/react/field";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Folder } from "lucide-react";
import { type FormEvent, useState } from "react";
import { useNavigate } from "react-router";
import { getTrickroomDesktopApi } from "../desktop-api";
import { configFileQueryKey } from "../queries/config-file";
import { openProject, sessionQueryKey } from "../queries/projects";
import { systemsQueryKey } from "../queries/systems";
import { Alert } from "./ui/alert";
import { Button } from "./ui/button";
import { FieldControl } from "./ui/input";
import { InputGroup, InputGroupButton } from "./ui/input-group";
import { Kbd } from "./ui/kbd";
import { Text } from "./ui/text";

export function OpenProjectPanel() {
	const [path, setPath] = useState("");
	const [folderPickerError, setFolderPickerError] = useState<string | null>(
		null,
	);
	const [isPickingFolder, setIsPickingFolder] = useState(false);
	const desktopApi = getTrickroomDesktopApi();
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const openMutation = useMutation({
		mutationFn: (targetPath: string) => openProject({ path: targetPath }),
		onSuccess: async () => {
			await queryClient.invalidateQueries({ queryKey: sessionQueryKey });
			await queryClient.invalidateQueries({ queryKey: configFileQueryKey });
			await queryClient.invalidateQueries({ queryKey: systemsQueryKey });
			navigate("/", { replace: true });
		},
	});

	const hasPath = path.trim().length > 0;
	const openError = (openMutation.error as Error | null)?.message;

	const handlePickProjectFolder = async () => {
		if (!desktopApi || isPickingFolder || openMutation.isPending) {
			return;
		}

		setFolderPickerError(null);
		setIsPickingFolder(true);
		try {
			const result = await desktopApi.pickProjectFolder();
			if (!result.canceled) {
				setPath(result.path);
				openMutation.mutate(result.path);
			}
		} catch (error) {
			setFolderPickerError(
				error instanceof Error ? error.message : "Failed to choose folder.",
			);
		} finally {
			setIsPickingFolder(false);
		}
	};

	const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (!hasPath || openMutation.isPending) {
			return;
		}
		openMutation.mutate(path.trim());
	};

	return (
		<div className="flex flex-1 flex-col justify-center gap-6 px-8 pt-4 pb-8">
			<div>
				<Text variant="eyebrow">Welcome</Text>
				<Text
					variant="title"
					tone="foreground"
					className="mt-1 block text-2xl tracking-tight"
				>
					Open a project
				</Text>
				<Text tone="muted" className="mt-1 block max-w-sm text-sm">
					Pick up where you left off, or point Trickroom at a folder to begin.
				</Text>
			</div>

			<div className="flex flex-col gap-3 sm:flex-row">
				{desktopApi ? (
					<Button
						type="button"
						variant="filled"
						className="w-full flex-col items-start gap-1 text-left"
						disabled={openMutation.isPending || isPickingFolder}
						onClick={handlePickProjectFolder}
					>
						<span className="block">
							{isPickingFolder ? "Choosing folder…" : "Open folder"}
						</span>
						<Text
							tone="inverse-muted"
							className="block text-[11px] font-normal"
						>
							Choose an existing project on disk
						</Text>
					</Button>
				) : null}
				<Button
					type="button"
					variant="outlined"
					className="w-full flex-col items-start gap-1 text-left"
					onClick={() => void navigate("/new")}
				>
					<span className="block">Create project</span>
					<Text tone="faint" className="block text-[11px] font-normal">
						Start a new .trickroom workspace
					</Text>
				</Button>
			</div>

			<form className="flex flex-col gap-2" onSubmit={handleSubmit}>
				<Field.Root className="flex flex-col gap-2">
					<Field.Label
						render={
							// biome-ignore lint/a11y/noLabelWithoutControl: Field.Label injects htmlFor and the label text into this render element at runtime.
							<Text variant="section-header" render={<label />} />
						}
					>
						or open by path
					</Field.Label>
					<InputGroup icon={Folder}>
						<FieldControl
							variant="formEmbedded"
							placeholder="/absolute/path/to/project"
							value={path}
							onChange={(event) => setPath(event.target.value)}
							disabled={openMutation.isPending}
							className="min-w-0 flex-1 truncate"
						/>
						<InputGroupButton
							type="submit"
							disabled={openMutation.isPending || !hasPath}
						>
							{openMutation.isPending ? "Opening…" : "Open"}
						</InputGroupButton>
					</InputGroup>
				</Field.Root>

				{openMutation.isError ? (
					<Alert variant="panel">Failed to open project: {openError}</Alert>
				) : null}
				{folderPickerError ? (
					<Alert variant="panel">{folderPickerError}</Alert>
				) : null}
			</form>

			<div className="flex items-center gap-2 pt-2">
				<Kbd>⌘K</Kbd>
				<Text tone="muted" className="text-[11px]">
					Open the command menu anywhere
				</Text>
			</div>
		</div>
	);
}
