import { useQuery } from "@tanstack/react-query";
import {
	type Dispatch,
	type RefObject,
	type SetStateAction,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import Frame from "react-frame-component";
import { useParams, useSearchParams } from "react-router";
import { useCompiledTailwind } from "../hooks/useCompiledTailwind";
import { useInjectSystemAssets } from "../hooks/useInjectSystemAssets";
import { useInjectSystemFonts } from "../hooks/useInjectSystemFonts";
import { useInjectSystemTheme } from "../hooks/useInjectSystemTheme";
import stageDocRaw from "../iframe/shell.html?raw";
import { getStagePreviewContainerClassName } from "../preview/stage-preview-dark-mode";
import {
	designFileQueryOptions,
	getDesignFileForUuid,
} from "../queries/design-file";
import { forceHydrateDesign, useDesignSystemId } from "../stores/design-store";
import type { Node as DesignNode, TrickroomDesign } from "../types";
import { resolveStageDoc } from "../utils/tailwind-render-mode";
import { useProjectScope } from "./contexts";
import {
	ResponsiveStageContext,
	type ResponsiveStageContextValue,
} from "./responsive-stage-context";
import { Artboards } from "./stage/Artboards";

const stageDoc = resolveStageDoc(stageDocRaw);
const CAPTURE_SETTLE_TIMEOUT_MS = 10_000;

export type CaptureTheme = "light" | "dark";

export type CaptureWindowState = {
	status: "loading" | "ready" | "error";
	designId?: string;
	boardId?: string;
	nodeId?: string;
	message?: string;
};

declare global {
	interface Window {
		__TRICKROOM_CAPTURE__?: CaptureWindowState;
	}
}

function setCaptureState(state: CaptureWindowState) {
	window.__TRICKROOM_CAPTURE__ = state;
	document.documentElement.dataset.trickroomCaptureStatus = state.status;
	if (state.status === "ready") {
		document.documentElement.dataset.trickroomCaptureReady = "true";
	} else {
		delete document.documentElement.dataset.trickroomCaptureReady;
	}
}

function nodeContainsId(node: DesignNode, id: string): boolean {
	if (node.id === id) return true;
	if (typeof node.children === "string") return false;
	return node.children.some((child) => nodeContainsId(child, id));
}

export function resolveCaptureBoardId(
	design: TrickroomDesign,
	requestedBoardId: string | undefined,
	nodeId: string | undefined,
) {
	if (requestedBoardId) {
		return design.boards.some((board) => board.id === requestedBoardId)
			? requestedBoardId
			: null;
	}
	if (nodeId) {
		return (
			design.boards.find((board) => nodeContainsId(board, nodeId))?.id ?? null
		);
	}
	return design.boards[0]?.id ?? null;
}

function nextFrame(view: Window) {
	return new Promise<void>((resolve) =>
		view.requestAnimationFrame(() => resolve()),
	);
}

async function waitForFontStylesheets(doc: Document) {
	const links = [
		...doc.querySelectorAll<HTMLLinkElement>(
			'link[data-trickroom-managed="system-font-stylesheet"]',
		),
	];
	await Promise.all(
		links.map(
			(link) =>
				new Promise<void>((resolve) => {
					if (link.sheet) {
						resolve();
						return;
					}
					const timeout = setTimeout(resolve, 5_000);
					const done = () => {
						clearTimeout(timeout);
						resolve();
					};
					link.addEventListener("load", done, { once: true });
					link.addEventListener("error", done, { once: true });
				}),
		),
	);
}

function hasTailwindOutput(doc: Document) {
	if (doc.getElementById("trickroom-compiled-tailwind")) return true;
	return [...doc.head.querySelectorAll("style")].some((style) => {
		const css = style.textContent ?? "";
		return css.includes("/*! tailwindcss") || css.includes("--tw-");
	});
}

async function waitForTailwindOutput(doc: Document) {
	if (hasTailwindOutput(doc)) return;
	await new Promise<void>((resolve, reject) => {
		const timeout = setTimeout(() => {
			observer.disconnect();
			reject(new Error("Tailwind did not finish compiling before timeout."));
		}, CAPTURE_SETTLE_TIMEOUT_MS);
		const observer = new MutationObserver(() => {
			if (!hasTailwindOutput(doc)) return;
			clearTimeout(timeout);
			observer.disconnect();
			resolve();
		});
		observer.observe(doc.head, { childList: true, subtree: true });
	});
}

async function settleCaptureDocument(doc: Document) {
	const timeout = new Promise<never>((_, reject) => {
		setTimeout(
			() =>
				reject(new Error("Capture rendering did not settle before timeout.")),
			CAPTURE_SETTLE_TIMEOUT_MS,
		);
	});
	const settle = async () => {
		await waitForTailwindOutput(doc);
		await waitForFontStylesheets(doc);
		if (doc.fonts) await doc.fonts.ready;
		const view = doc.defaultView;
		if (view) {
			await nextFrame(view);
			await nextFrame(view);
		}
	};
	await Promise.race([settle(), timeout]);
}

function noopDispatch<T>(): Dispatch<SetStateAction<T>> {
	return () => undefined;
}

function CaptureFrame({
	iframeRef,
	onMount,
	dark,
}: {
	iframeRef: RefObject<HTMLIFrameElement | null>;
	onMount: () => void;
	dark: boolean;
}) {
	return (
		<Frame
			ref={iframeRef}
			id="trickroom-capture-frame"
			initialContent={stageDoc}
			mountTarget="#trickroom-viewport"
			contentDidMount={onMount}
			className="block h-full w-full border-none"
		>
			<main
				className={`min-h-full min-w-full flex flex-row ${getStagePreviewContainerClassName(dark)}`}
			>
				<Artboards />
			</main>
		</Frame>
	);
}

export function Capture() {
	const { design: designId, board: requestedBoardId } = useParams<{
		design: string;
		board?: string;
	}>();
	const [searchParams] = useSearchParams();
	const nodeId = searchParams.get("node")?.trim() || undefined;
	const theme: CaptureTheme =
		searchParams.get("theme") === "dark" ? "dark" : "light";
	const projectScope = useProjectScope();
	const designFile = designId ? getDesignFileForUuid(designId) : "";
	const designQuery = useQuery({
		...designFileQueryOptions(designFile, projectScope),
		enabled: designFile.length > 0,
	});
	const iframeRef = useRef<HTMLIFrameElement>(null);
	const [didMount, setDidMount] = useState(false);
	const design = designQuery.data?.design;
	const boardId = design
		? resolveCaptureBoardId(design, requestedBoardId, nodeId)
		: null;

	useEffect(() => {
		setCaptureState({ status: "loading", ...(designId ? { designId } : {}) });
	}, [designId]);

	useEffect(() => {
		if (designQuery.data) {
			forceHydrateDesign(designQuery.data.design, designQuery.data.revision);
		}
	}, [designQuery.data]);

	const systemId = useDesignSystemId();
	const themeReady = useInjectSystemTheme(iframeRef, didMount, systemId);
	const stylesReady = useCompiledTailwind(iframeRef, didMount, systemId);
	const assetsReady = useInjectSystemAssets(iframeRef, didMount, systemId);
	const fontsReady = useInjectSystemFonts(iframeRef, didMount, systemId);

	const responsiveStage = useMemo<ResponsiveStageContextValue>(
		() => ({
			mode: "responsive",
			activeBoardId: boardId,
			responsiveWidth: 640,
			breakpoints: [],
			controls: {
				setMode: noopDispatch(),
				setActiveBoardId: noopDispatch(),
				setResponsiveWidth: noopDispatch(),
			},
		}),
		[boardId],
	);

	useEffect(() => {
		if (designQuery.isError) {
			setCaptureState({
				status: "error",
				...(designId ? { designId } : {}),
				message:
					designQuery.error instanceof Error
						? designQuery.error.message
						: "Failed to load design.",
			});
			return;
		}
		if (design && !boardId) {
			setCaptureState({
				status: "error",
				...(designId ? { designId } : {}),
				message: requestedBoardId
					? `Board "${requestedBoardId}" was not found.`
					: nodeId
						? `Node "${nodeId}" was not found.`
						: "The design has no boards.",
			});
		}
	}, [
		boardId,
		design,
		designId,
		designQuery.error,
		designQuery.isError,
		nodeId,
		requestedBoardId,
	]);

	useEffect(() => {
		if (
			!designId ||
			!boardId ||
			!didMount ||
			!themeReady ||
			!stylesReady ||
			!assetsReady ||
			!fontsReady
		) {
			return;
		}
		const doc = iframeRef.current?.contentDocument;
		if (!doc) return;
		let cancelled = false;
		void settleCaptureDocument(doc)
			.then(() => {
				if (cancelled) return;
				const board = doc.querySelector(
					`[data-trickroom-root-id="${CSS.escape(boardId)}"]`,
				);
				const target = nodeId
					? doc.querySelector(
							`[data-trickroom-node-id="${CSS.escape(nodeId)}"]`,
						)
					: board;
				if (!board || !target) {
					throw new Error(
						nodeId
							? `Node "${nodeId}" did not render.`
							: `Board "${boardId}" did not render.`,
					);
				}
				setCaptureState({
					status: "ready",
					designId,
					boardId,
					...(nodeId ? { nodeId } : {}),
				});
			})
			.catch((error) => {
				if (cancelled) return;
				setCaptureState({
					status: "error",
					designId,
					boardId,
					...(nodeId ? { nodeId } : {}),
					message: error instanceof Error ? error.message : String(error),
				});
			});
		return () => {
			cancelled = true;
		};
	}, [
		assetsReady,
		boardId,
		designId,
		didMount,
		fontsReady,
		nodeId,
		stylesReady,
		themeReady,
	]);

	if (!designId) {
		return <p>Missing design id.</p>;
	}

	return (
		<div className="h-screen w-screen overflow-hidden bg-white">
			{design && boardId ? (
				<ResponsiveStageContext.Provider value={responsiveStage}>
					<CaptureFrame
						iframeRef={iframeRef}
						onMount={() => setDidMount(true)}
						dark={theme === "dark"}
					/>
				</ResponsiveStageContext.Provider>
			) : null}
		</div>
	);
}
