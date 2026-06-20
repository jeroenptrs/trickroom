import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	Folder,
	FolderTree,
	Library,
	RefreshCw,
	Search,
	Trash2,
} from "lucide-react";
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
	addSystemIconFolder,
	removeSystemIconFolder,
	type SystemIconSummary,
	syncSystemIconsMutation,
	systemIconSvgQueriesQueryKey,
	systemIconsQueryKey,
	systemIconsQueryOptions,
} from "../../queries/system-icons";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { Input } from "../ui/input";
import { groupItemsBySegment, resolveIconFolderSegment } from "./path-segments";
import {
	ICON_GRID_MIN_COLUMN_WIDTH,
	ICON_GRID_ROW_HEIGHT,
	useVirtualGrid,
} from "./useVirtualGrid";
import { getKey, useWindowKeyDown } from "../../utils/editor-shortcuts";

function toProjectRelativePath(path: string, projectRoot: string) {
	const normalizedPath = path.trim().replaceAll("\\", "/").replace(/\/+$/, "");
	const normalizedRoot = projectRoot
		.trim()
		.replaceAll("\\", "/")
		.replace(/\/+$/, "");

	if (!normalizedPath || !normalizedRoot || normalizedPath === normalizedRoot) {
		return null;
	}

	const rootPrefix = `${normalizedRoot}/`;
	if (!normalizedPath.startsWith(rootPrefix)) {
		return null;
	}

	return normalizedPath.slice(rootPrefix.length);
}

function getIconFolderLabel(
	icon: SystemIconSummary,
	iconFolderPaths: readonly string[],
) {
	return resolveIconFolderSegment(icon.sourcePath, iconFolderPaths);
}

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
			className="size-6 object-contain text-slate-900"
			loading="lazy"
			src={`/api/trickroom/systems/${encodeURIComponent(systemId)}/icons/${encodeURIComponent(iconId)}/svg`}
			onError={() => setFailed(true)}
		/>
	);
}

function SystemEditorIconCard({
	icon,
	iconFolderPaths,
	isSelected,
	onSelect,
	systemId,
}: {
	icon: SystemIconSummary;
	iconFolderPaths: readonly string[];
	isSelected: boolean;
	onSelect: () => void;
	systemId: string;
}) {
	const folderLabel = getIconFolderLabel(icon, iconFolderPaths);

	return (
		<button
			type="button"
			className="flex min-w-0 flex-col gap-1.5 border border-slate-200 bg-white px-2 py-2 text-left hover:border-slate-300 focus-visible:border-cyan-500 focus-visible:outline-none data-[selected=true]:border-cyan-500 data-[selected=true]:inset-shadow-[0_0_0_1px] data-[selected=true]:inset-shadow-cyan-500"
			data-selected={isSelected}
			onClick={onSelect}
			aria-pressed={isSelected}
		>
			<div className="flex h-10 items-center justify-center bg-slate-50">
				<SystemEditorIconPreview
					iconId={icon.id}
					name={icon.name}
					systemId={systemId}
				/>
			</div>
			<span className="truncate text-[12px] font-medium text-slate-900">
				{icon.name}
			</span>
			<span
				className="truncate font-mono text-[10px] text-slate-500"
				title={icon.sourcePath}
			>
				{folderLabel}
			</span>
		</button>
	);
}

function VirtualIconGrid({
	iconFolderPaths,
	icons,
	scrollElementRef,
	selectedIconId,
	onSelectIcon,
	systemId,
}: {
	iconFolderPaths: readonly string[];
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
							className="absolute left-0 top-0 grid w-full gap-2.5"
							style={{
								gridTemplateColumns: `repeat(${virtualGrid.columnCount}, minmax(0, 1fr))`,
								height: `${virtualGrid.rowHeight}px`,
								transform: `translateY(${virtualRow.start - virtualGrid.scrollMargin}px)`,
							}}
						>
							{rowIcons.map((icon) => (
								<SystemEditorIconCard
									key={icon.id}
									icon={icon}
									iconFolderPaths={iconFolderPaths}
									isSelected={icon.id === selectedIconId}
									systemId={systemId}
									onSelect={() => onSelectIcon(icon.id)}
								/>
							))}
						</div>
					);
				})}
			</div>
		</div>
	);
}

function SystemIconsToolbar({
	countLabel,
	filteredCountLabel,
	filter,
	filterInputRef,
	groupByFolder,
	onFilterChange,
	onGroupByFolderChange,
}: {
	countLabel: string;
	filteredCountLabel: string;
	filter: string;
	filterInputRef: RefObject<HTMLInputElement | null>;
	groupByFolder: boolean;
	onFilterChange: (value: string) => void;
	onGroupByFolderChange: (value: boolean) => void;
}) {
	return (
		<div className="flex flex-col gap-3 border-b border-slate-200 pb-4">
			<div className="flex items-center justify-between gap-3">
				<div className="flex min-w-0 items-center gap-2">
					<h1 className="truncate text-[15px] font-semibold text-slate-900">
						Icons
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
			<div className="relative min-w-0">
				<Search
					className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-slate-500"
					aria-hidden="true"
				/>
				<Input
					ref={filterInputRef}
					variant="formCompact"
					className="w-full px-7"
					aria-label="Filter icons"
					placeholder="Filter by name or path..."
					value={filter}
					onChange={(event) => onFilterChange(event.target.value)}
				/>
				<span className="sr-only" aria-live="polite">
					{filteredCountLabel}
				</span>
			</div>
		</div>
	);
}

export function SystemEditorIconFoldersRail({
	systemId,
	projectScope,
}: {
	systemId: string;
	projectScope?: ProjectQueryScope;
}) {
	const queryClient = useQueryClient();
	const desktopApi = getTrickroomDesktopApi();
	const sessionQuery = useQuery(sessionQueryOptions());
	const iconsQuery = useQuery(systemIconsQueryOptions(systemId, projectScope));
	const folders = iconsQuery.data?.iconFolderPaths ?? [];
	const icons = iconsQuery.data?.icons ?? [];
	const [draftIconFolderPath, setDraftIconFolderPath] = useState("");
	const [iconFolderActionError, setIconFolderActionError] = useState<
		string | null
	>(null);
	const [isPickingIconFolder, setIsPickingIconFolder] = useState(false);
	const projectRoot = sessionQuery.data?.activeProject?.projectRoot ?? "";
	const iconsQueryKey = systemIconsQueryKey(systemId, projectScope);
	const iconSvgQueriesKey = systemIconSvgQueriesQueryKey(systemId);
	const canPickIconFolder = Boolean(desktopApi) && Boolean(projectRoot);
	const folderCounts = useMemo(() => {
		const counts = new Map<string, number>();
		for (const icon of icons) {
			const folder = getIconFolderLabel(icon, folders);
			counts.set(folder, (counts.get(folder) ?? 0) + 1);
		}
		return counts;
	}, [folders, icons]);
	const invalidateSystemIconSvgs = useCallback(async () => {
		queryClient.removeQueries({
			queryKey: iconSvgQueriesKey,
			type: "inactive",
		});
		await queryClient.invalidateQueries({ queryKey: iconSvgQueriesKey });
	}, [iconSvgQueriesKey, queryClient]);
	const clearIconFolderActionError = () => setIconFolderActionError(null);
	const captureIconFolderActionError = (error: unknown) => {
		setIconFolderActionError(
			error instanceof Error ? error.message : "Icon folder action failed.",
		);
	};
	const addIconFolderMutation = useMutation({
		mutationFn: (folderPath: string) =>
			addSystemIconFolder({ systemId, folderPath }),
		onMutate: clearIconFolderActionError,
		onError: captureIconFolderActionError,
		onSuccess: async (response) => {
			clearIconFolderActionError();
			queryClient.setQueryData(iconsQueryKey, response);
			setDraftIconFolderPath("");
			await invalidateSystemIconSvgs();
			await queryClient.invalidateQueries({ queryKey: iconsQueryKey });
		},
	});
	const removeIconFolderMutation = useMutation({
		mutationFn: (folderPath: string) =>
			removeSystemIconFolder({ systemId, folderPath }),
		onMutate: clearIconFolderActionError,
		onError: captureIconFolderActionError,
		onSuccess: async (response) => {
			clearIconFolderActionError();
			queryClient.setQueryData(iconsQueryKey, response);
			await invalidateSystemIconSvgs();
			await queryClient.invalidateQueries({ queryKey: iconsQueryKey });
		},
	});
	const reindexIconsMutation = useMutation({
		mutationFn: () => syncSystemIconsMutation(systemId),
		onMutate: clearIconFolderActionError,
		onError: captureIconFolderActionError,
		onSuccess: async (response) => {
			clearIconFolderActionError();
			queryClient.setQueryData(iconsQueryKey, response);
			await invalidateSystemIconSvgs();
			await queryClient.invalidateQueries({ queryKey: iconsQueryKey });
		},
	});
	const isMutatingIconFolders =
		addIconFolderMutation.isPending ||
		removeIconFolderMutation.isPending ||
		reindexIconsMutation.isPending;
	const addIconFolderDisabled =
		isMutatingIconFolders || draftIconFolderPath.trim().length === 0;
	const pickerDisabled = isMutatingIconFolders || isPickingIconFolder;
	const iconFolderError =
		iconFolderActionError ??
		(iconsQuery.error instanceof Error ? iconsQuery.error.message : null);

	const addIconFolder = () => {
		if (addIconFolderDisabled) {
			return;
		}
		addIconFolderMutation.mutate(draftIconFolderPath.trim());
	};

	const pickIconFolder = async () => {
		if (!desktopApi || !projectRoot || pickerDisabled) {
			return;
		}

		clearIconFolderActionError();
		setIsPickingIconFolder(true);
		try {
			const result = await desktopApi.pickProjectFolder();
			if (!result.canceled) {
				const relativePath = toProjectRelativePath(result.path, projectRoot);
				if (!relativePath) {
					setIconFolderActionError(
						"Choose an icon folder inside this project.",
					);
					return;
				}
				setDraftIconFolderPath(relativePath);
			}
		} catch (error) {
			captureIconFolderActionError(
				error instanceof Error
					? error
					: new Error("Failed to choose icon folder."),
			);
		} finally {
			setIsPickingIconFolder(false);
		}
	};

	return (
		<div className="flex h-full min-h-0 flex-col">
			<div className="flex shrink-0 flex-col gap-2 border-b border-slate-200 px-3 py-3">
				<div className="flex items-center justify-between gap-2">
					<div className="min-w-0">
						<p className="truncate text-[12px] font-semibold text-slate-900">
							Icon folders
						</p>
						<p className="font-mono text-[10px] text-slate-500">
							{iconsQuery.isPending
								? "Loading"
								: `${icons.length.toLocaleString()} icons`}
						</p>
					</div>
					<Button
						type="button"
						variant="outlined"
						className="flex shrink-0 items-center gap-1.5 px-2 py-1.5 text-xs"
						onClick={() => reindexIconsMutation.mutate()}
						disabled={isMutatingIconFolders}
					>
						<RefreshCw
							className={`size-3.5 ${reindexIconsMutation.isPending ? "animate-spin" : ""}`}
							aria-hidden="true"
						/>
						Re-index
					</Button>
				</div>
				{iconFolderError ? (
					<Card
						edge="border"
						tone="danger"
						className="px-2 py-1.5 text-[11px]"
						role="alert"
					>
						{iconFolderError}
					</Card>
				) : null}
				<div className="flex min-w-0 flex-col gap-1.5">
					<label
						htmlFor="system-editor-icon-folder-path"
						className="text-[10px] font-semibold uppercase tracking-wider text-slate-500"
					>
						Icon folder path
					</label>
					<div className="flex min-w-0 items-stretch gap-2">
						<div className="group flex min-w-0 flex-1 items-stretch inset-shadow-[0_0_0_1px] inset-shadow-slate-200 focus-within:inset-shadow-cyan-500">
							<Input
								id="system-editor-icon-folder-path"
								variant="formEmbedded"
								className="min-w-0 flex-1 font-mono text-xs"
								placeholder="src/icons"
								value={draftIconFolderPath}
								onChange={(event) => setDraftIconFolderPath(event.target.value)}
								onKeyDown={(event) => {
									if (event.key === "Enter") {
										addIconFolder();
									}
								}}
								disabled={isMutatingIconFolders}
							/>
							{desktopApi ? (
								<Button
									type="button"
									variant="block"
									className="shrink-0 px-2 py-1.5 text-xs inset-shadow-[1px_0_0_0] inset-shadow-slate-200 group-focus-within:inset-shadow-cyan-500"
									disabled={pickerDisabled || !canPickIconFolder}
									onClick={pickIconFolder}
								>
									{isPickingIconFolder ? "Browsing" : "Browse"}
								</Button>
							) : null}
						</div>
						<Button
							type="button"
							variant="outlined"
							className="shrink-0 px-3 py-2 text-xs"
							onClick={addIconFolder}
							disabled={addIconFolderDisabled}
						>
							Add
						</Button>
					</div>
				</div>
			</div>
			<div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
				{iconsQuery.isPending ? (
					<p className="px-2 py-3 text-sm text-slate-500">
						Loading icon folders...
					</p>
				) : folders.length === 0 ? (
					<p className="px-2 py-3 text-sm text-slate-500">
						No icon folders configured.
					</p>
				) : (
					<div className="flex flex-col gap-1">
						{folders.map((folder) => (
							<div
								key={folder}
								className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-2 px-1.5 py-1.5 text-xs"
							>
								<Folder
									className="size-3.5 text-slate-500"
									aria-hidden="true"
								/>
								<span
									className="min-w-0 truncate font-mono text-slate-800"
									title={folder}
								>
									{folder}
								</span>
								<span className="font-mono text-[10px] text-slate-500">
									{(folderCounts.get(folder) ?? 0).toLocaleString()}
								</span>
								<Button
									type="button"
									variant="block"
									flavor="warning"
									className="flex size-7 items-center justify-center p-0"
									title={`Remove ${folder}`}
									aria-label={`Remove ${folder}`}
									onClick={() => removeIconFolderMutation.mutate(folder)}
									disabled={isMutatingIconFolders}
								>
									<Trash2 className="size-3.5" aria-hidden="true" />
								</Button>
							</div>
						))}
					</div>
				)}
			</div>
		</div>
	);
}

export function SystemEditorIconsPanel({
	isActive = true,
	systemId,
	projectScope,
	scrollElementRef,
	selectedIconId,
	onSelectIcon,
}: {
	isActive?: boolean;
	systemId: string;
	projectScope?: ProjectQueryScope;
	scrollElementRef: RefObject<HTMLDivElement | null>;
	selectedIconId: string | null;
	onSelectIcon: (iconId: string | null) => void;
}) {
	const iconsQuery = useQuery(systemIconsQueryOptions(systemId, projectScope));
	const icons = iconsQuery.data?.icons ?? [];
	const iconFolderPaths = iconsQuery.data?.iconFolderPaths ?? [];
	const filterInputRef = useRef<HTMLInputElement>(null);
	const [iconFilter, setIconFilter] = useState("");
	const [groupIconsByFolder, setGroupIconsByFolder] = useState(false);
	const normalizedFilter = iconFilter.trim().toLowerCase();
	const filteredIcons = useMemo(() => {
		const matches = normalizedFilter
			? icons.filter((icon) => {
					const searchable =
						`${icon.name} ${icon.id} ${icon.sourcePath} ${icon.paint}`.toLowerCase();
					return searchable.includes(normalizedFilter);
				})
			: icons;

		return [...matches].sort((left, right) =>
			left.name.localeCompare(right.name),
		);
	}, [icons, normalizedFilter]);
	const segmentedIcons = useMemo(
		() =>
			groupItemsBySegment(filteredIcons, (icon) =>
				getIconFolderLabel(icon, iconFolderPaths),
			),
		[filteredIcons, iconFolderPaths],
	);
	const iconCountLabel = iconsQuery.isPending
		? "Loading"
		: `${icons.length.toLocaleString()} icon${icons.length === 1 ? "" : "s"}`;
	const filteredCountLabel = `${filteredIcons.length.toLocaleString()} visible icon${filteredIcons.length === 1 ? "" : "s"}`;

	useEffect(() => {
		if (selectedIconId && !icons.some((icon) => icon.id === selectedIconId)) {
			onSelectIcon(null);
		}
	}, [icons, onSelectIcon, selectedIconId]);

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

	if (iconsQuery.isPending) {
		return (
			<div className="flex min-h-0 flex-1 flex-col gap-4 px-5 py-4">
				<SystemIconsToolbar
					countLabel={iconCountLabel}
					filteredCountLabel={filteredCountLabel}
					filter={iconFilter}
					filterInputRef={filterInputRef}
					groupByFolder={groupIconsByFolder}
					onFilterChange={setIconFilter}
					onGroupByFolderChange={setGroupIconsByFolder}
				/>
				<p className="text-sm text-slate-500">Loading icons...</p>
			</div>
		);
	}

	if (iconsQuery.isError) {
		return (
			<div className="flex min-h-0 flex-col gap-4 px-5 py-4" role="alert">
				<SystemIconsToolbar
					countLabel="Unavailable"
					filteredCountLabel="Icon index unavailable"
					filter={iconFilter}
					filterInputRef={filterInputRef}
					groupByFolder={groupIconsByFolder}
					onFilterChange={setIconFilter}
					onGroupByFolderChange={setGroupIconsByFolder}
				/>
				<Card edge="border" tone="danger" className="px-4 py-3 text-sm">
					Failed to load icons: {(iconsQuery.error as Error).message}
				</Card>
			</div>
		);
	}

	return (
		<div className="flex min-h-0 flex-1 flex-col gap-4 px-5 py-4">
			<SystemIconsToolbar
				countLabel={iconCountLabel}
				filteredCountLabel={filteredCountLabel}
				filter={iconFilter}
				filterInputRef={filterInputRef}
				groupByFolder={groupIconsByFolder}
				onFilterChange={setIconFilter}
				onGroupByFolderChange={setGroupIconsByFolder}
			/>
			{icons.length === 0 ? (
				<div className="border border-dashed border-slate-300 bg-white px-4 py-10 text-sm text-slate-500">
					No icons indexed for this system.
				</div>
			) : filteredIcons.length === 0 ? (
				<div className="flex min-h-0 flex-1 flex-col items-center justify-center border border-dashed border-slate-300 bg-white px-4 py-10 text-center">
					<Search className="size-6 text-slate-400" aria-hidden="true" />
					<p className="mt-3 text-sm font-medium text-slate-900">
						No matching icons
					</p>
					<p className="mt-1 max-w-md text-sm text-slate-500">
						Try a different name, path, or icon id.
					</p>
				</div>
			) : (
				<div className="flex min-h-0 flex-1 flex-col gap-6">
					{groupIconsByFolder ? (
						segmentedIcons.map((segment) => (
							<section key={segment.segment} className="flex flex-col gap-3">
								<div className="flex items-baseline justify-between gap-3">
									<h2 className="truncate font-mono text-[11px] font-semibold text-slate-700">
										{segment.segment}
									</h2>
									<span className="shrink-0 text-[10px] text-slate-500">
										{segment.items.length} icon
										{segment.items.length === 1 ? "" : "s"}
									</span>
								</div>
								<VirtualIconGrid
									icons={segment.items}
									iconFolderPaths={iconFolderPaths}
									scrollElementRef={scrollElementRef}
									selectedIconId={selectedIconId}
									onSelectIcon={onSelectIcon}
									systemId={systemId}
								/>
							</section>
						))
					) : (
						<VirtualIconGrid
							icons={filteredIcons}
							iconFolderPaths={iconFolderPaths}
							scrollElementRef={scrollElementRef}
							selectedIconId={selectedIconId}
							onSelectIcon={onSelectIcon}
							systemId={systemId}
						/>
					)}
				</div>
			)}
		</div>
	);
}
