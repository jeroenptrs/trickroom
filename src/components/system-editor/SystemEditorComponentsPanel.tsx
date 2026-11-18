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
import {
	type ReactNode,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
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
} from "../../queries/system-components";
import {
	useComponentDraftComponentId,
	useComponentDraftRootPath,
	useComponentDraftTemplateDirty,
	useComponentDraftVariantsDirty,
} from "../../stores/component-draft-store";
import {
	useEditorDraftConflict,
	useEditorMetadataChanged,
	useEditorVariantsValid,
} from "../../stores/component-editor-session-store";
import {
	buildComponentGroupTree,
	type ComponentGroupTreeNode,
} from "../../utils/component-groups";
import { getKey, useWindowKeyDown } from "../../utils/editor-shortcuts";
import { OpenDesignTokensButton } from "../OpenDesignTokensButton";
import { Alert } from "../ui/alert";
import { ConfirmationDialog } from "../ui/alert-dialog";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { Input } from "../ui/input";
import { ScrollArea } from "../ui/scroll-area";
import { Skeleton } from "../ui/skeleton";
import { Tabs, TabsList, TabsPanel, TabsTab } from "../ui/tabs";
import { Text } from "../ui/text";
import { Tooltip } from "../ui/tooltip";
import { ComponentDraftLayers } from "./ComponentDraftLayers";
import { ComponentDraftStage } from "./ComponentDraftStage";
import {
	getComponentPublicationState,
	nextUniqueComponentSlug,
	slugifyComponentName,
} from "./component-catalog";
import { DisabledReason } from "./DisabledReason";
import {
	SystemEditorComponentContextPanel,
	SystemEditorComponentContextSync,
} from "./SystemEditorInspector";
import { discardOpenComponentDraft } from "./useGuardedComponentLocation";
import { useSaveComponentDraft } from "./useSaveComponentDraft";

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
		return <Skeleton className="h-4 w-14" />;
	}

	// The list shows the failure once, with its retry.
	if (isError) {
		return null;
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
	const templateDirty = useComponentDraftTemplateDirty();
	const variantsDirty = useComponentDraftVariantsDirty();
	const draftComponentId = useComponentDraftComponentId();
	const draftRootPath = useComponentDraftRootPath();
	const metadataChanged = useEditorMetadataChanged();
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
	const canPublish =
		Boolean(componentQuery.data?.valid) &&
		hasDraft &&
		hasPublishableChanges &&
		!hasUnsavedDraftChanges &&
		variantsValid &&
		errorDiagnostics.length === 0;
	// The first condition that keeps Publish disabled, as its tooltip.
	const publishBlockedReason = canPublish
		? null
		: hasUnsavedDraftChanges
			? "Save the draft first."
			: !hasPublishableChanges
				? "Nothing to publish."
				: !variantsValid
					? "Fix the variant errors first."
					: errorDiagnostics.length > 0 || !componentQuery.data?.valid
						? (errorDiagnostics[0]?.message ?? "Fix the draft's errors first.")
						: null;
	const [publishError, setPublishError] = useState<string | null>(null);
	const { saveDraftMutation, saveError, canSave } = useSaveComponentDraft({
		systemId,
		projectScope,
		componentId,
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

	// Nothing here works without a draft; the stage offers to create one.
	if (!componentId || (!componentQuery.isPending && !hasDraft)) {
		return null;
	}

	const reloadDraft = () => {
		// Drops the local edits; the context sync then hydrates the draft
		// that is on disk now.
		discardOpenComponentDraft();
		void invalidateSystemComponents(
			queryClient,
			systemId,
			projectScope,
			componentId,
		);
	};

	return (
		<div className="mt-auto flex shrink-0 flex-col gap-2 border-t border-slate-200 px-3 py-2">
			<div className="flex flex-col gap-2">
				<div className="flex min-h-4 min-w-0 items-center gap-2">
					{componentQuery.isPending ? (
						<Skeleton className="h-3 w-24" />
					) : (
						<p className="min-w-0 flex-1 truncate font-mono text-[10px] text-slate-500">
							{draftConflict
								? "Draft changed on disk"
								: draftNeedsRoot
									? "Root layer required"
									: hasUnsavedDraftChanges
										? "Unsaved changes"
										: hasPublishableChanges
											? "Draft saved"
											: "No changes to publish"}
						</p>
					)}
					{draftConflict ? (
						<Button
							type="button"
							variant="outlined"
							flavor="danger"
							className="shrink-0 px-2 py-1 text-xs"
							disabled={saveDraftMutation.isPending}
							onClick={reloadDraft}
						>
							Reload draft
						</Button>
					) : null}
				</div>
				<div className="flex gap-2">
					<Button
						type="button"
						variant="block"
						className="flex flex-1 items-center justify-center gap-1.5 px-2 py-1.5 text-xs"
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
					<DisabledReason
						reason={componentQuery.isPending ? null : publishBlockedReason}
						className="flex flex-1"
					>
						<Button
							type="button"
							variant="filled"
							className="flex flex-1 items-center justify-center gap-1.5 px-2 py-1.5 text-xs"
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
					</DisabledReason>
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

/**
 * Component context header row: back to the component list, the component's
 * name and slug, and its publication state. Shared by the components rail
 * and the floating header left in its place when the rail is collapsed.
 */
export function ComponentContextHeaderContent({
	componentId,
	summary,
	onBack,
	tools,
	actions,
}: {
	componentId: string;
	summary: SystemComponentSummary | null;
	onBack: () => void;
	/** Controls placed between the title and the status badge. */
	tools?: ReactNode;
	/** Trailing controls, after the status badge. */
	actions?: ReactNode;
}) {
	return (
		<>
			<Tooltip content="Back to components">
				<Button
					type="button"
					variant="block"
					className="flex size-7 shrink-0 items-center justify-center p-0"
					onClick={onBack}
					aria-label="Back to components"
				>
					<ArrowLeft className="size-4 text-slate-500" aria-hidden="true" />
				</Button>
			</Tooltip>
			<div className="min-w-0 flex-1">
				<Text
					variant="label"
					className="block truncate text-[13px] font-semibold text-slate-900"
				>
					{summary?.name ?? "Component"}
				</Text>
				<span className="block truncate font-mono text-[10px] text-slate-400">
					{summary?.slug ?? componentId}
				</span>
			</div>
			{tools}
			{summary ? <ComponentStatusBadge summary={summary} /> : null}
			{actions}
		</>
	);
}

/**
 * The component context header for the floating panel shown while the rail
 * is collapsed. Leaving the context resets the draft like the rail does.
 */
export function CollapsedComponentContextHeader({
	systemId,
	projectScope,
	componentId,
	onSelectComponent,
	actions,
}: {
	systemId: string;
	projectScope?: ProjectQueryScope;
	componentId: string;
	onSelectComponent: (componentId: string | null) => void;
	actions?: ReactNode;
}) {
	const componentsQuery = useQuery(
		systemComponentsQueryOptions(systemId, projectScope),
	);
	const summary =
		componentsQuery.data?.components.find(
			(component) => component.componentId === componentId,
		) ?? null;

	return (
		<ComponentContextHeaderContent
			componentId={componentId}
			summary={summary}
			onBack={() => onSelectComponent(null)}
			actions={actions}
		/>
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

function DeleteComponentDialog({
	component,
	instanceCount,
	open,
	onOpenChange,
	isPending,
	error,
	onDelete,
}: {
	component: SystemComponentSummary;
	instanceCount: number;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	isPending: boolean;
	error: string | null;
	onDelete: () => void;
}) {
	const usage =
		instanceCount > 0
			? `${instanceCount} ${instanceCount === 1 ? "instance in designs uses" : "instances in designs use"} this component. `
			: "";
	return (
		<ConfirmationDialog
			open={open}
			onOpenChange={(next) => {
				if (!isPending) onOpenChange(next);
			}}
			title={`Delete ${component.name}?`}
			description={
				component.hasPublished
					? `${usage}Deleting it removes all published versions and can't be undone.`
					: `${usage}This can't be undone.`
			}
			icon={<Trash2 className="size-4" aria-hidden="true" />}
			tone="destructive"
			actionLabel={isPending ? "Deleting" : "Delete component"}
			actionDisabled={isPending}
			error={error}
			onAction={onDelete}
		/>
	);
}

/** The component list's layout while the manifest loads. */
function ComponentRailSkeleton() {
	return (
		<div className="flex min-h-0 flex-1 flex-col" aria-busy="true">
			<div className="flex shrink-0 flex-col gap-2 border-b border-slate-200 px-2 py-2">
				<Skeleton className="h-7 w-full" />
				<div className="flex items-center gap-2">
					<Skeleton className="h-7 flex-1" />
					<Skeleton className="h-7 w-16" />
				</div>
			</div>
			<div className="flex flex-col gap-1 px-2 py-3">
				{Array.from({ length: 6 }, (_, index) => (
					// biome-ignore lint/suspicious/noArrayIndexKey: static placeholder rows.
					<Skeleton key={index} className="h-12 w-full" />
				))}
			</div>
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
	onComponentDeleted,
	headerActions,
}: {
	systemId: string;
	projectScope?: ProjectQueryScope;
	selectedComponentId: string | null;
	onSelectComponent: (componentId: string | null) => void;
	/** A component was deleted; the editor closes it if it is open by then. */
	onComponentDeleted?: (componentId: string) => void;
	/** Trailing controls for the component context header. */
	headerActions?: ReactNode;
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
	// Selection goes through the editor's guarded navigation, which drops the
	// open draft once leaving it is confirmed.
	const handleSelectComponent = onSelectComponent;

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

		const filter = componentFilterRef.current;
		// The rail stays mounted while collapsed; leave the key to the browser.
		if (!filter?.checkVisibility()) {
			return;
		}

		filter.focus();
		filter.select();
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
			setDeleteOpen(false);
			// This rail may have been remounted since the delete started, so the
			// editor decides whether the deleted component is open now.
			onComponentDeleted?.(response.componentId);
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

	const [deleteOpen, setDeleteOpen] = useState(false);

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
						<Tooltip content="Create draft from published version">
							<Button
								type="button"
								variant="block"
								className="flex w-8 shrink-0 items-center justify-center p-0"
								disabled={copyPublishedMutation.isPending}
								aria-busy={isCopying}
								aria-label={`Create draft from published version for ${component.name}`}
								onClick={() => copyPublishedMutation.mutate(component)}
							>
								<Pencil className="size-3.5" aria-hidden="true" />
							</Button>
						</Tooltip>
					) : null}
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
		return <ComponentRailSkeleton />;
	}

	if (componentsQuery.isError) {
		return (
			<div className="flex min-h-0 flex-1 flex-col gap-2 px-3 py-4">
				<Alert variant="panel">
					<span className="block text-sm font-medium">
						Could not load components
					</span>
					<span className="mt-1 block text-xs">
						{(componentsQuery.error as Error).message}
					</span>
				</Alert>
				<Button
					type="button"
					variant="outlined"
					className="self-start px-3 py-1.5 text-xs"
					onClick={() => void componentsQuery.refetch()}
				>
					Retry
				</Button>
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
					<ComponentContextHeaderContent
						componentId={selectedComponentId}
						summary={selectedSummary}
						onBack={() => handleSelectComponent(null)}
						tools={<OpenDesignTokensButton systemId={systemId} />}
						actions={headerActions}
					/>
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
							<div className="flex flex-col gap-6 px-3 py-3">
								<SystemEditorComponentContextPanel
									systemId={systemId}
									projectScope={projectScope}
									componentId={selectedComponentId}
									mode="settings"
								/>
								{selectedSummary ? (
									<section
										className="flex flex-col gap-2 border-t border-slate-200 pt-4"
										aria-label="Delete component"
									>
										<Button
											type="button"
											variant="outlined"
											flavor="danger"
											className="flex items-center gap-1.5 self-start px-2 py-1.5 text-xs"
											onClick={() => {
												deleteComponentMutation.reset();
												setDeleteError(null);
												setDeleteOpen(true);
											}}
										>
											<Trash2 className="size-3.5" aria-hidden="true" />
											Delete component
										</Button>
										<DeleteComponentDialog
											component={selectedSummary}
											instanceCount={
												usageByComponent.get(selectedSummary.componentId)
													?.usedByCount ?? 0
											}
											open={deleteOpen}
											onOpenChange={setDeleteOpen}
											isPending={deleteComponentMutation.isPending}
											error={deleteError}
											onDelete={() =>
												deleteComponentMutation.mutate(selectedSummary)
											}
										/>
									</section>
								) : null}
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
						aria-label="New component name"
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
			{usageQuery.isError && components.length > 0 ? (
				<div className="mx-2 mt-2 flex items-start gap-2">
					<Alert variant="panel" tone="warning" className="min-w-0 flex-1">
						Could not check where components are used.
					</Alert>
					<Button
						type="button"
						variant="outlined"
						className="px-2 py-1.5 text-xs"
						onClick={() => void usageQuery.refetch()}
					>
						Retry
					</Button>
				</div>
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
