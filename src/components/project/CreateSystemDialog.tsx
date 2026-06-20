import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FilePlus2, Plus, SwatchBook, X } from "lucide-react";
import { type FormEvent, useEffect, useId, useState } from "react";
import { getTrickroomDesktopApi } from "../../desktop-api";
import { configFileQueryKey } from "../../queries/config-file";
import { sessionQueryOptions } from "../../queries/projects";
import {
	type CreateSystemResponse,
	createSystem,
	systemsQueryKey,
} from "../../queries/systems";
import { Alert } from "../ui/alert";
import { Button } from "../ui/button";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogOverlay,
	DialogPortal,
	DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { InputGroup, InputGroupButton } from "../ui/input-group";
import { Separator } from "../ui/separator";
import { Text } from "../ui/text";

export function CreateSystemDialog({
	open,
	onOpenChange,
	onCreated,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onCreated?: (system: CreateSystemResponse) => void;
}) {
	const queryClient = useQueryClient();
	const sessionQuery = useQuery(sessionQueryOptions());
	const formId = useId();
	const [systemName, setSystemName] = useState("");
	const [cssPath, setCssPath] = useState("");
	const [cssPickerError, setCssPickerError] = useState<string | null>(null);
	const [isPickingCss, setIsPickingCss] = useState(false);
	const desktopApi = getTrickroomDesktopApi();
	const projectRoot = sessionQuery.data?.activeProject?.projectRoot ?? "";
	const canPickCss = Boolean(desktopApi) && Boolean(projectRoot);

	const mutation = useMutation({
		mutationFn: createSystem,
		onSuccess: async (system) => {
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: systemsQueryKey }),
				queryClient.invalidateQueries({ queryKey: configFileQueryKey }),
			]);
			onCreated?.(system);
			onOpenChange(false);
		},
	});

	useEffect(() => {
		if (open) {
			mutation.reset();
			setCssPickerError(null);
			return;
		}
		setSystemName("");
		setCssPath("");
		setCssPickerError(null);
	}, [open, mutation.reset]);

	const trimmedSystemName = systemName.trim();
	const trimmedCssPath = cssPath.trim();
	const canSubmit =
		trimmedSystemName.length > 0 &&
		trimmedCssPath.length > 0 &&
		!mutation.isPending;

	const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (!canSubmit) return;
		setCssPickerError(null);
		mutation.mutate({
			systemName: trimmedSystemName,
			cssPath: trimmedCssPath,
		});
	};

	const handlePickCssFile = async () => {
		if (!desktopApi || !projectRoot || mutation.isPending || isPickingCss) {
			return;
		}

		setCssPickerError(null);
		setIsPickingCss(true);
		try {
			const result = await desktopApi.pickCssFile(projectRoot);
			if (!result.canceled) {
				setCssPath(result.relativePath);
			}
		} catch (error) {
			setCssPickerError(
				error instanceof Error ? error.message : "Failed to choose CSS file.",
			);
		} finally {
			setIsPickingCss(false);
		}
	};

	const errorMessage =
		cssPickerError ?? (mutation.error as Error | null)?.message;

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogPortal>
				<DialogOverlay />
				<DialogContent className="w-[calc(100vw-2rem)] max-w-[32.5rem] md:max-w-[32.5rem] overflow-hidden">
					<div className="flex items-center justify-between px-4 py-3">
						<div className="flex min-w-0 items-center gap-2">
							<SwatchBook
								className="size-4 shrink-0 text-slate-500"
								aria-hidden="true"
							/>
							<DialogTitle className="p-0 text-sm font-medium text-slate-900">
								Create design system
							</DialogTitle>
						</div>
						<DialogClose className="border-none bg-transparent p-1 focus-visible:outline-none focus-visible:inset-shadow-[0_0_0_1px] focus-visible:inset-shadow-cyan-500">
							<span className="sr-only">Close</span>
							<X className="size-4 text-slate-500" aria-hidden="true" />
						</DialogClose>
					</div>
					<Separator />
					<form id={formId} onSubmit={handleSubmit}>
						<div className="flex flex-col gap-5 px-5 py-5">
							<Text render={<p />} tone="muted" className="text-xs">
								Define a design system for this project. Trickroom reads your
								tokens from the CSS file you point it at.
							</Text>
							<div className="flex flex-col gap-5">
								<div className="flex flex-col gap-2">
									<label htmlFor={`${formId}-name`}>
										<Text variant="label" tone="foreground">
											System name
										</Text>
									</label>
									<Input
										id={`${formId}-name`}
										variant="outlined"
										className="px-3 py-2"
										placeholder="e.g. Acme Web"
										value={systemName}
										onChange={(event) => setSystemName(event.target.value)}
										disabled={mutation.isPending}
									/>
								</div>
								<div className="flex flex-col gap-2">
									<label htmlFor={`${formId}-css`}>
										<Text variant="label" tone="foreground">
											Token source
										</Text>
									</label>
									<InputGroup icon={FilePlus2}>
										<Input
											id={`${formId}-css`}
											variant="formEmbedded"
											className="min-w-0 flex-1 truncate"
											placeholder="src/index.css"
											value={cssPath}
											onChange={(event) => setCssPath(event.target.value)}
											disabled={mutation.isPending}
										/>
										{desktopApi ? (
											<InputGroupButton
												disabled={
													mutation.isPending || isPickingCss || !canPickCss
												}
												onClick={handlePickCssFile}
												title={
													!canPickCss ? "Project path unavailable." : undefined
												}
											>
												{isPickingCss ? "Browsing" : "Browse"}
											</InputGroupButton>
										) : null}
									</InputGroup>
									<Text tone="muted" className="text-[11px] leading-relaxed">
										Trickroom indexes the @theme tokens declared in this file.
									</Text>
								</div>
							</div>
							{errorMessage ? (
								<Alert variant="panel" tone="danger">
									{errorMessage}
								</Alert>
							) : null}
						</div>
					</form>
					<Separator />
					<div className="flex items-center justify-end gap-2 px-4 py-3">
						<DialogClose render={<Button type="button" variant="block" />}>
							Cancel
						</DialogClose>
						<Button
							type="submit"
							form={formId}
							variant="filled"
							className="flex items-center justify-center gap-2"
							disabled={!canSubmit}
						>
							<Plus className="size-3.5" aria-hidden="true" />
							{mutation.isPending ? "Creating..." : "Create system"}
						</Button>
					</div>
				</DialogContent>
			</DialogPortal>
		</Dialog>
	);
}
