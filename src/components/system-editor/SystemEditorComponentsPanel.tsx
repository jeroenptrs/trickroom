import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Save, UploadCloud } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import type { ProjectQueryScope } from "../../queries/project-scope";
import { systemComponentsUsageQueryOptions } from "../../queries/system-component-usage";
import {
	copyPublishedSystemComponentToDraft,
	createSystemComponentDraft,
	invalidateSystemComponents,
	publishSystemComponent,
	type SystemComponentSummary,
	systemComponentQueryOptions,
	systemComponentsQueryOptions,
	updateSystemComponentDraft,
	updateSystemComponentMetadata,
} from "../../queries/system-components";
import {
	clearComponentDraftDirty,
	componentDraftStore,
	getComponentDraftTemplateHash,
	isComponentDraftForComponent,
	serializeComponentDraftState,
	useComponentDraftComponentId,
	useComponentDraftRevision,
	useComponentDraftTemplateDirty,
	useComponentDraftVariantsDirty,
} from "../../stores/component-draft-store";
import {
	componentEditorSessionStore,
	isEditorMetadataChanged,
	markEditorMetadataSaved,
	setLoadedDraftHashes,
	useEditorDraftConflict,
	useEditorMetadataChanged,
	useEditorVariantsValid,
	useLoadedDraftTemplateHash,
	useLoadedDraftVariantSchemaHash,
} from "../../stores/component-editor-session-store";
import { isSystemComponentSlug } from "../../utils/system-components";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { ComponentDraftLayers } from "./ComponentDraftLayers";
import { ComponentDraftStage } from "./ComponentDraftStage";
import {
	getComponentPublicationState,
	groupComponentsByGroup,
	nextUniqueComponentSlug,
	slugifyComponentName,
} from "./component-catalog";

type ComponentUsageSummary = {
	usedByCount: number;
	currentCount: number;
	staleCount: number;
	hashMismatchCount: number;
	diagnosticCount: number;
	hasDiagnosticsMissing: boolean;
};

const emptyUsageSummary = (): ComponentUsageSummary => ({
	usedByCount: 0,
	currentCount: 0,
	staleCount: 0,
	hashMismatchCount: 0,
	diagnosticCount: 0,
	hasDiagnosticsMissing: false,
});

function ComponentUsageBadge({
	component,
	usage,
	isPending,
	isError,
}: {
	component: SystemComponentSummary;
	usage?: ComponentUsageSummary;
	isPending: boolean;
	isError: boolean;
}) {
	if (!component.hasPublished) {
		return (
			<span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
				Not published
			</span>
		);
	}

	if (isPending) {
		return (
			<span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
				Checking usage
			</span>
		);
	}

	if (isError) {
		return (
			<span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-900">
				Usage unavailable
			</span>
		);
	}

	const summary = usage ?? emptyUsageSummary();
	if (summary.hasDiagnosticsMissing) {
		return (
			<span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-800">
				Diagnostics missing
			</span>
		);
	}

	if (summary.staleCount > 0) {
		return (
			<span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-900">
				{summary.staleCount} stale
			</span>
		);
	}

	if (summary.hashMismatchCount > 0) {
		return (
			<span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-900">
				{summary.hashMismatchCount} review
			</span>
		);
	}

	if (summary.usedByCount > 0) {
		return (
			<span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-800">
				{summary.currentCount || summary.usedByCount} current
			</span>
		);
	}

	return (
		<span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
			No usages
		</span>
	);
}

function ComponentWorkspaceActions({
	systemId,
	projectScope,
	componentId,
}: {
	systemId: string;
	projectScope?: ProjectQueryScope;
	componentId: string | null;
}) {
	const queryClient = useQueryClient();
	const draftRevision = useComponentDraftRevision();
	const templateDirty = useComponentDraftTemplateDirty();
	const variantsDirty = useComponentDraftVariantsDirty();
	const draftComponentId = useComponentDraftComponentId();
	const metadataChanged = useEditorMetadataChanged();
	const loadedDraftTemplateHash = useLoadedDraftTemplateHash();
	const loadedDraftVariantSchemaHash = useLoadedDraftVariantSchemaHash();
	const variantsValid = useEditorVariantsValid();
	const draftConflict = useEditorDraftConflict();
	const componentQuery = useQuery({
		...systemComponentQueryOptions(systemId, componentId ?? "", projectScope),
		enabled: componentId !== null,
	});
	const record = componentQuery.data?.record;
	const hasDraft = Boolean(record?.draft);
	const draftMatchesComponent =
		Boolean(componentId) && draftComponentId === componentId;
	const hasUnsavedTemplateOrVariantChanges =
		draftMatchesComponent && (templateDirty || variantsDirty);
	const hasUnsavedDraftChanges =
		metadataChanged ||
		hasUnsavedTemplateOrVariantChanges ||
		Boolean(draftConflict);
	const diagnostics = componentQuery.data?.diagnostics ?? [];
	const errorDiagnostics = diagnostics.filter(
		(diagnostic) => diagnostic.severity === "error",
	);
	const canSave =
		hasDraft &&
		!draftConflict &&
		variantsValid &&
		(metadataChanged || hasUnsavedTemplateOrVariantChanges);
	const canPublish =
		Boolean(componentQuery.data?.valid) &&
		hasDraft &&
		!hasUnsavedDraftChanges &&
		variantsValid &&
		errorDiagnostics.length === 0;
	const [saveError, setSaveError] = useState<string | null>(null);
	const [publishError, setPublishError] = useState<string | null>(null);

	const saveDraftMutation = useMutation({
		// The single save path for the whole draft: component metadata, the
		// template tree, and the variant schema. Metadata is edited in the
		// inspector but persisted here so this stays the only "Save draft" button.
		mutationFn: async () => {
			if (!componentId || !componentQuery.data?.record.draft) {
				throw new Error("Select a component draft before saving.");
			}

			const session = componentEditorSessionStore.get();
			const storeRevision = draftRevision;
			let expectedRevision = componentQuery.data.revision;
			const trimmedName = session.metadata.name.trim();
			if (!trimmedName) {
				throw new Error("Component name is required.");
			}
			const trimmedSlug = session.metadata.slug.trim();
			if (!trimmedSlug) {
				throw new Error("Component slug is required.");
			}
			if (!isSystemComponentSlug(trimmedSlug)) {
				throw new Error(
					"Component slug must use lowercase alphanumeric segments separated by hyphens.",
				);
			}
			if (!session.variantsValid) {
				throw new Error("Resolve variant diagnostics before saving.");
			}

			const draftDirty = templateDirty || variantsDirty;
			if (draftDirty && !isComponentDraftForComponent(componentId)) {
				throw new Error(
					"The open draft no longer matches the selected component. Reload the component before saving.",
				);
			}

			const savedMetadata = session.metadata;
			if (isEditorMetadataChanged(session)) {
				const metadataResult = await updateSystemComponentMetadata(
					systemId,
					componentId,
					{
						expectedRevision,
						name: trimmedName,
						slug: trimmedSlug,
						description: session.metadata.description.trim()
							? session.metadata.description
							: null,
						group: session.metadata.group.trim()
							? session.metadata.group
							: null,
						order: session.metadata.order.trim()
							? Number(session.metadata.order)
							: null,
					},
				);
				expectedRevision = metadataResult.revision;
			}

			let savedDraftTemplate = false;
			let savedDraftVariants = false;
			if (draftDirty) {
				if (templateDirty && session.draftConflict) {
					throw new Error(session.draftConflict);
				}
				const state = componentDraftStore.get();
				const savedTemplateHash = getComponentDraftTemplateHash(state);
				savedDraftTemplate = templateDirty;
				savedDraftVariants = variantsDirty;
				await updateSystemComponentDraft(systemId, componentId, {
					expectedRevision,
					expectedDraftTemplateHash: templateDirty
						? (loadedDraftTemplateHash ?? undefined)
						: undefined,
					expectedDraftVariantSchemaHash: variantsDirty
						? (loadedDraftVariantSchemaHash ?? undefined)
						: undefined,
					...(templateDirty
						? {
								root: serializeComponentDraftState(state),
								slots: Object.keys(state.slots).length > 0 ? state.slots : null,
								overrideTargets:
									Object.keys(state.overrideTargets).length > 0
										? state.overrideTargets
										: null,
							}
						: {}),
					...(variantsDirty
						? { variants: componentDraftStore.get().variants }
						: {}),
				});
				if (
					templateDirty &&
					savedTemplateHash === getComponentDraftTemplateHash()
				) {
					clearComponentDraftDirty(storeRevision);
				}
			}

			return {
				savedMetadata,
				savedDraftTemplate,
				savedDraftVariants,
				storeRevision,
			};
		},
		onMutate: () => setSaveError(null),
		onError: async (error) => {
			setSaveError(
				error instanceof Error
					? error.message
					: "Failed to save component draft.",
			);
			if (componentId) {
				await invalidateSystemComponents(
					queryClient,
					systemId,
					projectScope,
					componentId,
				);
			}
		},
		onSuccess: async ({
			savedMetadata,
			savedDraftTemplate,
			savedDraftVariants,
			storeRevision,
		}) => {
			clearComponentDraftDirty(storeRevision);
			markEditorMetadataSaved(savedMetadata);
			setSaveError(null);
			if (componentId) {
				if (savedDraftTemplate || savedDraftVariants) {
					const refreshed = await queryClient.fetchQuery(
						systemComponentQueryOptions(systemId, componentId, projectScope),
					);
					setLoadedDraftHashes({
						...(savedDraftTemplate
							? { templateHash: refreshed.draftTemplateHash ?? null }
							: {}),
						...(savedDraftVariants
							? {
									variantSchemaHash: refreshed.draftVariantSchemaHash ?? null,
								}
							: {}),
					});
				}
				await invalidateSystemComponents(
					queryClient,
					systemId,
					projectScope,
					componentId,
				);
			}
		},
	});

	const publishDraftMutation = useMutation({
		mutationFn: async () => {
			if (!componentId || !componentQuery.data?.record.draft) {
				throw new Error("Select a component draft before publishing.");
			}
			if (hasUnsavedDraftChanges) {
				throw new Error("Save the draft before publishing this version.");
			}
			if (!variantsValid) {
				throw new Error("Resolve variant diagnostics before publishing.");
			}
			if (errorDiagnostics.length > 0 || !componentQuery.data.valid) {
				throw new Error(
					errorDiagnostics[0]?.message ??
						"Resolve validation diagnostics before publishing.",
				);
			}

			return publishSystemComponent(systemId, componentId, {
				expectedRevision: componentQuery.data.revision,
			});
		},
		onMutate: () => setPublishError(null),
		onError: async (error) => {
			setPublishError(
				error instanceof Error
					? error.message
					: "Failed to publish component draft.",
			);
			if (componentId) {
				await invalidateSystemComponents(
					queryClient,
					systemId,
					projectScope,
					componentId,
				);
			}
		},
		onSuccess: async () => {
			setPublishError(null);
			if (componentId) {
				await invalidateSystemComponents(
					queryClient,
					systemId,
					projectScope,
					componentId,
				);
			}
		},
	});

	if (!componentId) {
		return null;
	}

	return (
		<div className="flex shrink-0 flex-col gap-2 border-b border-slate-200 bg-slate-100 px-4 py-2">
			<div className="flex min-h-8 flex-wrap items-center justify-between gap-2">
				<div className="min-w-0">
					<p className="truncate text-xs font-medium text-slate-900">
						{record?.name ?? "Component"}
					</p>
					<p className="truncate font-mono text-[10px] text-slate-500">
						{hasDraft
							? draftConflict
								? "Server draft changed"
								: hasUnsavedDraftChanges
									? "Unsaved changes"
									: "Draft saved"
							: componentQuery.isPending
								? "Loading draft"
								: "No draft available"}
					</p>
				</div>
				<div className="flex shrink-0 items-center gap-2">
					<Button
						type="button"
						variant="block"
						className="flex items-center gap-1.5"
						disabled={
							!canSave ||
							saveDraftMutation.isPending ||
							componentQuery.isPending
						}
						onClick={() => saveDraftMutation.mutate()}
					>
						<Save className="size-3.5" aria-hidden="true" />
						{saveDraftMutation.isPending ? "Saving" : "Save draft"}
					</Button>
					<Button
						type="button"
						variant="blockDark"
						className="bg-slate-900 flex items-center gap-1.5"
						disabled={
							!canPublish ||
							publishDraftMutation.isPending ||
							saveDraftMutation.isPending
						}
						onClick={() => publishDraftMutation.mutate()}
					>
						<UploadCloud className="size-3.5" aria-hidden="true" />
						{publishDraftMutation.isPending ? "Publishing" : "Publish draft"}
					</Button>
				</div>
			</div>
			{saveError || publishError ? (
				<p
					className="border border-red-200 bg-red-50 px-2 py-1.5 text-[11px] text-red-700"
					role="alert"
				>
					{saveError ?? publishError}
				</p>
			) : null}
		</div>
	);
}

function ComponentStatusBadge({
	summary,
}: {
	summary: SystemComponentSummary;
}) {
	const state = getComponentPublicationState(summary);
	if (state === "draft-over-published") {
		return (
			<span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-800">
				Draft over v{summary.currentVersion ?? "?"}
			</span>
		);
	}

	if (state === "published-only") {
		return (
			<span className="rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-medium text-sky-800">
				Published v{summary.currentVersion ?? "?"}
			</span>
		);
	}

	return (
		<span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-900">
			Draft only
		</span>
	);
}

export function SystemEditorComponentsPanel({
	systemId,
	projectScope,
	selectedComponentId,
	onSelectComponent,
}: {
	systemId: string;
	projectScope?: ProjectQueryScope;
	selectedComponentId: string | null;
	onSelectComponent: (componentId: string | null) => void;
}) {
	const queryClient = useQueryClient();
	const componentsQuery = useQuery(
		systemComponentsQueryOptions(systemId, projectScope),
	);
	const usageQuery = useQuery(
		systemComponentsUsageQueryOptions(systemId, projectScope),
	);
	const components = componentsQuery.data?.components ?? [];
	const groupedSections = useMemo(
		() => groupComponentsByGroup(components),
		[components],
	);
	const usageByComponent = useMemo(() => {
		const byComponent = new Map<string, ComponentUsageSummary>();
		for (const instance of usageQuery.data?.instances ?? []) {
			const summary =
				byComponent.get(instance.componentId) ?? emptyUsageSummary();
			summary.usedByCount += 1;
			if (instance.versionStatus?.status === "stale") {
				summary.staleCount += 1;
			} else if (instance.versionStatus?.status === "hash-mismatch") {
				summary.hashMismatchCount += 1;
			} else if (instance.versionStatus?.status === "current") {
				summary.currentCount += 1;
			} else if (!instance.versionStatus) {
				summary.hasDiagnosticsMissing = true;
			}
			byComponent.set(instance.componentId, summary);
		}
		for (const diagnostic of usageQuery.data?.diagnostics ?? []) {
			if (!diagnostic.componentId) {
				continue;
			}
			const summary =
				byComponent.get(diagnostic.componentId) ?? emptyUsageSummary();
			summary.diagnosticCount += 1;
			if (
				diagnostic.code === "UNKNOWN_COMPONENT" ||
				diagnostic.code === "UNKNOWN_VERSION" ||
				diagnostic.code === "MALFORMED_INSTANCE_MARKER" ||
				diagnostic.code === "DESIGN_READ_FAILED" ||
				diagnostic.code === "INVALID_DESIGN_PAYLOAD"
			) {
				summary.hasDiagnosticsMissing = true;
			}
			byComponent.set(diagnostic.componentId, summary);
		}
		return byComponent;
	}, [usageQuery.data]);
	const [draftName, setDraftName] = useState("");
	const [createError, setCreateError] = useState<string | null>(null);
	const [copyDraftError, setCopyDraftError] = useState<string | null>(null);

	const createDraftMutation = useMutation({
		mutationFn: async (name: string) => {
			const revision = componentsQuery.data?.revision;
			if (!revision) {
				throw new Error("Component manifest revision is not loaded yet.");
			}

			const baseSlug = slugifyComponentName(name);
			if (!baseSlug) {
				throw new Error("Enter a name with at least one letter or number.");
			}

			return createSystemComponentDraft(systemId, {
				expectedRevision: revision,
				slug: nextUniqueComponentSlug(baseSlug, components),
				name: name.trim(),
			});
		},
		onMutate: () => setCreateError(null),
		onError: (error) => {
			setCreateError(
				error instanceof Error
					? error.message
					: "Failed to create component draft.",
			);
		},
		onSuccess: async (response) => {
			setDraftName("");
			setCreateError(null);
			onSelectComponent(response.componentId);
			await invalidateSystemComponents(
				queryClient,
				systemId,
				projectScope,
				response.componentId,
			);
		},
	});

	const copyPublishedMutation = useMutation({
		mutationFn: async (component: SystemComponentSummary) => {
			const revision = componentsQuery.data?.revision;
			if (!revision) {
				throw new Error("Component manifest revision is not loaded yet.");
			}
			if (component.hasDraft) {
				throw new Error(
					`Component "${component.name}" already has a draft. Select the draft instead.`,
				);
			}

			return copyPublishedSystemComponentToDraft(
				systemId,
				component.componentId,
				{
					expectedRevision: revision,
					...(component.currentVersion
						? { versionId: component.currentVersion }
						: {}),
				},
			);
		},
		onMutate: () => setCopyDraftError(null),
		onError: (error) => {
			setCopyDraftError(
				error instanceof Error
					? error.message
					: "Failed to create draft from published version.",
			);
		},
		onSuccess: async (response) => {
			setCopyDraftError(null);
			onSelectComponent(response.componentId);
			await invalidateSystemComponents(
				queryClient,
				systemId,
				projectScope,
				response.componentId,
			);
		},
	});

	const handleCreateDraft = useCallback(() => {
		const trimmed = draftName.trim();
		if (!trimmed || createDraftMutation.isPending) {
			return;
		}
		createDraftMutation.mutate(trimmed);
	}, [createDraftMutation, draftName]);

	if (componentsQuery.isPending) {
		return (
			<div className="flex min-h-0 flex-1 flex-col px-5 py-4">
				<p className="text-sm text-slate-500">Loading components...</p>
			</div>
		);
	}

	if (componentsQuery.isError) {
		return (
			<div className="flex min-h-0 flex-1 flex-col px-5 py-4" role="alert">
				<p className="text-sm font-medium text-red-950">
					Failed to load components
				</p>
				<p className="mt-1 text-xs text-red-700">
					{(componentsQuery.error as Error).message}
				</p>
			</div>
		);
	}

	return (
		<div className="flex min-h-0 flex-1">
			<div className="flex min-h-0 w-[360px] shrink-0 flex-col gap-4 px-5 py-4">
				<div className="flex flex-wrap items-end gap-2">
					<div className="min-w-[12rem] flex-1">
						<label
							htmlFor="system-editor-new-component-name"
							className="mb-1 block text-[10px] uppercase tracking-wider text-slate-500"
						>
							New component
						</label>
						<Input
							id="system-editor-new-component-name"
							variant="formCompact"
							placeholder="Component name"
							value={draftName}
							onChange={(event) => setDraftName(event.target.value)}
							onKeyDown={(event) => {
								if (event.key === "Enter") {
									event.preventDefault();
									handleCreateDraft();
								}
							}}
						/>
					</div>
					<Button
						type="button"
						variant="blockDark"
						className="flex items-center gap-1.5"
						disabled={!draftName.trim() || createDraftMutation.isPending}
						onClick={handleCreateDraft}
					>
						<Plus className="size-3.5" aria-hidden="true" />
						{createDraftMutation.isPending ? "Creating" : "Create draft"}
					</Button>
				</div>
				{createError ? (
					<div
						className="border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"
						role="alert"
					>
						{createError}
					</div>
				) : null}
				{copyDraftError ? (
					<div
						className="border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"
						role="alert"
					>
						{copyDraftError}
					</div>
				) : null}
				{components.length === 0 ? (
					<div className="flex flex-1 flex-col items-center justify-center border border-dashed border-slate-300 bg-white px-4 py-10 text-center">
						<p className="text-sm font-medium text-slate-900">
							No components yet
						</p>
						<p className="mt-1 max-w-sm text-sm text-slate-500">
							Create a draft to start building the first system component in
							this manifest.
						</p>
					</div>
				) : (
					<div className="flex min-h-0 flex-1 flex-col gap-5">
						{groupedSections.map((section) => (
							<section key={section.group} className="flex flex-col gap-2">
								<h2 className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
									{section.group}
								</h2>
								<ul className="flex flex-col gap-1.5">
									{section.components.map((component) => {
										const isSelected =
											selectedComponentId === component.componentId;
										const canCopyPublished =
											component.hasPublished && !component.hasDraft;
										const isCopying =
											copyPublishedMutation.isPending &&
											copyPublishedMutation.variables?.componentId ===
												component.componentId;
										const usage = usageByComponent.get(component.componentId);
										return (
											<li key={component.componentId}>
												<div className="flex items-stretch gap-1.5">
													<Button
														type="button"
														variant="block"
														isSelected={isSelected}
														onClick={() =>
															onSelectComponent(component.componentId)
														}
														className="flex min-w-0 flex-1 items-start justify-between gap-3 px-3 py-2 text-left"
													>
														<span className="min-w-0 flex-1">
															<span className="block truncate font-medium">
																{component.name}
															</span>
															<span className="mt-1 flex flex-wrap items-center gap-1">
																<span className="truncate font-mono text-[10px] text-slate-500">
																	{component.slug}
																</span>
																<ComponentUsageBadge
																	component={component}
																	usage={usage}
																	isPending={usageQuery.isPending}
																	isError={usageQuery.isError}
																/>
															</span>
														</span>
														<ComponentStatusBadge summary={component} />
													</Button>
													{canCopyPublished ? (
														<Button
															type="button"
															variant="block"
															className="flex w-9 shrink-0 items-center justify-center p-0"
															disabled={copyPublishedMutation.isPending}
															title="Create draft from published version"
															aria-label={`Create draft from published version for ${component.name}`}
															onClick={() =>
																copyPublishedMutation.mutate(component)
															}
														>
															<Pencil className="size-3.5" aria-hidden="true" />
															<span className="sr-only">
																{isCopying ? "Creating draft" : "Edit draft"}
															</span>
														</Button>
													) : null}
												</div>
											</li>
										);
									})}
								</ul>
							</section>
						))}
					</div>
				)}
			</div>
			<div className="flex min-h-0 min-w-0 flex-1 flex-col">
				<ComponentWorkspaceActions
					systemId={systemId}
					projectScope={projectScope}
					componentId={selectedComponentId}
				/>
				<div className="flex min-h-0 flex-1">
					{selectedComponentId ? (
						<ComponentDraftLayers componentId={selectedComponentId} />
					) : null}
					<ComponentDraftStage
						systemId={systemId}
						componentId={selectedComponentId}
						projectScope={projectScope}
					/>
				</div>
			</div>
		</div>
	);
}
