import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Navigate, useNavigate } from "react-router";
import {
	configFileQueryKey,
	configFileQueryOptions,
	createConfigFile,
} from "../queries/config-file";
import { Button } from "./ui/button";
import {
	Dialog,
	DialogContent,
	DialogOverlay,
	DialogPortal,
	DialogTitle,
} from "./ui/dialog";
import { InputField } from "./ui/input";
import { Separator } from "./ui/separator";
import { Text } from "./ui/text";
import Checkbox from "./ui/checkbox";

const systemNamePattern = /^[A-Za-z0-9_@-]+$/;

export function CreateProject() {
	const [name, setName] = useState("");
	const [systemName, setSystemName] = useState("");
	const [systemCssPath, setSystemCssPath] = useState("");
	const [setSystemAsDefault, setSetSystemAsDefault] = useState(true);
	const inputRef = useRef<HTMLInputElement>(null);
	const queryClient = useQueryClient();
	const navigate = useNavigate();
	const configQuery = useQuery(configFileQueryOptions());
	const hasPartialSystemLink =
		Boolean(systemName.trim()) !== Boolean(systemCssPath.trim());
	const hasInvalidSystemName =
		Boolean(systemName.trim()) && !systemNamePattern.test(systemName.trim());

	const createProjectMutation = useMutation({
		mutationFn: () => {
			const trimmedSystemName = systemName.trim();
			const trimmedSystemCssPath = systemCssPath.trim();
			return createConfigFile({
				name,
				...(trimmedSystemName && trimmedSystemCssPath
					? {
							systems: { [trimmedSystemName]: trimmedSystemCssPath },
							...(setSystemAsDefault
								? { defaultSystemName: trimmedSystemName }
								: {}),
						}
					: {}),
			});
		},
		onSuccess: async () => {
			await queryClient.invalidateQueries({ queryKey: configFileQueryKey });
			navigate("/", { replace: true });
		},
	});

	useEffect(() => {
		if (configQuery.isError) {
			inputRef.current?.focus();
		}
	}, [configQuery.isError]);

	if (configQuery.isSuccess) {
		return <Navigate to="/" replace />;
	}

	const handleCreate = () => {
		if (hasPartialSystemLink || hasInvalidSystemName) {
			return;
		}

		createProjectMutation.mutate();
	};
	const createErrorMessage = (createProjectMutation.error as Error | null)
		?.message;

	return (
		<Dialog open>
			<DialogPortal>
				<DialogOverlay />
				<DialogContent initialFocus={false}>
					<DialogTitle render={<Text variant="title" />}>
						Start a new Trickroom project
					</DialogTitle>
					<Separator />
					<div className="flex flex-col gap-2 p-2 pb-4">
						<InputField
							autoFocus
							label="Name"
							ref={inputRef}
							placeholder="Project Name"
							description="The name of your project, spanning multiple designs. For instance, the name of your repo..."
							value={name}
							onChange={(event) => setName(event.target.value)}
							disabled={
								createProjectMutation.isPending || configQuery.isPending
							}
						/>
						<InputField
							type="text"
							placeholder="Core"
							label="Design system name"
							description="A friendly name for the optional synced design system."
							value={systemName}
							onChange={(event) => setSystemName(event.target.value)}
							pattern={systemNamePattern.source}
							aria-invalid={hasInvalidSystemName}
							disabled={
								createProjectMutation.isPending || configQuery.isPending
							}
						/>
						<InputField
							type="text"
							placeholder="src/index.css"
							label="Design system CSS"
							description="The location of the css file that imports Tailwindcss and your theme. This is completely optional, but exceptionally handy if you already have a Tailwindcss theme with design tokens."
							value={systemCssPath}
							onChange={(event) => setSystemCssPath(event.target.value)}
							disabled={
								createProjectMutation.isPending || configQuery.isPending
							}
						/>
						{hasPartialSystemLink ? (
							<div className="bg-red-500 px-2 py-1 text-xs text-white w-fit">
								Provide both a design system name and CSS path, or leave both
								empty.
							</div>
						) : null}
						{hasInvalidSystemName ? (
							<div className="bg-red-500 px-2 py-1 text-xs text-white w-fit">
								Use only letters, numbers, dashes, underscores, and at-signs in
								the design system name.
							</div>
						) : null}
						{systemName.trim() && systemCssPath.trim() ? (
							<label
								htmlFor="create-project-default-system"
								className="flex items-start gap-3"
							>
								<Checkbox
									id="create-project-default-system"
									checked={setSystemAsDefault}
									onCheckedChange={(checked) =>
										setSetSystemAsDefault(checked === true)
									}
									disabled={
										createProjectMutation.isPending || configQuery.isPending
									}
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
						{createProjectMutation.isError ? (
							<div className="bg-red-500 px-2 py-1 text-xs text-white w-fit">
								Failed to create project: {createErrorMessage}
							</div>
						) : null}
					</div>
					<Separator />
					<Button
						onClick={handleCreate}
						variant="block"
						className="py-1"
						disabled={
							createProjectMutation.isPending ||
							configQuery.isPending ||
							!name.trim() ||
							hasPartialSystemLink ||
							hasInvalidSystemName
						}
					>
						{createProjectMutation.isPending ? "Creating..." : "Create"}
					</Button>
				</DialogContent>
			</DialogPortal>
		</Dialog>
	);
}
