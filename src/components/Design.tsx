import { useHotkey } from "@tanstack/react-hotkeys";
import { useQuery } from "@tanstack/react-query";
import {
	memo,
	type RefObject,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import Frame from "react-frame-component";
import { useParams } from "react-router";
import { useInjectSystemAssets } from "../hooks/useInjectSystemAssets";
import { useInjectSystemFonts } from "../hooks/useInjectSystemFonts";
import { useInjectSystemTheme } from "../hooks/useInjectSystemTheme";
import { useStageNavigation } from "../hooks/useStageNavigation";
import stageDoc from "../iframe/shell.html?raw";
import {
	designFileQueryOptions,
	getDesignFileForUuid,
} from "../queries/design-file";
import {
	hydrateDesign,
	selectElement,
	useDesignSystemId,
	useSelectedId,
} from "../stores/design-store";
import { markDesignOpened } from "../utils/design-activity";
import { EditorShell } from "./chrome/EditorShell";
import { IFrameViewContext, useProjectScope } from "./contexts";
import { Artboards } from "./stage/Artboards";
import { Canvas } from "./stage/Canvas";

type StageFrameProps = {
	iframeRef: RefObject<HTMLIFrameElement | null>;
	onMount: () => void;
};

const StageFrame = memo(function StageFrame({
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
	const [didMount, setDidMount] = useState(false);
	const iframeRef = useRef<HTMLIFrameElement>(null);
	const view = useStageNavigation(iframeRef, didMount);
	const handleStageMount = useCallback(() => setDidMount(true), []);
	const projectScope = useProjectScope();

	const designFile = uuid ? getDesignFileForUuid(uuid) : null;
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
		if (design) {
			hydrateDesign(design);
		}
	}, [design]);

	const liveSystemId = useDesignSystemId();
	useInjectSystemTheme(iframeRef, didMount, liveSystemId);
	useInjectSystemAssets(iframeRef, didMount, liveSystemId);
	useInjectSystemFonts(iframeRef, didMount, liveSystemId);

	const selectedId = useSelectedId();
	useHotkey("Escape", () => selectElement(null), {
		enabled: selectedId !== null,
	});

	const errorMessage = (designQuery.error as Error | null)?.message;
	const stage = useMemo(
		() => <StageFrame iframeRef={iframeRef} onMount={handleStageMount} />,
		[handleStageMount],
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
			<EditorShell designFile={designFile}>{stage}</EditorShell>
		</IFrameViewContext.Provider>
	);
}
