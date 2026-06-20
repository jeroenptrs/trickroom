import { useHotkey } from "@tanstack/react-hotkeys";
import { useQuery } from "@tanstack/react-query";
import {
	createElement,
	type MouseEvent,
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
import { useCompiledTailwind } from "../../hooks/useCompiledTailwind";
import { useInjectSystemAssets } from "../../hooks/useInjectSystemAssets";
import { useInjectSystemFonts } from "../../hooks/useInjectSystemFonts";
import { useInjectSystemTheme } from "../../hooks/useInjectSystemTheme";
import stageDocRaw from "../../iframe/shell.html?raw";
import {
	getRenderableProps,
	type RenderableRegistryComponentDefinition,
	resolveRenderableRegistryComponent,
} from "../../libraries/render-registry";
import { DesignSystemRenderContext } from "../../libraries/trickroom/render-context";
import type { ProjectQueryScope } from "../../queries/project-scope";
import { systemComponentQueryOptions } from "../../queries/system-components";
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
} from "../../stores/component-draft-store";
import { resolveStageDoc } from "../../utils/tailwind-render-mode";
import { Canvas } from "../stage/Canvas";

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
	onMount: () => void;
};

export function getComponentDraftPreviewRenderableProps({
	entity,
	path,
	previewClassName,
	selectedPath,
	definition,
}: {
	entity: ComponentDraftEntity;
	path: string;
	previewClassName: string;
	selectedPath: string | null;
	definition: RenderableRegistryComponentDefinition;
}) {
	return getRenderableProps(
		{
			...(entity.props ?? {}),
			className: [
				previewClassName,
				selectedPath === path
					? "outline outline-2 outline-offset-2 outline-cyan-500"
					: null,
			]
				.filter(Boolean)
				.join(" "),
			"data-trickroom-name": entity.name ?? definition.label,
			"data-trickroom-library": entity.library,
			"data-trickroom-component": entity.component,
			"data-trickroom-role": entity.role,
		},
		definition,
	);
}

function SerializedDraftNode({ path }: { path: string }): ReactNode {
	const entity = useComponentDraftEntity(path);
	const childPaths = useComponentDraftChildPaths(path);
	const selectedPath = useComponentDraftSelectedPath();
	const previewClassName = useComponentDraftPreviewClassName(path);

	if (!entity) {
		return null;
	}

	const resolution = resolveRenderableRegistryComponent(
		entity.library,
		entity.component,
	);

	if (resolution.status !== "known") {
		return null;
	}

	const props = getComponentDraftPreviewRenderableProps({
		entity,
		path,
		previewClassName,
		selectedPath,
		definition: resolution.definition,
	});

	const handleClick = (event: MouseEvent) => {
		event.stopPropagation();
		selectTemplateNode(path);
	};

	if (entity.role === "text") {
		return createElement(
			resolution.definition.component,
			{ ...props, onClick: handleClick, "data-component-draft-path": path },
			entity.text,
		);
	}

	if (entity.role === "leaf") {
		return createElement(resolution.definition.component, {
			...props,
			onClick: handleClick,
			"data-component-draft-path": path,
		});
	}

	return createElement(
		resolution.definition.component,
		{ ...props, onClick: handleClick, "data-component-draft-path": path },
		childPaths.map((childPath) => (
			<SerializedDraftNode key={childPath} path={childPath} />
		)),
	);
}

function ComponentDraftBoard({ componentName }: { componentName: string }) {
	const rootPath = useComponentDraftRootPath();

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: clicking empty board space clears the draft node selection.
		// biome-ignore lint/a11y/useKeyWithClickEvents: node selection is keyboard-accessible through layer rows and Escape clears selection.
		<section
			className="m-10 flex min-h-[360px] w-[720px] shrink-0 flex-col border border-slate-300 bg-white shadow-sm"
			data-component-board="single"
			onClick={() => selectTemplateNode(null)}
		>
			<header className="flex h-9 shrink-0 items-center border-b border-slate-200 px-3 text-[11px] font-medium text-slate-500">
				{componentName}
			</header>
			<div className="flex min-h-0 flex-1 items-center justify-center p-10">
				{rootPath ? <SerializedDraftNode path={rootPath} /> : null}
			</div>
		</section>
	);
}

const ComponentStageFrame = memo(function ComponentStageFrame({
	iframeRef,
	systemId,
	componentName,
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
					<ComponentDraftBoard componentName={componentName} />
				</DesignSystemRenderContext.Provider>
			</main>
			<Canvas />
		</Frame>
	);
});

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

	const handleStageMount = useCallback(() => setDidMount(true), []);

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

	useHotkey("Escape", () => selectTemplateNode(null), {
		enabled: selectedPath !== null,
	});

	const componentName = componentQuery.data?.record.name ?? "Component draft";
	const stage = useMemo(
		() => (
			<ComponentStageFrame
				key={`${systemId}:${componentId ?? "none"}`}
				iframeRef={iframeRef}
				systemId={systemId}
				componentName={componentName}
				onMount={handleStageMount}
			/>
		),
		[componentId, componentName, handleStageMount, systemId],
	);

	if (!componentId) {
		return (
			<div className="flex min-h-0 flex-1 items-center justify-center bg-slate-100 px-6 text-center text-sm text-slate-500">
				Select a component draft to open the editor.
			</div>
		);
	}

	if (componentQuery.isPending) {
		return (
			<div className="flex min-h-0 flex-1 items-center justify-center bg-slate-100 text-sm text-slate-500">
				Loading component draft...
			</div>
		);
	}

	if (componentQuery.isError) {
		return (
			<div
				className="flex min-h-0 flex-1 flex-col justify-center bg-slate-100 px-6 text-sm"
				role="alert"
			>
				<p className="font-medium text-red-950">
					Failed to load component draft
				</p>
				<p className="mt-1 text-xs text-red-700">
					{(componentQuery.error as Error).message}
				</p>
			</div>
		);
	}

	if (!componentQuery.data.record.draft) {
		return (
			<div className="flex min-h-0 flex-1 items-center justify-center bg-slate-100 px-6 text-center text-sm text-slate-500">
				This component does not have a draft.
			</div>
		);
	}

	if (draftComponentId !== componentId) {
		return (
			<div
				className="flex min-h-0 flex-1 flex-col justify-center bg-slate-100 px-6 text-sm"
				role="alert"
			>
				<p className="font-medium text-amber-950">
					Unsaved draft is still open
				</p>
				<p className="mt-1 text-xs text-amber-800">
					Save or reload the current draft before editing this component.
				</p>
			</div>
		);
	}

	return (
		<div className="relative min-h-0 flex-1 overflow-hidden bg-slate-200">
			{stage}
		</div>
	);
}
