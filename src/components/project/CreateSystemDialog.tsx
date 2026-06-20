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
import { Separator } from "../ui/separator";

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
							<p className="text-xs text-slate-600">
								Define a design system for this project. Trickroom reads your
								tokens from the CSS file you point it at.
							</p>
							<div className="flex flex-col gap-5">
								<div className="flex flex-col gap-2">
									<label
										htmlFor={`${formId}-name`}
										className="text-xs font-semibold text-slate-950"
									>
										System name
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
									<label
										htmlFor={`${formId}-css`}
										className="text-xs font-semibold text-slate-950"
									>
										Token source
									</label>
									<div className="group flex min-w-0 items-stretch inset-shadow-[0_0_0_1px] inset-shadow-slate-200 focus-within:inset-shadow-cyan-500">
										<FilePlus2
											className="ml-2 size-4 shrink-0 self-center text-slate-600 group-focus-within:text-cyan-900"
											aria-hidden="true"
										/>
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
											<Button
												type="button"
												variant="block"
												className="shrink-0 inset-shadow-[1px_0_0_0] inset-shadow-slate-200 group-focus-within:inset-shadow-cyan-500 not-disabled:hover:inset-shadow-[0_0_0_1px] not-disabled:active:inset-shadow-[0_0_0_1px] not-disabled:active:inset-shadow-cyan-500"
												disabled={
													mutation.isPending || isPickingCss || !canPickCss
												}
												onClick={handlePickCssFile}
												title={
													!canPickCss ? "Project path unavailable." : undefined
												}
											>
												{isPickingCss ? "Browsing" : "Browse"}
											</Button>
										) : null}
									</div>
									<span className="text-[11px] leading-relaxed text-slate-600">
										Trickroom indexes the @theme tokens declared in this file.
									</span>
								</div>
							</div>
							{errorMessage ? (
								<div className="w-fit bg-red-500 px-2 py-1 text-xs text-white">
									{errorMessage}
								</div>
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
