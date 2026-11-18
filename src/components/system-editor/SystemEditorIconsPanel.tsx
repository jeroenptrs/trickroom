import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FolderTree, Library, RefreshCw, Search, Trash2 } from "lucide-react";
import {
	type RefObject,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import type { ProjectQueryScope } from "../../queries/project-scope";
import {
	addSystemIconFolder,
	removeSystemIconFolder,
	type SystemIconSummary,
	type SystemIconsResponse,
	syncSystemIconsMutation,
	systemIconSvgQueriesQueryKey,
	systemIconsQueryKey,
	systemIconsQueryOptions,
} from "../../queries/system-icons";
import { getKey, useWindowKeyDown } from "../../utils/editor-shortcuts";
import { pluralize } from "../project/project-view-utils";
import { Alert } from "../ui/alert";
import { ConfirmationDialog } from "../ui/alert-dialog";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { Input } from "../ui/input";
import { Popover } from "../ui/popover";
import { Skeleton } from "../ui/skeleton";
import { groupItemsBySegment, resolveIconFolderSegment } from "./path-segments";
import {
	ICON_GRID_MIN_COLUMN_WIDTH,
	ICON_GRID_ROW_HEIGHT,
	useVirtualGrid,
} from "./useVirtualGrid";

function getIconFolderLabel(
	icon: SystemIconSummary,
	iconFolderPaths: readonly string[],
) {
	return resolveIconFolderSegment(icon.sourcePath, iconFolderPaths);
}

function SystemEditorIconPreview({
	iconId,
	systemId,
}: {
	iconId: string;
	systemId: string;
}) {
	const [failed, setFailed] = useState(false);

	if (failed) {
		return <Library className="size-5 text-slate-400" aria-hidden="true" />;
	}

	return (
		<img
			alt=""
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
				<SystemEditorIconPreview iconId={icon.id} systemId={systemId} />
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

/** What the last index skipped or could not read, behind a popover. */
function IconIndexDiagnostics({
	diagnostics,
}: {
	diagnostics: SystemIconsResponse["diagnostics"];
}) {
	const count = diagnostics.length;
	return (
		<Alert variant="panel" tone="warning" className="items-center">
			<Popover
				title="Indexing problems"
				trigger={
					<button
						type="button"
						className="underline decoration-dotted underline-offset-2 hover:text-amber-950"
					>
						{count.toLocaleString()} indexing {pluralize(count, "problem")}
					</button>
				}
			>
				<ul className="flex flex-col gap-2">
					{diagnostics.map((diagnostic, index) => (
						<li
							// biome-ignore lint/suspicious/noArrayIndexKey: messages can repeat
							key={`${index}-${diagnostic.code}`}
							className="flex flex-col gap-0.5"
						>
							<span>{diagnostic.message}</span>
							{diagnostic.sourcePath ? (
								<span className="break-all font-mono text-[10px] text-slate-500">
									{diagnostic.sourcePath}
								</span>
							) : null}
						</li>
					))}
				</ul>
			</Popover>
		</Alert>
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
	isLoading = false,
}: {
	/** Draws the count chip and the toolbar button as skeletons. */
	isLoading?: boolean;
	countLabel: string | null;
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
					{isLoading ? (
						<Skeleton className="h-4 w-14" />
					) : countLabel ? (
						<span className="bg-slate-200 px-1.5 py-0.5 font-mono text-[10px] text-slate-600">
							{countLabel}
						</span>
					) : null}
				</div>
				{isLoading ? (
					<Skeleton className="h-7 w-32" />
				) : (
					<Button
						type="button"
						variant={groupByFolder ? "filled" : "outlined"}
						className="flex shrink-0 items-center gap-1.5 px-3 py-1.5"
						onClick={() => onGroupByFolderChange(!groupByFolder)}
						aria-pressed={groupByFolder}
					>
						<FolderTree className="size-3.5" aria-hidden="true" />
						Group by folder
					</Button>
				)}
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
					placeholder="Filter by name or path…"
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
	const iconsQuery = useQuery(systemIconsQueryOptions(systemId, projectScope));
	const folders = iconsQuery.data?.iconFolderPaths ?? [];
	const icons = iconsQuery.data?.icons ?? [];
	const [draftIconFolderPath, setDraftIconFolderPath] = useState("");
	const [iconFolderActionError, setIconFolderActionError] = useState<
		string | null
	>(null);
	const iconsQueryKey = systemIconsQueryKey(systemId, projectScope);
	const iconSvgQueriesKey = systemIconSvgQueriesQueryKey(systemId);
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
	// Each action names what failed, with the server's reason after it.
	const captureIconFolderActionError =
		(attempted: string) => (error: unknown) => {
			setIconFolderActionError(
				error instanceof Error
					? `${attempted}: ${error.message}`
					: `${attempted}.`,
			);
		};
	const addIconFolderMutation = useMutation({
		mutationFn: (folderPath: string) =>
			addSystemIconFolder({ systemId, folderPath }),
		onMutate: clearIconFolderActionError,
		onError: captureIconFolderActionError("Could not add the icon folder"),
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
		// A failure shows inside the confirmation dialog.
		onMutate: clearIconFolderActionError,
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
		onError: captureIconFolderActionError("Could not re-sync the icons"),
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
	// A failed load is reported (with a retry) in the workspace only.
	const iconFolderError = iconFolderActionError;
	const [folderToRemove, setFolderToRemove] = useState<string | null>(null);

	const addIconFolder = () => {
		if (addIconFolderDisabled) {
			return;
		}
		addIconFolderMutation.mutate(draftIconFolderPath.trim());
	};

	return (
		<div className="flex h-full min-h-0 flex-col">
			<div className="flex shrink-0 flex-col gap-2 border-b border-slate-200 px-3 py-3">
				<div className="flex items-center justify-between gap-2">
					<div className="min-w-0">
						<p className="truncate text-[12px] font-semibold text-slate-900">
							Icon folders
						</p>
					</div>
					{iconsQuery.isPending ? (
						<Skeleton className="h-7 w-20" />
					) : (
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
							Re-sync
						</Button>
					)}
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
					<div className="flex min-w-0 items-stretch gap-2">
						<div className="flex min-w-0 flex-1 items-stretch inset-shadow-[0_0_0_1px] inset-shadow-slate-200 focus-within:inset-shadow-cyan-500">
							<Input
								id="system-editor-icon-folder-path"
								aria-label="Icon folder path"
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
						</div>
						<Button
							type="button"
							variant="outlined"
							className="shrink-0 px-3 py-2 text-xs"
							onClick={addIconFolder}
							disabled={addIconFolderDisabled}
						>
							Add folder
						</Button>
					</div>
				</div>
			</div>
			<div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
				{iconsQuery.isPending ? (
					<div className="flex flex-col gap-1" aria-busy="true">
						{[0, 1, 2].map((row) => (
							<div
								key={row}
								className="flex items-center justify-between gap-2 px-1.5 py-2.5"
							>
								<Skeleton className="h-3 w-36" />
								<Skeleton className="h-3 w-6" />
							</div>
						))}
					</div>
				) : iconsQuery.isError ? null : folders.length === 0 ? (
					<p className="px-2 py-3 text-sm text-slate-500">
						No icon folders yet.
					</p>
				) : (
					<div className="flex flex-col gap-1">
						{folders.map((folder) => (
							<div
								key={folder}
								className="flex min-w-0 items-center gap-2 px-1.5 py-1.5 text-xs"
							>
								<span
									className="min-w-0 flex-1 truncate font-mono text-slate-800"
									title={folder}
								>
									{folder}
								</span>
								<span className="font-mono text-[10px] text-slate-900">
									{(folderCounts.get(folder) ?? 0).toLocaleString()}
								</span>
								<Button
									type="button"
									variant="block"
									flavor="danger"
									className="flex size-7 items-center justify-center p-0"
									title={`Remove ${folder}`}
									aria-label={`Remove ${folder}`}
									onClick={() => {
										removeIconFolderMutation.reset();
										setFolderToRemove(folder);
									}}
									disabled={isMutatingIconFolders}
								>
									<Trash2 className="size-3.5" aria-hidden="true" />
								</Button>
							</div>
						))}
					</div>
				)}
			</div>
			<ConfirmationDialog
				open={folderToRemove !== null}
				onOpenChange={(open) => {
					if (!open && !removeIconFolderMutation.isPending) {
						setFolderToRemove(null);
					}
				}}
				title="Remove icon folder"
				description={
					folderToRemove === null ? null : (
						<span>
							<span className="font-mono">{folderToRemove}</span> and its{" "}
							{(folderCounts.get(folderToRemove) ?? 0).toLocaleString()}{" "}
							{pluralize(folderCounts.get(folderToRemove) ?? 0, "icon")} leave
							this system. The files stay on disk.
						</span>
					)
				}
				tone="destructive"
				icon={<Trash2 className="size-4" aria-hidden="true" />}
				actionIcon={<Trash2 className="size-3.5" aria-hidden="true" />}
				actionLabel={
					removeIconFolderMutation.isPending ? "Removing" : "Remove folder"
				}
				actionDisabled={removeIconFolderMutation.isPending}
				error={
					removeIconFolderMutation.error instanceof Error
						? removeIconFolderMutation.error.message
						: undefined
				}
				onAction={() => {
					if (folderToRemove === null) {
						return;
					}
					removeIconFolderMutation.mutate(folderToRemove, {
						onSuccess: () => setFolderToRemove(null),
					});
				}}
			/>
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
	const iconCountLabel = icons.length.toLocaleString();
	const indexDiagnostics = iconsQuery.data?.diagnostics ?? [];
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
					countLabel={null}
					filteredCountLabel=""
					filter={iconFilter}
					filterInputRef={filterInputRef}
					groupByFolder={groupIconsByFolder}
					onFilterChange={setIconFilter}
					onGroupByFolderChange={setGroupIconsByFolder}
					isLoading
				/>
				<div className="flex flex-wrap gap-2.5" aria-busy="true">
					{Array.from({ length: 24 }, (_, index) => (
						<Skeleton
							// biome-ignore lint/suspicious/noArrayIndexKey: static placeholder cards
							key={index}
							className="h-[116px] w-[108px]"
						/>
					))}
				</div>
			</div>
		);
	}

	if (iconsQuery.isError) {
		return (
			<div className="flex min-h-0 flex-col gap-4 px-5 py-4" role="alert">
				<SystemIconsToolbar
					countLabel={null}
					filteredCountLabel="Icons could not be loaded"
					filter={iconFilter}
					filterInputRef={filterInputRef}
					groupByFolder={groupIconsByFolder}
					onFilterChange={setIconFilter}
					onGroupByFolderChange={setGroupIconsByFolder}
				/>
				<Card
					edge="border"
					tone="danger"
					className="flex flex-col items-start gap-2 px-4 py-3 text-sm"
				>
					<span>
						Could not load the icons: {(iconsQuery.error as Error).message}
					</span>
					<Button
						type="button"
						variant="outlined"
						className="px-2 py-1 text-xs"
						disabled={iconsQuery.isFetching}
						onClick={() => iconsQuery.refetch()}
					>
						Retry
					</Button>
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
			{indexDiagnostics.length > 0 ? (
				<IconIndexDiagnostics diagnostics={indexDiagnostics} />
			) : null}
			{icons.length === 0 ? (
				<div className="flex min-h-0 flex-1 flex-col items-center justify-center border border-dashed border-slate-300 bg-white px-4 py-10 text-center">
					<Library className="size-6 text-slate-400" aria-hidden="true" />
					<p className="mt-3 text-sm font-medium text-slate-900">
						No icons yet
					</p>
					<p className="mt-1 max-w-md text-sm text-slate-500">
						Add an icon folder in the sidebar to list its SVGs.
					</p>
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
									<h2 className="truncate font-mono text-[11px] font-semibold text-slate-900">
										{segment.segment}
									</h2>
									<span className="shrink-0 text-[10px] text-slate-900">
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
