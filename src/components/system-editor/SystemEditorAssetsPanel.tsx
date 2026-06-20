import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileImage, RefreshCw, Search, Upload } from "lucide-react";
import {
		type RefObject,
		useCallback,
		useEffect,
		useMemo,
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
import { formatRelativeTime } from "../project/project-view-utils";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { groupItemsByPathSegment } from "./path-segments";
import {
		ASSET_GRID_MIN_COLUMN_WIDTH,
		ASSET_GRID_ROW_EXTRA_HEIGHT,
		useVirtualGrid,
} from "./useVirtualGrid";

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
	const metadata = [formatAssetMimeType(asset.mimeType), dimensions]
		.filter(Boolean)
		.join(" · ");

	return (
		<button
			type="button"
			className="flex min-w-0 flex-col border border-slate-200 bg-white text-left hover:border-slate-300 focus-visible:border-cyan-500 focus-visible:outline-none data-[selected=true]:border-cyan-500"
			data-selected={isSelected}
			onClick={onSelect}
			aria-pressed={isSelected}
		>
			<div className="aspect-square bg-slate-50">
				<img
					alt={asset.alt || asset.name}
					className="size-full object-contain"
					loading="lazy"
					src={systemAssetFileUrl(systemId, asset.id)}
				/>
			</div>
			<div className="flex min-w-0 flex-col gap-0.5 border-t border-slate-100 px-3 py-2">
				<span className="truncate text-sm font-medium text-slate-900">
					{asset.name}
				</span>
				<span className="truncate font-mono text-[10px] text-slate-500">
					{metadata}
				</span>
				<span className="truncate font-mono text-[10px] text-slate-400">
					{formatRelativeTime(asset.updatedAt)}
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
			columnWidth + ASSET_GRID_ROW_EXTRA_HEIGHT,
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
	addAssetDisabled,
	filter,
	isAddingAsset,
	onAddAsset,
	onFilterChange,
}: {
	countLabel: string;
	addAssetDisabled: boolean;
	filter: string;
	isAddingAsset: boolean;
	onAddAsset: () => void;
	onFilterChange: (value: string) => void;
}) {
	return (
		<div className="flex items-center gap-2">
			<div className="relative min-w-0 flex-1">
				<Search
					className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-slate-500"
					aria-hidden="true"
				/>
				<Input
					variant="formCompact"
					className="w-full px-7"
					aria-label="Filter assets"
					placeholder="Filter by name or path..."
					value={filter}
					onChange={(event) => onFilterChange(event.target.value)}
				/>
			</div>
			<span className="sr-only" aria-live="polite">
				{countLabel}
			</span>
			<Button
				type="button"
				variant="blockDark"
				className="flex items-center gap-1.5 bg-slate-950 px-3 py-1.5"
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
	);
}

export function SystemEditorAssetsPanel({
	systemId,
	projectScope,
	scrollElementRef,
	selectedAssetId,
	onSelectAsset,
}: {
	systemId: string;
	projectScope?: ProjectQueryScope;
	scrollElementRef: RefObject<HTMLDivElement | null>;
	selectedAssetId: string | null;
	onSelectAsset: (assetId: string | null) => void;
}) {
	const queryClient = useQueryClient();
	const desktopApi = getTrickroomDesktopApi();
	const sessionQuery = useQuery(sessionQueryOptions());
	const assetsQuery = useQuery(systemAssetsQueryOptions(systemId, projectScope));
	const assets = assetsQuery.data?.assets ?? [];
	const [assetFilter, setAssetFilter] = useState("");
	const [assetActionError, setAssetActionError] = useState<string | null>(null);
	const [isPickingAsset, setIsPickingAsset] = useState(false);
	const projectRoot = sessionQuery.data?.activeProject?.projectRoot ?? "";
	const assetCountLabel = assetsQuery.isPending
		? "Loading"
		: `${assets.length.toLocaleString()} asset${assets.length === 1 ? "" : "s"}`;
	const normalizedFilter = assetFilter.trim().toLowerCase();
	const filteredAssets = useMemo(
		() =>
			normalizedFilter
				? assets.filter((asset) => {
					const searchable = `${asset.name} ${asset.id} ${asset.sourcePath} ${asset.mimeType}`
						.toLowerCase();
					return searchable.includes(normalizedFilter);
				})
				: assets,
			[assets, normalizedFilter],
	);
	const segmentedAssets = useMemo(
		() => groupItemsByPathSegment(filteredAssets),
		[filteredAssets],
	);
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
	}, [createAssetMutation, createAssetMutation.isPending, desktopApi, isPickingAsset, projectRoot]);

	useEffect(() => {
		if (selectedAssetId && !assets.some((asset) => asset.id === selectedAssetId)) {
			onSelectAsset(null);
		}
	}, [assets, onSelectAsset, selectedAssetId]);

	if (assetsQuery.isPending) {
		return (
			<div className="flex min-h-0 flex-col gap-4 px-5 py-4">
				<SystemAssetsToolbar
					countLabel={assetCountLabel}
					filter={assetFilter}
					addAssetDisabled={!desktopApi || !projectRoot || isPickingAsset}
					onFilterChange={setAssetFilter}
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
					filter={assetFilter}
					addAssetDisabled={!desktopApi || !projectRoot || isPickingAsset}
					onFilterChange={setAssetFilter}
					onAddAsset={pickAsset}
					isAddingAsset={isPickingAsset || createAssetMutation.isPending}
				/>
				<div className="border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
					Failed to load assets: {(assetsQuery.error as Error).message}
				</div>
			</div>
		);
	}

	return (
			<div className="flex min-h-0 flex-1 flex-col gap-4 px-5 py-4">
			<SystemAssetsToolbar
				countLabel={assetCountLabel}
				filter={assetFilter}
				addAssetDisabled={!desktopApi || !projectRoot || isPickingAsset}
				onFilterChange={setAssetFilter}
				onAddAsset={pickAsset}
				isAddingAsset={isPickingAsset || createAssetMutation.isPending}
			/>
			{assetActionError ? (
				<div className="border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
					{assetActionError}
				</div>
			) : null}
			{assets.length === 0 ? (
				<div className="flex min-h-0 flex-1 flex-col items-center justify-center border border-dashed border-slate-300 bg-white px-4 py-10 text-center">
					<FileImage className="size-6 text-slate-400" aria-hidden="true" />
					<p className="mt-3 text-sm font-medium text-slate-900">
						No assets registered
					</p>
					<p className="mt-1 max-w-md text-sm text-slate-500">
						Register raster image assets to make them available to linked designs.
					</p>
				</div>
			) : filteredAssets.length === 0 ? (
				<div className="flex min-h-0 flex-1 flex-col items-center justify-center border border-dashed border-slate-300 bg-white px-4 py-10 text-center">
					<Search className="size-6 text-slate-400" aria-hidden="true" />
					<p className="mt-3 text-sm font-medium text-slate-900">No matching assets</p>
					<p className="mt-1 max-w-md text-sm text-slate-500">
						Try a different name, path, type, or asset id.
					</p>
				</div>
			) : (
				<div className="flex min-h-0 flex-1 flex-col gap-6">
					{segmentedAssets.map((segment) => (
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
					))}
				</div>
			)}
		</div>
	);
}
