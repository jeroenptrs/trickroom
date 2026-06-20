import { Menu } from "@base-ui/react/menu";
import { Plus, Trash2 } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { useDesignSystemId } from "../../../stores/design-store";
import type {
	PropertyEntry,
	PropertyKey,
	PropertyModel,
} from "../../../utils/tailwind-classname";
import { Button } from "../../ui/button";
import { computePropertySlots } from "./propertySlots";
import {
	buildOverrideOptions,
	OVERRIDE_GROUP_LABELS,
	type OverrideGroup,
	type OverrideOption,
	useBreakpointNames,
} from "./styleOverrides";

/** Per-slot API handed to the caller's control renderer. */
export type OverrideRowSlot = {
	/** Variant chain for this row (`[]` = base). */
	variants: string[];
	/** Joined variant key (`""` = base, `"hover"`, `"md:hover"`). */
	variantKey: string;
	/** Current value for matching a control's active option (`null` = unset). */
	value: string | null;
	/** Write a payload into this slot, or clear it when passed `null`. */
	apply: (payload: string | null) => void;
};

type OverrideRowsProps = {
	label: string;
	model: PropertyModel;
	property: PropertyKey;
	/** Reads the row's display value from a model entry (domain-specific). */
	readValue: (entry: PropertyEntry | undefined) => string | null;
	/** Applies a payload (or clears with `null`) for a given variant chain. */
	onApply: (variants: string[], payload: string | null) => void;
	renderControl: (slot: OverrideRowSlot) => ReactNode;
};

/**
 * Domain-agnostic property-local override rows (#403): a base row first, then
 * a row per existing selector/breakpoint, then any draft rows the user adds,
 * with a grouped Add menu. The `readValue`/`onApply` callbacks let any domain
 * (style, spacing, …) reuse the same slot/draft/add-menu plumbing — see
 * `StyleOverrideRows` and `SpacingOverrideRows`.
 */
export function OverrideRows({
	label,
	model,
	property,
	readValue,
	onApply,
	renderControl,
}: OverrideRowsProps) {
	const [draftVariants, setDraftVariants] = useState<string[]>([]);
	const systemId = useDesignSystemId();
	const breakpoints = useBreakpointNames(systemId);

	const slots = useMemo(
		() => computePropertySlots(model, property, draftVariants),
		[model, property, draftVariants],
	);

	const usedVariantKeys = useMemo(
		() => new Set(slots.map((slot) => slot.variantKey).filter(Boolean)),
		[slots],
	);
	const overrideOptions = useMemo(
		() => buildOverrideOptions(breakpoints, usedVariantKeys),
		[breakpoints, usedVariantKeys],
	);

	function apply(variants: string[], payload: string | null) {
		onApply(variants, payload);
		setDraftVariants((prev) =>
			prev.filter((draft) => draft !== variants.join(":")),
		);
	}

	return (
		<div className="flex flex-col gap-1">
			<div className="flex flex-row items-center justify-between">
				<span className="px-0.5 text-[10px] text-slate-400">{label}</span>
				{overrideOptions.length > 0 ? (
					<AddOverrideMenu
						options={overrideOptions}
						onAdd={(value) =>
							setDraftVariants((prev) =>
								prev.includes(value) ? prev : [...prev, value],
							)
						}
					/>
				) : null}
			</div>
			<div className="flex flex-col gap-1">
				{slots.map(({ variantKey, variants, entry }) => {
					const value = readValue(entry);
					return (
						<div
							key={variantKey || "base"}
							className="flex items-center gap-1.5"
						>
							<span
								className={
									variantKey
										? "w-12 shrink-0 truncate px-1.5 py-0.5 text-center text-[9px] text-slate-500 inset-shadow-[0_0_0_1px] inset-shadow-slate-200"
										: "w-12 shrink-0 truncate bg-cyan-100 px-1.5 py-0.5 text-center text-[9px] font-medium text-cyan-900"
								}
							>
								{variantKey || "Base"}
							</span>
							<div className="min-w-0 flex-1">
								{renderControl({
									variants,
									variantKey,
									value,
									apply: (payload) => apply(variants, payload),
								})}
							</div>
							{entry ? (
								<Button
									type="button"
									variant="block"
									aria-label={`Clear ${variantKey || "base"} ${label.toLowerCase()}`}
									title={`Clear ${variantKey || "base"} ${label.toLowerCase()}`}
									onClick={() => apply(variants, null)}
									className="shrink-0 p-0.5"
								>
									<Trash2 className="size-3 text-slate-950" />
								</Button>
							) : null}
						</div>
					);
				})}
			</div>
		</div>
	);
}

function AddOverrideMenu({
	options,
	onAdd,
}: {
	options: readonly OverrideOption[];
	onAdd: (value: string) => void;
}) {
	const groups: OverrideGroup[] = ["selector", "breakpoint", "mode"];
	return (
		<Menu.Root modal>
			<Menu.Trigger
				render={(props, { open }) => (
					<Button
						{...props}
						variant="block"
						isSelected={open}
						className="p-0.5"
						aria-label="Add override"
						title="Add override"
					/>
				)}
			>
				<Plus className="size-3 text-slate-900" />
			</Menu.Trigger>
			<Menu.Portal>
				<Menu.Positioner sideOffset={4} align="end">
					<Menu.Popup className="flex min-w-32 flex-col bg-slate-50 p-1 inset-shadow-[0_0_0_1px] inset-shadow-slate-200">
						{groups.map((group) => {
							const groupOptions = options.filter(
								(option) => option.group === group,
							);
							if (groupOptions.length === 0) return null;
							return (
								<div key={group} className="flex flex-col">
									<span className="px-2 pt-1 pb-0.5 text-[9px] uppercase tracking-wide text-slate-400">
										{OVERRIDE_GROUP_LABELS[group]}
									</span>
									{groupOptions.map((option) => (
										<Menu.Item
											key={option.value}
											className="cursor-default px-2 py-0.5 text-left text-xs data-[highlighted]:bg-slate-200/60"
											onClick={() => onAdd(option.value)}
										>
											{option.value}
										</Menu.Item>
									))}
								</div>
							);
						})}
					</Menu.Popup>
				</Menu.Positioner>
			</Menu.Portal>
		</Menu.Root>
	);
}
