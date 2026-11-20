import { Menu } from "@base-ui/react/menu";
import {
	ChevronLeft,
	ChevronRight,
	Download,
	LayoutGrid,
	Minus,
	Plus,
	Smartphone,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
	downloadExport,
	type ExportBoard,
	findBoardIdForEntity,
	selectExportBoard,
	toExportBoards,
} from "../../export/client";
import {
	setAnnotationMode,
	useAnnotationMode,
} from "../../stores/annotation-mode-store";
import {
	designStore,
	serializeDesign,
	useDesignRoots,
	useSelectedId,
} from "../../stores/design-store";
import { useEditorPanelOpen } from "../../stores/editor-chrome-store";
import { useExternallyChangedBoardIds } from "../../stores/external-change-store";
import { formatShortcut } from "../../utils/editor-shortcuts";
import { useIFrameView, useProjectConfig } from "../contexts";
import {
	cycleResponsiveStageBoard,
	getResponsiveStageBoardPosition,
	RESPONSIVE_STAGE_MAX_WIDTH,
	RESPONSIVE_STAGE_MIN_WIDTH,
	type ResponsiveStageBoardCycleDirection,
	type ResponsiveStageMode,
	useResponsiveStage,
} from "../responsive-stage-context";
import {
	formatResponsiveStageZoom,
	RESPONSIVE_STAGE_MAX_ZOOM,
	RESPONSIVE_STAGE_MIN_ZOOM,
	RESPONSIVE_STAGE_ZOOM_PRESETS,
	stepResponsiveStageZoom,
	useResponsiveStageZoom,
} from "../responsive-stage-zoom";
import { Button } from "../ui/button";
import { Switch } from "../ui/switch";
import { DesignHeaderContent, DesignPanelToggle } from "./DesignHeader";
import { SaveIndicator } from "./DesignSave";

export const RESPONSIVE_DEVICE_WIDTH_PRESETS = [
	{ label: "Mobile S", width: 320 },
	{ label: "Mobile M", width: 375 },
	{ label: "Mobile L", width: 425 },
	{ label: "Tablet", width: 768 },
	{ label: "Laptop", width: 1024 },
	{ label: "Desktop", width: 1440 },
] as const;

export function getResponsiveWidthDraftError(draft: string) {
	const trimmed = draft.trim();
	if (!trimmed) {
		return "Enter a viewport width.";
	}

	const width = Number(trimmed);
	if (!Number.isFinite(width)) {
		return "Enter a numeric viewport width.";
	}

	if (
		width < RESPONSIVE_STAGE_MIN_WIDTH ||
		width > RESPONSIVE_STAGE_MAX_WIDTH
	) {
		return `Width must be between ${RESPONSIVE_STAGE_MIN_WIDTH}px and ${RESPONSIVE_STAGE_MAX_WIDTH}px.`;
	}

	return null;
}

/**
 * What the width field says after a commit changed the typed value, or null
 * when the value went in as typed.
 */
export function getResponsiveWidthCommitNotice(
	draft: string,
	committed: { draft: string; width: number | null },
) {
	if (committed.width === null) {
		return `Enter a width from ${RESPONSIVE_STAGE_MIN_WIDTH}px to ${RESPONSIVE_STAGE_MAX_WIDTH}px.`;
	}
	const typed = Number(draft.trim());
	if (typed > RESPONSIVE_STAGE_MAX_WIDTH) {
		return `Width set to ${committed.width}px, the maximum.`;
	}
	if (typed < RESPONSIVE_STAGE_MIN_WIDTH) {
		return `Width set to ${committed.width}px, the minimum.`;
	}
	return null;
}

export function resolveResponsiveWidthDraftCommit(
	draft: string,
	currentWidth: number,
) {
	const trimmed = draft.trim();
	const width = Number(trimmed);
	if (!trimmed || !Number.isFinite(width)) {
		return { draft: String(currentWidth), width: null };
	}

	const clampedWidth = Math.min(
		RESPONSIVE_STAGE_MAX_WIDTH,
		Math.max(RESPONSIVE_STAGE_MIN_WIDTH, Math.round(width)),
	);
	return { draft: String(clampedWidth), width: clampedWidth };
}

const STAGE_MODE_OPTIONS: {
	value: ResponsiveStageMode;
	label: string;
	Icon: typeof LayoutGrid;
	title: string;
}[] = [
	{
		value: "canvas",
		label: "Canvas",
		Icon: LayoutGrid,
		title: "Show all boards on a canvas",
	},
	{
		value: "responsive",
		label: "Responsive",
		Icon: Smartphone,
		title: "Preview one board at a set width",
	},
];

function WorkspaceModeToggle() {
	const { mode, controls } = useResponsiveStage();

	return (
		<fieldset
			className="flex gap-px border-0 p-0 min-inline-0"
			aria-label="Canvas mode"
		>
			{STAGE_MODE_OPTIONS.map(({ value, label, Icon, title }) => {
				const isSelected = mode === value;
				return (
					<Button
						key={value}
						type="button"
						variant="block"
						isSelected={isSelected}
						title={title}
						aria-pressed={isSelected}
						className="flex h-7 items-center gap-1 px-2 text-[11px]"
						onClick={() => controls.setMode(value)}
					>
						<Icon className="size-3.5 shrink-0" />
						<span>{label}</span>
					</Button>
				);
			})}
		</fieldset>
	);
}

function AnnotationModeSwitch() {
	const enabled = useAnnotationMode();
	const shortcut = formatShortcut(["Alt", "C"]);
	const title = enabled
		? `Use the boards as a live page (${shortcut})`
		: `Select layers and show annotation pins (${shortcut})`;

	return (
		// biome-ignore lint/a11y/noLabelWithoutControl: the Switch renders the control.
		<label className="flex items-center gap-1.5 text-slate-600" title={title}>
			<span>Select</span>
			<Switch
				checked={enabled}
				onCheckedChange={setAnnotationMode}
				aria-label="Select layers and show annotation pins"
			/>
		</label>
	);
}

function ResponsiveBoardControls() {
	const rootIds = useDesignRoots();
	const { activeBoardId, controls } = useResponsiveStage();
	const changedBoardIds = useExternallyChangedBoardIds();
	// Boards changed outside this editor that the human has not seen yet,
	// in board order starting after the active one.
	const unseenChangedBoardIds = useMemo(() => {
		const changed = new Set(changedBoardIds);
		const start = Math.max(0, rootIds.indexOf(activeBoardId ?? ""));
		return [...rootIds.slice(start + 1), ...rootIds.slice(0, start)].filter(
			(id) => changed.has(id),
		);
	}, [activeBoardId, changedBoardIds, rootIds]);
	const { index, total } = useMemo(
		() => getResponsiveStageBoardPosition(rootIds, activeBoardId),
		[activeBoardId, rootIds],
	);
	const canCycle = total > 1;

	const cycleBoard = (direction: ResponsiveStageBoardCycleDirection) => {
		controls.setActiveBoardId((currentBoardId) =>
			cycleResponsiveStageBoard(rootIds, currentBoardId, direction),
		);
	};

	return (
		<fieldset
			className="flex shrink-0 items-center gap-1 border-0 p-0"
			aria-label="Board navigation"
		>
			<Button
				type="button"
				variant="block"
				disabled={!canCycle}
				className="size-7 shrink-0 p-0"
				title="Previous board (Up)"
				aria-label="Previous board"
				onClick={() => cycleBoard("previous")}
			>
				<ChevronLeft className="size-3.5" />
			</Button>
			<span
				className="shrink-0 bg-white px-2 py-0.5 text-[11px] font-medium tabular-nums text-slate-950"
				aria-live="polite"
			>
				{total > 0 ? `Board ${index} / ${total}` : "No boards"}
			</span>
			<Button
				type="button"
				variant="block"
				disabled={!canCycle}
				className="size-7 shrink-0 p-0"
				title="Next board (Down)"
				aria-label="Next board"
				onClick={() => cycleBoard("next")}
			>
				<ChevronRight className="size-3.5" />
			</Button>
			{unseenChangedBoardIds.length > 0 ? (
				<Button
					type="button"
					variant="block"
					className="h-5 shrink-0 bg-cyan-500 px-1.5 py-0 text-[11px] font-medium text-slate-950 not-disabled:hover:bg-cyan-400"
					title="Boards changed outside this editor: show the next one"
					aria-label={`Show the next of ${unseenChangedBoardIds.length} boards changed outside this editor`}
					data-changed-externally="board-navigation"
					onClick={() =>
						controls.setActiveBoardId(unseenChangedBoardIds[0] ?? null)
					}
				>
					{unseenChangedBoardIds.length} changed
				</Button>
			) : null}
		</fieldset>
	);
}

function ResponsiveDevicePresetMenu() {
	const { responsiveWidth, controls } = useResponsiveStage();

	return (
		<Menu.Root modal={false}>
			<Menu.Trigger
				render={(props, { open }) => (
					<Button
						{...props}
						type="button"
						variant="block"
						isSelected={open}
						className="flex h-7 items-center gap-1 px-2 py-0 text-[11px]"
						aria-label="Viewport presets"
						title="Viewport presets"
					>
						<Smartphone className="size-3.5 shrink-0" />
						<span>Presets</span>
					</Button>
				)}
			/>
			<Menu.Portal>
				<Menu.Positioner sideOffset={4} align="start">
					<Menu.Popup className="z-50 flex min-w-36 flex-col bg-slate-50 p-1 text-[11px] text-slate-700 inset-shadow-[0_0_0_1px] inset-shadow-slate-200 focus-visible:outline-none">
						{RESPONSIVE_DEVICE_WIDTH_PRESETS.map(({ label, width }) => {
							const isSelected = responsiveWidth === width;
							return (
								<Menu.Item
									key={width}
									className="flex cursor-default items-center gap-2 px-2 py-1 data-highlighted:bg-slate-200/60"
									onClick={() => controls.setResponsiveWidth(width)}
								>
									<span className="min-w-0 flex-1 truncate">{label}</span>
									<span className="tabular-nums text-slate-500">{width}</span>
									{isSelected ? (
										<span aria-hidden className="size-1.5 bg-cyan-700" />
									) : null}
								</Menu.Item>
							);
						})}
					</Menu.Popup>
				</Menu.Positioner>
			</Menu.Portal>
		</Menu.Root>
	);
}

function ResponsiveWidthControls() {
	const { responsiveWidth, breakpoints, controls } = useResponsiveStage();
	const [widthDraft, setWidthDraft] = useState(String(responsiveWidth));
	const [inputFocused, setInputFocused] = useState(false);
	// Set on blur or Enter, never per keystroke: typing 3 on the way to 320
	// is not an error.
	const [notice, setNotice] = useState<string | null>(null);
	const noticeId = "responsive-viewport-width-notice";

	useEffect(() => {
		if (!inputFocused) {
			setWidthDraft(String(responsiveWidth));
		}
	}, [inputFocused, responsiveWidth]);

	const commitDraft = () => {
		const result = resolveResponsiveWidthDraftCommit(
			widthDraft,
			responsiveWidth,
		);
		setWidthDraft(result.draft);
		setNotice(getResponsiveWidthCommitNotice(widthDraft, result));
		if (result.width !== null) {
			controls.setResponsiveWidth(result.width);
		}
	};

	return (
		<fieldset
			className="flex min-w-0 items-center gap-2 border-0 p-0 min-inline-0"
			aria-label="Viewport width"
		>
			<label className="flex h-7 shrink-0 items-center bg-white text-slate-600 inset-shadow-[0_0_0_1px] inset-shadow-slate-200 focus-within:inset-shadow-cyan-500">
				<span className="sr-only">Viewport width</span>
				<input
					type="number"
					min={RESPONSIVE_STAGE_MIN_WIDTH}
					max={RESPONSIVE_STAGE_MAX_WIDTH}
					step={1}
					value={widthDraft}
					onChange={(event) => {
						const nextDraft = event.currentTarget.value;
						setWidthDraft(nextDraft);
						if (getResponsiveWidthDraftError(nextDraft) === null) {
							const nextWidth = Number(nextDraft);
							controls.setResponsiveWidth(nextWidth);
						}
					}}
					onFocus={() => {
						setInputFocused(true);
						setNotice(null);
					}}
					onBlur={() => {
						setInputFocused(false);
						commitDraft();
					}}
					onKeyDown={(event) => {
						if (event.key === "Enter") {
							event.preventDefault();
							commitDraft();
							event.currentTarget.blur();
						} else if (event.key === "Escape") {
							event.preventDefault();
							setWidthDraft(String(responsiveWidth));
							event.currentTarget.blur();
						}
					}}
					className="h-full w-16 border-none bg-transparent px-2 text-right text-[11px] tabular-nums text-slate-700 focus-visible:outline-none"
					aria-label="Viewport width in pixels"
					aria-describedby={notice ? noticeId : undefined}
					title="Viewport width in pixels"
				/>
				<span className="pr-2 text-[10px] text-slate-400">px</span>
			</label>
			<span
				id={noticeId}
				className="shrink-0 whitespace-nowrap text-[11px] text-slate-700 empty:hidden"
				aria-live="polite"
			>
				{notice}
			</span>
			<ResponsiveDevicePresetMenu />
			<fieldset
				className="flex min-w-0 items-center gap-px overflow-x-auto border-0 p-0 min-inline-0"
				aria-label="Breakpoints"
			>
				{breakpoints.map((breakpoint) => {
					const px = breakpoint.px;
					const roundedPx = px === null ? null : Math.round(px);
					const isActive = roundedPx === responsiveWidth;
					const title =
						roundedPx === null
							? `${breakpoint.name} uses ${breakpoint.value}, which cannot be converted to pixels`
							: `Set width to ${breakpoint.name} ${roundedPx}px`;

					return (
						<span key={breakpoint.name} title={title} className="shrink-0">
							<Button
								type="button"
								variant="block"
								disabled={roundedPx === null}
								isSelected={isActive}
								className="flex h-7 items-center gap-1 px-2 py-0 text-[11px]"
								aria-label={title}
								onClick={() => {
									if (roundedPx !== null) {
										controls.setResponsiveWidth(roundedPx);
									}
								}}
							>
								<span className="font-medium">{breakpoint.name}</span>
								{roundedPx !== null ? (
									<span className="tabular-nums text-slate-500">
										{roundedPx}
									</span>
								) : null}
							</Button>
						</span>
					);
				})}
			</fieldset>
		</fieldset>
	);
}

function ResponsiveZoomControls() {
	const { zoom, fitScale, scale, setZoom } = useResponsiveStageZoom();
	const menuItemClassName =
		"flex cursor-default items-center gap-2 px-2 py-1 data-[highlighted]:bg-slate-200/60";
	const options = [
		{ value: "fit" as const, label: "Fit", scale: fitScale },
		...RESPONSIVE_STAGE_ZOOM_PRESETS.map((preset) => ({
			value: preset,
			label: formatResponsiveStageZoom(preset),
			scale: preset,
		})),
	];

	return (
		<fieldset
			className="flex items-center gap-px border-0 p-0 min-inline-0"
			aria-label="Zoom"
		>
			<Button
				type="button"
				variant="block"
				disabled={scale <= RESPONSIVE_STAGE_MIN_ZOOM}
				className="size-7 shrink-0 p-0"
				title="Zoom out"
				aria-label="Zoom out"
				onClick={() => setZoom(stepResponsiveStageZoom(scale, "out"))}
			>
				<Minus className="size-3.5" />
			</Button>
			<Menu.Root modal={false}>
				<Menu.Trigger
					render={(props, { open }) => (
						<Button
							{...props}
							type="button"
							variant="block"
							isSelected={open}
							className="flex h-7 min-w-12 items-center justify-center gap-1 px-1.5 py-0 text-[11px] tabular-nums"
							aria-label="Zoom level"
							title="Zoom level (Ctrl/Cmd + scroll to zoom)"
						>
							{zoom === "fit" ? <span>Fit</span> : null}
							<span aria-live="polite">{formatResponsiveStageZoom(scale)}</span>
						</Button>
					)}
				/>
				<Menu.Portal>
					<Menu.Positioner sideOffset={4} align="end">
						<Menu.Popup className="z-50 flex min-w-32 flex-col bg-slate-50 p-1 text-[11px] text-slate-700 inset-shadow-[0_0_0_1px] inset-shadow-slate-200 focus-visible:outline-none">
							{options.map((option) => (
								<Menu.Item
									key={option.label}
									className={menuItemClassName}
									onClick={() => setZoom(option.value)}
								>
									<span className="min-w-0 flex-1">{option.label}</span>
									{option.value === "fit" ? (
										<span className="tabular-nums text-slate-500">
											{formatResponsiveStageZoom(option.scale)}
										</span>
									) : null}
									{zoom === option.value ? (
										<span aria-hidden className="size-1.5 bg-cyan-700" />
									) : null}
								</Menu.Item>
							))}
						</Menu.Popup>
					</Menu.Positioner>
				</Menu.Portal>
			</Menu.Root>
			<Button
				type="button"
				variant="block"
				disabled={scale >= RESPONSIVE_STAGE_MAX_ZOOM}
				className="size-7 shrink-0 p-0"
				title="Zoom in"
				aria-label="Zoom in"
				onClick={() => setZoom(stepResponsiveStageZoom(scale, "in"))}
			>
				<Plus className="size-3.5" />
			</Button>
		</fieldset>
	);
}

function ExportControl() {
	const { mode, activeBoardId } = useResponsiveStage();
	const projectName = useProjectConfig().name;
	const selectedId = useSelectedId();
	const [busy, setBusy] = useState(false);

	const runExport = async (target: "all" | "active" | "selected") => {
		const design = serializeDesign();
		let boards: ExportBoard[];
		if (target === "all") {
			boards = toExportBoards(design.boards);
		} else if (target === "active") {
			boards = selectExportBoard(design.boards, activeBoardId);
		} else {
			const boardId = findBoardIdForEntity(
				designStore.get().entitiesById,
				selectedId,
			);
			boards = selectExportBoard(design.boards, boardId);
		}

		if (boards.length === 0) {
			toast.error("No board to export");
			return;
		}

		setBusy(true);
		try {
			await downloadExport({
				boards,
				systemId: design.systemId ?? null,
				projectName,
				designName: design.name,
			});
			toast.success(
				boards.length > 1
					? `${boards.length} boards exported`
					: "Board exported",
			);
		} catch (error) {
			console.error(error);
			toast.error(`${design.name} not exported`, {
				description: error instanceof Error ? error.message : undefined,
			});
		} finally {
			setBusy(false);
		}
	};

	return (
		<Menu.Root modal={false}>
			<Menu.Trigger
				render={(props, { open }) => (
					<Button
						{...props}
						type="button"
						variant="block"
						isSelected={open}
						disabled={busy}
						className="flex h-7 items-center gap-1 px-2 py-0 text-[11px]"
						aria-label="Export"
						title="Export as HTML"
					>
						<Download className="size-3.5 shrink-0" />
						<span>Export</span>
					</Button>
				)}
			/>
			<Menu.Portal>
				<Menu.Positioner sideOffset={4} align="end">
					<Menu.Popup className="z-50 flex min-w-44 flex-col bg-slate-50 p-1 text-[11px] text-slate-700 inset-shadow-[0_0_0_1px] inset-shadow-slate-200 focus-visible:outline-none">
						{mode === "responsive" ? (
							<Menu.Item
								className="flex cursor-default items-center gap-2 px-2 py-1 data-highlighted:bg-slate-200/60"
								onClick={() => runExport("active")}
							>
								Export this board
							</Menu.Item>
						) : (
							<>
								<Menu.Item
									className="flex cursor-default items-center gap-2 px-2 py-1 data-highlighted:bg-slate-200/60"
									onClick={() => runExport("all")}
								>
									Export all boards
									<span className="ml-auto text-[10px] text-slate-400">
										.zip
									</span>
								</Menu.Item>
								{selectedId ? (
									<Menu.Item
										className="flex cursor-default items-center gap-2 px-2 py-1 data-highlighted:bg-slate-200/60"
										onClick={() => runExport("selected")}
									>
										Export selected board
									</Menu.Item>
								) : null}
							</>
						)}
					</Menu.Popup>
				</Menu.Positioner>
			</Menu.Portal>
		</Menu.Root>
	);
}

export function WorkspaceToolbar() {
	const view = useIFrameView();
	const { mode } = useResponsiveStage();
	const railOpen = useEditorPanelOpen("design", "rail");
	const zoomLabel = `${Math.round(view.scale * 100)}%`;

	return (
		<header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-3 text-[11px] text-slate-500">
			{railOpen ? null : (
				// The collapsed rail's header, ending where the rail's edge would
				// be. It may shrink, never grow, so the controls keep their room.
				<div className="flex w-[252px] min-w-0 shrink items-center gap-2 self-stretch border-r border-slate-200 pr-3 text-xs">
					<DesignHeaderContent>
						<SaveIndicator />
						<DesignPanelToggle panel="rail" />
					</DesignHeaderContent>
				</div>
			)}
			<div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
				{mode === "responsive" ? (
					<>
						<ResponsiveBoardControls />
						<ResponsiveWidthControls />
					</>
				) : null}
			</div>
			<div className="flex shrink-0 items-center gap-3">
				{mode === "canvas" ? (
					<span className="tabular-nums text-slate-600" aria-live="polite">
						<span className="text-slate-400">Zoom </span>
						{zoomLabel}
					</span>
				) : (
					<ResponsiveZoomControls />
				)}
				<AnnotationModeSwitch />
				<ExportControl />
				<WorkspaceModeToggle />
				<DesignPanelToggle panel="inspector" />
			</div>
		</header>
	);
}
