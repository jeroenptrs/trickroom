import { Button as UnstyledButton } from "@base-ui/react/button";
import { ChevronRight, Frame, Plus, Repeat2, Type } from "lucide-react";
import {
	type KeyboardEvent,
	memo,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { tv } from "tailwind-variants";
import {
	availableRegistries,
	canHaveElementChildren,
	getComponentIds,
	getRegistry,
	resolveRegistryComponent,
	type RegistryId,
} from "../../libraries/registry";
import type { ComponentDraftEntity } from "../../stores/component-draft-store";
import {
	addTemplateNode,
	type ComponentTemplateSelection,
	selectTemplateNode,
	updateTemplateNodeName,
	useComponentDraftComponentId,
	useComponentDraftLayerSummary,
	useComponentDraftLayerTreeSnapshot,
	useComponentDraftRootPath,
	useComponentDraftSelectedPath,
} from "../../stores/component-draft-store";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { ScrollArea } from "../ui/scroll-area";
import { Separator } from "../ui/separator";
import { Text } from "../ui/text";

const icon = tv({
	base: "size-4 -ml-1 text-slate-400 transition-transform translate-y-px",
	variants: {
		open: {
			true: "rotate-90 -translate-x-px",
		},
		isEditing: {
			true: "-mr-0.5",
		},
		selected: {
			true: "text-cyan-500",
		},
	},
});

const layerRow = tv({
	base: "relative pr-1 flex flex-row items-center leading-5 inset-shadow-[0_0_0_1px]",
	variants: {
		selected: {
			true: "bg-cyan-50 text-cyan-500 inset-shadow-transparent",
			false: "text-slate-950 inset-shadow-transparent hover:bg-slate-200",
		},
	},
});

const INDENT_PER_LEVEL = 12;

type OpenLayerMap = Record<string, boolean | undefined>;

type VisibleLayerRow = {
	path: string;
	depth: number;
	hasTopSeparator: boolean;
};

type DraftLayerInsertionPlacement = {
	parentPath: string;
	index: number;
};

type DraftPickerItem = {
	component: string;
	label: string;
	description?: string;
	role: string;
};

function resolveDraftLayerInsertionPlacement({
	rootPath,
	selectedPath,
	entitiesByPath,
}: {
	rootPath: string;
	selectedPath: string | null;
	entitiesByPath: Record<string, ComponentDraftEntity>;
}): DraftLayerInsertionPlacement | null {
	const selectedEntity = selectedPath ? entitiesByPath[selectedPath] : null;

	if (selectedEntity) {
		if (canHaveElementChildren(selectedEntity.role)) {
			return {
				parentPath: selectedEntity.path,
				index: selectedEntity.childPaths?.length ?? 0,
			};
		}

		if (!selectedEntity.parentPath) {
			return null;
		}

		const parent = entitiesByPath[selectedEntity.parentPath];
		if (!parent || !canHaveElementChildren(parent.role)) {
			return null;
		}

		const siblingIndex = parent.childPaths?.indexOf(selectedEntity.path) ?? -1;
		return {
			parentPath: parent.path,
			index:
				siblingIndex >= 0 ? siblingIndex + 1 : (parent.childPaths?.length ?? 0),
		};
	}

	const rootEntity = entitiesByPath[rootPath];
	if (!rootEntity || !canHaveElementChildren(rootEntity.role)) {
		return null;
	}

	return {
		parentPath: rootPath,
		index: rootEntity.childPaths?.length ?? 0,
	};
}

function getDraftComponentPickerItems(
	library: RegistryId,
	queryText: string,
): DraftPickerItem[] {
	const query = queryText.trim().toLowerCase();
	const registry = getRegistry(library);

	return getComponentIds(library)
		.map((component) => {
			const definition = registry[component as keyof typeof registry];
			return {
				component,
				label: definition.label,
				description: definition.description,
				role: definition.role,
			};
		})
		.filter((item) => {
			if (!query) {
				return true;
			}

			return (
				item.component.toLowerCase().includes(query) ||
				item.label.toLowerCase().includes(query) ||
				(item.description?.toLowerCase().includes(query) ?? false)
			);
		});
}

function getVisibleDraftLayerRows({
	rootPath,
	entitiesByPath,
	openByPath,
}: {
	rootPath: string | null;
	entitiesByPath: Record<string, ComponentDraftEntity>;
	openByPath: OpenLayerMap;
}): VisibleLayerRow[] {
	if (!rootPath) {
		return [];
	}

	const rows: VisibleLayerRow[] = [];

	const visit = (path: string, depth: number, hasTopSeparator = false) => {
		rows.push({ path, depth, hasTopSeparator });

		const entity = entitiesByPath[path];
		if (!entity?.childPaths?.length || openByPath[path] === false) {
			return;
		}

		for (const childPath of entity.childPaths) {
			visit(childPath, depth + 1);
		}
	};

	visit(rootPath, 0);
	return rows;
}

const DraftLayerRow = memo(function DraftLayerRow({
	path,
	depth,
	hasTopSeparator,
	open,
	onToggleOpen,
}: {
	path: string;
	depth: number;
	hasTopSeparator: boolean;
	open: boolean;
	onToggleOpen: (path: string) => void;
}) {
	const [isEditing, setIsEditing] = useState(false);
	const [draftName, setDraftName] = useState("");
	const inputRef = useRef<HTMLInputElement>(null);
	const layer = useComponentDraftLayerSummary(path);
	const hasChildren = layer.childPaths.length > 0;
	const className = !hasChildren ? "-ml-0.5" : undefined;

	const selectLayer = useCallback(() => {
		selectTemplateNode(path);
	}, [path]);

	const editLayer = useCallback(() => {
		selectLayer();
		setDraftName(layer.name);
		setIsEditing(true);
	}, [layer.name, selectLayer]);

	const commitLayerName = useCallback(() => {
		const nextName = draftName.trim() || "Layer";
		setIsEditing(false);

		if (nextName !== layer.name) {
			updateTemplateNodeName(path, nextName);
		}
	}, [draftName, layer.name, path]);

	const cancelLayerName = useCallback(() => {
		setDraftName(layer.name);
		setIsEditing(false);
	}, [layer.name]);

	useEffect(() => {
		if (!layer.isSelected) {
			setIsEditing(false);
		}
	}, [layer.isSelected]);

	useEffect(() => {
		if (!isEditing) {
			setDraftName(layer.name);
		}
	}, [isEditing, layer.name]);

	useEffect(() => {
		if (!isEditing) {
			return;
		}

		inputRef.current?.focus();
		inputRef.current?.select();
	}, [isEditing]);

	const onInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		if (event.key === "Enter") {
			event.preventDefault();
			commitLayerName();
			return;
		}

		if (event.key === "Escape") {
			event.preventDefault();
			cancelLayerName();
		}
	};

	return (
		<div className={hasTopSeparator ? "border-t border-slate-200" : undefined}>
			<div
				className={layerRow({ selected: layer.isSelected })}
				style={{ paddingLeft: `${4 + depth * INDENT_PER_LEVEL}px` }}
			>
				{hasChildren ? (
					<UnstyledButton
						className="shrink-0"
						onClick={() => onToggleOpen(path)}
					>
						<ChevronRight
							className={icon({
								open,
								isEditing,
								selected: layer.isSelected,
							})}
						/>
					</UnstyledButton>
				) : null}
				{!isEditing ? (
					<UnstyledButton
						className="min-w-0 flex-1 text-start"
						onClick={selectLayer}
						onDoubleClick={editLayer}
						title={layer.name}
					>
						<span className={`truncate ${hasChildren ? " font-semibold" : ""}`}>
							{layer.name}
						</span>
					</UnstyledButton>
				) : (
					<Input
						ref={inputRef}
						variant="inline"
						value={draftName}
						placeholder="Layer"
						className={className}
						onKeyDown={onInputKeyDown}
						onChange={(event) => setDraftName(event.target.value)}
						onBlur={commitLayerName}
					/>
				)}
			</div>
		</div>
	);
});

export function ComponentDraftLayers({
	className,
	componentId,
}: {
	className?: string;
	componentId: string;
}) {
	const rootPath = useComponentDraftRootPath();
	const draftComponentId = useComponentDraftComponentId();
	const selectedPath = useComponentDraftSelectedPath();
	const { entitiesByPath } = useComponentDraftLayerTreeSnapshot();
	const [openByPath, setOpenByPath] = useState<OpenLayerMap>({});
	const [pickerOpen, setPickerOpen] = useState(false);
	const [componentQuery, setComponentQuery] = useState("");
	const [selectedLibrary, setSelectedLibrary] =
		useState<RegistryId>("trickroom");
	const [lastAddedSelection, setLastAddedSelection] =
		useState<ComponentTemplateSelection | null>(null);
	const visibleRows = useMemo(
		() =>
			getVisibleDraftLayerRows({
				rootPath,
				entitiesByPath,
				openByPath,
			}),
		[entitiesByPath, openByPath, rootPath],
	);

	const toggleOpen = useCallback((path: string) => {
		setOpenByPath((current) => ({
			...current,
			[path]: current[path] === false,
		}));
	}, []);

	const insertionPlacement = useMemo(
		() =>
			rootPath && draftComponentId === componentId
				? resolveDraftLayerInsertionPlacement({
						rootPath,
						selectedPath,
						entitiesByPath,
					})
				: null,
		[componentId, draftComponentId, entitiesByPath, rootPath, selectedPath],
	);
	const canAddLayer = insertionPlacement !== null;
	const pickerItems = useMemo(
		() => getDraftComponentPickerItems(selectedLibrary, componentQuery),
		[componentQuery, selectedLibrary],
	);

	const addDraftLayer = useCallback(
		(selection: ComponentTemplateSelection) => {
			if (!insertionPlacement) {
				return;
			}

			addTemplateNode(
				selection,
				insertionPlacement.parentPath,
				insertionPlacement.index,
			);
			setLastAddedSelection(selection);
		},
		[insertionPlacement],
	);

	const repeatLastLayer = useCallback(() => {
		if (!lastAddedSelection) {
			return;
		}

		const resolution = resolveRegistryComponent(
			lastAddedSelection.library,
			lastAddedSelection.component,
		);
		if (resolution.status !== "known") {
			return;
		}

		addDraftLayer(lastAddedSelection);
	}, [addDraftLayer, lastAddedSelection]);

	if (!rootPath || draftComponentId !== componentId) {
		return (
			<aside
				className={`flex min-h-0 w-[264px] shrink-0 flex-col border-r border-slate-200 bg-slate-50 text-xs ${className ?? ""}`}
			>
				<Text
					variant="label"
					render={<div />}
					className="px-3 py-3 text-[10px] uppercase tracking-wider text-slate-400"
				>
					Layers
				</Text>
				<p className="px-3 text-slate-500">
					{draftComponentId !== componentId
						? "Unsaved draft open."
						: "No template loaded."}
				</p>
			</aside>
		);
	}

	return (
		<aside
			className={`flex min-h-0 w-[264px] shrink-0 flex-col border-r border-slate-200 bg-slate-50 text-xs ${className ?? ""}`}
		>
			<Text
				variant="label"
				render={<div />}
				className="px-3 pt-3 pb-1 text-[10px] uppercase tracking-wider text-slate-400"
			>
				Layers
			</Text>
			<div className="flex flex-row items-center gap-1 px-2 pb-2">
				<Button
					type="button"
					variant="block"
					className="px-2 py-1"
					disabled={!canAddLayer}
					onClick={() =>
						addDraftLayer({ library: "trickroom", component: "container" })
					}
					title="Add container"
				>
					<Frame className="size-4 text-slate-950" aria-hidden="true" />
				</Button>
				<Button
					type="button"
					variant="block"
					className="px-2 py-1"
					disabled={!canAddLayer}
					onClick={() =>
						addDraftLayer({ library: "trickroom", component: "text" })
					}
					title="Add text"
				>
					<Type className="size-4 text-slate-950" aria-hidden="true" />
				</Button>
				<Button
					type="button"
					variant="block"
					className="px-2 py-1"
					disabled={!canAddLayer}
					onClick={() => setPickerOpen((isOpen) => !isOpen)}
					title="Add component"
				>
					<Plus className="size-4 text-slate-950" aria-hidden="true" />
				</Button>
				<Separator orientation="vertical" className="mx-1 h-5" />
				<Button
					type="button"
					variant="block"
					className="px-2 py-1"
					disabled={!canAddLayer || !lastAddedSelection}
					onClick={repeatLastLayer}
					title="Repeat last added item"
				>
					<Repeat2 className="size-4 text-slate-950" aria-hidden="true" />
				</Button>
			</div>
			{pickerOpen ? (
				<div className="mx-1 mb-1 flex flex-col gap-1 border border-slate-200 bg-white p-1">
					<Input
						variant="block"
						value={componentQuery}
						placeholder="Search components"
						onChange={(event) => setComponentQuery(event.target.value)}
					/>
					<div className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-1">
						<div className="flex flex-col gap-1">
							{availableRegistries.map((library) => (
								<Button
									key={library}
									type="button"
									variant="block"
									className="flex w-full justify-start px-1 py-1 text-xs"
									onClick={() => setSelectedLibrary(library)}
									isSelected={selectedLibrary === library}
								>
									{library}
								</Button>
							))}
						</div>
						<div className="flex min-w-0 flex-col gap-1">
							<div className="px-1 text-[0.625rem] font-semibold uppercase tracking-normal text-slate-400">
								Components
							</div>
							{pickerItems.length === 0 ? (
								<div className="px-1 text-xs text-slate-400">No matches</div>
							) : (
								pickerItems.map((item) => (
									<Button
										key={item.component}
										type="button"
										variant="block"
										className="flex w-full justify-start px-1 py-1 text-left text-xs"
										disabled={!canAddLayer}
										onClick={() => {
											addDraftLayer({
												library: selectedLibrary,
												component: item.component,
											});
											setPickerOpen(false);
										}}
									>
										<span className="min-w-0">
											<span className="block truncate font-medium">
												{item.label}
											</span>
											<span className="block truncate text-slate-500">
												{item.role}
											</span>
										</span>
									</Button>
								))
							)}
						</div>
					</div>
				</div>
			) : null}
			<ScrollArea className="min-h-0 flex-1">
				<div className="flex flex-col">
					{visibleRows.map((row) => (
						<DraftLayerRow
							key={row.path}
							path={row.path}
							depth={row.depth}
							hasTopSeparator={row.hasTopSeparator}
							open={openByPath[row.path] !== false}
							onToggleOpen={toggleOpen}
						/>
					))}
				</div>
			</ScrollArea>
			<div className="flex shrink-0 items-center gap-1 border-t border-slate-200 px-3 py-2 text-[10px] text-slate-500">
				<Type className="size-3 shrink-0" aria-hidden="true" />
				<span className="truncate">Double-click a layer to rename</span>
			</div>
		</aside>
	);
}
