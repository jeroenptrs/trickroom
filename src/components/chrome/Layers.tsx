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
import {
	RiArtboard2Line as AddContainer,
	RiText as AddText,
	RiArrowRightSLine as ChevronRight,
} from "@remixicon/react";
import { useKeyHold } from "@tanstack/react-hotkeys";
import {
	type KeyboardEvent,
	type MouseEvent,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { tv } from "tailwind-variants";
import {
	addElement,
	designStore,
	moveElement,
	renameElement,
	selectElement,
	useDesignRoots,
	useElement,
	useLayerSummary,
	useSelectedElement,
} from "../../stores/design-store";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { ScrollArea } from "../ui/scroll-area";
import { Separator } from "../ui/separator";
import { Text } from "../ui/text";
import { LayerContextMenu } from "./LayerContextMenu";

const sublayer = tv({
	base: "h-fit ml-1.5 border-l border-gray-200 pl-1.5 overflow-y-hidden transition-[height]",
	variants: {
		open: {
			false: "h-0",
		},
	},
});

const icon = tv({
	base: "size-4 -ml-1 fill-gray-400 transition-transform translate-y-px",
	variants: {
		open: {
			true: "rotate-90 -translate-x-px",
		},
		isEditing: {
			true: "-mr-0.5",
		},
	},
});

const dropIndicator = tv({
	base: "pointer-events-none absolute inset-x-0 z-10",
	variants: {
		intent: {
			before: "-top-px h-0.5 bg-blue-500",
			after: "-bottom-px h-0.5 bg-blue-500",
			inside: "inset-y-0 border border-blue-400 bg-blue-100/50",
		},
	},
});

const layerRow = tv({
	base: "relative px-1 flex flex-row items-center leading-5",
	variants: {
		selected: {
			true: "bg-gray-200/60",
			false: "hover:bg-gray-100",
		},
		dragging: {
			true: "opacity-40",
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

const INDENT_PER_LEVEL = 12;
const trickroomComponent = (component: "container" | "text") => ({
	"data-trickroom-library": "trickroom" as const,
	"data-trickroom-component": component,
});

type LayerProps = {
	id: string;
	depth: number;
};

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

function Layer({ id, depth }: LayerProps) {
	const [open, setOpen] = useState(true);
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
	const hasChildren = layer.childIds.length > 0;
	const className = !hasChildren ? "-ml-0.5" : undefined;

	const toggleOpen = () => {
		setOpen((isOpen) => !isOpen);
	};

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

		return combine(
			draggable({
				element: row,
				dragHandle: label,
				getInitialData: () => ({ type: "trickroom-layer", id: layer.id }),
				onDragStart: () => {
					setDragging(true);
				},
				onDrop: () => setDragging(false),
			}),
			dropTargetForElements({
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
							block: layer.canHaveChildren ? [] : ["make-child"],
						},
					),
				onDrag: ({ self }) => updateDropIntent(self.data),
				onDragEnter: ({ self }) => updateDropIntent(self.data),
				onDropTargetChange: ({ self }) => updateDropIntent(self.data),
				onDragLeave: clearDropIntent,
				onDrop: clearDropIntent,
			}),
		);
	}, [
		clearDropIntent,
		depth,
		isEditing,
		layer.canHaveChildren,
		layer.id,
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
		<div className="flex flex-col">
			<LayerContextMenu id={id}>
				<div
					ref={rowRef}
					className={layerRow({ selected: layer.isSelected, dragging })}
				>
					{dropIntent ? (
						<div className={dropIndicator({ intent: dropIntent })} />
					) : null}
					{hasChildren ? (
						<UnstyledButton className="shrink-0" onClick={toggleOpen}>
							<ChevronRight className={icon({ open, isEditing })} />
						</UnstyledButton>
					) : null}
					{!isEditing ? (
						<UnstyledButton
							ref={labelRef}
							className="min-w-0 flex-1 text-start active:cursor-grabbing"
							onClick={selectLayer}
							onDoubleClick={editLayer}
							title={`Drag ${layer.name}`}
						>
							<span className="truncate text-black">{layer.name}</span>
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
			{hasChildren ? (
				<div className={sublayer({ open })}>
					{layer.childIds.map((childId) => (
						<Layer key={childId} id={childId} depth={depth + 1} />
					))}
				</div>
			) : null}
		</div>
	);
}

export function Layers() {
	const rootIds = useDesignRoots();
	const selectedElement = useSelectedElement();
	const selectedParent = useElement(selectedElement?.parentId ?? "");
	const isShiftPressed = useKeyHold("Shift");
	const isAltPressed = useKeyHold("Alt");
	const scrollViewportRef = useRef<HTMLDivElement>(null);

	const handleAddLayer = useCallback(
		(
			elementType: "container" | "text",
			event: MouseEvent<HTMLButtonElement>,
		) => {
			if (event.altKey) {
				if (!selectedElement || selectedElement.role === "text") {
					return;
				}

				addElement(
					trickroomComponent(elementType),
					selectedElement.id,
					selectedElement.childIds?.length ?? 0,
				);
				return;
			}

			if (!selectedElement) {
				addElement(
					trickroomComponent(elementType),
					null,
					isShiftPressed ? 0 : rootIds.length,
				);
				return;
			}

			const siblingIds =
				selectedElement.parentId === null
					? rootIds
					: (selectedParent?.childIds ?? []);
			const selectedIndex = siblingIds.indexOf(selectedElement.id);
			const insertionPoint =
				selectedIndex === -1 ? siblingIds.length : selectedIndex;

			addElement(
				trickroomComponent(elementType),
				selectedElement.parentId,
				isShiftPressed ? insertionPoint : insertionPoint + 1,
			);
		},
		[isShiftPressed, rootIds, selectedElement, selectedParent],
	);

	useEffect(() => {
		return monitorForElements({
			canMonitor: ({ source }) => isLayerDragData(source.data),
			onDrop: ({ source, location }) => {
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

	return (
		<div className="flex flex-col">
			<div className="flex flex-row items-center justify-between">
				<Text variant="label" className="ml-1">
					Layers
				</Text>
				<span className="flex flex-row">
					<Button
						variant="block"
						className="py-1"
						disabled={
							isAltPressed &&
							(!selectedElement || selectedElement?.role === "text")
						}
						onClick={(event) => handleAddLayer("container", event)}
					>
						<AddContainer className="fill-black size-4" />
					</Button>
					<Separator orientation="vertical" />
					<Button
						variant="block"
						className="py-1"
						disabled={
							isAltPressed &&
							(!selectedElement || selectedElement?.role === "text")
						}
						onClick={(event) => handleAddLayer("text", event)}
					>
						<AddText className="fill-black size-4" />
					</Button>
				</span>
			</div>
			<ScrollArea viewportRef={scrollViewportRef} className="h-20">
				{rootIds.map((rootId) => (
					<Layer key={rootId} id={rootId} depth={0} />
				))}
			</ScrollArea>
		</div>
	);
}
