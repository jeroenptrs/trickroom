import { useHotkey } from "@tanstack/react-hotkeys";
import { useQuery } from "@tanstack/react-query";
import {
	memo,
	type RefObject,
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import Frame from "react-frame-component";
import { useParams } from "react-router";
import { useCompiledTailwind } from "../hooks/useCompiledTailwind";
import { useDesignDeepLink } from "../hooks/useDesignDeepLink";
import { useDesignLiveSync } from "../hooks/useDesignLiveSync";
import { useExternalChangeMarkers } from "../hooks/useExternalChangeMarkers";
import { useInjectSystemAssets } from "../hooks/useInjectSystemAssets";
import { useInjectSystemFonts } from "../hooks/useInjectSystemFonts";
import { useInjectSystemTheme } from "../hooks/useInjectSystemTheme";
import { useResolvedBreakpoints } from "../hooks/useResolvedBreakpoints";
import { useResponsiveBoardCycleShortcuts } from "../hooks/useResponsiveBoardCycleShortcuts";
import { useResponsiveStageFrame } from "../hooks/useResponsiveStageFrame";
import { useStageNavigation } from "../hooks/useStageNavigation";
import stageDocRaw from "../iframe/shell.html?raw";
import {
	getStagePreviewContainerClassName,
	StagePreviewDarkModeProvider,
	useStagePreviewDarkMode,
} from "../preview/stage-preview-dark-mode";
import {
	type DesignFileSnapshot,
	designFileQueryOptions,
} from "../queries/design-file";
import {
	designStore,
	hydrateDesign,
	selectElement,
	useDesignRoots,
	useDesignSystemId,
	useSelectedId,
} from "../stores/design-store";
import { applyDiskDesign, diskStateFromDesign } from "../stores/design-sync";
import {
	resetStageView,
	setActiveBoardId,
	setResponsiveWidth,
	setStageMode,
	stageViewStore,
	useActiveBoardId,
	useResponsiveWidth,
	useStageMode,
} from "../stores/stage-view-store";
import { markDesignOpened } from "../utils/design-activity";
import { resolveActiveBoardAfterHydrate } from "../utils/design-live-sync";
import {
	getResponsiveStageSessionStorageKey,
	readResponsiveStageSessionWidth,
	writeResponsiveStageSessionWidth,
} from "../utils/responsive-stage-session";
import { resolveStageDoc } from "../utils/tailwind-render-mode";
import { DesignConflictDialog } from "./chrome/DesignConflictDialog";
import { EditorShell } from "./chrome/EditorShell";
import { IFrameViewContext, useProjectScope } from "./contexts";
import {
	RESPONSIVE_STAGE_DEFAULT_WIDTH,
	ResponsiveStageContext,
	resolveResponsiveStageActiveBoardId,
	shouldPreserveSelectionOnActiveBoard,
} from "./responsive-stage-context";
import { ResponsiveStageFrameWrapper } from "./responsive-stage-frame";
import {
	type ResponsiveStageZoom,
	ResponsiveStageZoomContext,
	resolveResponsiveStageScale,
} from "./responsive-stage-zoom";
import { Artboards } from "./stage/Artboards";
import { Canvas } from "./stage/Canvas";
import { StageChangeHighlight } from "./stage/StageChangeHighlight";
import { StageFocusHighlight } from "./stage/StageFocusHighlight";

const stageDoc = resolveStageDoc(stageDocRaw);

type StageFrameProps = {
	iframeRef: RefObject<HTMLIFrameElement | null>;
	onMount: () => void;
	previewDarkMode: boolean;
};

export const StageFrame = memo(function StageFrame({
	iframeRef,
	onMount,
	previewDarkMode,
}: StageFrameProps) {
	return (
		<Frame
			ref={iframeRef}
			initialContent={stageDoc}
			mountTarget="#trickroom-viewport"
			contentDidMount={onMount}
			className="h-full w-full border-none"
		>
			<main
				className={`absolute inset-0 min-w-screen min-h-screen origin-top-left flex flex-row gap-4 ${getStagePreviewContainerClassName(previewDarkMode)}`}
			>
				<Artboards />
			</main>

			<Canvas />
			<StageChangeHighlight />
			<StageFocusHighlight />
		</Frame>
	);
});

const responsiveStageControls = {
	setMode: setStageMode,
	setActiveBoardId,
	setResponsiveWidth,
};

function DesignStage({
	iframeRef,
	onMount,
}: {
	iframeRef: RefObject<HTMLIFrameElement | null>;
	onMount: () => void;
}) {
	const { enabled: previewDarkMode } = useStagePreviewDarkMode();

	return (
		<ResponsiveStageFrameWrapper>
			<StageFrame
				iframeRef={iframeRef}
				onMount={onMount}
				previewDarkMode={previewDarkMode}
			/>
		</ResponsiveStageFrameWrapper>
	);
}

export function Design() {
	const { uuid } = useParams<{ uuid: string }>();
	const projectScope = useProjectScope();
	const designId = uuid ?? null;
	const [didMount, setDidMount] = useState(false);
	const stageMode = useStageMode();
	const activeBoardId = useActiveBoardId();
	const responsiveWidth = useResponsiveWidth();
	// The design whose snapshot is in the store and kept in sync with disk.
	const [liveDesignId, setLiveDesignId] = useState<string | null>(null);
	const [responsiveZoom, setResponsiveZoom] =
		useState<ResponsiveStageZoom>("fit");
	const [responsiveFitScale, setResponsiveFitScale] = useState(1);
	const responsiveSessionKey = useMemo(
		() => getResponsiveStageSessionStorageKey(projectScope, designId),
		[designId, projectScope],
	);
	const responsiveSessionKeyRef = useRef(responsiveSessionKey);
	// The stage view starts fresh for every visit to the design route, as it did
	// when it was local state. Layout effects run before the stage's effects.
	const initialStageViewRef = useRef({ projectScope, designId });
	useLayoutEffect(() => {
		const initial = initialStageViewRef.current;
		resetStageView(
			readResponsiveStageSessionWidth(initial.projectScope, initial.designId),
		);
		return () => resetStageView(RESPONSIVE_STAGE_DEFAULT_WIDTH);
	}, []);
	const skipNextResponsiveSessionSaveRef = useRef(false);
	// The design file whose snapshot was last hydrated, so a live-sync reload of
	// the open design can keep the active board instead of resetting it.
	const hydratedDesignIdRef = useRef<string | null>(null);
	const iframeRef = useRef<HTMLIFrameElement>(null);
	const rootIds = useDesignRoots();
	const view = useStageNavigation(iframeRef, didMount, {
		mode: stageMode,
		activeBoardId,
		responsiveWidth,
	});
	useResponsiveStageFrame(
		iframeRef,
		{ mode: stageMode, responsiveWidth },
		didMount,
	);
	useResponsiveBoardCycleShortcuts({
		mode: stageMode,
		rootIds,
		setActiveBoardId,
		iframeRef,
		didMount,
	});
	const handleStageMount = useCallback(() => setDidMount(true), []);
	const designQuery = useQuery({
		...designFileQueryOptions(designId ?? "", projectScope),
		enabled: designId !== null,
		// Once open, the design follows the disk through change events, board
		// by board; refetching the whole design on focus is not needed.
		refetchOnWindowFocus: false,
	});
	const designSnapshot = designQuery.data;

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
		setResponsiveWidth(readResponsiveStageSessionWidth(projectScope, designId));
		setResponsiveZoom("fit");
	}, [designId, projectScope, responsiveSessionKey]);

	useEffect(() => {
		if (responsiveSessionKeyRef.current !== responsiveSessionKey) {
			return;
		}

		if (skipNextResponsiveSessionSaveRef.current) {
			skipNextResponsiveSessionSaveRef.current = false;
			return;
		}

		// The first render of a visit still holds the width from before the
		// mount reset above; the render after it saves the right one.
		if (responsiveWidth !== stageViewStore.get().responsiveWidth) {
			return;
		}

		writeResponsiveStageSessionWidth(projectScope, designId, responsiveWidth);
	}, [designId, projectScope, responsiveSessionKey, responsiveWidth]);

	const applyHydratedActiveBoard = useCallback(
		(snapshot: DesignFileSnapshot) => {
			const isReload = hydratedDesignIdRef.current === designId;
			hydratedDesignIdRef.current = designId;
			const boardIds = snapshot.design.boards.map((board) => board.id);
			setActiveBoardId((currentBoardId) =>
				resolveActiveBoardAfterHydrate({ boardIds, currentBoardId, isReload }),
			);
		},
		[designId],
	);

	useEffect(() => {
		if (!designSnapshot) {
			return;
		}
		if (hydratedDesignIdRef.current !== designId) {
			hydrateDesign(
				designSnapshot.design,
				designSnapshot.revision,
				designSnapshot.parts,
			);
			applyHydratedActiveBoard(designSnapshot);
			setLiveDesignId(designId);
			return;
		}
		// A later read of the open design (a refetch after it was invalidated,
		// or a save result) is reconciled board by board like any disk change.
		const state = designStore.get();
		if (
			state.designSavePending ||
			designSnapshot.revision === state.persistedRevision
		) {
			return;
		}
		applyDiskDesign(
			diskStateFromDesign(
				designSnapshot.design,
				designSnapshot.revision,
				designSnapshot.parts,
			),
		);
	}, [applyHydratedActiveBoard, designId, designSnapshot]);

	useDesignLiveSync({
		designId,
		enabled: liveDesignId !== null && liveDesignId === designId,
	});
	useExternalChangeMarkers({ designId, iframeRef, didMount });

	useEffect(() => {
		setActiveBoardId((currentBoardId) =>
			resolveResponsiveStageActiveBoardId(rootIds, currentBoardId),
		);
	}, [rootIds]);

	useDesignDeepLink({ designId, hydratedDesignIdRef, rootIds });

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
		() => <DesignStage iframeRef={iframeRef} onMount={handleStageMount} />,
		[handleStageMount],
	);
	const responsiveStage = useMemo(
		() => ({
			mode: stageMode,
			activeBoardId,
			responsiveWidth,
			breakpoints: responsiveBreakpoints,
			controls: responsiveStageControls,
		}),
		[activeBoardId, responsiveBreakpoints, responsiveWidth, stageMode],
	);

	const responsiveStageZoom = useMemo(
		() => ({
			zoom: responsiveZoom,
			fitScale: responsiveFitScale,
			scale: resolveResponsiveStageScale(responsiveZoom, responsiveFitScale),
			setZoom: setResponsiveZoom,
			setFitScale: setResponsiveFitScale,
		}),
		[responsiveFitScale, responsiveZoom],
	);

	// TODO: make isLoading and hasError work with a rendered sidebar and iframe
	if (!designId) {
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
		<>
			<IFrameViewContext.Provider value={view}>
				<ResponsiveStageContext.Provider value={responsiveStage}>
					<ResponsiveStageZoomContext.Provider value={responsiveStageZoom}>
						<StagePreviewDarkModeProvider key={designId}>
							<EditorShell designId={designId}>{stage}</EditorShell>
						</StagePreviewDarkModeProvider>
					</ResponsiveStageZoomContext.Provider>
				</ResponsiveStageContext.Provider>
			</IFrameViewContext.Provider>
			<DesignConflictDialog />
		</>
	);
}
