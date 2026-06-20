import { Field } from "@base-ui/react/field";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Folder, Plus } from "lucide-react";
import { type FormEvent, useState } from "react";
import { useNavigate } from "react-router";
import { getTrickroomDesktopApi } from "../desktop-api";
import { configFileQueryKey } from "../queries/config-file";
import { openProject, sessionQueryKey } from "../queries/projects";
import { systemsQueryKey } from "../queries/systems";
import { Button } from "./ui/button";
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
		<div className="flex flex-1 flex-col gap-5 px-8 pt-4 pb-8">
			<div>
				<Text variant="title" className="text-lg">
					No active project
				</Text>
				<Text className="mt-1 block text-sm text-slate-700">
					Open the folder of an existing project or start a fresh one.
				</Text>
			</div>

			<form className="flex flex-col gap-2" onSubmit={handleSubmit}>
				<Field.Root className="flex flex-col gap-2">
					<Field.Label
						render={<Text variant="label" />}
						className="text-xs font-semibold"
					>
						Project folder
					</Field.Label>
					<div className="group flex items-stretch inset-shadow-[0_0_0_1px] inset-shadow-slate-200 focus-within:inset-shadow-cyan-500">
						<Folder
							className="ml-2 size-4 shrink-0 self-center text-slate-600 group-focus-within:text-cyan-900"
							aria-hidden="true"
						/>
						<Field.Control
							className="flex-1 border-none bg-transparent px-2 py-2 text-xs text-slate-950 placeholder:text-slate-500 focus:outline-none disabled:opacity-50"
							placeholder="/absolute/path/to/project"
							value={path}
							onChange={(event) => setPath(event.target.value)}
							disabled={openMutation.isPending}
						/>
						{desktopApi ? (
							<Button
								type="button"
								variant="block"
								className="inset-shadow-[1px_0_0_0] inset-shadow-slate-200 group-focus-within:inset-shadow-cyan-500 not-disabled:hover:inset-shadow-[0_0_0_1px] not-disabled:active:inset-shadow-[0_0_0_1px] not-disabled:active:inset-shadow-cyan-500"
								disabled={openMutation.isPending || isPickingFolder}
								onClick={handlePickProjectFolder}
							>
								{isPickingFolder ? "Choosing" : "Choose"}
							</Button>
						) : null}
					</div>
				</Field.Root>

				<Button
					type="submit"
					variant="outlined"
					className="w-full justify-center"
					disabled={openMutation.isPending || !hasPath}
				>
					{openMutation.isPending ? "Opening project…" : "Open project"}
				</Button>

				{openMutation.isError ? (
					<div className="w-fit bg-red-500 px-2 py-1 text-xs text-white">
						Failed to open project: {openError}
					</div>
				) : null}
				{folderPickerError ? (
					<div className="w-fit bg-red-500 px-2 py-1 text-xs text-white">
						{folderPickerError}
					</div>
				) : null}
			</form>

			<div className="text-center font-mono text-[10px] uppercase tracking-wider text-slate-500">
				— or —
			</div>

			<Button
				type="button"
				variant="outlined"
				className="flex w-full items-center justify-center gap-2"
				onClick={() => void navigate("/new")}
			>
				<Plus className="size-3.5" aria-hidden="true" />
				Create new project
			</Button>
		</div>
	);
}
