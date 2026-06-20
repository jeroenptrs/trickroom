import { Lock, Pencil } from "lucide-react";
import { useMemo } from "react";
import { useResolvedColorTokens } from "../../../hooks/useResolvedColorTokens";
import { useResolvedCustomUtilities } from "../../../hooks/useResolvedCustomUtilities";
import { useDesignSystemId } from "../../../stores/design-store";
import {
	type ClassLayer,
	splitClassLayerTokens,
} from "../../../utils/class-layers";
import type { ModelOptions } from "../../../utils/tailwind-classname";
import { Chip } from "../../ui/chip";
import { ClassCombobox } from "./ClassCombobox";
import { buildClassInventory, type InventoryItem } from "./classInventory";

type Tier = "recipe" | "component" | "instance";

function getLayerTier(source: ClassLayer["source"]): Tier {
	if (source === "registry-base") return "recipe";
	if (source === "instance-override" || source === "authored")
		return "instance";
	return "component";
}

function tierLabel(tier: Tier, source?: ClassLayer["source"]): string {
	if (tier === "recipe") return "Recipe";
	if (tier === "component") {
		if (source === "system-variant") return "Variant";
		if (source === "system-compound-variant") return "Compound variant";
		return "Component";
	}
	return "Instance · editable";
}

type TierGroup = {
	tier: Tier;
	label: string;
	classes: string;
};

function groupLayers(layers: readonly ClassLayer[]): TierGroup[] {
	const byTier = new Map<Tier, { label: string; parts: string[] }>();
	const tierOrder: Tier[] = ["recipe", "component", "instance"];

	for (const layer of layers) {
		const tier = getLayerTier(layer.source);
		const existing = byTier.get(tier);
		if (existing) {
			if (layer.className) existing.parts.push(layer.className);
		} else {
			byTier.set(tier, {
				label: tierLabel(tier, layer.source),
				parts: layer.className ? [layer.className] : [],
			});
		}
	}

	return tierOrder
		.filter((t) => byTier.has(t))
		.map((t) => {
			const entry = byTier.get(t);
			return {
				tier: t,
				label: entry?.label ?? t,
				classes: entry?.parts.join(" ") ?? "",
			};
		});
}

function instanceChipTone(item: InventoryItem): "base" | "scope" | "struck" {
	if (item.status === "shadowed") return "struck";
	if ((item.variantKey ?? "") !== "") return "scope";
	return "base";
}

function InstanceChip({
	item,
	editable,
	onRemove,
}: {
	item: InventoryItem;
	editable: boolean;
	onRemove: (cls: string) => void;
}) {
	// The instance tier card is cyan-50, so chips sit on white regardless of tone.
	const chip = (
		<Chip
			tone={instanceChipTone(item)}
			className={`select-none bg-white${editable ? " cursor-pointer" : ""}`}
		>
			{item.raw}
		</Chip>
	);
	const title =
		item.status === "shadowed" ? "Shadowed — click to remove" : undefined;
	if (editable) {
		return (
			<button
				type="button"
				title={title}
				onClick={() => onRemove(item.raw)}
				className="focus-visible:outline-none focus-visible:inset-shadow-[0_0_0_1px] focus-visible:inset-shadow-cyan-500"
			>
				{chip}
			</button>
		);
	}
	return <span title={title}>{chip}</span>;
}

function ConflictHint({
	items,
	onRemove,
}: {
	items: InventoryItem[];
	onRemove: (cls: string) => void;
}) {
	const shadowed = items.filter((i) => i.status === "shadowed");
	if (shadowed.length === 0) return null;

	return (
		<div className="flex flex-col gap-0.5">
			{shadowed.map((item) => (
				<button
					key={item.raw}
					type="button"
					onClick={() => onRemove(item.raw)}
					className="flex items-center gap-1.5 text-left"
				>
					<span className="text-xs text-amber-700">
						<span className="font-mono">{item.raw}</span> is shadowed — click to
						remove
					</span>
				</button>
			))}
		</div>
	);
}

/**
 * Classes tab content (right-rail P5): provenance stack from classInventoryLayers,
 * per-class chip removal for the editable instance tier, conflict lint, and
 * a ClassCombobox for adding new classes.
 */
export function ClassCompositionPanel({
	className,
	layers,
	editable,
	onChangeClassName,
}: {
	/** The editable portion — the instance-layer className string. */
	className: string;
	/** Full resolved layer stack from resolveAttachedComponentClassInventoryLayers. */
	layers?: readonly ClassLayer[];
	editable: boolean;
	onChangeClassName: (next: string) => void;
}) {
	const systemId = useDesignSystemId();
	const resolved = useResolvedColorTokens(systemId);
	const customUtilityRoots = useResolvedCustomUtilities(systemId);
	const options = useMemo<ModelOptions>(
		() => ({ colorTokens: resolved.names, ...customUtilityRoots }),
		[resolved.names, customUtilityRoots],
	);

	const inventory = useMemo(
		() => buildClassInventory(layers ? { layers } : className, options),
		[className, layers, options],
	);

	const groups = useMemo(() => (layers ? groupLayers(layers) : null), [layers]);

	// Instance-layer items from the inventory (for the chip display + conflict).
	const instanceItems = useMemo<InventoryItem[]>(() => {
		if (!layers) {
			// Free element: all inventory items are the instance tier.
			return inventory.items;
		}
		return inventory.items.filter((item) => !item.readOnly);
	}, [inventory.items, layers]);

	function removeToken(token: string) {
		const next = splitClassLayerTokens(className)
			.filter((t) => t !== token)
			.join(" ");
		onChangeClassName(next);
	}

	function appendClass(cls: string) {
		const current = className.trim();
		onChangeClassName(current ? `${current} ${cls}` : cls);
	}

	return (
		<div className="flex flex-col">
			{/* Provenance stack (only shown for component instances with layers) */}
			{groups ? (
				<div className="flex flex-col gap-2 border-b border-slate-200 px-3 py-2.5">
					<div className="flex items-center gap-1">
						<span className="text-xs font-semibold text-slate-700">
							Composition
						</span>
					</div>

					{groups.map((group) =>
						group.tier === "instance" ? (
							<div
								key="instance"
								className="flex flex-col gap-1 border border-cyan-200 bg-cyan-50 p-2"
							>
								<div className="flex items-center gap-1">
									<span className="text-xs font-medium text-cyan-700">
										{group.label}
									</span>
									<Pencil className="ml-auto size-3 text-cyan-600" />
								</div>
								<div className="flex flex-wrap gap-1">
									{instanceItems.map((item) => (
										<InstanceChip
											key={`${item.layerIndex}:${item.tokenIndex}:${item.raw}`}
											item={item}
											editable={editable}
											onRemove={removeToken}
										/>
									))}
									{instanceItems.length === 0 ? (
										<span className="text-xs text-cyan-400">No overrides</span>
									) : null}
								</div>
							</div>
						) : (
							<div
								key={group.tier}
								className="flex flex-col gap-1 border border-slate-200 p-2"
							>
								<div className="flex items-center gap-1">
									<span className="text-xs text-slate-400">{group.label}</span>
									<Lock className="ml-auto size-3 text-slate-300" />
								</div>
								<span className="truncate font-mono text-xs text-slate-400">
									{group.classes || "—"}
								</span>
							</div>
						),
					)}
				</div>
			) : null}

			{/* Instance-tier editor for free elements (no composition stack) */}
			{!groups && instanceItems.length > 0 ? (
				<div className="flex flex-col gap-1 border-b border-slate-200 px-3 py-2.5">
					<div className="flex flex-wrap gap-1">
						{instanceItems.map((item) => (
							<InstanceChip
								key={`${item.layerIndex}:${item.tokenIndex}:${item.raw}`}
								item={item}
								editable={editable}
								onRemove={removeToken}
							/>
						))}
					</div>
				</div>
			) : null}

			{/* Conflict lint + add-class combobox */}
			{editable ? (
				<div className="flex flex-col gap-1.5 px-3 py-2.5">
					<ConflictHint items={instanceItems} onRemove={removeToken} />
					<ClassCombobox onAppend={appendClass} />
				</div>
			) : null}
		</div>
	);
}
