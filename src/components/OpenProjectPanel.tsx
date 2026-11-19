import { Field } from "@base-ui/react/field";
import { useMutation } from "@tanstack/react-query";
import { Folder, TriangleAlert } from "lucide-react";
import { type FormEvent, useState } from "react";
import { useNavigate } from "react-router";
import { openProject } from "../queries/projects";
import { openCheckoutInTab } from "../utils/tab-location";
import { Alert } from "./ui/alert";
import { Button } from "./ui/button";
import { FieldControl } from "./ui/input";
import { InputGroup, InputGroupButton } from "./ui/input-group";
import { Text } from "./ui/text";

export function OpenProjectPanel() {
	const [path, setPath] = useState("");
	const [pathError, setPathError] = useState<string | null>(null);
	const navigate = useNavigate();
	const openMutation = useMutation({
		mutationFn: (targetPath: string) => openProject({ path: targetPath }),
		onSuccess: (response) => openCheckoutInTab(response.project.locationId),
	});

	const hasPath = path.trim().length > 0;
	const openError = (openMutation.error as Error | null)?.message;

	const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (openMutation.isPending) {
			return;
		}
		if (!hasPath) {
			setPathError("Enter the project folder.");
			return;
		}
		openMutation.mutate(path.trim());
	};

	return (
		<div className="flex flex-1 flex-col justify-center gap-6 px-8 pt-4 pb-8">
			<div>
				<Text
					variant="title"
					tone="foreground"
					className="block text-2xl tracking-tight"
				>
					Open a project
				</Text>
				<Text tone="muted" className="mt-1 block max-w-sm text-sm">
					Pick up where you left off, or point Trickroom at a folder to begin.
				</Text>
			</div>

			<div className="flex flex-col gap-3 sm:flex-row">
				<Button
					type="button"
					variant="outlined"
					className="w-full text-left"
					onClick={() => void navigate("/new")}
				>
					Create project
				</Button>
			</div>

			<form className="flex flex-col gap-2" onSubmit={handleSubmit}>
				<Field.Root
					className="flex flex-col gap-2"
					invalid={Boolean(pathError)}
				>
					<Field.Label
						render={
							// biome-ignore lint/a11y/noLabelWithoutControl: Field.Label injects htmlFor and the label text into this render element at runtime.
							<Text variant="label" render={<label />} />
						}
					>
						Open by path
					</Field.Label>
					<InputGroup icon={Folder}>
						<FieldControl
							variant="formEmbedded"
							placeholder="/absolute/path/to/project"
							value={path}
							onChange={(event) => {
								setPath(event.target.value);
								if (event.target.value.trim()) {
									setPathError(null);
								}
							}}
							disabled={openMutation.isPending}
							className="min-w-0 flex-1 truncate aria-invalid:inset-shadow-transparent"
						/>
						<InputGroupButton type="submit" disabled={openMutation.isPending}>
							{openMutation.isPending ? "Opening…" : "Open"}
						</InputGroupButton>
					</InputGroup>
					{pathError ? (
						<Field.Error
							match
							className="flex items-center gap-1.5 text-xs text-red-900"
						>
							<TriangleAlert
								className="size-3 shrink-0 text-red-700"
								aria-hidden="true"
							/>
							<span>{pathError}</span>
						</Field.Error>
					) : null}
				</Field.Root>

				{openMutation.isError ? (
					<Alert variant="panel">
						Could not open {openMutation.variables}: {openError}
					</Alert>
				) : null}
			</form>
		</div>
	);
}
