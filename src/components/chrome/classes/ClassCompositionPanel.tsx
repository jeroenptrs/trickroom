import { useMemo } from "react";
import { useResolvedColorTokens } from "../../../hooks/useResolvedColorTokens";
import { useResolvedCustomUtilities } from "../../../hooks/useResolvedCustomUtilities";
import type { ClassLayer } from "../../../utils/class-layers";
import { findClassesRemovedByMerge } from "../../../utils/class-merge";
import type { ClassNameOptions } from "../../../utils/tailwind-classname";
import { useClassMergeContext } from "../../stage/class-merge-context";
import { Chip } from "../../ui/chip";
import { ClassField, type ClassFieldHint } from "./ClassField";
import { buildClassInventory, type InventoryItem } from "./classInventory";

function layerLabel(layer: ClassLayer): string {
	const { metadata } = layer;
	switch (layer.source) {
		case "registry-base":
			return "Recipe";
		case "system-template":
			return "Component";
		case "system-variant":
			return metadata?.axis && metadata.value
				? `Variant · ${metadata.axis}: ${metadata.value}`
				: "Variant";
		case "system-compound-variant":
			return "Compound variant";
		case "materialized-snapshot":
			return "Materialized";
		case "instance-override":
		case "authored":
			return "Instance";
	}
}

type ReadOnlyLayerGroup = {
	key: string;
	label: string;
	items: InventoryItem[];
};

function groupReadOnlyItems(
	layers: readonly ClassLayer[],
	items: readonly InventoryItem[],
): ReadOnlyLayerGroup[] {
	const groups: ReadOnlyLayerGroup[] = [];
	for (const [index, layer] of layers.entries()) {
		const layerItems = items.filter(
			(item) => item.readOnly && item.layerIndex === index,
		);
		if (layerItems.length > 0) {
			groups.push({
				key: String(index),
				label: layerLabel(layer),
				items: layerItems,
			});
		}
	}
	return groups;
}

const REMOVED_BY_MERGE = "is removed when the classes merge";

function shadowedHints(items: readonly InventoryItem[]): ClassFieldHint[] {
	return items.flatMap((item) => {
		if (item.readOnly || item.status !== "shadowed") return [];
		const winner =
			item.shadowedBy !== undefined ? items[item.shadowedBy] : undefined;
		return [
			{
				token: item.raw,
				tone: "shadowed" as const,
				message: item.removedByMerge
					? `${REMOVED_BY_MERGE}: a later class overrides it`
					: winner
						? `is overridden by ${winner.raw}`
						: "is overridden by a later class",
				fix: { label: "remove", replacement: "" },
			},
		];
	});
}

function chipTitle(item: InventoryItem): string | undefined {
	if (item.removedByMerge) {
		return "Removed when the classes merge: a later class overrides it";
	}
	return item.status === "shadowed" ? "Overridden by a later class" : undefined;
}

/**
 * Class editing for one layer: read-only chips for the classes it inherits
 * (Recipe, Component, Variant), struck through where a later class wins, then
 * a free-text field for the classes this layer owns.
 */
export function ClassCompositionPanel({
	className,
	layers,
	systemId,
	label = "Classes",
	onChangeClassName,
}: {
	/** The editable portion: the layer's own (or instance override) className. */
	className: string;
	/** Full resolved layer stack when the layer inherits classes. */
	layers?: readonly ClassLayer[];
	systemId: string | null;
	label?: string;
	onChangeClassName: (next: string) => void;
}) {
	const resolved = useResolvedColorTokens(systemId);
	const customUtilityRoots = useResolvedCustomUtilities(systemId);
	const options = useMemo<ClassNameOptions>(
		() => ({ colorTokens: resolved.names, ...customUtilityRoots }),
		[resolved.names, customUtilityRoots],
	);
	// Component and override layers merge on the canvas like in code; the
	// classes that merging removes are struck through.
	const classMerge = useClassMergeContext().merge;
	const removedByMerge = useMemo(
		() =>
			layers && classMerge
				? findClassesRemovedByMerge(layers, classMerge)
				: undefined,
		[classMerge, layers],
	);
	const inventory = useMemo(
		() =>
			buildClassInventory(
				layers ? { layers } : className,
				options,
				removedByMerge,
			),
		[className, layers, options, removedByMerge],
	);
	const readOnlyGroups = useMemo(
		() => (layers ? groupReadOnlyItems(layers, inventory.items) : []),
		[layers, inventory.items],
	);
	const hints = useMemo(
		() => shadowedHints(inventory.items),
		[inventory.items],
	);

	return (
		<div className="flex flex-col gap-2">
			{readOnlyGroups.map((group) => (
				<div key={group.key} className="flex flex-col gap-1">
					<span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
						{group.label}
					</span>
					<div className="flex flex-wrap gap-1">
						{group.items.map((item) => (
							<Chip
								key={`${item.layerIndex}:${item.tokenIndex}`}
								tone={item.status === "shadowed" ? "struck" : "base"}
								title={chipTitle(item)}
							>
								{item.raw}
							</Chip>
						))}
					</div>
				</div>
			))}
			<div className="flex flex-col gap-1">
				{readOnlyGroups.length > 0 ? (
					<span className="text-[10px] font-semibold uppercase tracking-wider text-cyan-700">
						{label}
					</span>
				) : null}
				<ClassField
					value={className}
					onCommit={onChangeClassName}
					systemId={systemId}
					label={label}
					hints={hints}
				/>
			</div>
		</div>
	);
}
