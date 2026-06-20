import { Menu } from "@base-ui/react/menu";
import {
	ChevronLeft,
	ChevronRight,
	Download,
	LayoutGrid,
	Monitor,
	Smartphone,
	Tablet,
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
	designStore,
	serializeDesign,
	useDesignRoots,
	useSelectedId,
} from "../../stores/design-store";
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
import { Button } from "../ui/button";

export const RESPONSIVE_DEVICE_WIDTH_PRESETS = [
	{ label: "Mobile S", width: 320, Icon: Smartphone },
	{ label: "Mobile M", width: 375, Icon: Smartphone },
	{ label: "Mobile L", width: 425, Icon: Smartphone },
	{ label: "Tablet", width: 768, Icon: Tablet },
	{ label: "Laptop", width: 1024, Icon: Monitor },
	{ label: "Desktop", width: 1440, Icon: Monitor },
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
		title: "Canvas mode — all boards visible",
	},
	{
		value: "responsive",
		label: "Responsive",
		Icon: Smartphone,
		title: "Responsive mode — single board preview",
	},
];

function WorkspaceModeToggle() {
	const { mode, controls } = useResponsiveStage();

	return (
		<fieldset
			className="flex gap-px border-0 p-0 [min-inline-size:0]"
			aria-label="Stage mode"
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
						className="flex items-center gap-1 px-2 py-1 text-[11px]"
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

function ResponsiveBoardControls() {
	const rootIds = useDesignRoots();
	const { activeBoardId, controls } = useResponsiveStage();
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
			className="flex min-w-0 items-center gap-1 border-0 p-0 [min-inline-size:0]"
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
				className="shrink-0 rounded bg-white px-2 py-0.5 text-[10px] font-medium tabular-nums text-slate-600"
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
						className="flex h-7 items-center gap-1 px-2 py-0 text-[10px]"
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
						{RESPONSIVE_DEVICE_WIDTH_PRESETS.map(({ label, width, Icon }) => {
							const isSelected = responsiveWidth === width;
							return (
								<Menu.Item
									key={width}
									className="flex cursor-default items-center gap-2 px-2 py-1 data-[highlighted]:bg-slate-200/60"
									onClick={() => controls.setResponsiveWidth(width)}
								>
									<Icon className="size-3.5 shrink-0 text-slate-400" />
									<span className="min-w-0 flex-1 truncate">{label}</span>
									<span className="tabular-nums text-slate-500">{width}</span>
									{isSelected ? (
										<span
											aria-hidden
											className="size-1.5 rounded-full bg-cyan-700"
										/>
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
	const draftError = getResponsiveWidthDraftError(widthDraft);
	const errorId = "responsive-viewport-width-error";

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
		if (result.width !== null) {
			controls.setResponsiveWidth(result.width);
		}
	};

	return (
		<fieldset
			className="flex min-w-0 items-center gap-2 border-0 p-0 [min-inline-size:0]"
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
					onFocus={() => setInputFocused(true)}
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
					className={[
						"h-full w-16 border-none bg-transparent px-2 text-right text-[11px] tabular-nums text-slate-700 focus-visible:outline-none",
						draftError ? "text-red-700" : "",
					].join(" ")}
					aria-label="Viewport width in pixels"
					aria-invalid={draftError ? true : undefined}
					aria-describedby={draftError ? errorId : undefined}
					title={draftError ?? "Viewport width in pixels"}
				/>
				<span className="pr-2 text-[10px] text-slate-400">px</span>
			</label>
			{draftError ? (
				<span id={errorId} className="sr-only" aria-live="polite">
					{draftError}
				</span>
			) : null}
			<ResponsiveDevicePresetMenu />
			<fieldset
				className="flex min-w-0 items-center gap-px overflow-x-auto border-0 p-0 [min-inline-size:0]"
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
								className="flex h-7 items-center gap-1 px-2 py-0 text-[10px]"
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
			toast.error("No board to export.");
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
					? `Exported ${boards.length} board artifacts.`
					: "Artifact exported.",
			);
		} catch (error) {
			console.error(error);
			toast.error("Export failed.");
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
						className="flex h-7 items-center gap-1 px-2 py-0 text-[10px]"
						aria-label="Export"
						title="Export as a Trickroom Artifact"
					>
						<Download className="size-3.5 shrink-0" />
						<span>Export</span>
					</Button>
				)}
			/>
			<Menu.Portal>
				<Menu.Positioner sideOffset={4} align="end">
					<Menu.Popup className="z-50 flex min-w-44 flex-col bg-slate-50 p-1 text-[11px] text-slate-700 inset-shadow-[0_0_0_1px] inset-shadow-slate-200 focus-visible:outline-none">
						<div className="flex items-center gap-1.5 px-2 pt-0.5 pb-1 text-[9px] font-medium uppercase tracking-wider text-slate-400">
							<span aria-hidden className="text-cyan-700">
								▦
							</span>
							Artifact
						</div>
						{mode === "responsive" ? (
							<Menu.Item
								className="flex cursor-default items-center gap-2 px-2 py-1 data-[highlighted]:bg-slate-200/60"
								onClick={() => runExport("active")}
							>
								Export this board
							</Menu.Item>
						) : (
							<>
								<Menu.Item
									className="flex cursor-default items-center gap-2 px-2 py-1 data-[highlighted]:bg-slate-200/60"
									onClick={() => runExport("all")}
								>
									Export all boards
									<span className="ml-auto text-[10px] text-slate-400">
										.zip
									</span>
								</Menu.Item>
								{selectedId ? (
									<Menu.Item
										className="flex cursor-default items-center gap-2 px-2 py-1 data-[highlighted]:bg-slate-200/60"
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
	const zoomLabel = `${Math.round(view.scale * 100)}%`;

	return (
		<header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-3 text-[11px] text-slate-500">
			<div className="flex min-w-0 flex-1 items-center gap-2">
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
				) : null}
				<ExportControl />
				<WorkspaceModeToggle />
			</div>
		</header>
	);
}
