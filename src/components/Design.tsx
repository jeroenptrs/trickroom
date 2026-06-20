import { useQuery } from "@tanstack/react-query";
import { useHotkey } from "@tanstack/react-hotkeys";
import { useEffect, useRef, useState } from "react";
import Frame from "react-frame-component";
import { useParams } from "react-router";
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
	useDesignSystemName,
	useSelectedId,
} from "../stores/design-store";
import { Sidebar } from "./chrome/Sidebar";
import { IFrameViewContext } from "./contexts";
import { Artboards } from "./stage/Artboards";
import { Canvas } from "./stage/Canvas";
import "../index.css";

export function Design() {
	const { uuid } = useParams<{ uuid: string }>();
	const [didMount, setDidMount] = useState(false);
	const iframeRef = useRef<HTMLIFrameElement>(null);
	const view = useStageNavigation(iframeRef, didMount);

	const designFile = uuid ? getDesignFileForUuid(uuid) : null;
	const designQuery = useQuery({
		...designFileQueryOptions(designFile ?? ""),
		enabled: designFile !== null,
	});
	const design = designQuery.data;

	useEffect(() => {
		if (design) {
			hydrateDesign(design);
		}
	}, [design]);

	const liveSystemName = useDesignSystemName();
	useInjectSystemTheme(iframeRef, didMount, liveSystemName);

	const selectedId = useSelectedId();
	useHotkey("Escape", () => selectElement(null), { enabled: selectedId !== null });

	const errorMessage = (designQuery.error as Error | null)?.message;

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
			<div className="pointer-events-none absolute left-3 top-3 z-30 bg-gray-500 px-2 py-1 text-xs text-white">
				Loading design data...
			</div>
		);
	}

	return (
		<>
			<div className="absolute inset-0 z-10">
				<Frame
					ref={iframeRef}
					initialContent={stageDoc}
					mountTarget="#trickroom-viewport"
					contentDidMount={() => setDidMount(true)}
					className="h-full w-full border-none"
				>
					<main className="absolute inset-0 min-w-screen min-h-screen origin-top-left flex flex-row gap-4">
						<Artboards />
					</main>

					<Canvas />
				</Frame>
			</div>
			<IFrameViewContext.Provider value={view}>
				<Sidebar designFile={designFile} />
			</IFrameViewContext.Provider>
		</>
	);
}
