import { useHotkey } from "@tanstack/react-hotkeys";
import { useQuery } from "@tanstack/react-query";
import {
	memo,
	type RefObject,
	type SetStateAction,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import Frame from "react-frame-component";
import { useParams } from "react-router";
import { useCompiledTailwind } from "../hooks/useCompiledTailwind";
import { useInjectSystemAssets } from "../hooks/useInjectSystemAssets";
import { useInjectSystemFonts } from "../hooks/useInjectSystemFonts";
import { useInjectSystemTheme } from "../hooks/useInjectSystemTheme";
import { useResolvedBreakpoints } from "../hooks/useResolvedBreakpoints";
import { useResponsiveBoardCycleShortcuts } from "../hooks/useResponsiveBoardCycleShortcuts";
import { useResponsiveStageFrame } from "../hooks/useResponsiveStageFrame";
import { useStageNavigation } from "../hooks/useStageNavigation";
import stageDocRaw from "../iframe/shell.html?raw";
import {
	designFileQueryOptions,
	getDesignFileForUuid,
} from "../queries/design-file";
import {
	designStore,
	hydrateDesign,
	selectElement,
	useDesignRoots,
	useDesignSystemId,
	useSelectedId,
} from "../stores/design-store";
import { markDesignOpened } from "../utils/design-activity";
import {
	getResponsiveStageSessionStorageKey,
	readResponsiveStageSessionWidth,
	writeResponsiveStageSessionWidth,
} from "../utils/responsive-stage-session";
import { resolveStageDoc } from "../utils/tailwind-render-mode";
import { EditorShell } from "./chrome/EditorShell";
import { IFrameViewContext, useProjectScope } from "./contexts";
import {
	clampResponsiveStageWidth,
	ResponsiveStageContext,
	type ResponsiveStageMode,
	resolveResponsiveStageActiveBoardId,
	shouldPreserveSelectionOnActiveBoard,
} from "./responsive-stage-context";
import { ResponsiveStageFrameWrapper } from "./responsive-stage-frame";
import { Artboards } from "./stage/Artboards";
import { Canvas } from "./stage/Canvas";

const stageDoc = resolveStageDoc(stageDocRaw);

type StageFrameProps = {
	iframeRef: RefObject<HTMLIFrameElement | null>;
	onMount: () => void;
};

export const StageFrame = memo(function StageFrame({
	iframeRef,
	onMount,
}: StageFrameProps) {
	return (
		<Frame
			ref={iframeRef}
			initialContent={stageDoc}
			mountTarget="#trickroom-viewport"
			contentDidMount={onMount}
			className="h-full w-full border-none"
		>
			<main className="absolute inset-0 min-w-screen min-h-screen origin-top-left flex flex-row gap-4">
				<Artboards />
			</main>

			<Canvas />
		</Frame>
	);
});

export function Design() {
	const { uuid } = useParams<{ uuid: string }>();
	const projectScope = useProjectScope();
	const designFile = uuid ? getDesignFileForUuid(uuid) : null;
	const [didMount, setDidMount] = useState(false);
	const [stageMode, setStageMode] = useState<ResponsiveStageMode>("canvas");
	const [activeBoardId, setActiveBoardId] = useState<string | null>(null);
	const [responsiveWidth, setResponsiveWidth] = useState(() =>
		readResponsiveStageSessionWidth(projectScope, designFile),
	);
	const responsiveSessionKey = useMemo(
		() => getResponsiveStageSessionStorageKey(projectScope, designFile),
		[designFile, projectScope],
	);
	const responsiveSessionKeyRef = useRef(responsiveSessionKey);
	const skipNextResponsiveSessionSaveRef = useRef(false);
	const iframeRef = useRef<HTMLIFrameElement>(null);
	const rootIds = useDesignRoots();
	const view = useStageNavigation(iframeRef, didMount, {
		mode: stageMode,
		activeBoardId,
		responsiveWidth,
	});
	useResponsiveStageFrame(iframeRef, { mode: stageMode, responsiveWidth });
	useResponsiveBoardCycleShortcuts({
		mode: stageMode,
		rootIds,
		setActiveBoardId,
		iframeRef,
		didMount,
	});
	const handleStageMount = useCallback(() => setDidMount(true), []);
	const designQuery = useQuery({
		...designFileQueryOptions(designFile ?? "", projectScope),
		enabled: designFile !== null,
	});
	const design = designQuery.data;

	useEffect(() => {
		if (uuid && designQuery.isSuccess) {
			markDesignOpened(projectScope, uuid);
		}
	}, [designQuery.isSuccess, projectScope, uuid]);

	useEffect(() => {
		if (responsiveSessionKeyRef.current === responsiveSessionKey) {
			return;
		}

		responsiveSessionKeyRef.current = responsiveSessionKey;
		skipNextResponsiveSessionSaveRef.current = true;
		setResponsiveWidth(
			readResponsiveStageSessionWidth(projectScope, designFile),
		);
	}, [designFile, projectScope, responsiveSessionKey]);

	useEffect(() => {
		if (responsiveSessionKeyRef.current !== responsiveSessionKey) {
			return;
		}

		if (skipNextResponsiveSessionSaveRef.current) {
			skipNextResponsiveSessionSaveRef.current = false;
			return;
		}

		writeResponsiveStageSessionWidth(projectScope, designFile, responsiveWidth);
	}, [designFile, projectScope, responsiveSessionKey, responsiveWidth]);

	useEffect(() => {
		if (design) {
			hydrateDesign(design);
			setActiveBoardId(design.boards[0]?.id ?? null);
		}
	}, [design]);

	useEffect(() => {
		setActiveBoardId((currentBoardId) =>
			resolveResponsiveStageActiveBoardId(rootIds, currentBoardId),
		);
	}, [rootIds]);

	const liveSystemId = useDesignSystemId();
	const responsiveBreakpoints = useResolvedBreakpoints(liveSystemId);
	useInjectSystemTheme(iframeRef, didMount, liveSystemId);
	useCompiledTailwind(iframeRef, didMount, liveSystemId);
	useInjectSystemAssets(iframeRef, didMount, liveSystemId);
	useInjectSystemFonts(iframeRef, didMount, liveSystemId);

	const selectedId = useSelectedId();
	useHotkey("Escape", () => selectElement(null), {
		enabled: selectedId !== null,
	});

	useEffect(() => {
		if (stageMode !== "responsive") {
			return;
		}

		if (
			!shouldPreserveSelectionOnActiveBoard(
				designStore.get().entitiesById,
				selectedId,
				activeBoardId,
			)
		) {
			selectElement(null);
		}
	}, [stageMode, activeBoardId, selectedId]);

	const errorMessage = (designQuery.error as Error | null)?.message;
	const stage = useMemo(
		() => (
			<ResponsiveStageFrameWrapper>
				<StageFrame iframeRef={iframeRef} onMount={handleStageMount} />
			</ResponsiveStageFrameWrapper>
		),
		[handleStageMount],
	);
	const setClampedResponsiveWidth = useCallback(
		(nextWidth: SetStateAction<number>) => {
			setResponsiveWidth((currentWidth) =>
				clampResponsiveStageWidth(
					typeof nextWidth === "function" ? nextWidth(currentWidth) : nextWidth,
				),
			);
		},
		[],
	);
	const responsiveStageControls = useMemo(
		() => ({
			setMode: setStageMode,
			setActiveBoardId,
			setResponsiveWidth: setClampedResponsiveWidth,
		}),
		[setClampedResponsiveWidth],
	);
	const responsiveStage = useMemo(
		() => ({
			mode: stageMode,
			activeBoardId,
			responsiveWidth,
			breakpoints: responsiveBreakpoints,
			controls: responsiveStageControls,
		}),
		[
			activeBoardId,
			responsiveBreakpoints,
			responsiveStageControls,
			responsiveWidth,
			stageMode,
		],
	);

	// TODO: make isLoading and hasError work with a rendered sidebar and iframe
	if (!designFile) {
		return (
			<div className="absolute left-3 top-3 z-30 bg-red-500 px-2 py-1 text-xs text-white">
				Missing design id
			</div>
		);
	}

	if (designQuery.isError) {
		return (
			<div className="absolute left-3 top-3 z-30 bg-red-500 px-2 py-1 text-xs text-white">
				Failed to load design data: {errorMessage}
			</div>
		);
	}

	if (designQuery.isPending) {
		return (
			<div className="pointer-events-none absolute left-3 top-3 z-30 bg-slate-500 px-2 py-1 text-xs text-white">
				Loading design data...
			</div>
		);
	}

	return (
		<IFrameViewContext.Provider value={view}>
			<ResponsiveStageContext.Provider value={responsiveStage}>
				<EditorShell designFile={designFile}>{stage}</EditorShell>
			</ResponsiveStageContext.Provider>
		</IFrameViewContext.Provider>
	);
}
