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
import { useVirtualizer } from "@tanstack/react-virtual";
import {
	ChevronRight,
	Frame,
	PanelTopOpen,
	Plus,
	Repeat2,
	Type,
} from "lucide-react";
import {
	type KeyboardEvent,
	type MouseEvent,
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
	type ComponentRef,
	getComponentIds,
	getRegistry,
	getRegistryRecipes,
	type RecipeRef,
	type RegistryId,
	resolveRegistryComponent,
	resolveRegistryRecipe,
} from "../../libraries/registry";
import {
	canInsertIntoRecipeBoundary,
	getElementRecipeMetadata,
	isRecipeOwnedStructuralNode,
	isRecipeRoot,
	isRecipeSlotHost,
} from "../../recipes/ownership";
import { isRecipeSlotInsertionAllowed } from "../../recipes/slot-allowlist";
import {
	addElement,
	addRecipe,
	type DesignEntity,
	designStore,
	moveElement,
	renameElement,
	selectElement,
	useElement,
	useLayerSummary,
	useLayerTreeSnapshot,
	useSelectedElement,
} from "../../stores/design-store";
import type {
	RecipeDefinition,
	RegistryComponentDefinition,
} from "../../types";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { ScrollArea } from "../ui/scroll-area";
import { Separator } from "../ui/separator";
import { Text } from "../ui/text";
import { LayerContextMenu } from "./LayerContextMenu";

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
		recipeOwned: {
			true: "text-orange-500",
		},
	},
	compoundVariants: [
		{
			selected: true,
			recipeOwned: true,
			className: "text-orange-700",
		},
	],
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
		recipeOwned: {
			true: "before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-orange-500 before:content-['']",
		},
		dragging: {
			true: "opacity-40",
		},
	},
	compoundVariants: [
		{
			selected: false,
			recipeOwned: true,
			className:
				"bg-orange-50 text-orange-950 inset-shadow-orange-200 hover:bg-orange-100",
		},
		{
			selected: true,
			recipeOwned: true,
			className:
				"bg-orange-100 text-orange-950 inset-shadow-cyan-400 hover:bg-orange-100",
		},
	],
});

const slotCue = tv({
	base: "mr-1 flex size-4 shrink-0 items-center justify-center text-orange-500",
	variants: {
		selected: {
			true: "text-orange-700",
		},
	},
});

type LayerDragData = {
	type: "trickroom-layer";
	id: string;
};

type LayerDropData = {
	type: "trickroom-layer-drop-target";
	id: string;
};

type LayerDropIntent =
	| { type: "before"; targetId: string }
	| { type: "after"; targetId: string }
	| { type: "inside"; targetId: string };
type PlacementIntent = "after" | "before" | "inside";
type InsertionPlacement = {
	parentId: string | null;
	index: number;
};

const INDENT_PER_LEVEL = 12;
const componentRef = (library: string, component: string) => ({
	"data-trickroom-library": library,
	"data-trickroom-component": component,
});
const trickroomComponent = (component: "container" | "text") =>
	componentRef("trickroom", component);

type PickerItem =
	| {
			type: "component";
			component: string;
			definition: RegistryComponentDefinition;
	  }
	| {
			type: "recipe";
			recipe: string;
			definition: RecipeDefinition;
	  };

type LastAddedRef =
	| ({ type: "component" } & ComponentRef)
	| ({ type: "recipe" } & RecipeRef);

export function getRegistryPickerSections(
	library: RegistryId,
	queryText: string,
) {
	const query = queryText.trim().toLowerCase();
	const registry = getRegistry(library);
	const matches = ({
		id,
		label,
		description,
	}: {
		id: string;
		label: string;
		description?: string;
	}) =>
		!query ||
		id.toLowerCase().includes(query) ||
		label.toLowerCase().includes(query) ||
		(description?.toLowerCase().includes(query) ?? false);

	const components: PickerItem[] = getComponentIds(library)
		.map((component) => ({
			type: "component" as const,
			component,
			definition: registry[component as keyof typeof registry],
		}))
		.filter(({ component, definition }) =>
			matches({
				id: component,
				label: definition.label,
				description: definition.description,
			}),
		);

	const recipes: PickerItem[] = getRegistryRecipes(library)
		.map((definition) => ({
			type: "recipe" as const,
			recipe: definition.id,
			definition,
		}))
		.filter(({ recipe, definition }) =>
			matches({
				id: recipe,
				label: definition.label,
				description: definition.description,
			}),
		);

	return [
		{ title: "Components", items: components },
		{ title: "Recipes", items: recipes },
	];
}

type LayerProps = {
	id: string;
	depth: number;
	designFile: string;
	hasTopSeparator: boolean;
	open: boolean;
	onDraggingChange: (isDragging: boolean) => void;
	onToggleOpen: (id: string) => void;
};

export type VisibleLayerRow = {
	id: string;
	depth: number;
	hasTopSeparator: boolean;
};

type OpenLayerMap = Record<string, boolean | undefined>;

const LAYER_ROW_HEIGHT = 20;
const LAYER_OVERSCAN = 8;
const LAYER_DRAG_OVERSCAN = 32;

export function getVisibleLayerRows({
	rootIds,
	entitiesById,
	openById,
}: {
	rootIds: readonly string[];
	entitiesById: Readonly<Record<string, DesignEntity | undefined>>;
	openById: OpenLayerMap;
}): VisibleLayerRow[] {
	const rows: VisibleLayerRow[] = [];

	const visit = (id: string, depth: number, hasTopSeparator = false) => {
		rows.push({ id, depth, hasTopSeparator });

		const entity = entitiesById[id];
		if (!entity?.childIds?.length || openById[id] === false) {
			return;
		}

		for (const childId of entity.childIds) {
			visit(childId, depth + 1);
		}
	};

	rootIds.forEach((rootId, index) => {
		visit(rootId, 0, index > 0);
	});
	return rows;
}

function isLayerDragData(data: Record<string, unknown>): data is LayerDragData {
	return data.type === "trickroom-layer" && typeof data.id === "string";
}

function isLayerDropData(
	data: Record<string | symbol, unknown>,
): data is LayerDropData {
	return (
		data.type === "trickroom-layer-drop-target" && typeof data.id === "string"
	);
}

function getLayerDropIntent(
	data: Record<string | symbol, unknown>,
): LayerDropIntent | null {
	if (!isLayerDropData(data)) {
		return null;
	}

	const instruction = extractInstruction(data);
	if (!instruction || instruction.type === "instruction-blocked") {
		return null;
	}

	switch (instruction.type) {
		case "reorder-above":
			return { type: "before", targetId: data.id };
		case "reorder-below":
			return { type: "after", targetId: data.id };
		case "make-child":
			return { type: "inside", targetId: data.id };
		case "reparent":
			return null;
	}
}

function getSiblingIds(parentId: string | null) {
	const state = designStore.get();
	if (parentId === null) {
		return state.rootIds;
	}

	return state.entitiesById[parentId]?.childIds ?? [];
}

function moveLayerByIntent(id: string, intent: LayerDropIntent) {
	const state = designStore.get();
	const target = state.entitiesById[intent.targetId];
	if (!target || target.id === id) {
		return false;
	}

	const siblings = getSiblingIds(target.parentId);
	const targetIndex = siblings.indexOf(target.id);
	if (targetIndex === -1) {
		return false;
	}

	const revision = state.revision;
	const index =
		intent.type === "after"
			? targetIndex + 1
			: intent.type === "before"
				? targetIndex
				: (target.childIds?.length ?? 0);

	moveElement(
		id,
		intent.type === "inside" ? target.id : target.parentId,
		index,
	);
	return designStore.get().revision !== revision;
}

function getIntentLabel(intent: LayerDropIntent) {
	switch (intent.type) {
		case "before":
			return "before";
		case "after":
			return "after";
		case "inside":
			return "inside";
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

function getPlacementIntent(
	event: MouseEvent<HTMLButtonElement>,
): PlacementIntent {
	if (event.altKey) return "inside";
	if (event.shiftKey) return "before";
	return "after";
}

export function resolveLayerInsertionPlacement({
	intent,
	rootIds,
	selectedElement,
	selectedParent,
	entitiesById,
}: {
	intent: PlacementIntent;
	rootIds: readonly string[];
	selectedElement: DesignEntity | null | undefined;
	selectedParent: DesignEntity | null | undefined;
	entitiesById: Record<string, DesignEntity | undefined>;
}): InsertionPlacement | null {
	let placement: InsertionPlacement | null = null;

	if (intent === "inside") {
		if (!selectedElement || selectedElement.role !== "branch") {
			return null;
		}

		placement = {
			parentId: selectedElement.id,
			index: selectedElement.childIds?.length ?? 0,
		};
	} else if (!selectedElement) {
		placement = {
			parentId: null,
			index: intent === "before" ? 0 : rootIds.length,
		};
	} else {
		const siblingIds =
			selectedElement.parentId === null
				? rootIds
				: (selectedParent?.childIds ?? []);
		const selectedIndex = siblingIds.indexOf(selectedElement.id);
		const insertionPoint =
			selectedIndex === -1 ? siblingIds.length : selectedIndex;

		placement = {
			parentId: selectedElement.parentId,
			index: intent === "before" ? insertionPoint : insertionPoint + 1,
		};
	}

	if (!canInsertIntoRecipeBoundary(entitiesById, placement.parentId)) {
		return null;
	}

	return placement;
}

function getBlockedDropInstructions(
	canHaveChildren: boolean,
	entity:
		| ReturnType<typeof designStore.get>["entitiesById"][string]
		| undefined,
) {
	const blockedInstructions: Instruction["type"][] = [];
	const isRecipeOwned = isRecipeOwnedStructuralNode(entity);

	if (!canHaveChildren || (isRecipeOwned && !isRecipeSlotHost(entity))) {
		blockedInstructions.push("make-child");
	}

	if (isRecipeOwned && !isRecipeRoot(entity)) {
		blockedInstructions.push("reorder-above", "reorder-below");
	}

	return blockedInstructions;
}

const Layer = memo(function Layer({
	id,
	depth,
	designFile,
	hasTopSeparator,
	open,
	onDraggingChange,
	onToggleOpen,
}: LayerProps) {
	const [isEditing, setIsEditing] = useState(false);
	const [draftName, setDraftName] = useState("");
	const [dragging, setDragging] = useState(false);
	const [dropIntent, setDropIntent] = useState<LayerDropIntent["type"] | null>(
		null,
	);
	const rowRef = useRef<HTMLDivElement>(null);
	const labelRef = useRef<HTMLButtonElement>(null);
	const inputRef = useRef<HTMLInputElement>(null);
	const layer = useLayerSummary(id);
	const entity = useElement(id);
	const hasChildren = layer.childIds.length > 0;
	const isRecipeOwned = isRecipeOwnedStructuralNode(entity);
	const recipeMetadata = getElementRecipeMetadata(entity);
	const canDragLayer = !isRecipeOwned || isRecipeRoot(entity);
	const isSlotHost = isRecipeSlotHost(entity);
	const className = !hasChildren ? "-ml-0.5" : undefined;

	const toggleOpen = useCallback(() => {
		onToggleOpen(layer.id);
	}, [layer.id, onToggleOpen]);

	const selectLayer = () => {
		selectElement(layer.id);
	};

	const editLayer = () => {
		selectLayer();
		setDraftName(layer.name);
		setIsEditing(true);
	};

	const commitLayerName = useCallback(() => {
		const nextName = draftName.trim() || "Layer";
		setIsEditing(false);

		if (nextName !== layer.name) {
			renameElement(layer.id, nextName);
		}
	}, [draftName, layer.id, layer.name]);

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
				isLayerDragData(source.data) && source.data.id !== layer.id,
			getData: ({ input, element }) =>
				attachInstruction(
					{
						type: "trickroom-layer-drop-target",
						id: layer.id,
					},
					{
						element,
						input,
						currentLevel: depth,
						indentPerLevel: INDENT_PER_LEVEL,
						mode: "standard",
						block: getBlockedDropInstructions(layer.canHaveChildren, entity),
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
				getInitialData: () => ({ type: "trickroom-layer", id: layer.id }),
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
		entity,
		isEditing,
		layer.canHaveChildren,
		layer.id,
		onDraggingChange,
		updateDropIntent,
	]);

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
			<LayerContextMenu
				id={id}
				designFile={designFile}
				isRecipeOwned={isRecipeOwned}
				layerName={layer.name}
				recipeInstanceId={recipeMetadata?.instanceId ?? null}
			>
				<div
					ref={rowRef}
					className={layerRow({
						selected: layer.isSelected,
						recipeOwned: isRecipeOwned,
						dragging,
					})}
					style={{ paddingLeft: `${4 + depth * INDENT_PER_LEVEL}px` }}
				>
					{dropIntent ? (
						<div className={dropIndicator({ intent: dropIntent })} />
					) : null}
					{hasChildren ? (
						<UnstyledButton className="shrink-0" onClick={toggleOpen}>
							<ChevronRight
								className={icon({
									open,
									isEditing,
									selected: layer.isSelected,
									recipeOwned: isRecipeOwned,
								})}
							/>
						</UnstyledButton>
					) : null}
					{isSlotHost ? (
						<span
							aria-label="Recipe slot"
							className={slotCue({ selected: layer.isSelected })}
							role="img"
							title="Recipe slot"
						>
							<PanelTopOpen aria-hidden="true" className="size-3.5" />
						</span>
					) : null}
					{!isEditing ? (
						<UnstyledButton
							ref={labelRef}
							className={`min-w-0 flex-1 text-start ${canDragLayer ? "active:cursor-grabbing" : ""}`}
							onClick={selectLayer}
							onDoubleClick={editLayer}
							title={
								canDragLayer
									? `Drag ${layer.name}`
									: `${layer.name} is recipe-owned structure`
							}
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
						/>
					)}
				</div>
			</LayerContextMenu>
		</div>
	);
});

export function Layers({
	designFile,
	className,
}: {
	designFile: string;
	className?: string;
}) {
	const { rootIds, entitiesById } = useLayerTreeSnapshot();
	const selectedElement = useSelectedElement();
	const selectedParent = useElement(selectedElement?.parentId ?? "");
	const isAltPressed = useKeyHold("Alt");
	const isShiftPressed = useKeyHold("Shift");
	const scrollViewportRef = useRef<HTMLDivElement>(null);
	const [openById, setOpenById] = useState<OpenLayerMap>({});
	const [isDraggingLayer, setIsDraggingLayer] = useState(false);
	const [pickerOpen, setPickerOpen] = useState(false);
	const [pickerIntent, setPickerIntent] = useState<PlacementIntent>("after");
	const [componentQuery, setComponentQuery] = useState("");
	const [selectedLibrary, setSelectedLibrary] = useState<RegistryId>("base-ui");
	const [lastAddedRef, setLastAddedRef] = useState<LastAddedRef | null>(null);
	const visibleLayerRows = useMemo(
		() =>
			getVisibleLayerRows({
				rootIds,
				entitiesById,
				openById,
			}),
		[rootIds, entitiesById, openById],
	);
	const layerVirtualizer = useVirtualizer({
		count: visibleLayerRows.length,
		getScrollElement: () => scrollViewportRef.current,
		estimateSize: () => LAYER_ROW_HEIGHT,
		getItemKey: (index) => visibleLayerRows[index]?.id ?? index,
		overscan: isDraggingLayer ? LAYER_DRAG_OVERSCAN : LAYER_OVERSCAN,
	});
	const keyboardPlacementIntent: PlacementIntent = isAltPressed
		? "inside"
		: isShiftPressed
			? "before"
			: "after";
	const registryComponentGroups = useMemo(
		() => availableRegistries.map((library) => ({ library })),
		[],
	);
	const pickerSections = useMemo(
		() => getRegistryPickerSections(selectedLibrary, componentQuery),
		[componentQuery, selectedLibrary],
	);
	const toggleLayerOpen = useCallback((id: string) => {
		setOpenById((current) => ({
			...current,
			[id]: current[id] === false,
		}));
	}, []);
	const handleLayerDraggingChange = useCallback((isDragging: boolean) => {
		setIsDraggingLayer(isDragging);
	}, []);

	const resolveInsertionPlacement = useCallback(
		(intent: PlacementIntent) => {
			return resolveLayerInsertionPlacement({
				intent,
				rootIds,
				selectedElement,
				selectedParent,
				entitiesById: designStore.get().entitiesById,
			});
		},
		[rootIds, selectedElement, selectedParent],
	);
	const canInsertWithKeyboardIntent =
		resolveInsertionPlacement(keyboardPlacementIntent) !== null;
	const canInsertWithPickerIntent =
		resolveInsertionPlacement(pickerIntent) !== null;
	const isPickerItemAllowed = useCallback(
		(item: PickerItem) => {
			const placement = resolveInsertionPlacement(pickerIntent);
			if (!placement) {
				return false;
			}

			return isRecipeSlotInsertionAllowed(
				designStore.get().entitiesById,
				placement.parentId,
				item.type === "recipe"
					? {
							kind: "recipe",
							library: selectedLibrary,
							recipe: item.recipe,
						}
					: {
							kind: "component",
							library: selectedLibrary,
							component: item.component,
						},
			);
		},
		[pickerIntent, resolveInsertionPlacement, selectedLibrary],
	);

	const addChosenComponent = useCallback(
		(ref: ComponentRef, intent: PlacementIntent) => {
			const placement = resolveInsertionPlacement(intent);
			if (!placement) {
				return;
			}

			addElement(
				componentRef(ref.library, ref.component),
				placement.parentId,
				placement.index,
			);
			setLastAddedRef({ type: "component", ...ref });
			setPickerOpen(false);
		},
		[resolveInsertionPlacement],
	);

	const addChosenRecipe = useCallback(
		(ref: RecipeRef, intent: PlacementIntent) => {
			const placement = resolveInsertionPlacement(intent);
			if (!placement) {
				return;
			}

			addRecipe(ref, placement.parentId, placement.index);
			setLastAddedRef({ type: "recipe", ...ref });
			setPickerOpen(false);
		},
		[resolveInsertionPlacement],
	);

	const handleAddLayer = useCallback(
		(
			elementType: "container" | "text",
			event: MouseEvent<HTMLButtonElement>,
		) => {
			const intent = getPlacementIntent(event);
			const placement = resolveInsertionPlacement(intent);
			if (!placement) {
				return;
			}

			addElement(
				trickroomComponent(elementType),
				placement.parentId,
				placement.index,
			);
			setLastAddedRef({
				type: "component",
				library: "trickroom",
				component: elementType,
			});
		},
		[resolveInsertionPlacement],
	);

	const handleOpenPicker = (event: MouseEvent<HTMLButtonElement>) => {
		const intent = getPlacementIntent(event);
		if (!resolveInsertionPlacement(intent)) {
			return;
		}
		setPickerIntent(intent);
		setPickerOpen((isOpen) => !isOpen);
	};

	const handleRepeatLast = (event: MouseEvent<HTMLButtonElement>) => {
		if (!lastAddedRef) {
			return;
		}

		const resolution =
			lastAddedRef.type === "component"
				? resolveRegistryComponent(lastAddedRef.library, lastAddedRef.component)
				: resolveRegistryRecipe(lastAddedRef.library, lastAddedRef.recipe);
		if (resolution.status !== "known") {
			return;
		}

		if (lastAddedRef.type === "component") {
			addChosenComponent(lastAddedRef, getPlacementIntent(event));
		} else {
			addChosenRecipe(lastAddedRef, getPlacementIntent(event));
		}
	};

	useEffect(() => {
		return monitorForElements({
			canMonitor: ({ source }) => isLayerDragData(source.data),
			onDragStart: () => {
				setIsDraggingLayer(true);
			},
			onDrop: ({ source, location }) => {
				setIsDraggingLayer(false);

				if (!isLayerDragData(source.data)) {
					return;
				}

				const target = location.current.dropTargets[0];
				if (!target) {
					return;
				}

				const intent = getLayerDropIntent(target.data);
				if (!intent) {
					return;
				}

				const sourceName =
					designStore.get().entitiesById[source.data.id]?.props[
						"data-trickroom-name"
					] ?? "Layer";
				const targetName =
					designStore.get().entitiesById[intent.targetId]?.props[
						"data-trickroom-name"
					] ?? "layer";
				const didMove = moveLayerByIntent(source.data.id, intent);
				if (didMove) {
					announce(
						`Moved ${sourceName} ${getIntentLabel(intent)} ${targetName}.`,
					);
					selectElement(source.data.id);
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
			canScroll: ({ source }) => isLayerDragData(source.data),
		});
	}, []);

	const selectionPath = useMemo(() => {
		if (!selectedElement) {
			return "";
		}

		const names: string[] = [];
		let current: DesignEntity | undefined = selectedElement;
		while (current) {
			const name = current.props["data-trickroom-name"];
			names.unshift(
				(typeof name === "string" && name.trim()) ||
					current.props["data-trickroom-component"],
			);
			current = current.parentId ? entitiesById[current.parentId] : undefined;
		}

		return names.join(" / ");
	}, [selectedElement, entitiesById]);

	return (
		<div className={`flex min-h-0 flex-col ${className ?? ""}`}>
			<div className="flex flex-row items-center gap-1 px-2 py-2">
				<Button
					variant="block"
					className="px-2 py-1"
					disabled={!canInsertWithKeyboardIntent}
					onClick={(event) => handleAddLayer("container", event)}
					title="Add container"
				>
					<Frame className="size-4 text-slate-950" />
				</Button>
				<Button
					variant="block"
					className="px-2 py-1"
					disabled={!canInsertWithKeyboardIntent}
					onClick={(event) => handleAddLayer("text", event)}
					title="Add text"
				>
					<Type className="size-4 text-slate-950" />
				</Button>
				<Button
					variant="block"
					className="px-2 py-1"
					disabled={!canInsertWithKeyboardIntent}
					onClick={handleOpenPicker}
					title="Add component"
				>
					<Plus className="size-4 text-slate-950" />
				</Button>
				<Separator orientation="vertical" className="mx-1 h-5" />
				<Button
					variant="block"
					className="px-2 py-1"
					disabled={!lastAddedRef || !canInsertWithKeyboardIntent}
					onClick={handleRepeatLast}
					title="Repeat last added item"
				>
					<Repeat2 className="size-4 text-slate-950" />
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
					<div className="grid grid-cols-[5rem_minmax(0,1fr)] gap-1">
						<div className="flex flex-col">
							{registryComponentGroups.map((group) => (
								<Button
									key={group.library}
									variant="block"
									className="flex w-full justify-start px-1 py-1 text-xs"
									onClick={() => setSelectedLibrary(group.library)}
									isSelected={selectedLibrary === group.library}
								>
									{group.library}
								</Button>
							))}
						</div>
						<div className="flex min-w-0 flex-col gap-1">
							{pickerSections.map((section) => (
								<div
									key={section.title}
									className="flex min-w-0 flex-col gap-1"
								>
									<div className="px-1 text-[0.625rem] font-semibold uppercase tracking-normal text-slate-400">
										{section.title}
									</div>
									{section.items.length === 0 ? (
										<div className="px-1 text-xs text-slate-400">
											No matches
										</div>
									) : (
										section.items.map((item) => {
											const itemAllowed = isPickerItemAllowed(item);
											return (
												<Button
													key={
														item.type === "component"
															? `component:${item.component}`
															: `recipe:${item.recipe}`
													}
													variant="block"
													className="flex w-full justify-start px-1 py-1 text-left text-xs"
													disabled={!canInsertWithPickerIntent || !itemAllowed}
													title={
														itemAllowed
															? undefined
															: "This recipe slot does not allow that child"
													}
													onClick={() => {
														if (item.type === "component") {
															addChosenComponent(
																{
																	library: selectedLibrary,
																	component: item.component,
																},
																pickerIntent,
															);
														} else {
															addChosenRecipe(
																{
																	library: selectedLibrary,
																	recipe: item.recipe,
																},
																pickerIntent,
															);
														}
													}}
												>
													<span className="min-w-0">
														<span className="block truncate font-medium">
															{item.definition.label}
														</span>
														<span className="block truncate text-slate-500">
															{item.type === "component"
																? item.definition.role
																: "recipe"}
															{item.type === "component" &&
															item.definition.controls
																? ` · ${Object.keys(item.definition.controls).join(", ")}`
																: ""}
														</span>
													</span>
												</Button>
											);
										})
									)}
								</div>
							))}
						</div>
					</div>
				</div>
			) : null}
			<Separator />
			<Text
				variant="label"
				render={<div />}
				className="px-3 pt-3 pb-1 text-[10px] uppercase tracking-wider text-slate-400"
			>
				Layers
			</Text>
			<ScrollArea viewportRef={scrollViewportRef} className="min-h-0 flex-1">
				<div
					className="relative w-full"
					style={{ height: `${layerVirtualizer.getTotalSize()}px` }}
				>
					{layerVirtualizer.getVirtualItems().map((virtualRow) => {
						const row = visibleLayerRows[virtualRow.index];
						if (!row) {
							return null;
						}

						return (
							<div
								key={virtualRow.key}
								className="absolute left-0 top-0 w-full"
								style={{
									height: `${virtualRow.size}px`,
									transform: `translateY(${virtualRow.start}px)`,
								}}
							>
								<Layer
									id={row.id}
									depth={row.depth}
									designFile={designFile}
									hasTopSeparator={row.hasTopSeparator}
									open={openById[row.id] !== false}
									onDraggingChange={handleLayerDraggingChange}
									onToggleOpen={toggleLayerOpen}
								/>
							</div>
						);
					})}
				</div>
			</ScrollArea>
			{selectionPath ? (
				<div className="shrink-0 truncate border-t border-slate-200 px-3 py-2 text-[10px] text-slate-400">
					{selectionPath}
				</div>
			) : null}
		</div>
	);
}
