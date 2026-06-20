import { useQuery } from "@tanstack/react-query";
import { Library, Search } from "lucide-react";
import { type RefObject, useMemo, useState } from "react";
import type { ProjectQueryScope } from "../../queries/project-scope";
import {
		type SystemIconSummary,
		systemIconsQueryOptions,
} from "../../queries/system-icons";
import { Input } from "../ui/input";
import {
	ICON_GRID_MIN_COLUMN_WIDTH,
	ICON_GRID_ROW_HEIGHT,
	useVirtualGrid,
} from "./useVirtualGrid";

function SystemEditorIconPreview({
	iconId,
	name,
	systemId,
}: {
	iconId: string;
	name: string;
	systemId: string;
}) {
	const [failed, setFailed] = useState(false);

	if (failed) {
		return <Library className="size-5 text-slate-400" aria-hidden="true" />;
	}

	return (
		<img
			alt={`${name} preview`}
			className="size-7 object-contain text-slate-900"
			loading="lazy"
			src={`/api/trickroom/systems/${encodeURIComponent(systemId)}/icons/${encodeURIComponent(iconId)}/svg`}
			onError={() => setFailed(true)}
		/>
	);
}

function VirtualIconGrid({
	icons,
	scrollElementRef,
	selectedIconId,
	onSelectIcon,
	systemId,
}: {
	icons: readonly SystemIconSummary[];
	scrollElementRef: RefObject<HTMLDivElement | null>;
	selectedIconId: string | null;
	onSelectIcon: (iconId: string) => void;
	systemId: string;
}) {
	const virtualGrid = useVirtualGrid({
		items: icons,
		minColumnWidth: ICON_GRID_MIN_COLUMN_WIDTH,
		estimateRowHeight: () => ICON_GRID_ROW_HEIGHT,
		scrollElementRef,
		getItemKey: (icon) => icon.id,
	});

	return (
		<div ref={virtualGrid.containerRef} className="relative w-full">
			<div
				className="relative w-full"
				style={{
					height: `${virtualGrid.rowVirtualizer.getTotalSize()}px`,
				}}
			>
				{virtualGrid.rowVirtualizer.getVirtualItems().map((virtualRow) => {
					const rowIcons = icons.slice(
						virtualRow.index * virtualGrid.columnCount,
						virtualRow.index * virtualGrid.columnCount +
							virtualGrid.columnCount,
					);

					return (
						<div
							key={virtualRow.key}
							className="absolute left-0 top-0 grid w-full gap-3"
							style={{
								gridTemplateColumns: `repeat(${virtualGrid.columnCount}, minmax(0, 1fr))`,
								height: `${virtualGrid.rowHeight}px`,
								transform: `translateY(${virtualRow.start - virtualGrid.scrollMargin}px)`,
							}}
						>
							{rowIcons.map((icon) => {
								const isSelected = icon.id === selectedIconId;
								return (
									<button
										key={icon.id}
										type="button"
										className="flex min-w-0 flex-col gap-2 border border-slate-200 bg-white px-3 py-3 text-left hover:border-slate-300 focus-visible:border-cyan-500 focus-visible:outline-none data-[selected=true]:border-cyan-500"
										data-selected={isSelected}
										onClick={() => onSelectIcon(icon.id)}
										aria-pressed={isSelected}
									>
										<div className="flex h-16 items-center justify-center bg-slate-50">
											<SystemEditorIconPreview
												iconId={icon.id}
												name={icon.name}
												systemId={systemId}
											/>
										</div>
										<span className="truncate text-sm font-medium text-slate-900">
											{icon.name}
										</span>
										<span className="truncate font-mono text-[11px] text-slate-500">
											{icon.paint} · {icon.sourcePath}
										</span>
									</button>
								);
							})}
						</div>
					);
				})}
			</div>
		</div>
	);
}

function SystemIconsToolbar({
	folders,
	iconCount,
	filter,
	onFilterChange,
}: {
	folders: string[];
	iconCount: string;
	filter: string;
	onFilterChange: (value: string) => void;
}) {
	return (
		<div className="flex flex-col gap-2">
			<div className="flex items-center justify-between gap-3">
				<div className="text-sm font-semibold text-slate-900">Icon libraries</div>
				<span className="font-mono text-xs text-slate-500">{iconCount}</span>
			</div>
			<div className="flex flex-col border border-slate-200 bg-white">
				<div className="flex items-baseline px-4 py-3 text-sm font-bold text-slate-950">
					Folders
				</div>
				{folders.length === 0 ? (
					<p className="border-t border-slate-100 px-4 py-5 text-sm text-slate-500">
						No icon folders configured.
					</p>
				) : (
					folders.map((folder) => (
						<div
							key={folder}
							className="border-t border-slate-100 px-4 py-2 font-mono text-xs text-slate-700"
						>
							{folder}
						</div>
					))
				)}
			</div>
			<div className="relative min-w-0">
				<Search
					className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-slate-500"
					aria-hidden="true"
				/>
				<Input
					variant="formCompact"
					className="w-full px-7"
					aria-label="Filter icons"
					placeholder="Filter by name or path..."
					value={filter}
					onChange={(event) => onFilterChange(event.target.value)}
				/>
			</div>
		</div>
	);
}

export function SystemEditorIconsPanel({
	systemId,
	projectScope,
	scrollElementRef,
	selectedIconId,
	onSelectIcon,
}: {
	systemId: string;
	projectScope?: ProjectQueryScope;
	scrollElementRef: RefObject<HTMLDivElement | null>;
	selectedIconId: string | null;
	onSelectIcon: (iconId: string) => void;
}) {
	const iconsQuery = useQuery(systemIconsQueryOptions(systemId, projectScope));
	const icons = iconsQuery.data?.icons ?? [];
	const iconFolderPaths = iconsQuery.data?.iconFolderPaths ?? [];
	const [iconFilter, setIconFilter] = useState("");
	const normalizedFilter = iconFilter.trim().toLowerCase();
	const filteredIcons = useMemo(
		() =>
			normalizedFilter
				? icons.filter((icon) => {
					const searchable =
						`${icon.name} ${icon.id} ${icon.sourcePath} ${icon.paint}`.toLowerCase();
					return searchable.includes(normalizedFilter);
				})
				: icons,
			[icons, normalizedFilter],
	);

	if (iconsQuery.isPending) {
		return (
			<div className="flex min-h-0 flex-1 flex-col gap-4 px-5 py-4">
				<SystemIconsToolbar
					folders={iconFolderPaths}
					iconCount="Loading icons..."
					filter={iconFilter}
					onFilterChange={setIconFilter}
				/>
				<p className="text-sm text-slate-500">Loading icons...</p>
			</div>
		);
	}

	if (iconsQuery.isError) {
		return (
			<div className="flex min-h-0 flex-col gap-4 px-5 py-4" role="alert">
				<SystemIconsToolbar
					folders={iconFolderPaths}
					iconCount="Unavailable"
					filter={iconFilter}
					onFilterChange={setIconFilter}
				/>
				<div className="border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
					Failed to load icons: {(iconsQuery.error as Error).message}
				</div>
			</div>
		);
	}

	return (
		<div className="flex min-h-0 flex-1 flex-col gap-4 px-5 py-4">
			<SystemIconsToolbar
				folders={iconFolderPaths}
				iconCount={`${icons.length} icons`}
				filter={iconFilter}
				onFilterChange={setIconFilter}
			/>
			{icons.length === 0 ? (
				<div className="border border-dashed border-slate-300 bg-white px-4 py-10 text-sm text-slate-500">
					No icons indexed for this system.
				</div>
			) : filteredIcons.length === 0 ? (
				<div className="flex min-h-0 flex-1 flex-col items-center justify-center border border-dashed border-slate-300 bg-white px-4 py-10 text-center">
					<Search className="size-6 text-slate-400" aria-hidden="true" />
					<p className="mt-3 text-sm font-medium text-slate-900">No matching icons</p>
					<p className="mt-1 max-w-md text-sm text-slate-500">
						Try a different name, path, or paint mode.
					</p>
				</div>
			) : (
				<div className="flex min-h-0 flex-1 flex-col gap-6">
					<VirtualIconGrid
						icons={filteredIcons}
						scrollElementRef={scrollElementRef}
						selectedIconId={selectedIconId}
						onSelectIcon={onSelectIcon}
						systemId={systemId}
					/>
				</div>
			)}
		</div>
	);
}
