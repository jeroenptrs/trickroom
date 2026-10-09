import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FilePlus2, Plus, SwatchBook, X } from "lucide-react";
import { type FormEvent, useEffect, useId, useState } from "react";
import { configFileQueryKey } from "../../queries/config-file";
import {
	type CreateSystemResponse,
	createSystem,
	systemsQueryKey,
} from "../../queries/systems";
import { Alert } from "../ui/alert";
import { Button } from "../ui/button";
import Checkbox from "../ui/checkbox";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogOverlay,
	DialogPortal,
	DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { InputGroup } from "../ui/input-group";
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
	const formId = useId();
	const [systemName, setSystemName] = useState("");
	const [cssPath, setCssPath] = useState("");
	const [setAsDefault, setSetAsDefault] = useState(true);

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
			setSetAsDefault(true);
			return;
		}
		setSystemName("");
		setCssPath("");
		setSetAsDefault(true);
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
		mutation.mutate({
			systemName: trimmedSystemName,
			cssPath: trimmedCssPath,
			setAsDefault,
		});
	};

	const errorMessage = (mutation.error as Error | null)?.message;

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogPortal>
				<DialogOverlay />
				<DialogContent className="w-[calc(100vw-2rem)] max-w-130 md:max-w-130 overflow-hidden">
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
									</InputGroup>
									<Text tone="muted" className="text-[11px] leading-relaxed">
										Trickroom indexes the @theme tokens declared in this file.
									</Text>
								</div>
								<label
									htmlFor={`${formId}-default`}
									className="flex items-start gap-3"
								>
									<Checkbox
										id={`${formId}-default`}
										checked={setAsDefault}
										onCheckedChange={(checked) =>
											setSetAsDefault(checked === true)
										}
										disabled={mutation.isPending}
									/>
									<span className="flex min-w-0 flex-col gap-0.5">
										<Text variant="label" tone="foreground">
											Set as default system
										</Text>
										<Text tone="muted" className="text-[11px] leading-relaxed">
											New designs will automatically link to this system.
										</Text>
									</span>
								</label>
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
