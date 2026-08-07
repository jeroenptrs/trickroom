import { useHotkey } from "@tanstack/react-hotkeys";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
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
	getStagePreviewContainerClassName,
	StagePreviewDarkModeProvider,
	useStagePreviewDarkMode,
} from "../preview/stage-preview-dark-mode";
import {
	type DesignFileSnapshot,
	designFileQueryOptions,
	getDesignFileForUuid,
} from "../queries/design-file";
import {
	designStore,
	forceHydrateDesign,
	hydrateDesign,
	selectElement,
	setExternalConflictPending,
	setPersistedDesignRevision,
	useDesignRoots,
	useDesignSavePending,
	useDesignSystemId,
	useHasUnsavedChanges,
	usePersistedDesignRevision,
	useSelectedId,
} from "../stores/design-store";
import { markDesignOpened } from "../utils/design-activity";
import { getDesignSyncDecision } from "../utils/design-live-sync";
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
import { ConfirmationDialog } from "./ui/alert-dialog";

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
		</Frame>
	);
});

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
	const designFile = uuid ? getDesignFileForUuid(uuid) : null;
	const [didMount, setDidMount] = useState(false);
	const [stageMode, setStageMode] = useState<ResponsiveStageMode>("canvas");
	const [activeBoardId, setActiveBoardId] = useState<string | null>(null);
	const [externalSnapshot, setExternalSnapshot] =
		useState<DesignFileSnapshot | null>(null);
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
	const designSnapshot = designQuery.data;
	const hasUnsavedChanges = useHasUnsavedChanges();
	const persistedRevision = usePersistedDesignRevision();
	const designSavePending = useDesignSavePending();

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
		if (!designSnapshot) {
			return;
		}
		const decision = getDesignSyncDecision({
			snapshotRevision: designSnapshot.revision,
			persistedRevision,
			hasUnsavedChanges,
			savePending: designSavePending,
		});
		if (decision === "ignore") return;

		if (decision === "conflict") {
			setExternalSnapshot(designSnapshot);
			setExternalConflictPending(true);
			return;
		}

		hydrateDesign(designSnapshot.design, designSnapshot.revision);
		setActiveBoardId(designSnapshot.design.boards[0]?.id ?? null);
	}, [designSavePending, designSnapshot, hasUnsavedChanges, persistedRevision]);

	useEffect(() => {
		if (
			externalSnapshot &&
			!hasUnsavedChanges &&
			externalSnapshot.revision === persistedRevision
		) {
			setExternalSnapshot(null);
			setExternalConflictPending(false);
		}
	}, [externalSnapshot, hasUnsavedChanges, persistedRevision]);

	const reloadExternalDesign = useCallback(() => {
		if (!externalSnapshot) {
			return;
		}
		forceHydrateDesign(externalSnapshot.design, externalSnapshot.revision);
		setActiveBoardId(externalSnapshot.design.boards[0]?.id ?? null);
		setExternalSnapshot(null);
	}, [externalSnapshot]);

	const keepLocalDesign = useCallback(() => {
		if (!externalSnapshot) {
			return;
		}
		setPersistedDesignRevision(externalSnapshot.revision);
		setExternalConflictPending(false);
		setExternalSnapshot(null);
	}, [externalSnapshot]);

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
		() => <DesignStage iframeRef={iframeRef} onMount={handleStageMount} />,
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
		<>
			<IFrameViewContext.Provider value={view}>
				<ResponsiveStageContext.Provider value={responsiveStage}>
					<StagePreviewDarkModeProvider key={designFile}>
						<EditorShell designFile={designFile}>{stage}</EditorShell>
					</StagePreviewDarkModeProvider>
				</ResponsiveStageContext.Provider>
			</IFrameViewContext.Provider>
			<ConfirmationDialog
				open={externalSnapshot !== null}
				onOpenChange={() => undefined}
				title="Design changed on disk"
				description="Another browser or agent changed this design while you have unsaved edits. Reload the disk version or keep your local version and save it over the newer revision."
				icon={<RefreshCw className="size-4" aria-hidden="true" />}
				actionLabel="Reload from disk"
				cancelLabel="Keep mine"
				onAction={reloadExternalDesign}
				onCancel={keepLocalDesign}
			/>
		</>
	);
}
