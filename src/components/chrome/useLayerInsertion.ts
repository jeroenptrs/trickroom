import { useQuery } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import {
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
import { canInsertIntoRecipeBoundary } from "../../recipes/ownership";
import {
	getRecipeSlotCandidateFromProps,
	isRecipeSlotInsertionAllowed,
} from "../../recipes/slot-allowlist";
import {
	addElement,
	addNodeTree,
	addRecipe,
	type DesignEntity,
	designStore,
	useDesignSystemId,
	useElement,
	useLayerTreeSnapshot,
	useSelectedElement,
} from "../../stores/design-store";
import type {
	RecipeDefinition,
	RegistryComponentDefinition,
} from "../../types";
import {
	buildComponentGroupTree,
	flattenComponentGroupSections,
} from "../../utils/component-groups";
import type { ShortcutPlacementIntent } from "../../utils/editor-shortcuts";
import { canInsertIntoSystemComponentBoundary } from "../../utils/system-component-ownership";
import { useProjectScope } from "../contexts";

export type PlacementIntent = ShortcutPlacementIntent;

type InsertionPlacement = {
	parentId: string | null;
	index: number;
};

export type PickerItem =
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

export type UserComponentPickerItem = {
	type: "system-component";
	component: SystemComponentSummary;
};

export type PickerSection = {
	title: string;
	items: PickerItem[];
};

export type UserComponentPickerSection = {
	/** Slash-delimited group path, or "" for ungrouped components. */
	groupPath: string;
	items: UserComponentPickerItem[];
};

export type LastAddedRef =
	| ({ type: "component" } & ComponentRef)
	| ({ type: "recipe" } & RecipeRef);

const componentRef = (library: string, component: string) => ({
	"data-trickroom-library": library,
	"data-trickroom-component": component,
});

const trickroomComponent = (component: "container" | "text") =>
	componentRef("trickroom", component);

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
	const publishable = components
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
		});

	// Group paths drive both the rail's folder tree and these menu sections, so
	// the menu stays search-first (flat, fuzzy) while still labeling provenance.
	return flattenComponentGroupSections(
		buildComponentGroupTree(publishable),
	).map((section) => ({
		groupPath: section.path,
		items: section.components.map((component) => ({
			type: "system-component" as const,
			component,
		})),
	}));
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

export type LayerInsertion = ReturnType<typeof useLayerInsertion>;

/**
 * Shared insertion engine for the layer rail toolbar and the add-layer command
 * menu. Owns `lastAddedRef` plus the placement resolution and add actions so
 * both surfaces stay in lockstep. Add actions return whether the insertion
 * happened, letting the caller (e.g. the command menu) decide when to close.
 */
export function useLayerInsertion() {
	const { rootIds } = useLayerTreeSnapshot();
	const selectedElement = useSelectedElement();
	const selectedParent = useElement(selectedElement?.parentId ?? "");
	const systemId = useDesignSystemId();
	const projectScope = useProjectScope();
	const systemComponentsQuery = useQuery({
		...systemComponentsQueryOptions(systemId ?? "", projectScope),
		enabled: Boolean(systemId),
	});
	const [lastAddedRef, setLastAddedRef] = useState<LastAddedRef | null>(null);

	const resolveInsertionPlacement = useCallback(
		(intent: PlacementIntent) =>
			resolveLayerInsertionPlacement({
				intent,
				rootIds,
				selectedElement,
				selectedParent,
				entitiesById: designStore.get().entitiesById,
			}),
		[rootIds, selectedElement, selectedParent],
	);

	const canInsert = useCallback(
		(intent: PlacementIntent) => resolveInsertionPlacement(intent) !== null,
		[resolveInsertionPlacement],
	);

	const isItemAllowed = useCallback(
		(item: PickerItem, library: RegistryId, intent: PlacementIntent) => {
			const placement = resolveInsertionPlacement(intent);
			if (!placement) {
				return false;
			}

			return isRecipeSlotInsertionAllowed(
				designStore.get().entitiesById,
				placement.parentId,
				item.type === "recipe"
					? { kind: "recipe", library, recipe: item.recipe }
					: { kind: "component", library, component: item.component },
			);
		},
		[resolveInsertionPlacement],
	);

	const addBasicLayer = useCallback(
		(elementType: "container" | "text", intent: PlacementIntent) => {
			const placement = resolveInsertionPlacement(intent);
			if (!placement) {
				return false;
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
			return true;
		},
		[resolveInsertionPlacement],
	);

	const addComponent = useCallback(
		(ref: ComponentRef, intent: PlacementIntent) => {
			const placement = resolveInsertionPlacement(intent);
			if (!placement) {
				return false;
			}

			addElement(
				componentRef(ref.library, ref.component),
				placement.parentId,
				placement.index,
			);
			setLastAddedRef({ type: "component", ...ref });
			return true;
		},
		[resolveInsertionPlacement],
	);

	const addRecipeInstance = useCallback(
		(ref: RecipeRef, intent: PlacementIntent) => {
			const placement = resolveInsertionPlacement(intent);
			if (!placement) {
				return false;
			}

			addRecipe(ref, placement.parentId, placement.index);
			setLastAddedRef({ type: "recipe", ...ref });
			return true;
		},
		[resolveInsertionPlacement],
	);

	const addSystemComponent = useCallback(
		async (component: SystemComponentSummary, intent: PlacementIntent) => {
			const placement = resolveInsertionPlacement(intent);
			if (!placement || !systemId || !component.currentVersion) {
				return false;
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
					return false;
				}
				addNodeTree(expansion.root, placement.parentId, placement.index);
				return true;
			} catch (error) {
				toast.error(
					error instanceof Error
						? error.message
						: "Failed to add the system component.",
				);
				return false;
			}
		},
		[resolveInsertionPlacement, systemId],
	);

	const repeatLast = useCallback(
		(intent: PlacementIntent) => {
			if (!lastAddedRef) {
				return false;
			}

			const resolution =
				lastAddedRef.type === "component"
					? resolveRegistryComponent(
							lastAddedRef.library,
							lastAddedRef.component,
						)
					: resolveRegistryRecipe(lastAddedRef.library, lastAddedRef.recipe);
			if (resolution.status !== "known") {
				return false;
			}

			return lastAddedRef.type === "component"
				? addComponent(lastAddedRef, intent)
				: addRecipeInstance(lastAddedRef, intent);
		},
		[addComponent, addRecipeInstance, lastAddedRef],
	);

	return {
		systemId,
		systemComponents: systemComponentsQuery.data?.components ?? [],
		lastAddedRef,
		resolveInsertionPlacement,
		canInsert,
		isItemAllowed,
		addBasicLayer,
		addComponent,
		addRecipe: addRecipeInstance,
		addSystemComponent,
		repeatLast,
	};
}
