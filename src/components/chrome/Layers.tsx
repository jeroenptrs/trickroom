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
import { useQuery } from "@tanstack/react-query";
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
	type KeyboardEvent as ReactKeyboardEvent,
	type MouseEvent,
	memo,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { toast } from "sonner";
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
	expandSystemComponent,
	type SystemComponentSummary,
	systemComponentsQueryOptions,
} from "../../queries/system-components";
import {
	canInsertIntoRecipeBoundary,
	getElementRecipeMetadata,
	isRecipeOwnedStructuralNode,
	isRecipeRoot,
	isRecipeSlotHost,
} from "../../recipes/ownership";
import {
	canInsertIntoSystemComponentBoundary,
	getElementSystemComponentMetadata,
	isSystemComponentOwnedStructuralNode,
	isSystemComponentRoot,
	isSystemComponentSlotHost,
} from "../../utils/system-component-ownership";
import { layerDropInsertionIndex } from "../../utils/reorder-insertion-index";
import {
	getRecipeSlotCandidateFromProps,
	isRecipeSlotInsertionAllowed,
} from "../../recipes/slot-allowlist";
import {
	addElement,
	addNodeTree,
	addRecipe,
	deleteElement,
	type DesignEntity,
	designStore,
	moveElement,
	renameElement,
	selectElement,
	useDesignSystemId,
	useElement,
	useLayerSummary,
	useLayerTreeSnapshot,
	useSelectedElement,
} from "../../stores/design-store";
import type {
	RecipeDefinition,
	RegistryComponentDefinition,
} from "../../types";
import { useProjectScope } from "../contexts";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { ScrollArea } from "../ui/scroll-area";
import { Separator } from "../ui/separator";
import { Text } from "../ui/text";
import { LayerContextMenu } from "./LayerContextMenu";
import {
	getKey,
	getShortcutPlacementIntent,
	hasCommandModifier,
	isPeriodKey,
	isShortcutLetter,
	useWindowKeyDown,
} from "../../utils/editor-shortcuts";

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
		componentOwned: {
			true: "text-emerald-500",
		},
	},
	compoundVariants: [
		{
			selected: true,
			recipeOwned: true,
			className: "text-orange-700",
		},
		{
			selected: true,
			componentOwned: true,
			className: "text-emerald-700",
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
		componentOwned: {
			true: "before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-emerald-500 before:content-['']",
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
		{
			selected: false,
			componentOwned: true,
			className:
				"bg-emerald-50 text-emerald-950 inset-shadow-emerald-200 hover:bg-emerald-100",
		},
		{
			selected: true,
			componentOwned: true,
			className:
				"bg-emerald-100 text-emerald-950 inset-shadow-cyan-400 hover:bg-emerald-100",
		},
	],
});

const recipeSlotCue = tv({
	base: "mr-1 flex size-4 shrink-0 items-center justify-center text-orange-500",
	variants: {
		selected: {
			true: "text-orange-700",
		},
	},
});

const componentSlotCue = tv({
	base: "mr-1 flex size-4 shrink-0 items-center justify-center text-emerald-500",
	variants: {
		selected: {
			true: "text-emerald-700",
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

type UserComponentPickerItem = {
	type: "system-component";
	component: SystemComponentSummary;
};

type PickerSection = {
	title: string;
	items: PickerItem[];
};

type UserComponentPickerSection = {
	title: string;
	items: UserComponentPickerItem[];
};

type PickerSource = "user" | "trickroom" | "libraries";

type LastAddedRef =
	| ({ type: "component" } & ComponentRef)
	| ({ type: "recipe" } & RecipeRef);

export function getRegistryPickerSections(
	library: RegistryId,
	queryText: string,
): PickerSection[] {
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

export function getUserComponentPickerSections(
	components: readonly SystemComponentSummary[],
	queryText: string,
): UserComponentPickerSection[] {
	const query = queryText.trim().toLowerCase();
	const items = components
		.filter((component) => component.hasPublished && component.currentVersion)
		.filter((component) => {
			if (!query) {
				return true;
			}

			return (
				component.componentId.toLowerCase().includes(query) ||
				component.slug.toLowerCase().includes(query) ||
				component.name.toLowerCase().includes(query) ||
				(component.description?.toLowerCase().includes(query) ?? false) ||
				(component.group?.toLowerCase().includes(query) ?? false)
			);
		})
		.sort(
			(left, right) =>
				(left.order ?? Number.MAX_SAFE_INTEGER) -
					(right.order ?? Number.MAX_SAFE_INTEGER) ||
				(left.group ?? "").localeCompare(right.group ?? "") ||
				left.name.localeCompare(right.name) ||
				left.componentId.localeCompare(right.componentId),
		)
		.map((component) => ({
			type: "system-component" as const,
			component,
		}));

	return [{ title: "User authored components", items }];
}

type LayerProps = {
	id: string;
	depth: number;
	designFile: string;
	editRequestId: string | null;
	hasTopSeparator: boolean;
	open: boolean;
	onDraggingChange: (isDragging: boolean) => void;
	onEditRequestHandled: () => void;
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
		intent.type === "inside"
			? (target.childIds?.length ?? 0)
			: layerDropInsertionIndex(siblings, id, intent.type, target.id);

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
	if (!canInsertIntoSystemComponentBoundary(entitiesById, placement.parentId)) {
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
	const isComponentOwned = isSystemComponentOwnedStructuralNode(entity);

	if (
		!canHaveChildren ||
		(isRecipeOwned && !isRecipeSlotHost(entity)) ||
		(isComponentOwned && !isSystemComponentSlotHost(entity))
	) {
		blockedInstructions.push("make-child");
	}

	if (
		(isRecipeOwned && !isRecipeRoot(entity)) ||
		(isComponentOwned && !isSystemComponentRoot(entity))
	) {
		blockedInstructions.push("reorder-above", "reorder-below");
	}

	return blockedInstructions;
}

const Layer = memo(function Layer({
	id,
	depth,
	designFile,
	editRequestId,
	hasTopSeparator,
	open,
	onDraggingChange,
	onEditRequestHandled,
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
	const isComponentOwned = isSystemComponentOwnedStructuralNode(entity);
	const recipeMetadata = getElementRecipeMetadata(entity);
	const canDragLayer =
		(!isRecipeOwned || isRecipeRoot(entity)) &&
		(!isComponentOwned || isSystemComponentRoot(entity));
	const isRecipeSlotHostLayer = isRecipeSlotHost(entity);
	const isComponentSlotHostLayer = isSystemComponentSlotHost(entity);
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
		if (editRequestId !== layer.id) {
			return;
		}

		editLayer();
		onEditRequestHandled();
	}, [editLayer, editRequestId, layer.id, onEditRequestHandled]);

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
						componentOwned: isComponentOwned,
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
									componentOwned: isComponentOwned,
								})}
							/>
						</UnstyledButton>
					) : null}
					{isRecipeSlotHostLayer ? (
						<span
							aria-label="Recipe slot"
							className={recipeSlotCue({ selected: layer.isSelected })}
							role="img"
							title="Recipe slot"
						>
							<PanelTopOpen aria-hidden="true" className="size-3.5" />
						</span>
					) : null}
					{isComponentSlotHostLayer ? (
						<span
							aria-label="Component slot"
							className={componentSlotCue({ selected: layer.isSelected })}
							role="img"
							title="Component slot"
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
									: isRecipeOwned
										? `${layer.name} is recipe-owned structure`
										: isComponentOwned
											? `${layer.name} is component-owned structure`
											: layer.name
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
	const systemId = useDesignSystemId();
	const projectScope = useProjectScope();
	const isAltPressed = useKeyHold("Alt");
	const isShiftPressed = useKeyHold("Shift");
	const scrollViewportRef = useRef<HTMLDivElement>(null);
	const [openById, setOpenById] = useState<OpenLayerMap>({});
	const [isDraggingLayer, setIsDraggingLayer] = useState(false);
	const [pickerOpen, setPickerOpen] = useState(false);
	const [pickerIntent, setPickerIntent] = useState<PlacementIntent>("after");
	const [componentQuery, setComponentQuery] = useState("");
	const [selectedPickerSource, setSelectedPickerSource] =
		useState<PickerSource>("user");
	const [selectedLibrary, setSelectedLibrary] = useState<RegistryId>("base-ui");
	const [lastAddedRef, setLastAddedRef] = useState<LastAddedRef | null>(null);
	const [editRequestId, setEditRequestId] = useState<string | null>(null);
	const systemComponentsQuery = useQuery({
		...systemComponentsQueryOptions(systemId ?? "", projectScope),
		enabled: Boolean(systemId),
	});
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
	const keyboardPlacementIntent: PlacementIntent = getShortcutPlacementIntent({
		altKey: isAltPressed,
		shiftKey: isShiftPressed,
	});
	const effectivePickerIntent: PlacementIntent =
		pickerOpen && (isAltPressed || isShiftPressed)
			? keyboardPlacementIntent
			: pickerIntent;
	const pickerSources = useMemo(
		() =>
			[
				{ source: "user" as const, label: "User authored" },
				{ source: "trickroom" as const, label: "Trickroom builtins" },
				{ source: "libraries" as const, label: "Other libraries" },
			] satisfies Array<{ source: PickerSource; label: string }>,
		[],
	);
	const libraryGroups = useMemo(
		() =>
			availableRegistries
				.filter((library) => library !== "trickroom")
				.map((library) => ({ library })),
		[],
	);
	const effectiveSelectedLibrary =
		selectedPickerSource === "trickroom" ? "trickroom" : selectedLibrary;
	const pickerSections = useMemo(
		() =>
			selectedPickerSource === "user"
				? getUserComponentPickerSections(
						systemComponentsQuery.data?.components ?? [],
						componentQuery,
					)
				: getRegistryPickerSections(effectiveSelectedLibrary, componentQuery),
		[
			componentQuery,
			effectiveSelectedLibrary,
			selectedPickerSource,
			systemComponentsQuery.data?.components,
		],
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
		resolveInsertionPlacement(effectivePickerIntent) !== null;
	const isPickerItemAllowed = useCallback(
		(item: PickerItem) => {
			const placement = resolveInsertionPlacement(effectivePickerIntent);
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
		[effectivePickerIntent, resolveInsertionPlacement, selectedLibrary],
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

	const addChosenSystemComponent = useCallback(
		async (component: SystemComponentSummary, intent: PlacementIntent) => {
			const placement = resolveInsertionPlacement(intent);
			if (!placement || !systemId || !component.currentVersion) {
				return;
			}

			try {
				const expansion = await expandSystemComponent(
					systemId,
					component.componentId,
					component.currentVersion,
				);
				if (
					!isRecipeSlotInsertionAllowed(
						designStore.get().entitiesById,
						placement.parentId,
						getRecipeSlotCandidateFromProps(expansion.root.props),
					)
				) {
					toast.error("This recipe slot does not allow that component.");
					return;
				}
				addNodeTree(expansion.root, placement.parentId, placement.index);
				setPickerOpen(false);
			} catch (error) {
				toast.error(
					error instanceof Error
						? error.message
						: "Failed to add the system component.",
				);
			}
		},
		[resolveInsertionPlacement, systemId],
	);

	const addBasicLayer = useCallback(
		(elementType: "container" | "text", intent: PlacementIntent) => {
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

	const handleAddLayer = useCallback(
		(
			elementType: "container" | "text",
			event: MouseEvent<HTMLButtonElement>,
		) => {
			addBasicLayer(elementType, getPlacementIntent(event));
		},
		[addBasicLayer],
	);

	const handleOpenPicker = (event: MouseEvent<HTMLButtonElement>) => {
		const intent = getPlacementIntent(event);
		if (!resolveInsertionPlacement(intent)) {
			return;
		}
		setPickerIntent(intent);
		setPickerOpen((isOpen) => !isOpen);
	};

	const repeatLast = useCallback(
		(intent: PlacementIntent) => {
			if (!lastAddedRef) {
				return;
			}

			const resolution =
				lastAddedRef.type === "component"
					? resolveRegistryComponent(
							lastAddedRef.library,
							lastAddedRef.component,
						)
					: resolveRegistryRecipe(lastAddedRef.library, lastAddedRef.recipe);
			if (resolution.status !== "known") {
				return;
			}

			if (lastAddedRef.type === "component") {
				addChosenComponent(lastAddedRef, intent);
			} else {
				addChosenRecipe(lastAddedRef, intent);
			}
		},
		[addChosenComponent, addChosenRecipe, lastAddedRef],
	);

	const handleRepeatLast = (event: MouseEvent<HTMLButtonElement>) => {
		if (!lastAddedRef) {
			return;
		}

		repeatLast(getPlacementIntent(event));
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

	const selectVisibleLayerAtIndex = useCallback(
		(index: number) => {
			const row = visibleLayerRows[index];
			if (!row) {
				return false;
			}

			selectElement(row.id);
			layerVirtualizer.scrollToIndex(index);
			return true;
		},
		[layerVirtualizer, visibleLayerRows],
	);

	const selectRelativeLayer = useCallback(
		(direction: 1 | -1) => {
			if (visibleLayerRows.length === 0) {
				return false;
			}

			const selectedIndex = selectedElement
				? visibleLayerRows.findIndex((row) => row.id === selectedElement.id)
				: -1;
			const nextIndex =
				selectedIndex === -1
					? direction === 1
						? 0
						: visibleLayerRows.length - 1
					: Math.min(
							visibleLayerRows.length - 1,
							Math.max(0, selectedIndex + direction),
						);

			return selectVisibleLayerAtIndex(nextIndex);
		},
		[selectedElement, selectVisibleLayerAtIndex, visibleLayerRows],
	);

	const expandOrEnterSelectedLayer = useCallback(() => {
		if (!selectedElement) {
			return selectVisibleLayerAtIndex(0);
		}

		const childIds = selectedElement.childIds ?? [];
		if (childIds.length === 0) {
			return false;
		}

		if (openById[selectedElement.id] === false) {
			setOpenById((current) => ({ ...current, [selectedElement.id]: true }));
			return true;
		}

		selectElement(childIds[0] ?? null);
		return true;
	}, [openById, selectVisibleLayerAtIndex, selectedElement]);

	const collapseOrSelectParentLayer = useCallback(() => {
		if (!selectedElement) {
			return false;
		}

		if (
			(selectedElement.childIds?.length ?? 0) > 0 &&
			openById[selectedElement.id] !== false
		) {
			setOpenById((current) => ({ ...current, [selectedElement.id]: false }));
			return true;
		}

		if (selectedElement.parentId) {
			selectElement(selectedElement.parentId);
			return true;
		}

		return false;
	}, [openById, selectedElement]);

	const moveSelectedLayerBy = useCallback(
		(direction: 1 | -1) => {
			if (!selectedElement) {
				return false;
			}

			const siblings =
				selectedElement.parentId === null
					? rootIds
					: (entitiesById[selectedElement.parentId]?.childIds ?? []);
			const currentIndex = siblings.indexOf(selectedElement.id);
			const nextIndex = currentIndex + direction;
			if (
				currentIndex === -1 ||
				nextIndex < 0 ||
				nextIndex >= siblings.length
			) {
				return false;
			}

			moveElement(selectedElement.id, selectedElement.parentId, nextIndex);
			return true;
		},
		[entitiesById, rootIds, selectedElement],
	);

	const handleLayerShortcut = useCallback(
		(event: KeyboardEvent) => {
			if (
				hasCommandModifier(event) &&
				event.shiftKey &&
				(event.key === "ArrowUp" || event.key === "ArrowDown")
			) {
				if (moveSelectedLayerBy(event.key === "ArrowDown" ? 1 : -1)) {
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
				handled = selectRelativeLayer(1);
			} else if (event.key === "ArrowUp" || key === "k") {
				handled = selectRelativeLayer(-1);
			} else if (event.key === "ArrowRight" || key === "l") {
				handled = expandOrEnterSelectedLayer();
			} else if (event.key === "ArrowLeft" || key === "h") {
				handled = collapseOrSelectParentLayer();
			} else if (event.key === "Home") {
				handled = selectVisibleLayerAtIndex(0);
			} else if (event.key === "End") {
				handled = selectVisibleLayerAtIndex(visibleLayerRows.length - 1);
			} else if (key === "r" && selectedElement) {
				setEditRequestId(selectedElement.id);
				handled = true;
			} else if (
				(event.key === "Backspace" || event.key === "Delete") &&
				selectedElement
			) {
				deleteElement(selectedElement.id);
				handled = true;
			} else if (!event.repeat && isShortcutLetter(event, "f")) {
				addBasicLayer("container", placementIntent);
				handled = true;
			} else if (!event.repeat && isShortcutLetter(event, "t")) {
				addBasicLayer("text", placementIntent);
				handled = true;
			} else if (!event.repeat && isShortcutLetter(event, "a")) {
				if (resolveInsertionPlacement(placementIntent)) {
					setPickerIntent(placementIntent);
					setPickerOpen(true);
					handled = true;
				}
			} else if (!event.repeat && isPeriodKey(event) && lastAddedRef) {
				repeatLast(placementIntent);
				handled = true;
			}

			if (handled) {
				event.preventDefault();
			}
		},
		[
			addBasicLayer,
			collapseOrSelectParentLayer,
			expandOrEnterSelectedLayer,
			lastAddedRef,
			moveSelectedLayerBy,
			repeatLast,
			resolveInsertionPlacement,
			selectRelativeLayer,
			selectVisibleLayerAtIndex,
			selectedElement,
			visibleLayerRows.length,
		],
	);

	useWindowKeyDown(handleLayerShortcut);

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
					<div className="px-1 font-mono text-[10px] text-slate-500">
						Insert {effectivePickerIntent}
					</div>
					<div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-1">
						<div className="flex flex-col gap-1">
							{pickerSources.map((source) => (
								<Button
									key={source.source}
									variant="block"
									className="flex w-full justify-start px-1 py-1 text-xs"
									onClick={() => setSelectedPickerSource(source.source)}
									isSelected={selectedPickerSource === source.source}
								>
									{source.label}
								</Button>
							))}
							{selectedPickerSource === "libraries"
								? libraryGroups.map((group) => (
										<Button
											key={group.library}
											variant="block"
											className="flex w-full justify-start px-1 py-1 pl-3 text-xs"
											onClick={() => setSelectedLibrary(group.library)}
											isSelected={selectedLibrary === group.library}
										>
											{group.library}
										</Button>
									))
								: null}
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
											const itemAllowed =
												item.type === "system-component"
													? Boolean(systemId && item.component.currentVersion)
													: isPickerItemAllowed(item);
											return (
												<Button
													key={
														item.type === "system-component"
															? `system-component:${item.component.componentId}`
															: item.type === "component"
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
													onClick={(event) => {
														const placementIntent =
															event.altKey || event.shiftKey
																? getShortcutPlacementIntent(event)
																: effectivePickerIntent;
														if (item.type === "system-component") {
															void addChosenSystemComponent(
																item.component,
																placementIntent,
															);
														} else if (item.type === "component") {
															addChosenComponent(
																{
																	library: effectiveSelectedLibrary,
																	component: item.component,
																},
																placementIntent,
															);
														} else {
															addChosenRecipe(
																{
																	library: effectiveSelectedLibrary,
																	recipe: item.recipe,
																},
																placementIntent,
															);
														}
													}}
												>
													<span className="min-w-0">
														<span className="block truncate font-medium">
															{item.type === "system-component"
																? item.component.name
																: item.definition.label}
														</span>
														<span className="block truncate text-slate-500">
															{item.type === "system-component"
																? `${item.component.slug} · v${item.component.currentVersion}`
																: item.type === "component"
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
									editRequestId={editRequestId}
									hasTopSeparator={row.hasTopSeparator}
									open={openById[row.id] !== false}
									onDraggingChange={handleLayerDraggingChange}
									onEditRequestHandled={() => setEditRequestId(null)}
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
