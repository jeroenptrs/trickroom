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
import { systemComponentQueryOptions } from "../queries/system-components";
import type { DesignFileRevision } from "../services/design-file-service.types";
import { forceHydrateDesign, useDesignSystemId } from "../stores/design-store";
import type { Node as DesignNode, TrickroomDesign } from "../types";
import { expandResolvedSystemComponent } from "../utils/system-component-expansion.core";
import type {
	PublishedSystemComponentVersion,
	SystemComponentRecord,
} from "../utils/system-components";
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

type CaptureStageProps = {
	/** Design id or component key reported in the capture state. */
	captureId: string;
	design: TrickroomDesign | undefined;
	/** Render-only designs (components) have no file revision. */
	revision?: DesignFileRevision;
	/** Load error to report instead of rendering. */
	error: string | null;
	requestedBoardId: string | undefined;
	nodeId: string | undefined;
	theme: CaptureTheme;
};

/**
 * Hydrates a design into the stage, renders one board through the same
 * iframe shell and Artboards renderer as the responsive view, and reports
 * readiness once styles, fonts and two frames have settled.
 */
function CaptureStage({
	captureId,
	design,
	revision,
	error,
	requestedBoardId,
	nodeId,
	theme,
}: CaptureStageProps) {
	const iframeRef = useRef<HTMLIFrameElement>(null);
	const [didMount, setDidMount] = useState(false);
	const boardId = design
		? resolveCaptureBoardId(design, requestedBoardId, nodeId)
		: null;

	useEffect(() => {
		setCaptureState({ status: "loading", designId: captureId });
	}, [captureId]);

	useEffect(() => {
		if (design) forceHydrateDesign(design, revision ?? "sha256:capture");
	}, [design, revision]);

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
		if (error) {
			setCaptureState({
				status: "error",
				designId: captureId,
				message: error,
			});
			return;
		}
		if (design && !boardId) {
			setCaptureState({
				status: "error",
				designId: captureId,
				message: requestedBoardId
					? `Board "${requestedBoardId}" was not found.`
					: nodeId
						? `Node "${nodeId}" was not found.`
						: "The design has no boards.",
			});
		}
	}, [boardId, captureId, design, error, nodeId, requestedBoardId]);

	useEffect(() => {
		if (
			error ||
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
					designId: captureId,
					boardId,
					...(nodeId ? { nodeId } : {}),
				});
			})
			.catch((settleError) => {
				if (cancelled) return;
				setCaptureState({
					status: "error",
					designId: captureId,
					boardId,
					...(nodeId ? { nodeId } : {}),
					message:
						settleError instanceof Error
							? settleError.message
							: String(settleError),
				});
			});
		return () => {
			cancelled = true;
		};
	}, [
		assetsReady,
		boardId,
		captureId,
		didMount,
		error,
		fontsReady,
		nodeId,
		stylesReady,
		themeReady,
	]);

	return (
		<div className="h-screen w-screen overflow-hidden bg-white">
			{design && boardId && !error ? (
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

function readCaptureTheme(searchParams: URLSearchParams): CaptureTheme {
	return searchParams.get("theme") === "dark" ? "dark" : "light";
}

/** `/capture/:design/:board?`: one board of a design file. */
export function Capture() {
	const { design: designId, board: requestedBoardId } = useParams<{
		design: string;
		board?: string;
	}>();
	const [searchParams] = useSearchParams();
	const nodeId = searchParams.get("node")?.trim() || undefined;
	const projectScope = useProjectScope();
	const designFile = designId ? getDesignFileForUuid(designId) : "";
	const designQuery = useQuery({
		...designFileQueryOptions(designFile, projectScope),
		enabled: designFile.length > 0,
	});

	if (!designId) {
		return <p>Missing design id.</p>;
	}

	return (
		<CaptureStage
			captureId={designId}
			design={designQuery.data?.design}
			revision={designQuery.data?.revision}
			error={
				designQuery.isError
					? designQuery.error instanceof Error
						? designQuery.error.message
						: "Failed to load design."
					: null
			}
			requestedBoardId={requestedBoardId}
			nodeId={nodeId}
			theme={readCaptureTheme(searchParams)}
		/>
	);
}

export const COMPONENT_CAPTURE_BOARD_ID = "component-capture";

export type ComponentCaptureOptions = {
	systemId: string;
	record: SystemComponentRecord;
	source: "published" | "draft";
	variants: Record<string, string>;
	rows?: string;
	columns?: string;
};

const trickroomNode = (
	component: "container" | "text",
	name: string,
	className: string,
	children: DesignNode["children"],
	id: string = globalThis.crypto.randomUUID(),
): DesignNode => ({
	id,
	props: {
		"data-trickroom-name": name,
		"data-trickroom-library": "trickroom",
		"data-trickroom-component": component,
		...(component === "text" ? { "data-trickroom-role": "text" } : {}),
		className,
	},
	children,
});

// Arbitrary colours: the linked system may not ship Tailwind's palette.
const LABEL_CLASS_NAME =
	"font-mono text-[11px] leading-4 text-[#64748b] dark:text-[#94a3b8]";

/**
 * A one-board design that renders a system component on its own: one
 * instance, or a labelled grid of instances for every value of one or two
 * variant axes. Instances are expanded exactly as when they are placed in a
 * design. Render-only: nothing is written.
 */
export function buildComponentCaptureDesign({
	systemId,
	record,
	source,
	variants,
	rows,
	columns,
}: ComponentCaptureOptions): TrickroomDesign {
	const payload =
		source === "draft"
			? record.draft
			: record.published?.versions[record.published.currentVersion];
	if (!payload) {
		throw new Error(
			source === "draft"
				? `Component "${record.slug}" has no draft.`
				: `Component "${record.slug}" is not published.`,
		);
	}
	const version: PublishedSystemComponentVersion =
		"version" in payload
			? (payload as PublishedSystemComponentVersion)
			: {
					...payload,
					version: "draft",
					publishedAt: "",
					templateHash: "",
					variantSchemaHash: "",
				};
	const axes = version.variants?.axes ?? {};
	const valuesOf = (axis: string | undefined) => {
		if (!axis) return [undefined];
		const definition = axes[axis];
		if (!definition) {
			throw new Error(
				`Component "${record.slug}" has no variant axis "${axis}".`,
			);
		}
		return Object.keys(definition.values);
	};
	const instance = (row: string | undefined, column: string | undefined) =>
		expandResolvedSystemComponent(
			{ systemId, componentId: record.componentId, record, version },
			{
				variantValues: {
					...variants,
					...(rows && row !== undefined ? { [rows]: row } : {}),
					...(columns && column !== undefined ? { [columns]: column } : {}),
				},
			},
		).root;

	const boardClassName =
		"flex flex-col items-start gap-6 p-8 bg-[#ffffff] dark:bg-[#0b1120]";
	if (!rows) {
		return {
			name: record.name,
			systemId,
			boards: [
				trickroomNode(
					"container",
					record.name,
					boardClassName,
					[instance(undefined, undefined)],
					COMPONENT_CAPTURE_BOARD_ID,
				),
			],
		};
	}

	const rowValues = valuesOf(rows);
	const columnValues = valuesOf(columns);
	const cells: DesignNode[] = [];
	if (columns) {
		cells.push(trickroomNode("text", "Corner", LABEL_CLASS_NAME, ""));
		for (const column of columnValues) {
			cells.push(
				trickroomNode(
					"text",
					`${columns}=${column}`,
					LABEL_CLASS_NAME,
					`${columns}=${column}`,
				),
			);
		}
	}
	for (const row of rowValues) {
		cells.push(
			trickroomNode(
				"text",
				`${rows}=${row}`,
				LABEL_CLASS_NAME,
				`${rows}=${row}`,
			),
		);
		for (const column of columnValues) {
			cells.push(instance(row, column));
		}
	}
	return {
		name: record.name,
		systemId,
		boards: [
			trickroomNode(
				"container",
				record.name,
				boardClassName,
				[
					// A variant matrix is two-dimensional, so it is a grid.
					trickroomNode(
						"container",
						"Variant matrix",
						`grid grid-cols-[auto_repeat(${columnValues.length},auto)] items-center justify-items-start gap-x-8 gap-y-6`,
						cells,
					),
				],
				COMPONENT_CAPTURE_BOARD_ID,
			),
		],
	};
}

/**
 * `/capture/component/:system/:component`: a system component on its own.
 * Query: `variant=axis:value` (repeatable), `rows`/`columns` axes for a
 * matrix, `source=draft`, `theme`.
 */
export function ComponentCapture() {
	const { system: systemId, component: componentId } = useParams<{
		system: string;
		component: string;
	}>();
	const [searchParams] = useSearchParams();
	const projectScope = useProjectScope();
	const componentQuery = useQuery({
		...systemComponentQueryOptions(
			systemId ?? "",
			componentId ?? "",
			projectScope,
		),
		enabled: Boolean(systemId && componentId),
	});
	const record = componentQuery.data?.record;
	const query = searchParams.toString();
	const built = useMemo(() => {
		if (!systemId || !record) return null;
		const params = new URLSearchParams(query);
		const variants: Record<string, string> = {};
		for (const entry of params.getAll("variant")) {
			const separator = entry.indexOf(":");
			if (separator > 0) {
				variants[entry.slice(0, separator)] = entry.slice(separator + 1);
			}
		}
		try {
			return {
				design: buildComponentCaptureDesign({
					systemId,
					record,
					source:
						params.get("source") === "draft" || !record.published
							? "draft"
							: "published",
					variants,
					rows: params.get("rows") || undefined,
					columns: params.get("columns") || undefined,
				}),
				error: null,
			};
		} catch (error) {
			return {
				design: undefined,
				error: error instanceof Error ? error.message : String(error),
			};
		}
	}, [query, record, systemId]);

	if (!systemId || !componentId) {
		return <p>Missing system or component id.</p>;
	}

	return (
		<CaptureStage
			captureId={`${systemId}/${componentId}`}
			design={built?.design}
			error={
				componentQuery.isError
					? componentQuery.error instanceof Error
						? componentQuery.error.message
						: "Failed to load the component."
					: (built?.error ?? null)
			}
			requestedBoardId={COMPONENT_CAPTURE_BOARD_ID}
			nodeId={undefined}
			theme={readCaptureTheme(searchParams)}
		/>
	);
}
