import { useMemo } from "react";
import { useResolvedColorTokens } from "../../../hooks/useResolvedColorTokens";
import { useDesignSystemId } from "../../../stores/design-store";
import type { ClassLayer } from "../../../utils/class-layers";
import type { ModelOptions } from "../../../utils/tailwind-classname";
import { buildClassInventory } from "./classInventory";

/**
 * Compact read-out of how the current className breaks down: conflicts where
 * two classes target the same slot, classes that aren't recognized, and raw
 * arbitrary-property classes. Sits above the raw Classes editor as a safety
 * net (#419); the textarea remains the escape hatch.
 */
export function ClassInventoryPanel({
	className,
	layers,
}: {
	className: string;
	layers?: readonly ClassLayer[];
}) {
	const systemId = useDesignSystemId();
	const resolved = useResolvedColorTokens(systemId);
	const options = useMemo<ModelOptions>(
		() => ({ colorTokens: resolved.names }),
		[resolved.names],
	);
	const inventory = useMemo(
		() => buildClassInventory(layers ? { layers } : className, options),
		[className, layers, options],
	);

	if (inventory.items.length === 0) {
		return null;
	}

	return (
		<div className="flex flex-col gap-2 text-[11px]">
			{inventory.conflicts.length > 0 ? (
				<div className="flex flex-col gap-0.5 border-l-2 border-amber-300 bg-amber-50 px-2 py-1 text-amber-800">
					<span className="font-semibold">Conflicts · last wins</span>
					{inventory.conflicts.map((conflict) => (
						<span key={conflict.slot} className="truncate">
							{conflict.slot}: {conflict.raws.join(" → ")}
						</span>
					))}
				</div>
			) : null}

			{inventory.unknown.length > 0 ? (
				<ChipGroup
					title="Not recognized"
					items={inventory.unknown.map((item) => item.raw)}
				/>
			) : null}

			{inventory.arbitrary.length > 0 ? (
				<ChipGroup
					title="Arbitrary"
					items={inventory.arbitrary.map((item) => item.raw)}
				/>
			) : null}

			{inventory.hasLayerMetadata ? (
				<div className="flex flex-col gap-1">
					<span className="text-[10px] text-slate-400">Resolved sources</span>
					<div className="flex flex-wrap gap-1">
						{inventory.items.map((item) => (
							<span
								key={`${item.layerIndex}:${item.tokenIndex}:${item.raw}`}
								className={[
									"truncate bg-slate-100 px-1.5 py-0.5 font-mono text-[10px]",
									item.status === "shadowed"
										? "text-slate-400 line-through"
										: item.readOnly
											? "text-slate-600"
											: "text-slate-800",
								].join(" ")}
								title={`${item.sourceLabel}${item.readOnly ? " (read-only)" : ""}${item.status === "shadowed" ? " · shadowed" : ""}`}
							>
								<span className="font-sans text-[10px] text-slate-400">
									{item.sourceLabel}:{" "}
								</span>
								{item.raw}
							</span>
						))}
					</div>
				</div>
			) : null}

			<span className="text-[10px] text-slate-400">
				{inventory.managed.length} managed · {inventory.unknown.length}{" "}
				unrecognized · {inventory.arbitrary.length} arbitrary
				{inventory.shadowed.length > 0
					? ` · ${inventory.shadowed.length} shadowed`
					: ""}
			</span>
		</div>
	);
}

function ChipGroup({ title, items }: { title: string; items: string[] }) {
	return (
		<div className="flex flex-col gap-1">
			<span className="text-[10px] text-slate-400">{title}</span>
			<div className="flex flex-wrap gap-1">
				{items.map((item) => (
					<span
						key={item}
						className="truncate bg-slate-200/60 px-1.5 py-0.5 font-mono text-[10px] text-slate-700"
					>
						{item}
					</span>
				))}
			</div>
		</div>
	);
}
