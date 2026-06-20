import { combine } from "@atlaskit/pragmatic-drag-and-drop/combine";
import {
	draggable,
	dropTargetForElements,
	monitorForElements,
} from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { autoScrollForElements } from "@atlaskit/pragmatic-drag-and-drop-auto-scroll/element";
import {
	attachInstruction,
	extractInstruction,
	type Instruction,
} from "@atlaskit/pragmatic-drag-and-drop-hitbox/tree-item";
import { announce } from "@atlaskit/pragmatic-drag-and-drop-live-region";
import { Button as UnstyledButton } from "@base-ui/react/button";
import { useKeyHold } from "@tanstack/react-hotkeys";
import { ChevronRight, Frame, Plus, Repeat2, Type } from "lucide-react";
import {
	memo,
	type KeyboardEvent as ReactKeyboardEvent,
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
	type RegistryId,
	resolveRegistryComponent,
} from "../../libraries/registry";
import type { ComponentDraftEntity } from "../../stores/component-draft-store";
import {
	addTemplateNode,
	type ComponentTemplateSelection,
	componentDraftStore,
	deleteTemplateNode,
	moveTemplateNode,
	selectTemplateNode,
	updateTemplateNodeName,
	useComponentDraftComponentId,
	useComponentDraftLayerSummary,
	useComponentDraftLayerTreeSnapshot,
	useComponentDraftRootPath,
	useComponentDraftSelectedPath,
} from "../../stores/component-draft-store";
import {
	getKey,
	getShortcutPlacementIntent,
	hasCommandModifier,
	isPeriodKey,
	isShortcutLetter,
	useWindowKeyDown,
} from "../../utils/editor-shortcuts";
import { layerDropInsertionIndex } from "../../utils/reorder-insertion-index";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { ScrollArea } from "../ui/scroll-area";
import { Separator } from "../ui/separator";
import { Text } from "../ui/text";
import { DraftLayerContextMenu } from "./DraftLayerContextMenu";

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

const dropIndicator = tv({
	base: "pointer-events-none absolute inset-x-0 z-10",
	variants: {
		intent: {
			before: "-top-px h-0.5 bg-cyan-500",
			after: "-bottom-px h-0.5 bg-cyan-500",
			inside: "inset-y-0 border border-cyan-400 bg-cyan-100/50",
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
		dragging: {
			true: "opacity-40",
		},
	},
});

const INDENT_PER_LEVEL = 12;

type DraftLayerDragData = {
	type: "trickroom-draft-layer";
	path: string;
};

type DraftLayerDropIntent =
	| { type: "before"; targetPath: string }
	| { type: "after"; targetPath: string }
	| { type: "inside"; targetPath: string };

function isDraftLayerDragData(
	data: Record<string, unknown>,
): data is DraftLayerDragData {
	return data.type === "trickroom-draft-layer" && typeof data.path === "string";
}

function getDraftLayerDropIntent(
	data: Record<string | symbol, unknown>,
): DraftLayerDropIntent | null {
	if (
		data.type !== "trickroom-draft-layer-drop-target" ||
		typeof data.path !== "string"
	) {
		return null;
	}

	const instruction = extractInstruction(data);
	if (!instruction || instruction.type === "instruction-blocked") {
		return null;
	}

	switch (instruction.type) {
		case "reorder-above":
			return { type: "before", targetPath: data.path };
		case "reorder-below":
			return { type: "after", targetPath: data.path };
		case "make-child":
			return { type: "inside", targetPath: data.path };
		case "reparent":
			return null;
	}
}

function getInstructionIntent(instruction: Instruction | null) {
	if (!instruction || instruction.type === "instruction-blocked") {
		return null;
	}

	if (instruction.type === "reorder-above") {
		return "before";
	}

	if (instruction.type === "reorder-below") {
		return "after";
	}

	if (instruction.type === "make-child") {
		return "inside";
	}

	return null;
}

function getBlockedDropInstructions(
	canHaveChildren: boolean,
	isRoot: boolean,
): Instruction["type"][] {
	const blockedInstructions: Instruction["type"][] = [];

	if (!canHaveChildren) {
		blockedInstructions.push("make-child");
	}

	if (isRoot) {
		blockedInstructions.push("reorder-above", "reorder-below");
	}

	return blockedInstructions;
}

function moveDraftLayerByIntent(path: string, intent: DraftLayerDropIntent) {
	const state = componentDraftStore.get();
	const target = state.entitiesByPath[intent.targetPath];
	if (!target || target.path === path) {
		return false;
	}

	if (intent.type === "inside") {
		const revision = state.revision;
		const index = target.childPaths?.length ?? 0;
		moveTemplateNode(path, target.path, index);
		return componentDraftStore.get().revision !== revision;
	}

	const parentPath = target.parentPath;
	if (!parentPath) {
		return false;
	}

	const siblings = state.entitiesByPath[parentPath]?.childPaths ?? [];
	const targetIndex = siblings.indexOf(target.path);
	if (targetIndex === -1) {
		return false;
	}

	const revision = state.revision;
	const index = layerDropInsertionIndex(
		siblings,
		path,
		intent.type,
		target.path,
	);
	moveTemplateNode(path, parentPath, index);
	return componentDraftStore.get().revision !== revision;
}

function getIntentLabel(intent: DraftLayerDropIntent) {
	switch (intent.type) {
		case "before":
			return "before";
		case "after":
			return "after";
		case "inside":
			return "inside";
	}
}

type OpenLayerMap = Record<string, boolean | undefined>;

type VisibleLayerRow = {
	path: string;
	depth: number;
	hasTopSeparator: boolean;
};

type DraftLayerInsertionPlacement = {
	parentPath: string | null;
	index: number;
};
type PlacementIntent = "after" | "before" | "inside";

type DraftPickerItem = {
	component: string;
	label: string;
	description?: string;
	role: string;
};

function resolveDraftLayerInsertionPlacement({
	intent,
	rootPath,
	selectedPath,
	entitiesByPath,
}: {
	intent: PlacementIntent;
	rootPath: string | null;
	selectedPath: string | null;
	entitiesByPath: Record<string, ComponentDraftEntity>;
}): DraftLayerInsertionPlacement | null {
	if (!rootPath) {
		return Object.keys(entitiesByPath).length === 0
			? { parentPath: null, index: 0 }
			: null;
	}

	const selectedEntity = selectedPath ? entitiesByPath[selectedPath] : null;

	if (selectedEntity) {
		if (intent === "inside") {
			if (!canHaveElementChildren(selectedEntity.role)) {
				return null;
			}

			return {
				parentPath: selectedEntity.path,
				index: selectedEntity.childPaths?.length ?? 0,
			};
		}

		if (selectedEntity.path === rootPath || !selectedEntity.parentPath) {
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
				siblingIndex >= 0
					? siblingIndex + (intent === "before" ? 0 : 1)
					: (parent.childPaths?.length ?? 0),
		};
	}

	const rootEntity = entitiesByPath[rootPath];
	if (!rootEntity || !canHaveElementChildren(rootEntity.role)) {
		return null;
	}

	return {
		parentPath: rootPath,
		index: intent === "before" ? 0 : (rootEntity.childPaths?.length ?? 0),
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
	editRequestPath,
	hasTopSeparator,
	open,
	rootPath,
	onDraggingChange,
	onEditRequestHandled,
	onToggleOpen,
}: {
	path: string;
	depth: number;
	editRequestPath: string | null;
	hasTopSeparator: boolean;
	open: boolean;
	rootPath: string;
	onDraggingChange: (isDragging: boolean) => void;
	onEditRequestHandled: () => void;
	onToggleOpen: (path: string) => void;
}) {
	const [isEditing, setIsEditing] = useState(false);
	const [draftName, setDraftName] = useState("");
	const [dragging, setDragging] = useState(false);
	const [dropIntent, setDropIntent] = useState<
		"before" | "after" | "inside" | null
	>(null);
	const rowRef = useRef<HTMLDivElement>(null);
	const labelRef = useRef<HTMLButtonElement>(null);
	const inputRef = useRef<HTMLInputElement>(null);
	const layer = useComponentDraftLayerSummary(path);
	const hasChildren = layer.childPaths.length > 0;
	const isRoot = path === rootPath;
	const canDragLayer = !isRoot;
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

	const updateDropIntent = useCallback(
		(data: Record<string | symbol, unknown>) => {
			const instruction = extractInstruction(data);
			setDropIntent(getInstructionIntent(instruction));
		},
		[],
	);

	const clearDropIntent = useCallback(() => {
		setDropIntent(null);
	}, []);

	useEffect(() => {
		if (!layer.isSelected) {
			setIsEditing(false);
		}
	}, [layer.isSelected]);

	useEffect(() => {
		if (editRequestPath !== path) {
			return;
		}

		editLayer();
		onEditRequestHandled();
	}, [editLayer, editRequestPath, onEditRequestHandled, path]);

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

	useEffect(() => {
		if (!isEditing) {
			return;
		}

		const onPointerDown = (event: PointerEvent) => {
			const target = event.target;
			if (!(target instanceof Node)) {
				return;
			}

			if (rowRef.current?.contains(target)) {
				return;
			}

			commitLayerName();
		};

		document.addEventListener("pointerdown", onPointerDown);
		return () => {
			document.removeEventListener("pointerdown", onPointerDown);
		};
	}, [commitLayerName, isEditing]);

	useEffect(() => {
		const row = rowRef.current;
		const label = labelRef.current;
		if (!row || !label || isEditing) {
			return;
		}

		const dropTargetCleanup = dropTargetForElements({
			element: row,
			canDrop: ({ source }) =>
				isDraftLayerDragData(source.data) && source.data.path !== path,
			getData: ({ input, element }) =>
				attachInstruction(
					{
						type: "trickroom-draft-layer-drop-target",
						path,
					},
					{
						element,
						input,
						currentLevel: depth,
						indentPerLevel: INDENT_PER_LEVEL,
						mode: "standard",
						block: getBlockedDropInstructions(layer.canHaveChildren, isRoot),
					},
				),
			onDrag: ({ self }) => updateDropIntent(self.data),
			onDragEnter: ({ self }) => updateDropIntent(self.data),
			onDropTargetChange: ({ self }) => updateDropIntent(self.data),
			onDragLeave: clearDropIntent,
			onDrop: clearDropIntent,
		});

		if (!canDragLayer) {
			return dropTargetCleanup;
		}

		return combine(
			draggable({
				element: row,
				dragHandle: label,
				getInitialData: () => ({ type: "trickroom-draft-layer", path }),
				onDragStart: () => {
					setDragging(true);
					onDraggingChange(true);
				},
				onDrop: () => {
					setDragging(false);
					onDraggingChange(false);
				},
			}),
			dropTargetCleanup,
		);
	}, [
		canDragLayer,
		clearDropIntent,
		depth,
		isEditing,
		isRoot,
		layer.canHaveChildren,
		onDraggingChange,
		path,
		updateDropIntent,
	]);

	const onInputKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
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
			<DraftLayerContextMenu path={path}>
				<div
					ref={rowRef}
					className={layerRow({
						selected: layer.isSelected,
						dragging,
					})}
					style={{ paddingLeft: `${4 + depth * INDENT_PER_LEVEL}px` }}
				>
					{dropIntent ? (
						<div className={dropIndicator({ intent: dropIntent })} />
					) : null}
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
							ref={labelRef}
							className={`min-w-0 flex-1 text-start ${canDragLayer ? "active:cursor-grabbing" : ""}`}
							onClick={selectLayer}
							onDoubleClick={editLayer}
							title={canDragLayer ? `Drag ${layer.name}` : layer.name}
						>
							<span
								className={`truncate ${hasChildren ? " font-semibold" : ""}`}
							>
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
			</DraftLayerContextMenu>
		</div>
	);
});

export function ComponentDraftLayers({
	className,
	componentId,
	embedded = false,
}: {
	className?: string;
	componentId: string;
	embedded?: boolean;
}) {
	const rootPath = useComponentDraftRootPath();
	const draftComponentId = useComponentDraftComponentId();
	const selectedPath = useComponentDraftSelectedPath();
	const { entitiesByPath } = useComponentDraftLayerTreeSnapshot();
	const isAltPressed = useKeyHold("Alt");
	const isShiftPressed = useKeyHold("Shift");
	const scrollViewportRef = useRef<HTMLDivElement>(null);
	const [openByPath, setOpenByPath] = useState<OpenLayerMap>({});
	const [isDraggingLayer, setIsDraggingLayer] = useState(false);
	const [pickerOpen, setPickerOpen] = useState(false);
	const [pickerIntent, setPickerIntent] = useState<PlacementIntent>("after");
	const [componentQuery, setComponentQuery] = useState("");
	const [selectedLibrary, setSelectedLibrary] =
		useState<RegistryId>("trickroom");
	const [lastAddedSelection, setLastAddedSelection] =
		useState<ComponentTemplateSelection | null>(null);
	const [editRequestPath, setEditRequestPath] = useState<string | null>(null);
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

	const handleLayerDraggingChange = useCallback((isDragging: boolean) => {
		setIsDraggingLayer(isDragging);
	}, []);

	useEffect(() => {
		return monitorForElements({
			canMonitor: ({ source }) => isDraftLayerDragData(source.data),
			onDragStart: () => {
				setIsDraggingLayer(true);
			},
			onDrop: ({ source, location }) => {
				setIsDraggingLayer(false);

				if (!isDraftLayerDragData(source.data)) {
					return;
				}

				const target = location.current.dropTargets[0];
				if (!target) {
					return;
				}

				const intent = getDraftLayerDropIntent(target.data);
				if (!intent) {
					return;
				}

				const state = componentDraftStore.get();
				const sourceName =
					state.entitiesByPath[source.data.path]?.name?.trim() ||
					state.entitiesByPath[source.data.path]?.component ||
					"Layer";
				const targetName =
					state.entitiesByPath[intent.targetPath]?.name?.trim() ||
					state.entitiesByPath[intent.targetPath]?.component ||
					"layer";
				const didMove = moveDraftLayerByIntent(source.data.path, intent);
				if (didMove) {
					announce(
						`Moved ${sourceName} ${getIntentLabel(intent)} ${targetName}.`,
					);
					selectTemplateNode(source.data.path);
				}
			},
		});
	}, []);

	useEffect(() => {
		const scrollElement = scrollViewportRef.current;
		if (!scrollElement) {
			return;
		}

		return autoScrollForElements({
			element: scrollElement,
			canScroll: ({ source }) => isDraftLayerDragData(source.data),
		});
	}, []);

	const keyboardPlacementIntent: PlacementIntent = getShortcutPlacementIntent({
		altKey: isAltPressed,
		shiftKey: isShiftPressed,
	});
	const effectivePickerIntent: PlacementIntent =
		pickerOpen && (isAltPressed || isShiftPressed)
			? keyboardPlacementIntent
			: pickerIntent;
	const resolveInsertionPlacement = useCallback(
		(intent: PlacementIntent) =>
			draftComponentId === componentId
				? resolveDraftLayerInsertionPlacement({
						intent,
						rootPath,
						selectedPath,
						entitiesByPath,
					})
				: null,
		[componentId, draftComponentId, entitiesByPath, rootPath, selectedPath],
	);
	const insertionPlacement = useMemo(
		() => resolveInsertionPlacement(keyboardPlacementIntent),
		[keyboardPlacementIntent, resolveInsertionPlacement],
	);
	const canAddLayer = insertionPlacement !== null;
	const canAddWithPickerIntent =
		resolveInsertionPlacement(effectivePickerIntent) !== null;
	const pickerPlacementLabel = rootPath ? effectivePickerIntent : "root";
	const pickerItems = useMemo(
		() => getDraftComponentPickerItems(selectedLibrary, componentQuery),
		[componentQuery, selectedLibrary],
	);

	const addDraftLayer = useCallback(
		(selection: ComponentTemplateSelection, intent: PlacementIntent) => {
			const placement = resolveInsertionPlacement(intent);
			if (!placement) {
				return;
			}

			addTemplateNode(selection, placement.parentPath, placement.index);
			setLastAddedSelection(selection);
		},
		[resolveInsertionPlacement],
	);

	const repeatLastLayer = useCallback(
		(intent: PlacementIntent) => {
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

			addDraftLayer(lastAddedSelection, intent);
		},
		[addDraftLayer, lastAddedSelection],
	);

	const selectVisibleRowAtIndex = useCallback(
		(index: number) => {
			const row = visibleRows[index];
			if (!row) {
				return false;
			}

			selectTemplateNode(row.path);
			return true;
		},
		[visibleRows],
	);

	const selectRelativeRow = useCallback(
		(direction: 1 | -1) => {
			if (visibleRows.length === 0) {
				return false;
			}

			const selectedIndex = selectedPath
				? visibleRows.findIndex((row) => row.path === selectedPath)
				: -1;
			const nextIndex =
				selectedIndex === -1
					? direction === 1
						? 0
						: visibleRows.length - 1
					: Math.min(
							visibleRows.length - 1,
							Math.max(0, selectedIndex + direction),
						);

			return selectVisibleRowAtIndex(nextIndex);
		},
		[selectVisibleRowAtIndex, selectedPath, visibleRows],
	);

	const expandOrEnterSelectedRow = useCallback(() => {
		const selectedEntity = selectedPath ? entitiesByPath[selectedPath] : null;
		if (!selectedEntity) {
			return selectVisibleRowAtIndex(0);
		}

		const childPaths = selectedEntity.childPaths ?? [];
		if (childPaths.length === 0) {
			return false;
		}

		if (openByPath[selectedEntity.path] === false) {
			setOpenByPath((current) => ({ ...current, [selectedEntity.path]: true }));
			return true;
		}

		selectTemplateNode(childPaths[0] ?? null);
		return true;
	}, [entitiesByPath, openByPath, selectVisibleRowAtIndex, selectedPath]);

	const collapseOrSelectParentRow = useCallback(() => {
		const selectedEntity = selectedPath ? entitiesByPath[selectedPath] : null;
		if (!selectedEntity) {
			return false;
		}

		if (
			(selectedEntity.childPaths?.length ?? 0) > 0 &&
			openByPath[selectedEntity.path] !== false
		) {
			setOpenByPath((current) => ({
				...current,
				[selectedEntity.path]: false,
			}));
			return true;
		}

		if (selectedEntity.parentPath) {
			selectTemplateNode(selectedEntity.parentPath);
			return true;
		}

		return false;
	}, [entitiesByPath, openByPath, selectedPath]);

	const moveSelectedRowBy = useCallback(
		(direction: 1 | -1) => {
			const selectedEntity = selectedPath ? entitiesByPath[selectedPath] : null;
			if (!selectedEntity?.parentPath) {
				return false;
			}

			const siblings =
				entitiesByPath[selectedEntity.parentPath]?.childPaths ?? [];
			const currentIndex = siblings.indexOf(selectedEntity.path);
			const nextIndex = currentIndex + direction;
			if (
				currentIndex === -1 ||
				nextIndex < 0 ||
				nextIndex >= siblings.length
			) {
				return false;
			}

			moveTemplateNode(
				selectedEntity.path,
				selectedEntity.parentPath,
				nextIndex,
			);
			return true;
		},
		[entitiesByPath, selectedPath],
	);

	const handleDraftLayerShortcut = useCallback(
		(event: KeyboardEvent) => {
			if (
				hasCommandModifier(event) &&
				event.shiftKey &&
				(event.key === "ArrowUp" || event.key === "ArrowDown")
			) {
				if (moveSelectedRowBy(event.key === "ArrowDown" ? 1 : -1)) {
					event.preventDefault();
				}
				return;
			}

			if (event.metaKey || event.ctrlKey) {
				return;
			}

			const key = getKey(event);
			const placementIntent = getShortcutPlacementIntent(event);
			let handled = false;

			if (event.key === "ArrowDown" || key === "j") {
				handled = selectRelativeRow(1);
			} else if (event.key === "ArrowUp" || key === "k") {
				handled = selectRelativeRow(-1);
			} else if (event.key === "ArrowRight" || key === "l") {
				handled = expandOrEnterSelectedRow();
			} else if (event.key === "ArrowLeft" || key === "h") {
				handled = collapseOrSelectParentRow();
			} else if (event.key === "Home") {
				handled = selectVisibleRowAtIndex(0);
			} else if (event.key === "End") {
				handled = selectVisibleRowAtIndex(visibleRows.length - 1);
			} else if (key === "r" && selectedPath) {
				setEditRequestPath(selectedPath);
				handled = true;
			} else if (
				(event.key === "Backspace" || event.key === "Delete") &&
				selectedPath
			) {
				deleteTemplateNode(selectedPath);
				handled = true;
			} else if (!event.repeat && isShortcutLetter(event, "f")) {
				addDraftLayer(
					{ library: "trickroom", component: "container" },
					placementIntent,
				);
				handled = true;
			} else if (!event.repeat && isShortcutLetter(event, "t")) {
				addDraftLayer(
					{ library: "trickroom", component: "text" },
					placementIntent,
				);
				handled = true;
			} else if (!event.repeat && isShortcutLetter(event, "a")) {
				if (resolveInsertionPlacement(placementIntent)) {
					setPickerIntent(placementIntent);
					setPickerOpen(true);
					handled = true;
				}
			} else if (!event.repeat && isPeriodKey(event) && lastAddedSelection) {
				repeatLastLayer(placementIntent);
				handled = true;
			}

			if (handled) {
				event.preventDefault();
			}
		},
		[
			addDraftLayer,
			collapseOrSelectParentRow,
			expandOrEnterSelectedRow,
			lastAddedSelection,
			moveSelectedRowBy,
			repeatLastLayer,
			resolveInsertionPlacement,
			selectRelativeRow,
			selectVisibleRowAtIndex,
			selectedPath,
			visibleRows.length,
		],
	);

	useWindowKeyDown(handleDraftLayerShortcut, {
		enabled: draftComponentId === componentId,
	});

	const Shell = embedded ? "div" : "aside";
	const shellClassName = embedded
		? `flex min-h-0 flex-1 flex-col text-xs ${className ?? ""}`
		: `flex min-h-0 w-[264px] shrink-0 flex-col border-r border-slate-200 bg-slate-50 text-xs ${className ?? ""}`;

	if (draftComponentId !== componentId) {
		return (
			<Shell className={shellClassName}>
				<Text
					variant="label"
					render={<div />}
					className="px-3 py-3 text-[10px] uppercase tracking-wider text-slate-400"
				>
					Layers
				</Text>
				<p className="px-3 text-slate-500">Unsaved draft open.</p>
			</Shell>
		);
	}

	return (
		<Shell className={shellClassName}>
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
						addDraftLayer(
							{ library: "trickroom", component: "container" },
							keyboardPlacementIntent,
						)
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
						addDraftLayer(
							{ library: "trickroom", component: "text" },
							keyboardPlacementIntent,
						)
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
					onClick={() => {
						setPickerIntent(keyboardPlacementIntent);
						setPickerOpen((isOpen) => !isOpen);
					}}
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
					onClick={() => repeatLastLayer(keyboardPlacementIntent)}
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
					<div className="px-1 font-mono text-[10px] text-slate-500">
						Insert {pickerPlacementLabel}
					</div>
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
										disabled={!canAddWithPickerIntent}
										onClick={(event) => {
											const placementIntent =
												event.altKey || event.shiftKey
													? getShortcutPlacementIntent(event)
													: effectivePickerIntent;
											addDraftLayer(
												{
													library: selectedLibrary,
													component: item.component,
												},
												placementIntent,
											);
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
			<ScrollArea
				viewportRef={scrollViewportRef}
				className="min-h-0 flex-1"
				data-dragging={isDraggingLayer ? "" : undefined}
			>
				<div className="flex flex-col">
					{visibleRows.length === 0 ? (
						<div className="px-3 py-2 text-slate-500">No root layer</div>
					) : (
						visibleRows.map((row) => (
							<DraftLayerRow
								key={row.path}
								path={row.path}
								depth={row.depth}
								editRequestPath={editRequestPath}
								hasTopSeparator={row.hasTopSeparator}
								open={openByPath[row.path] !== false}
								rootPath={rootPath ?? row.path}
								onDraggingChange={handleLayerDraggingChange}
								onEditRequestHandled={() => setEditRequestPath(null)}
								onToggleOpen={toggleOpen}
							/>
						))
					)}
				</div>
			</ScrollArea>
		</Shell>
	);
}
