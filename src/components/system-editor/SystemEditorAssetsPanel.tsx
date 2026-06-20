import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileImage, FolderTree, RefreshCw, Search, Upload } from "lucide-react";
import {
	type RefObject,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { getTrickroomDesktopApi } from "../../desktop-api";
import type { ProjectQueryScope } from "../../queries/project-scope";
import { sessionQueryOptions } from "../../queries/projects";
import {
	createSystemAsset,
	type SystemAssetSummary,
	systemAssetFileUrl,
	systemAssetsQueryKey,
	systemAssetsQueryOptions,
} from "../../queries/system-assets";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { Input } from "../ui/input";
import { getParentPathSegment, groupItemsByPathSegment } from "./path-segments";
import {
	ASSET_GRID_MIN_COLUMN_WIDTH,
	ASSET_GRID_ROW_EXTRA_HEIGHT,
	useVirtualGrid,
} from "./useVirtualGrid";
import { getKey, useWindowKeyDown } from "../../utils/editor-shortcuts";

function getAssetNameFromPath(sourcePath: string) {
	const basename = sourcePath.split(/[\\/]/).pop() || sourcePath;
	return basename.replace(/\.[^.]+$/u, "") || basename;
}

function formatAssetMimeType(mimeType: string) {
	const subtype = mimeType.split("/")[1]?.split("+")[0];
	return subtype ? subtype.toUpperCase() : mimeType;
}

function SystemEditorAssetCard({
	asset,
	isSelected,
	onSelect,
	systemId,
}: {
	asset: SystemAssetSummary;
	isSelected: boolean;
	onSelect: () => void;
	systemId: string;
}) {
	const dimensions =
		asset.width && asset.height ? `${asset.width} x ${asset.height}` : null;
	const typeLabel = formatAssetMimeType(asset.mimeType);
	const folderLabel = getParentPathSegment(asset.sourcePath);

	return (
		<button
			type="button"
			className="grid h-full min-w-0 grid-rows-[minmax(0,1fr)_3.75rem] overflow-hidden border border-slate-200 bg-white text-left hover:border-slate-300 focus-visible:border-cyan-500 focus-visible:outline-none data-[selected=true]:border-cyan-500 data-[selected=true]:inset-shadow-[0_0_0_1px] data-[selected=true]:inset-shadow-cyan-500"
			data-selected={isSelected}
			onClick={onSelect}
			aria-pressed={isSelected}
		>
			<div className="relative min-h-0 bg-slate-50">
				<span className="absolute left-2 top-2 bg-white px-1.5 py-0.5 font-mono text-[9px] text-slate-500 inset-shadow-[0_0_0_1px] inset-shadow-slate-200">
					{typeLabel}
				</span>
				{dimensions ? (
					<span className="absolute bottom-2 right-2 bg-white px-1.5 py-0.5 font-mono text-[9px] text-slate-500 inset-shadow-[0_0_0_1px] inset-shadow-slate-200">
						{dimensions}
					</span>
				) : null}
				<img
					alt={asset.alt || asset.name}
					className="size-full object-contain p-3"
					loading="lazy"
					src={systemAssetFileUrl(systemId, asset.id)}
				/>
			</div>
			<div className="flex min-h-0 min-w-0 flex-col justify-center gap-0.5 border-t border-slate-100 px-3 py-2">
				<span className="truncate text-[13px] font-medium leading-4 text-slate-900">
					{asset.name}
				</span>
				<span
					className="truncate font-mono text-[10px] leading-3 text-slate-500"
					title={asset.sourcePath}
				>
					{folderLabel}
				</span>
			</div>
		</button>
	);
}

function VirtualAssetGrid({
	assets,
	scrollElementRef,
	selectedAssetId,
	onSelectAsset,
	systemId,
}: {
	assets: readonly SystemAssetSummary[];
	scrollElementRef: RefObject<HTMLDivElement | null>;
	selectedAssetId: string | null;
	onSelectAsset: (assetId: string) => void;
	systemId: string;
}) {
	const virtualGrid = useVirtualGrid({
		items: assets,
		minColumnWidth: ASSET_GRID_MIN_COLUMN_WIDTH,
		estimateRowHeight: (columnWidth) =>
			columnWidth * 0.75 + ASSET_GRID_ROW_EXTRA_HEIGHT,
		scrollElementRef,
		getItemKey: (asset) => asset.id,
	});

	return (
		<div ref={virtualGrid.containerRef} className="relative w-full">
			<div
				className="relative w-full"
				style={{ height: `${virtualGrid.rowVirtualizer.getTotalSize()}px` }}
			>
				{virtualGrid.rowVirtualizer.getVirtualItems().map((virtualRow) => {
					const rowAssets = assets.slice(
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
							{rowAssets.map((asset) => (
								<SystemEditorAssetCard
									key={asset.id}
									asset={asset}
									isSelected={asset.id === selectedAssetId}
									systemId={systemId}
									onSelect={() => {
										onSelectAsset(asset.id);
									}}
								/>
							))}
						</div>
					);
				})}
			</div>
		</div>
	);
}

function SystemAssetsToolbar({
	countLabel,
	filteredCountLabel,
	addAssetDisabled,
	filter,
	filterInputRef,
	groupByFolder,
	isAddingAsset,
	onAddAsset,
	onFilterChange,
	onGroupByFolderChange,
}: {
	countLabel: string;
	filteredCountLabel: string;
	addAssetDisabled: boolean;
	filter: string;
	filterInputRef: RefObject<HTMLInputElement | null>;
	groupByFolder: boolean;
	isAddingAsset: boolean;
	onAddAsset: () => void;
	onFilterChange: (value: string) => void;
	onGroupByFolderChange: (value: boolean) => void;
}) {
	return (
		<div className="flex flex-col gap-3 border-b border-slate-200 pb-4">
			<div className="flex items-center justify-between gap-3">
				<div className="flex min-w-0 items-center gap-2">
					<h1 className="truncate text-[15px] font-semibold text-slate-900">
						Assets
					</h1>
					<span className="bg-slate-200 px-1.5 py-0.5 font-mono text-[10px] text-slate-600">
						{countLabel}
					</span>
				</div>
				<Button
					type="button"
					variant={groupByFolder ? "filled" : "outlined"}
					className="flex shrink-0 items-center gap-1.5 px-3 py-1.5"
					onClick={() => onGroupByFolderChange(!groupByFolder)}
					aria-pressed={groupByFolder}
				>
					<FolderTree className="size-3.5" aria-hidden="true" />
					Group folders
				</Button>
			</div>
			<div className="flex items-center gap-2">
				<div className="relative min-w-0 flex-1">
					<Search
						className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-slate-500"
						aria-hidden="true"
					/>
					<Input
						ref={filterInputRef}
						variant="formCompact"
						className="w-full px-7"
						aria-label="Filter assets"
						placeholder="Filter by name or path..."
						value={filter}
						onChange={(event) => onFilterChange(event.target.value)}
					/>
				</div>
				<span className="sr-only" aria-live="polite">
					{filteredCountLabel}
				</span>
				<Button
					type="button"
					variant="filled"
					className="flex shrink-0 items-center gap-1.5 px-3 py-1.5"
					onClick={onAddAsset}
					disabled={addAssetDisabled || isAddingAsset}
				>
					{isAddingAsset ? (
						<RefreshCw className="size-3.5 animate-spin" aria-hidden="true" />
					) : (
						<Upload className="size-3.5" aria-hidden="true" />
					)}
					{isAddingAsset ? "Adding" : "Add asset"}
				</Button>
			</div>
		</div>
	);
}

export function SystemEditorAssetsPanel({
	isActive = true,
	systemId,
	projectScope,
	scrollElementRef,
	selectedAssetId,
	onSelectAsset,
}: {
	isActive?: boolean;
	systemId: string;
	projectScope?: ProjectQueryScope;
	scrollElementRef: RefObject<HTMLDivElement | null>;
	selectedAssetId: string | null;
	onSelectAsset: (assetId: string | null) => void;
}) {
	const queryClient = useQueryClient();
	const desktopApi = getTrickroomDesktopApi();
	const sessionQuery = useQuery(sessionQueryOptions());
	const assetsQuery = useQuery(
		systemAssetsQueryOptions(systemId, projectScope),
	);
	const assets = assetsQuery.data?.assets ?? [];
	const filterInputRef = useRef<HTMLInputElement>(null);
	const [assetFilter, setAssetFilter] = useState("");
	const [groupAssetsByFolder, setGroupAssetsByFolder] = useState(false);
	const [assetActionError, setAssetActionError] = useState<string | null>(null);
	const [isPickingAsset, setIsPickingAsset] = useState(false);
	const projectRoot = sessionQuery.data?.activeProject?.projectRoot ?? "";
	const assetCountLabel = assetsQuery.isPending
		? "Loading"
		: `${assets.length.toLocaleString()} asset${assets.length === 1 ? "" : "s"}`;
	const normalizedFilter = assetFilter.trim().toLowerCase();
	const filteredAssets = useMemo(() => {
		const matches = normalizedFilter
			? assets.filter((asset) => {
					const searchable =
						`${asset.name} ${asset.id} ${asset.sourcePath} ${asset.mimeType}`.toLowerCase();
					return searchable.includes(normalizedFilter);
				})
			: assets;

		return [...matches].sort((left, right) =>
			left.name.localeCompare(right.name),
		);
	}, [assets, normalizedFilter]);
	const segmentedAssets = useMemo(
		() => groupItemsByPathSegment(filteredAssets),
		[filteredAssets],
	);
	const filteredCountLabel = `${filteredAssets.length.toLocaleString()} visible asset${filteredAssets.length === 1 ? "" : "s"}`;
	const assetsQueryKey = systemAssetsQueryKey(systemId, projectScope);
	const invalidateAssets = useCallback(async () => {
		await queryClient.invalidateQueries({ queryKey: assetsQueryKey });
	}, [assetsQueryKey, queryClient]);
	const createAssetMutation = useMutation({
		mutationFn: (sourcePath: string) =>
			createSystemAsset(systemId, {
				name: getAssetNameFromPath(sourcePath),
				sourcePath,
			}),
		onMutate: () => setAssetActionError(null),
		onError: (error) => {
			setAssetActionError(
				error instanceof Error ? error.message : "Failed to add asset.",
			);
		},
		onSuccess: async (response) => {
			setAssetActionError(null);
			onSelectAsset(response.asset.id);
			await invalidateAssets();
		},
	});

	const pickAsset = useCallback(async () => {
		if (
			!desktopApi ||
			!projectRoot ||
			isPickingAsset ||
			createAssetMutation.isPending
		) {
			return;
		}

		setAssetActionError(null);
		setIsPickingAsset(true);
		try {
			const result = await desktopApi.pickAssetFile(projectRoot);
			if (!result.canceled) {
				await createAssetMutation.mutateAsync(result.relativePath);
			}
		} catch (error) {
			setAssetActionError(
				error instanceof Error ? error.message : "Failed to choose asset file.",
			);
		} finally {
			setIsPickingAsset(false);
		}
	}, [
		createAssetMutation,
		createAssetMutation.isPending,
		desktopApi,
		isPickingAsset,
		projectRoot,
	]);

	const handleFilterShortcut = useCallback((event: KeyboardEvent) => {
		const key = getKey(event);
		if (
			key !== "/" &&
			!((event.metaKey || event.ctrlKey) && !event.altKey && key === "f")
		) {
			return;
		}

		filterInputRef.current?.focus();
		filterInputRef.current?.select();
		event.preventDefault();
	}, []);

	useWindowKeyDown(handleFilterShortcut, { enabled: isActive });

	useEffect(() => {
		if (
			selectedAssetId &&
			!assets.some((asset) => asset.id === selectedAssetId)
		) {
			onSelectAsset(null);
		}
	}, [assets, onSelectAsset, selectedAssetId]);

	if (assetsQuery.isPending) {
		return (
			<div className="flex min-h-0 flex-col gap-4 px-5 py-4">
				<SystemAssetsToolbar
					countLabel={assetCountLabel}
					filteredCountLabel={filteredCountLabel}
					filter={assetFilter}
					filterInputRef={filterInputRef}
					groupByFolder={groupAssetsByFolder}
					addAssetDisabled={!desktopApi || !projectRoot || isPickingAsset}
					onFilterChange={setAssetFilter}
					onGroupByFolderChange={setGroupAssetsByFolder}
					onAddAsset={pickAsset}
					isAddingAsset={isPickingAsset || createAssetMutation.isPending}
				/>
				<div className="grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-3">
					{[0, 1, 2].map((index) => (
						<div
							key={index}
							className="flex min-w-0 animate-pulse flex-col border border-slate-200 bg-white"
						>
							<div className="aspect-square bg-slate-100" />
							<div className="flex flex-col gap-2 border-t border-slate-100 px-3 py-2">
								<div className="h-4 w-2/3 bg-slate-100" />
								<div className="h-3 w-1/2 bg-slate-100" />
							</div>
						</div>
					))}
				</div>
			</div>
		);
	}

	if (assetsQuery.isError) {
		return (
			<div className="flex min-h-0 flex-col gap-4 px-5 py-4" role="alert">
				<SystemAssetsToolbar
					countLabel="Unavailable"
					filteredCountLabel="Asset catalog unavailable"
					filter={assetFilter}
					filterInputRef={filterInputRef}
					groupByFolder={groupAssetsByFolder}
					addAssetDisabled={!desktopApi || !projectRoot || isPickingAsset}
					onFilterChange={setAssetFilter}
					onGroupByFolderChange={setGroupAssetsByFolder}
					onAddAsset={pickAsset}
					isAddingAsset={isPickingAsset || createAssetMutation.isPending}
				/>
				<Card edge="border" tone="danger" className="px-4 py-3 text-sm">
					Failed to load assets: {(assetsQuery.error as Error).message}
				</Card>
			</div>
		);
	}

	return (
		<div className="flex min-h-0 flex-1 flex-col gap-4 px-5 py-4">
			<SystemAssetsToolbar
				countLabel={assetCountLabel}
				filteredCountLabel={filteredCountLabel}
				filter={assetFilter}
				filterInputRef={filterInputRef}
				groupByFolder={groupAssetsByFolder}
				addAssetDisabled={!desktopApi || !projectRoot || isPickingAsset}
				onFilterChange={setAssetFilter}
				onGroupByFolderChange={setGroupAssetsByFolder}
				onAddAsset={pickAsset}
				isAddingAsset={isPickingAsset || createAssetMutation.isPending}
			/>
			{assetActionError ? (
				<Card
					edge="border"
					tone="danger"
					className="px-4 py-3 text-sm"
					role="alert"
				>
					{assetActionError}
				</Card>
			) : null}
			{assets.length === 0 ? (
				<div className="flex min-h-0 flex-1 flex-col items-center justify-center border border-dashed border-slate-300 bg-white px-4 py-10 text-center">
					<FileImage className="size-6 text-slate-400" aria-hidden="true" />
					<p className="mt-3 text-sm font-medium text-slate-900">
						No assets registered
					</p>
					<p className="mt-1 max-w-md text-sm text-slate-500">
						Register raster image assets to make them available to linked
						designs.
					</p>
				</div>
			) : filteredAssets.length === 0 ? (
				<div className="flex min-h-0 flex-1 flex-col items-center justify-center border border-dashed border-slate-300 bg-white px-4 py-10 text-center">
					<Search className="size-6 text-slate-400" aria-hidden="true" />
					<p className="mt-3 text-sm font-medium text-slate-900">
						No matching assets
					</p>
					<p className="mt-1 max-w-md text-sm text-slate-500">
						Try a different name, path, type, or asset id.
					</p>
				</div>
			) : (
				<div className="flex min-h-0 flex-1 flex-col gap-6">
					{groupAssetsByFolder ? (
						segmentedAssets.map((segment) => (
							<section key={segment.segment} className="flex flex-col gap-3">
								<div className="flex items-baseline justify-between gap-3">
									<h2 className="truncate font-mono text-[11px] font-semibold text-slate-700">
										{segment.segment}
									</h2>
									<span className="shrink-0 text-[10px] text-slate-500">
										{segment.items.length} asset
										{segment.items.length === 1 ? "" : "s"}
									</span>
								</div>
								<VirtualAssetGrid
									assets={segment.items}
									scrollElementRef={scrollElementRef}
									selectedAssetId={selectedAssetId}
									onSelectAsset={onSelectAsset}
									systemId={systemId}
								/>
							</section>
						))
					) : (
						<VirtualAssetGrid
							assets={filteredAssets}
							scrollElementRef={scrollElementRef}
							selectedAssetId={selectedAssetId}
							onSelectAsset={onSelectAsset}
							systemId={systemId}
						/>
					)}
				</div>
			)}
		</div>
	);
}
