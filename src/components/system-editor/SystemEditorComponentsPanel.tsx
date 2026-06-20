import { useHotkey } from "@tanstack/react-hotkeys";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	ArrowLeft,
	ChevronRight,
	Pencil,
	Plus,
	Save,
	Search,
	Trash2,
	UploadCloud,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ProjectQueryScope } from "../../queries/project-scope";
import { systemComponentsUsageQueryOptions } from "../../queries/system-component-usage";
import {
	copyPublishedSystemComponentToDraft,
	createSystemComponentDraft,
	deleteSystemComponent,
	invalidateSystemComponents,
	publishSystemComponent,
	type SystemComponentSummary,
	systemComponentQueryKey,
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
	resetComponentDraftStore,
	serializeComponentDraftState,
	serializeComponentDraftVariants,
	useComponentDraftComponentId,
	useComponentDraftRevision,
	useComponentDraftRootPath,
	useComponentDraftTemplateDirty,
	useComponentDraftVariantsDirty,
} from "../../stores/component-draft-store";
import {
	componentEditorSessionStore,
	isEditorMetadataChanged,
	markEditorMetadataSaved,
	resetComponentEditorSession,
	setLoadedDraftHashes,
	useEditorDraftConflict,
	useEditorMetadataChanged,
	useEditorVariantsValid,
	useLoadedDraftTemplateHash,
	useLoadedDraftVariantSchemaHash,
} from "../../stores/component-editor-session-store";
import {
	buildComponentGroupTree,
	type ComponentGroupTreeNode,
} from "../../utils/component-groups";
import { getKey, useWindowKeyDown } from "../../utils/editor-shortcuts";
import { isSystemComponentSlug } from "../../utils/system-components";
import { OpenDesignTokensButton } from "../OpenDesignTokensButton";
import { Alert } from "../ui/alert";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { Input } from "../ui/input";
import { ScrollArea } from "../ui/scroll-area";
import { Tabs, TabsList, TabsPanel, TabsTab } from "../ui/tabs";
import { Text } from "../ui/text";
import { ComponentDraftLayers } from "./ComponentDraftLayers";
import { ComponentDraftStage } from "./ComponentDraftStage";
import {
	getComponentPublicationState,
	nextUniqueComponentSlug,
	slugifyComponentName,
} from "./component-catalog";
import {
	SystemEditorComponentContextPanel,
	SystemEditorComponentContextSync,
} from "./SystemEditorInspector";

export function hasPublishableComponentDraftChanges({
	hasDraft,
	hasPublishedVersion,
	draftTemplateHash,
	draftVariantSchemaHash,
	publishedTemplateHash,
	publishedVariantSchemaHash,
}: {
	hasDraft: boolean;
	hasPublishedVersion: boolean;
	draftTemplateHash?: string | null;
	draftVariantSchemaHash?: string | null;
	publishedTemplateHash?: string | null;
	publishedVariantSchemaHash?: string | null;
}) {
	return (
		hasDraft &&
		(!hasPublishedVersion ||
			draftTemplateHash !== publishedTemplateHash ||
			(draftVariantSchemaHash ?? null) !== (publishedVariantSchemaHash ?? null))
	);
}

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
	const draftRootPath = useComponentDraftRootPath();
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
	const currentPublishedVersion = record?.published?.currentVersion
		? record.published.versions[record.published.currentVersion]
		: null;
	const hasPublishableChanges = hasPublishableComponentDraftChanges({
		hasDraft,
		hasPublishedVersion: Boolean(currentPublishedVersion),
		draftTemplateHash: componentQuery.data?.draftTemplateHash,
		draftVariantSchemaHash: componentQuery.data?.draftVariantSchemaHash,
		publishedTemplateHash: currentPublishedVersion?.templateHash,
		publishedVariantSchemaHash: currentPublishedVersion?.variantSchemaHash,
	});
	const draftMatchesComponent =
		Boolean(componentId) && draftComponentId === componentId;
	const hasUnsavedTemplateOrVariantChanges =
		draftMatchesComponent && (templateDirty || variantsDirty);
	const hasUnsavedDraftChanges =
		metadataChanged ||
		hasUnsavedTemplateOrVariantChanges ||
		Boolean(draftConflict);
	const draftNeedsRoot =
		draftMatchesComponent && templateDirty && !draftRootPath;
	const diagnostics = componentQuery.data?.diagnostics ?? [];
	const errorDiagnostics = diagnostics.filter(
		(diagnostic) => diagnostic.severity === "error",
	);
	const canSave =
		hasDraft &&
		!draftConflict &&
		variantsValid &&
		!draftNeedsRoot &&
		(metadataChanged || hasUnsavedTemplateOrVariantChanges);
	const canPublish =
		Boolean(componentQuery.data?.valid) &&
		hasDraft &&
		hasPublishableChanges &&
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
				if (templateDirty && !state.rootPath) {
					throw new Error("Add a root layer before saving the draft.");
				}
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
						? { variants: serializeComponentDraftVariants(state) }
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
			if (!hasPublishableChanges) {
				throw new Error("There are no draft changes to publish.");
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

	useHotkey(
		"Mod+S",
		() => {
			if (
				canSave &&
				!saveDraftMutation.isPending &&
				!componentQuery.isPending
			) {
				saveDraftMutation.mutate();
			}
		},
		{
			enabled: componentId !== null,
			preventDefault: true,
		},
	);

	if (!componentId) {
		return null;
	}

	return (
		<div className="mt-auto flex shrink-0 flex-col gap-2 border-t border-slate-200 px-3 py-2">
			<div className="flex flex-col gap-2">
				<div className="min-w-0">
					<p className="truncate font-mono text-[10px] text-slate-500">
						{hasDraft
							? draftConflict
								? "Server draft changed"
								: draftNeedsRoot
									? "Root layer required"
									: hasUnsavedDraftChanges
										? "Unsaved changes"
										: hasPublishableChanges
											? "Draft saved"
											: "No changes to publish"
							: componentQuery.isPending
								? "Loading draft"
								: "No draft available"}
					</p>
				</div>
				<div className="grid grid-cols-2 gap-2">
					<Button
						type="button"
						variant="block"
						className="flex items-center justify-center gap-1.5 px-2 py-1.5 text-xs"
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
						variant="filled"
						className="flex items-center justify-center gap-1.5 px-2 py-1.5 text-xs"
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
				<Card
					edge="border"
					tone="danger"
					className="px-2 py-1.5 text-[11px]"
					role="alert"
				>
					{saveError ?? publishError}
				</Card>
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

type ComponentRailTab = "design" | "settings" | "variants" | "publish";
const COMPONENT_RAIL_TABS: ComponentRailTab[] = [
	"design",
	"settings",
	"variants",
	"publish",
];

function filterComponents(
	components: readonly SystemComponentSummary[],
	filter: string,
) {
	const normalizedFilter = filter.trim().toLowerCase();
	if (!normalizedFilter) {
		return components;
	}

	return components.filter((component) =>
		[
			component.name,
			component.slug,
			component.group ?? "",
			component.currentVersion ? `v${component.currentVersion}` : "",
		]
			.join(" ")
			.toLowerCase()
			.includes(normalizedFilter),
	);
}

function ComponentRailEmptyState() {
	return (
		<div className="mt-2 mx-2 flex flex-1 flex-col items-center justify-center border border-dashed border-slate-300 px-4 py-10 text-center">
			<p className="text-sm font-medium text-slate-900">No components yet</p>
			<p className="mt-1 max-w-sm text-sm text-slate-500">
				Create a draft to start building the first system component in this
				manifest.
			</p>
		</div>
	);
}

function ComponentRailNoMatches() {
	return (
		<div className="mx-auto py-6 text-sm text-slate-500">
			No components match the current search.
		</div>
	);
}

export function SystemEditorComponentsRail({
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
	const selectedSummary =
		components.find(
			(component) => component.componentId === selectedComponentId,
		) ?? null;
	const [componentFilter, setComponentFilter] = useState("");
	const filteredComponents = useMemo(
		() => filterComponents(components, componentFilter),
		[componentFilter, components],
	);
	const groupTree = useMemo(
		() => buildComponentGroupTree(filteredComponents),
		[filteredComponents],
	);
	const isSearching = componentFilter.trim().length > 0;
	const collapseStorageKey = `trickroom:system-editor:collapsed-groups:${systemId}`;
	const [collapsedPaths, setCollapsedPaths] = useState<ReadonlySet<string>>(
		() => {
			if (typeof window === "undefined") {
				return new Set();
			}
			try {
				const raw = window.localStorage.getItem(collapseStorageKey);
				return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
			} catch {
				return new Set();
			}
		},
	);
	useEffect(() => {
		if (typeof window === "undefined") {
			return;
		}
		try {
			window.localStorage.setItem(
				collapseStorageKey,
				JSON.stringify([...collapsedPaths]),
			);
		} catch {
			// Ignore storage failures (private mode, quota); collapse is non-critical.
		}
	}, [collapseStorageKey, collapsedPaths]);
	const toggleFolder = useCallback((path: string) => {
		setCollapsedPaths((previous) => {
			const next = new Set(previous);
			if (next.has(path)) {
				next.delete(path);
			} else {
				next.add(path);
			}
			return next;
		});
	}, []);
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
	const [deleteError, setDeleteError] = useState<string | null>(null);
	const [activeComponentTab, setActiveComponentTab] =
		useState<ComponentRailTab>("design");
	const componentFilterRef = useRef<HTMLInputElement>(null);
	const handleSelectComponent = useCallback(
		(nextComponentId: string | null) => {
			if (nextComponentId !== selectedComponentId) {
				resetComponentDraftStore();
				resetComponentEditorSession();
			}
			onSelectComponent(nextComponentId);
		},
		[onSelectComponent, selectedComponentId],
	);

	useEffect(() => {
		if (selectedComponentId !== null) {
			setActiveComponentTab("design");
		}
	}, [selectedComponentId]);

	const handleComponentTabShortcut = useCallback(
		(event: KeyboardEvent) => {
			if (
				!event.ctrlKey ||
				event.metaKey ||
				event.altKey ||
				event.key !== "Tab"
			) {
				return;
			}

			const currentIndex = COMPONENT_RAIL_TABS.indexOf(activeComponentTab);
			const direction = event.shiftKey ? -1 : 1;
			const nextIndex =
				(currentIndex + direction + COMPONENT_RAIL_TABS.length) %
				COMPONENT_RAIL_TABS.length;
			setActiveComponentTab(COMPONENT_RAIL_TABS[nextIndex] ?? "design");
			event.preventDefault();
		},
		[activeComponentTab],
	);

	useWindowKeyDown(handleComponentTabShortcut, {
		enabled: selectedComponentId !== null,
	});

	const handleComponentFilterShortcut = useCallback((event: KeyboardEvent) => {
		const key = getKey(event);
		if (
			key !== "/" &&
			!((event.metaKey || event.ctrlKey) && !event.altKey && key === "f")
		) {
			return;
		}

		componentFilterRef.current?.focus();
		componentFilterRef.current?.select();
		event.preventDefault();
	}, []);

	useWindowKeyDown(handleComponentFilterShortcut, {
		enabled: selectedComponentId === null,
	});

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
			handleSelectComponent(response.componentId);
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
			handleSelectComponent(response.componentId);
			await invalidateSystemComponents(
				queryClient,
				systemId,
				projectScope,
				response.componentId,
			);
		},
	});

	const deleteComponentMutation = useMutation({
		mutationFn: async (component: SystemComponentSummary) => {
			const revision = componentsQuery.data?.revision;
			if (!revision) {
				throw new Error("Component manifest revision is not loaded yet.");
			}

			return deleteSystemComponent(systemId, component.componentId, {
				expectedRevision: revision,
			});
		},
		onMutate: () => setDeleteError(null),
		onError: (error) => {
			setDeleteError(
				error instanceof Error ? error.message : "Failed to delete component.",
			);
		},
		onSuccess: async (response) => {
			setDeleteError(null);
			if (selectedComponentId === response.componentId) {
				handleSelectComponent(null);
			}
			queryClient.removeQueries({
				queryKey: systemComponentQueryKey(
					systemId,
					response.componentId,
					projectScope,
				),
			});
			await invalidateSystemComponents(
				queryClient,
				systemId,
				projectScope,
				response.componentId,
			);
		},
	});

	const handleDeleteComponent = useCallback(
		(component: SystemComponentSummary) => {
			if (deleteComponentMutation.isPending) {
				return;
			}
			const confirmed = window.confirm(
				component.hasPublished
					? `Delete "${component.name}" and all published versions? This cannot be undone.`
					: `Delete "${component.name}"? This cannot be undone.`,
			);
			if (!confirmed) {
				return;
			}
			deleteComponentMutation.mutate(component);
		},
		[deleteComponentMutation],
	);

	const handleCreateDraft = useCallback(() => {
		const trimmed = draftName.trim();
		if (!trimmed || createDraftMutation.isPending) {
			return;
		}
		createDraftMutation.mutate(trimmed);
	}, [createDraftMutation, draftName]);

	const renderComponentRow = (component: SystemComponentSummary) => {
		const canCopyPublished = component.hasPublished && !component.hasDraft;
		const isCopying =
			copyPublishedMutation.isPending &&
			copyPublishedMutation.variables?.componentId === component.componentId;
		const isDeleting =
			deleteComponentMutation.isPending &&
			deleteComponentMutation.variables?.componentId === component.componentId;
		const usage = usageByComponent.get(component.componentId);
		return (
			<li key={component.componentId}>
				<div className="flex items-stretch gap-1">
					<Button
						type="button"
						variant="block"
						onClick={() => handleSelectComponent(component.componentId)}
						className="flex min-w-0 flex-1 items-start justify-between gap-2 px-2.5 py-2 text-left"
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
							className="flex w-8 shrink-0 items-center justify-center p-0"
							disabled={copyPublishedMutation.isPending}
							title="Create draft from published version"
							aria-label={`Create draft from published version for ${component.name}`}
							onClick={() => copyPublishedMutation.mutate(component)}
						>
							<Pencil className="size-3.5" aria-hidden="true" />
							<span className="sr-only">
								{isCopying ? "Creating draft" : "Edit draft"}
							</span>
						</Button>
					) : null}
					<Button
						type="button"
						variant="block"
						flavor="warning"
						className="flex w-8 shrink-0 items-center justify-center p-0"
						disabled={deleteComponentMutation.isPending}
						title="Delete component"
						aria-label={`Delete ${component.name}`}
						onClick={() => handleDeleteComponent(component)}
					>
						<Trash2 className="size-3.5" aria-hidden="true" />
						<span className="sr-only">
							{isDeleting ? "Deleting" : "Delete"}
						</span>
					</Button>
				</div>
			</li>
		);
	};

	const renderFolder = (node: ComponentGroupTreeNode, depth: number) => {
		const collapsed = !isSearching && collapsedPaths.has(node.path);
		const headerPadding = depth * 12 + 4;
		const childPadding = (depth + 1) * 12 + 4;
		return (
			<div key={node.path} className="flex flex-col gap-1">
				<button
					type="button"
					onClick={() => toggleFolder(node.path)}
					aria-expanded={!collapsed}
					className="flex items-center gap-1 py-0.5 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500 hover:text-slate-700"
					style={{ paddingLeft: `${headerPadding}px` }}
				>
					<ChevronRight
						className={`size-3 shrink-0 transition-transform ${
							collapsed ? "" : "rotate-90"
						}`}
						aria-hidden="true"
					/>
					<span className="truncate">{node.segment}</span>
				</button>
				{collapsed ? null : (
					<div className="flex flex-col gap-1">
						{node.folders.map((child) => renderFolder(child, depth + 1))}
						{node.components.length > 0 ? (
							<ul
								className="flex flex-col gap-1"
								style={{ paddingLeft: `${childPadding}px` }}
							>
								{node.components.map(renderComponentRow)}
							</ul>
						) : null}
					</div>
				)}
			</div>
		);
	};

	if (componentsQuery.isPending) {
		return (
			<div className="flex min-h-0 flex-1 flex-col px-3 py-4">
				<p className="text-sm text-slate-500">Loading components...</p>
			</div>
		);
	}

	if (componentsQuery.isError) {
		return (
			<div className="flex min-h-0 flex-1 flex-col px-3 py-4">
				<Alert variant="panel">
					<span className="block text-sm font-medium">
						Failed to load components
					</span>
					<span className="mt-1 block text-xs">
						{(componentsQuery.error as Error).message}
					</span>
				</Alert>
			</div>
		);
	}

	if (selectedComponentId) {
		return (
			<div className="flex min-h-0 flex-1 flex-col">
				<SystemEditorComponentContextSync
					systemId={systemId}
					projectScope={projectScope}
					componentId={selectedComponentId}
				/>
				<header className="flex h-12 shrink-0 items-center gap-2 border-b border-slate-200 px-2">
					<Button
						type="button"
						variant="block"
						className="flex size-7 shrink-0 items-center justify-center p-0"
						onClick={() => handleSelectComponent(null)}
						title="Back to components"
					>
						<ArrowLeft className="size-4 text-slate-500" aria-hidden="true" />
					</Button>
					<div className="min-w-0 flex-1">
						<Text
							variant="label"
							className="block truncate text-[13px] font-semibold text-slate-900"
						>
							{selectedSummary?.name ?? "Component"}
						</Text>
						<span className="block truncate font-mono text-[10px] text-slate-400">
							{selectedSummary?.slug ?? selectedComponentId}
						</span>
					</div>
					<OpenDesignTokensButton systemId={systemId} />
					{selectedSummary ? (
						<ComponentStatusBadge summary={selectedSummary} />
					) : null}
				</header>
				<Tabs
					value={activeComponentTab}
					onValueChange={(value) =>
						setActiveComponentTab(value as ComponentRailTab)
					}
					className="flex h-full min-h-0 flex-1 flex-col gap-0 overflow-hidden"
				>
					<TabsList variant="line" className="shrink-0 px-2">
						<TabsTab value="design" variant="block" className="px-3 py-2">
							Design
						</TabsTab>
						<TabsTab value="settings" variant="block" className="px-3 py-2">
							Settings
						</TabsTab>
						<TabsTab value="variants" variant="block" className="px-3 py-2">
							Variants
						</TabsTab>
						<TabsTab value="publish" variant="block" className="px-3 py-2">
							Publish
						</TabsTab>
					</TabsList>
					<TabsPanel
						value="design"
						className="flex h-full min-h-0 flex-1 flex-col overflow-hidden"
					>
						<ComponentDraftLayers componentId={selectedComponentId} embedded />
					</TabsPanel>
					<TabsPanel
						value="settings"
						className="flex h-full min-h-0 flex-1 flex-col overflow-hidden"
					>
						<ScrollArea className="h-full min-h-0">
							<div className="px-3 py-3">
								<SystemEditorComponentContextPanel
									systemId={systemId}
									projectScope={projectScope}
									componentId={selectedComponentId}
									mode="settings"
								/>
							</div>
						</ScrollArea>
					</TabsPanel>
					<TabsPanel
						value="variants"
						className="flex h-full min-h-0 flex-1 flex-col overflow-hidden"
					>
						<ScrollArea className="h-full min-h-0">
							<div className="px-3 py-3">
								<SystemEditorComponentContextPanel
									systemId={systemId}
									projectScope={projectScope}
									componentId={selectedComponentId}
									mode="variants"
								/>
							</div>
						</ScrollArea>
					</TabsPanel>
					<TabsPanel
						value="publish"
						className="flex h-full min-h-0 flex-1 flex-col overflow-hidden"
					>
						<ScrollArea className="h-full min-h-0">
							<div className="px-3 py-3">
								<SystemEditorComponentContextPanel
									systemId={systemId}
									projectScope={projectScope}
									componentId={selectedComponentId}
									mode="publish"
								/>
							</div>
						</ScrollArea>
					</TabsPanel>
				</Tabs>
				<ComponentWorkspaceActions
					systemId={systemId}
					projectScope={projectScope}
					componentId={selectedComponentId}
				/>
			</div>
		);
	}

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<div className="flex shrink-0 flex-col gap-2 border-b border-slate-200 px-2 py-2">
				<div className="relative">
					<Search
						className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-slate-500"
						aria-hidden="true"
					/>
					<Input
						ref={componentFilterRef}
						variant="formCompact"
						className="w-full px-7"
						aria-label="Search components"
						placeholder="Search components"
						value={componentFilter}
						onChange={(event) => setComponentFilter(event.target.value)}
					/>
				</div>
				<div className="flex items-center gap-2">
					<Input
						id="system-editor-new-component-name"
						variant="formCompact"
						placeholder="New component name"
						value={draftName}
						onChange={(event) => setDraftName(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === "Enter") {
								event.preventDefault();
								handleCreateDraft();
							}
						}}
					/>
					<Button
						type="button"
						variant="filled"
						className="flex shrink-0 items-center gap-1.5 px-2.5 py-1.5"
						disabled={!draftName.trim() || createDraftMutation.isPending}
						onClick={handleCreateDraft}
					>
						<Plus className="size-3.5" aria-hidden="true" />
						{createDraftMutation.isPending ? "Creating" : "New"}
					</Button>
				</div>
			</div>
			{createError ? (
				<Card
					edge="border"
					tone="danger"
					className="mx-2 mt-2 px-3 py-2 text-xs"
					role="alert"
				>
					{createError}
				</Card>
			) : null}
			{copyDraftError ? (
				<Card
					edge="border"
					tone="danger"
					className="mx-2 mt-2 px-3 py-2 text-xs"
					role="alert"
				>
					{copyDraftError}
				</Card>
			) : null}
			{deleteError ? (
				<Card
					edge="border"
					tone="danger"
					className="mx-2 mt-2 px-3 py-2 text-xs"
					role="alert"
				>
					{deleteError}
				</Card>
			) : null}
			{components.length === 0 ? (
				<ComponentRailEmptyState />
			) : filteredComponents.length === 0 ? (
				<ComponentRailNoMatches />
			) : (
				<ScrollArea className="min-h-0 flex-1">
					<div className="flex flex-col gap-1 px-2 py-3">
						{groupTree.folders.map((node) => renderFolder(node, 0))}
						{groupTree.ungrouped.length > 0 ? (
							<ul className="flex flex-col gap-1">
								{groupTree.ungrouped.map(renderComponentRow)}
							</ul>
						) : null}
					</div>
				</ScrollArea>
			)}
		</div>
	);
}

export function SystemEditorComponentsPanel({
	systemId,
	projectScope,
	selectedComponentId,
}: {
	systemId: string;
	projectScope?: ProjectQueryScope;
	selectedComponentId: string | null;
	onSelectComponent: (componentId: string | null) => void;
}) {
	return (
		<div className="flex min-h-0 min-w-0 flex-1">
			<ComponentDraftStage
				systemId={systemId}
				componentId={selectedComponentId}
				projectScope={projectScope}
			/>
		</div>
	);
}
