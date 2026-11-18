import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Component, Pencil, X } from "lucide-react";
import { type FormEvent, useEffect, useId, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import {
	createSystemComponentDraft,
	expandSystemComponent,
	invalidateSystemComponents,
	publishSystemComponent,
	systemComponentsQueryOptions,
} from "../../queries/system-components";
import { systemsQueryOptions } from "../../queries/systems";
import {
	canReplaceElementWithCandidateProps,
	designStore,
	replaceElementWithNodeTree,
} from "../../stores/design-store";
import {
	convertDesignSubtreeToComponentDraftRoot,
	validateComponentDraftTemplateRoot,
} from "../../utils/design-subtree-to-component-draft";
import {
	isSystemComponentSlug,
	systemComponentSlugFromName,
} from "../../utils/system-components";
import { buildSystemComponentPath } from "../../utils/system-deep-link";
import { useProjectScope } from "../contexts";
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
import { Field } from "../ui/field";
import { Input } from "../ui/input";
import { Select } from "../ui/select";
import { Separator } from "../ui/separator";

type ExtractSystemComponentDialogProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	elementId: string;
	layerName: string;
};

export type ExtractSystemComponentDefaults = {
	name: string;
	slug: string;
};

export { systemComponentSlugFromName };

export class ExtractSystemComponentPostPublishError extends Error {
	constructor(
		message: string,
		readonly partialResult: {
			systemId: string;
			componentId: string;
		},
	) {
		super(message);
		this.name = "ExtractSystemComponentPostPublishError";
	}
}

export function getExtractSystemComponentDefaults(
	layerName: string,
): ExtractSystemComponentDefaults {
	const name = layerName.trim() || "Component";
	return {
		name,
		slug: systemComponentSlugFromName(name) || "component",
	};
}

export function canSubmitExtractSystemComponentDialog({
	hasSelection,
	hasTargetSystem,
	hasManifestRevision,
	name,
	slug,
	isPending,
}: {
	hasSelection: boolean;
	hasTargetSystem: boolean;
	hasManifestRevision: boolean;
	name: string;
	slug: string;
	isPending: boolean;
}) {
	return (
		hasSelection &&
		hasTargetSystem &&
		hasManifestRevision &&
		name.trim().length > 0 &&
		isSystemComponentSlug(slug.trim()) &&
		!isPending
	);
}

export type ExtractSystemComponentFieldErrors = {
	system?: string;
	name?: string;
	slug?: string;
};

/** Field errors, shown once a field blurs or the form is submitted. */
export function getExtractSystemComponentFieldErrors({
	hasTargetSystem,
	name,
	slug,
}: {
	hasTargetSystem: boolean;
	name: string;
	slug: string;
}): ExtractSystemComponentFieldErrors {
	return {
		...(hasTargetSystem ? {} : { system: "Choose a system." }),
		...(name.trim() ? {} : { name: "Enter a name." }),
		...(isSystemComponentSlug(slug.trim())
			? {}
			: { slug: "Use lowercase letters, numbers, and hyphens." }),
	};
}

function getSelectionError(elementId: string) {
	const entity = designStore.get().entitiesById[elementId];
	if (!entity) {
		return "Select a layer before extracting a component.";
	}
	return null;
}

type ExtractSystemComponentMutationInput = {
	elementId: string;
	targetSystemId: string;
	revision: string;
	name: string;
	slug: string;
	description: string;
	group: string;
	replaceSelection: boolean;
};

export const getSystemComponentEditorPath = buildSystemComponentPath;

export function promptToOpenExtractedComponent({
	replacedSelection,
	systemId,
	componentId,
	navigate,
}: {
	replacedSelection: boolean;
	systemId: string;
	componentId: string;
	navigate: (path: string) => void;
}) {
	let didOpenEditor = false;
	const toastId = toast.success("Component extracted.", {
		description: replacedSelection
			? "The design now has the attached instance selected."
			: "The component draft is ready to edit.",
		duration: Number.POSITIVE_INFINITY,
		action: {
			label: "Open editor",
			onClick: () => {
				if (didOpenEditor) {
					return;
				}
				didOpenEditor = true;
				toast.dismiss(toastId);
				navigate(getSystemComponentEditorPath(systemId, componentId));
			},
		},
		cancel: {
			label: "Stay in design",
			onClick: () => {
				toast.dismiss(toastId);
			},
		},
		icon: <Pencil className="size-4" aria-hidden="true" />,
	});
	return toastId;
}

export async function extractSystemComponentMutation({
	elementId,
	targetSystemId,
	revision,
	name,
	slug,
	description,
	group,
	replaceSelection,
}: ExtractSystemComponentMutationInput) {
	const currentSelectionError = getSelectionError(elementId);
	if (currentSelectionError) {
		throw new Error(currentSelectionError);
	}
	if (!targetSystemId || !revision) {
		throw new Error("Choose a target system before extracting.");
	}
	const draft = convertDesignSubtreeToComponentDraftRoot(
		elementId,
		designStore.get().entitiesById,
	);
	const validation = validateComponentDraftTemplateRoot(draft.root);
	if (!validation.valid) {
		throw new Error(validation.errors.join(" "));
	}
	if (
		replaceSelection &&
		!canReplaceElementWithCandidateProps(elementId, {
			"data-trickroom-library": draft.root.library,
			"data-trickroom-component": draft.root.component,
		})
	) {
		throw new Error(
			"The selected layer cannot be replaced in its current location.",
		);
	}

	const created = await createSystemComponentDraft(targetSystemId, {
		expectedRevision: revision,
		name: name.trim(),
		slug: slug.trim(),
		...(description.trim() ? { description: description.trim() } : {}),
		...(group.trim() ? { group: group.trim() } : {}),
		draft: { root: draft.root },
	});
	if (!replaceSelection) {
		return { ...created, replacedSelection: false };
	}

	const published = await publishSystemComponent(
		targetSystemId,
		created.componentId,
		{ expectedRevision: created.revision },
	);
	if (!published.publishedVersion) {
		throw new Error("Component publish did not return a version.");
	}
	const partialResult = {
		systemId: published.systemId,
		componentId: published.componentId,
	};
	let expansion: Awaited<ReturnType<typeof expandSystemComponent>>;
	try {
		expansion = await expandSystemComponent(
			targetSystemId,
			created.componentId,
			published.publishedVersion,
		);
	} catch (error) {
		throw new ExtractSystemComponentPostPublishError(
			error instanceof Error
				? error.message
				: "Failed to expand the published component.",
			partialResult,
		);
	}
	if (!replaceElementWithNodeTree(elementId, expansion.root)) {
		throw new ExtractSystemComponentPostPublishError(
			"Published the component, but the selected layer could not be replaced.",
			partialResult,
		);
	}
	return { ...published, replacedSelection: true };
}

export function ExtractSystemComponentDialog({
	open,
	onOpenChange,
	elementId,
	layerName,
}: ExtractSystemComponentDialogProps) {
	const formId = useId();
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const projectScope = useProjectScope();
	const currentSystemId = designStore.get().systemId ?? "";
	const defaults = useMemo(
		() => getExtractSystemComponentDefaults(layerName),
		[layerName],
	);
	const systemsQuery = useQuery(systemsQueryOptions(projectScope));
	const [targetSystemId, setTargetSystemId] = useState(currentSystemId);
	const [name, setName] = useState(defaults.name);
	const [slug, setSlug] = useState(defaults.slug);
	const [description, setDescription] = useState("");
	const [group, setGroup] = useState("");
	const [replaceSelection, setReplaceSelection] = useState(true);
	// A slug typed by hand stops following the name.
	const [slugEdited, setSlugEdited] = useState(false);
	const [touched, setTouched] = useState<
		Partial<Record<keyof ExtractSystemComponentFieldErrors, boolean>>
	>({});
	const selectionError = open ? getSelectionError(elementId) : null;
	const componentsQuery = useQuery({
		...systemComponentsQueryOptions(targetSystemId, projectScope),
		enabled: open && targetSystemId.trim().length > 0,
	});
	const systems = systemsQuery.data?.systems ?? [];
	const hasTargetSystem = systems.some(
		(system) => system.systemId === targetSystemId,
	);
	const revision = componentsQuery.data?.revision;
	const mutation = useMutation({
		mutationFn: () =>
			extractSystemComponentMutation({
				elementId,
				targetSystemId,
				revision,
				name,
				slug,
				description,
				group,
				replaceSelection,
			}),
		onSuccess: async (result) => {
			await invalidateSystemComponents(
				queryClient,
				targetSystemId,
				projectScope,
				result.componentId,
			);
			onOpenChange(false);
			promptToOpenExtractedComponent({
				replacedSelection: result.replacedSelection,
				systemId: result.systemId,
				componentId: result.componentId,
				navigate,
			});
		},
		onError: async (error) => {
			if (error instanceof ExtractSystemComponentPostPublishError) {
				await invalidateSystemComponents(
					queryClient,
					error.partialResult.systemId,
					projectScope,
					error.partialResult.componentId,
				);
			}
		},
	});

	useEffect(() => {
		if (!open) {
			return;
		}
		mutation.reset();
		setTargetSystemId(currentSystemId);
		setName(defaults.name);
		setSlug(defaults.slug);
		setDescription("");
		setGroup("");
		setReplaceSelection(true);
		setSlugEdited(false);
		setTouched({});
	}, [currentSystemId, defaults.name, defaults.slug, mutation.reset, open]);

	const canSubmit = canSubmitExtractSystemComponentDialog({
		hasSelection: !selectionError,
		hasTargetSystem,
		hasManifestRevision: Boolean(revision),
		name,
		slug,
		isPending: mutation.isPending,
	});
	const errorMessage =
		selectionError ??
		(systemsQuery.error as Error | null)?.message ??
		(componentsQuery.error as Error | null)?.message ??
		(mutation.error as Error | null)?.message;

	const fieldErrors = getExtractSystemComponentFieldErrors({
		hasTargetSystem,
		name,
		slug,
	});
	const shownErrors: ExtractSystemComponentFieldErrors = {
		system: touched.system ? fieldErrors.system : undefined,
		name: touched.name ? fieldErrors.name : undefined,
		slug: touched.slug ? fieldErrors.slug : undefined,
	};
	const touch = (field: keyof ExtractSystemComponentFieldErrors) =>
		setTouched((current) =>
			current[field] ? current : { ...current, [field]: true },
		);
	// The system's component list carries the revision to write against.
	const loadingRevision =
		hasTargetSystem && !revision && componentsQuery.isFetching;

	const handleNameChange = (value: string) => {
		setName(value);
		if (!slugEdited) {
			setSlug(systemComponentSlugFromName(value));
		}
	};

	const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		setTouched({ system: true, name: true, slug: true });
		if (!canSubmit) {
			return;
		}
		mutation.mutate();
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogPortal>
				<DialogOverlay />
				<DialogContent className="w-[calc(100vw-2rem)] max-w-136 overflow-hidden">
					<div className="flex items-center justify-between px-4 py-3">
						<div className="flex min-w-0 items-center gap-2">
							<Component
								className="size-4 shrink-0 text-slate-500"
								aria-hidden="true"
							/>
							<DialogTitle className="p-0 text-sm font-medium text-slate-900">
								Extract as system component
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
							<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
								<div className="flex flex-col gap-1 sm:col-span-2">
									<label
										htmlFor={`${formId}-system`}
										className="text-xs font-semibold text-slate-950"
									>
										Target system
									</label>
									<Select
										id={`${formId}-system`}
										variant="outlined"
										className="h-8"
										value={targetSystemId}
										onChange={(event) => setTargetSystemId(event.target.value)}
										onBlur={() => touch("system")}
										aria-invalid={shownErrors.system ? true : undefined}
										aria-describedby={
											shownErrors.system ? `${formId}-system-error` : undefined
										}
										disabled={mutation.isPending || systemsQuery.isPending}
									>
										<option value="">Choose system</option>
										{systems.map((system) => (
											<option key={system.systemId} value={system.systemId}>
												{system.systemName}
											</option>
										))}
									</Select>
									{shownErrors.system ? (
										<Alert
											id={`${formId}-system-error`}
											variant="inline"
											tone="danger"
											className="pt-0.5 text-xs"
										>
											{shownErrors.system}
										</Alert>
									) : null}
								</div>
								<Field label="Component name" error={shownErrors.name}>
									<Input
										variant="outlined"
										className="px-3 py-2"
										value={name}
										onChange={(event) => handleNameChange(event.target.value)}
										onBlur={() => touch("name")}
										disabled={mutation.isPending}
									/>
								</Field>
								<Field label="Slug" error={shownErrors.slug}>
									<Input
										variant="outlined"
										className="px-3 py-2 font-mono"
										value={slug}
										onChange={(event) => {
											setSlugEdited(true);
											setSlug(event.target.value);
										}}
										onBlur={() => touch("slug")}
										disabled={mutation.isPending}
									/>
								</Field>
								<div className="flex flex-col gap-2">
									<label
										htmlFor={`${formId}-group`}
										className="text-xs font-semibold text-slate-950"
									>
										Group
									</label>
									<Input
										id={`${formId}-group`}
										variant="outlined"
										className="px-3 py-2"
										value={group}
										onChange={(event) => setGroup(event.target.value)}
										disabled={mutation.isPending}
										placeholder="Optional"
									/>
								</div>
								<div className="flex flex-col gap-2">
									<label
										htmlFor={`${formId}-description`}
										className="text-xs font-semibold text-slate-950"
									>
										Description
									</label>
									<Input
										id={`${formId}-description`}
										variant="outlined"
										className="px-3 py-2"
										value={description}
										onChange={(event) => setDescription(event.target.value)}
										disabled={mutation.isPending}
										placeholder="Optional"
									/>
								</div>
							</div>
							<div className="flex flex-col gap-3">
								<label
									htmlFor={`${formId}-replace-selection`}
									className="flex items-center gap-3 text-xs text-slate-800"
								>
									<Checkbox
										id={`${formId}-replace-selection`}
										checked={replaceSelection}
										onCheckedChange={(checked) =>
											setReplaceSelection(checked === true)
										}
										disabled={mutation.isPending}
									/>
									<span className="flex flex-col gap-0.5">
										<span>Replace selection with attached instance</span>
										<span className="text-[11px] text-slate-500">
											Publishes the initial version and swaps the selected
											layer.
										</span>
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
							disabled={mutation.isPending || loadingRevision}
						>
							{mutation.isPending ? "Extracting…" : "Extract component"}
						</Button>
					</div>
				</DialogContent>
			</DialogPortal>
		</Dialog>
	);
}
