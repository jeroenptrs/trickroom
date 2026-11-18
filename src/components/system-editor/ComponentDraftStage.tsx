import { useHotkey } from "@tanstack/react-hotkeys";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	createElement,
	memo,
	type ReactNode,
	type RefObject,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import Frame from "react-frame-component";
import { useLocation, useNavigate } from "react-router";
import { useClassMerge } from "../../hooks/useClassMerge";
import { useCompiledTailwind } from "../../hooks/useCompiledTailwind";
import { useComponentAnnotations } from "../../hooks/useComponentAnnotations";
import { useInjectSystemAssets } from "../../hooks/useInjectSystemAssets";
import { useInjectSystemFonts } from "../../hooks/useInjectSystemFonts";
import { useInjectSystemTheme } from "../../hooks/useInjectSystemTheme";
import stageDocRaw from "../../iframe/shell.html?raw";
import {
	getRenderableProps,
	type RenderableRegistryComponentDefinition,
	resolveRenderableRegistryComponent,
} from "../../libraries/render-registry";
import {
	StageBoardPortalContext,
	useStageBoardPortal,
} from "../../libraries/stage-portal";
import { DesignSystemRenderContext } from "../../libraries/trickroom/render-context";
import {
	getStagePreviewContainerClassName,
	useStagePreviewDarkMode,
} from "../../preview/stage-preview-dark-mode";
import type { ProjectQueryScope } from "../../queries/project-scope";
import {
	copyPublishedSystemComponentToDraft,
	invalidateSystemComponents,
	systemComponentQueryOptions,
	systemComponentsQueryOptions,
} from "../../queries/system-components";
import {
	type ComponentDraftEntity,
	hydrateComponentDraft,
	resetComponentDraftStore,
	selectTemplateNode,
	useComponentDraftChildPaths,
	useComponentDraftComponentId,
	useComponentDraftEntity,
	useComponentDraftPreviewClassName,
	useComponentDraftRootPath,
	useComponentDraftSelectedPath,
	useComponentDraftTemplateDirty,
	useComponentDraftVariantsDirty,
} from "../../stores/component-draft-store";
import { useEditorPanelOpen } from "../../stores/editor-chrome-store";
import type { ClassMerge } from "../../utils/class-merge";
import { buildSystemComponentSearch } from "../../utils/system-deep-link";
import { resolveStageDoc } from "../../utils/tailwind-render-mode";
import { componentAnnotationPinSource } from "../annotations/component-annotation-pins";
import { Canvas } from "../stage/Canvas";
import {
	ClassMergeContext,
	useClassMergeContext,
} from "../stage/class-merge-context";
import { MissingRenderer } from "../stage/MissingRenderer";
import { StageAnnotationPins } from "../stage/StageAnnotationPins";
import { StageSelectionLayer } from "../stage/StageSelectionLayer";
import { STAGE_NODE_ID_ATTRIBUTE } from "../stage/stage-interaction";
import { componentDraftStageSelection } from "../stage/stage-selection-sources";
import { Alert } from "../ui/alert";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { Skeleton } from "../ui/skeleton";
import { discardOpenComponentDraft } from "./useGuardedComponentLocation";

const stageDoc = resolveStageDoc(stageDocRaw);

type ComponentDraftStageProps = {
	systemId: string;
	componentId: string | null;
	projectScope?: ProjectQueryScope;
};

type ComponentStageFrameProps = {
	iframeRef: RefObject<HTMLIFrameElement | null>;
	systemId: string;
	componentName: string;
	previewDarkMode: boolean;
	onMount: () => void;
};

/**
 * Stage props for a draft node. The selection is an overlay in the stage
 * document (StageSelectionLayer), so the class string is the draft's own.
 */
export function getComponentDraftPreviewRenderableProps({
	entity,
	path,
	previewClassName,
	definition,
	classMerge = null,
}: {
	entity: ComponentDraftEntity;
	path: string;
	previewClassName: string;
	definition: RenderableRegistryComponentDefinition;
	/** Merges the template, variant and compound classes like `tv()` does. */
	classMerge?: ClassMerge | null;
}) {
	const props = getRenderableProps(
		{
			...(entity.props ?? {}),
			className:
				classMerge && previewClassName
					? classMerge(previewClassName)
					: previewClassName,
			"data-trickroom-name": entity.name ?? definition.label,
			"data-trickroom-library": entity.library,
			"data-trickroom-component": entity.component,
			"data-trickroom-role": entity.role,
		},
		definition,
	);
	props[STAGE_NODE_ID_ATTRIBUTE] = path;
	props["data-component-draft-path"] = path;
	return props;
}

export function SerializedDraftNode({ path }: { path: string }): ReactNode {
	const entity = useComponentDraftEntity(path);
	const childPaths = useComponentDraftChildPaths(path);
	const previewClassName = useComponentDraftPreviewClassName(path);
	const classMerge = useClassMergeContext().merge;

	if (!entity) {
		return null;
	}

	const resolution = resolveRenderableRegistryComponent(
		entity.library,
		entity.component,
	);

	if (resolution.status !== "known") {
		return (
			<MissingRenderer
				library={resolution.library}
				component={resolution.component}
				data-trickroom-node-id={path}
				data-component-draft-path={path}
			>
				{entity.role === "text"
					? entity.text
					: childPaths.map((childPath) => (
							<SerializedDraftNode key={childPath} path={childPath} />
						))}
			</MissingRenderer>
		);
	}

	const props = getComponentDraftPreviewRenderableProps({
		entity,
		path,
		previewClassName,
		definition: resolution.definition,
		classMerge,
	});

	if (entity.role === "text") {
		return createElement(resolution.definition.component, props, entity.text);
	}

	if (entity.role === "leaf") {
		return createElement(resolution.definition.component, props);
	}

	return createElement(
		resolution.definition.component,
		props,
		childPaths.map((childPath) => (
			<SerializedDraftNode key={childPath} path={childPath} />
		)),
	);
}

/**
 * The draft board. Like a design board on the canvas, its content area is the
 * containing block and portal target for the draft's own overlays, so an open
 * dialog centres on the board instead of the editor pane. The board sits on a
 * pannable canvas next to editor chrome, so overlays use the canvas
 * (non-modal) behaviour.
 */
function ComponentDraftBoard({
	componentName,
	previewDarkMode,
}: {
	componentName: string;
	previewDarkMode: boolean;
}) {
	const rootPath = useComponentDraftRootPath();
	const { value: boardPortal, host: portalHost } = useStageBoardPortal(true);
	// Like the canvas, wait for the merge settings instead of painting the
	// draft unmerged first.
	const classMergeReady = useClassMergeContext().ready;

	// Clicks are the stage's (StageSelectionLayer): a draft node selects it,
	// empty board space clears the selection.
	return (
		<section
			className={`m-10 flex min-h-[360px] w-[720px] shrink-0 flex-col border border-slate-300 bg-white shadow-sm ${getStagePreviewContainerClassName(previewDarkMode)}`}
			data-component-board="single"
		>
			<header className="flex h-9 shrink-0 items-center border-b border-slate-200 px-3 text-[11px] font-medium text-slate-500">
				{componentName}
			</header>
			<StageBoardPortalContext.Provider value={boardPortal}>
				<div
					className="flex min-h-0 flex-1 items-center justify-center p-10"
					data-trickroom-draft-board=""
				>
					{portalHost}
					{rootPath && classMergeReady ? (
						<SerializedDraftNode path={rootPath} />
					) : null}
				</div>
			</StageBoardPortalContext.Provider>
		</section>
	);
}

const ComponentStageFrame = memo(function ComponentStageFrame({
	iframeRef,
	systemId,
	componentName,
	previewDarkMode,
	onMount,
}: ComponentStageFrameProps) {
	return (
		<Frame
			ref={iframeRef}
			initialContent={stageDoc}
			mountTarget="#trickroom-viewport"
			contentDidMount={onMount}
			className="h-full w-full border-none"
		>
			<main className="absolute inset-0 min-w-screen min-h-screen origin-top-left">
				<DesignSystemRenderContext.Provider value={systemId}>
					<ComponentDraftBoard
						componentName={componentName}
						previewDarkMode={previewDarkMode}
					/>
				</DesignSystemRenderContext.Provider>
			</main>
			<Canvas />
			<StageSelectionLayer source={componentDraftStageSelection} />
			<StageAnnotationPins source={componentAnnotationPinSource} />
		</Frame>
	);
});

/** The stage's layout while a draft loads: an empty board on the canvas. */
function ComponentStageSkeleton() {
	return (
		<div
			className="flex min-h-0 flex-1 items-center justify-center bg-slate-200"
			aria-busy="true"
		>
			<Skeleton className="h-48 w-80 bg-slate-100" />
		</div>
	);
}

export function ComponentDraftStage({
	systemId,
	componentId,
	projectScope,
}: ComponentDraftStageProps) {
	const iframeRef = useRef<HTMLIFrameElement>(null);
	const [didMount, setDidMount] = useState(false);
	const selectedPath = useComponentDraftSelectedPath();
	const draftComponentId = useComponentDraftComponentId();
	const componentQuery = useQuery({
		...systemComponentQueryOptions(systemId, componentId ?? "", projectScope),
		enabled: componentId !== null,
	});

	const templateDirty = useComponentDraftTemplateDirty();
	const variantsDirty = useComponentDraftVariantsDirty();
	const queryClient = useQueryClient();
	const navigate = useNavigate();
	const location = useLocation();
	const listQuery = useQuery({
		...systemComponentsQueryOptions(systemId, projectScope),
		enabled: componentId !== null,
	});
	const createDraftMutation = useMutation({
		mutationFn: async () => {
			const revision = listQuery.data?.revision;
			const published = componentQuery.data?.record.published;
			if (!componentId || !revision) {
				throw new Error("Components are still loading. Try again.");
			}
			return copyPublishedSystemComponentToDraft(systemId, componentId, {
				expectedRevision: revision,
				...(published?.currentVersion
					? { versionId: published.currentVersion }
					: {}),
			});
		},
		onSuccess: (response) =>
			invalidateSystemComponents(
				queryClient,
				systemId,
				projectScope,
				response.componentId,
			),
	});

	const handleStageMount = useCallback(() => setDidMount(true), []);
	// The component's annotations, once its draft is the one open.
	useComponentAnnotations(
		systemId,
		componentId !== null && draftComponentId === componentId
			? componentId
			: null,
	);

	// biome-ignore lint/correctness/useExhaustiveDependencies: componentId and systemId are triggers; the frame is keyed by them, so a new one mounts and reports didMount again.
	useEffect(() => {
		setDidMount(false);
	}, [componentId, systemId]);

	useEffect(() => {
		if (!componentId) {
			resetComponentDraftStore();
		}
	}, [componentId]);

	useEffect(() => {
		const draft = componentQuery.data?.record.draft;
		if (!componentId) {
			return;
		}

		if (!draft) {
			resetComponentDraftStore();
			return;
		}

		hydrateComponentDraft({
			componentId,
			baseVersion: draft.baseVersion,
			root: draft.root,
			slots: draft.slots,
			overrideTargets: draft.overrideTargets,
			variants: draft.variants ?? null,
		});
	}, [componentId, componentQuery.data]);

	useInjectSystemTheme(iframeRef, didMount, systemId);
	useCompiledTailwind(iframeRef, didMount, systemId);
	useInjectSystemAssets(iframeRef, didMount, systemId);
	useInjectSystemFonts(iframeRef, didMount, systemId);
	const classMerge = useClassMerge(systemId);

	useHotkey("Escape", () => selectTemplateNode(null), {
		enabled: selectedPath !== null,
	});

	const componentName = componentQuery.data?.record.name ?? "Component draft";
	const { enabled: previewDarkMode } = useStagePreviewDarkMode();
	const stage = useMemo(
		() => (
			<ComponentStageFrame
				key={`${systemId}:${componentId ?? "none"}`}
				iframeRef={iframeRef}
				systemId={systemId}
				componentName={componentName}
				previewDarkMode={previewDarkMode}
				onMount={handleStageMount}
			/>
		),
		[componentId, componentName, handleStageMount, previewDarkMode, systemId],
	);
	const railOpen = useEditorPanelOpen("system", "rail");

	if (!componentId) {
		// The component list lives in the rail, so point at it when collapsed.
		return (
			<div className="flex min-h-0 flex-1 items-center justify-center bg-slate-100 px-6 text-center text-sm text-slate-500">
				{railOpen
					? "Select a component draft to open the editor."
					: "Expand the sidebar (Alt+[) to pick a component draft."}
			</div>
		);
	}

	if (componentQuery.isPending) {
		return <ComponentStageSkeleton />;
	}

	if (componentQuery.isError) {
		return (
			<div className="flex min-h-0 flex-1 flex-col items-start justify-center gap-2 bg-slate-100 px-6 text-sm">
				<Alert variant="panel" className="self-stretch">
					<span className="block font-medium">Could not load this draft</span>
					<span className="mt-1 block text-xs">
						{(componentQuery.error as Error).message}
					</span>
				</Alert>
				<Button
					type="button"
					variant="outlined"
					className="px-3 py-1.5 text-xs"
					onClick={() => void componentQuery.refetch()}
				>
					Retry
				</Button>
			</div>
		);
	}

	const record = componentQuery.data.record;
	if (!record.draft) {
		const publishedVersion = record.published?.currentVersion;
		return (
			<div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 bg-slate-100 px-6 text-center text-sm text-slate-700">
				<p>
					{publishedVersion
						? `Published as v${publishedVersion}. No draft yet.`
						: "No draft yet."}
				</p>
				{publishedVersion ? (
					<Button
						type="button"
						variant="filled"
						className="px-3 py-1.5 text-xs"
						disabled={createDraftMutation.isPending}
						onClick={() => createDraftMutation.mutate()}
					>
						{createDraftMutation.isPending ? "Creating draft" : "Create draft"}
					</Button>
				) : null}
				{createDraftMutation.error ? (
					<Alert variant="panel" className="text-left">
						{createDraftMutation.error.message}
					</Alert>
				) : null}
			</div>
		);
	}

	const draft = record.draft;
	if (draftComponentId !== componentId) {
		// A clean draft of another component is replaced in a moment; only
		// unsaved edits hold the stage.
		if (!draftComponentId || !(templateDirty || variantsDirty)) {
			return <ComponentStageSkeleton />;
		}
		const otherComponentId = draftComponentId;
		return (
			<div className="flex min-h-0 flex-1 flex-col justify-center bg-slate-100 px-6 text-sm">
				<Card
					edge="border"
					tone="warning"
					className="flex flex-col gap-3 px-4 py-3"
					role="alert"
				>
					<p className="font-medium">Another component has unsaved changes.</p>
					<div className="flex flex-wrap gap-2">
						<Button
							type="button"
							variant="outlined"
							className="px-3 py-1.5 text-xs"
							onClick={() =>
								navigate({
									pathname: location.pathname,
									search: buildSystemComponentSearch(otherComponentId),
								})
							}
						>
							Go to that component
						</Button>
						<Button
							type="button"
							variant="outlined"
							flavor="danger"
							className="px-3 py-1.5 text-xs"
							onClick={() => {
								discardOpenComponentDraft();
								hydrateComponentDraft({
									componentId,
									baseVersion: draft.baseVersion,
									root: draft.root,
									slots: draft.slots,
									overrideTargets: draft.overrideTargets,
									variants: draft.variants ?? null,
								});
							}}
						>
							Discard its changes
						</Button>
					</div>
				</Card>
			</div>
		);
	}

	return (
		<div className="relative min-h-0 flex-1 overflow-hidden bg-slate-200">
			<ClassMergeContext.Provider value={classMerge}>
				{stage}
			</ClassMergeContext.Provider>
		</div>
	);
}
