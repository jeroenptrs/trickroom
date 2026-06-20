import { useMemo, useState } from "react";
import { useDesignSystemId } from "../../../stores/design-store";
import type { ResolvedColorTokens } from "../../../utils/resolved-color-tokens";
import type {
	ColorProperty,
	ColorValue,
	PropertyEntry,
	PropertyModel,
} from "../../../utils/tailwind-classname";
import { ColorSwatch } from "../../ui/color-swatch";
import { ColorPickerPopover } from "./ColorPickerPopover";
import { computeColorPropertySlots } from "./colorPropertySlots";
import { appearanceFromIntent } from "./colorSwatchAppearance";
import {
	AddOverrideMenu,
	PeekPopover,
	PropertyRow,
	SlotRow,
} from "./OverrideRows";
import { buildOverrideOptions, useBreakpointNames } from "./styleOverrides";
import { useStyleScope } from "./styleScope";
import { useSectionRow } from "./styleSectionRows";

type ColorPropertyControlProps = {
	label: string;
	property: ColorProperty;
	model: PropertyModel;
	resolved: ResolvedColorTokens;
	/** Offer this property as a dashed ghost chip while unset (see StyleSection). */
	likely?: boolean;
	onSet: (variants: string[], value: ColorValue) => void;
	onClear: (variants: string[]) => void;
	/** Clears every given variant chain in one folded mutation — the row-level
	 * × (remove property) gesture. */
	onClearAll: (variantChains: string[][]) => void;
};

/**
 * Quiet, override-aware color row (right-rail todo 571): same shell as
 * {@link OverrideRows} — bare swatch field editing the active scope's slot,
 * the per-slot override editor in a peek popover behind the cross-scope dot,
 * section registration for set-only rendering, and a row-level ×. The control
 * itself stays a ColorPickerPopover trigger because color values are
 * structured (`ColorValue`), not utility-body strings.
 */
export function ColorPropertyControl({
	label,
	property,
	model,
	resolved,
	likely = false,
	onSet,
	onClear,
	onClearAll,
}: ColorPropertyControlProps) {
	const [draftVariants, setDraftVariants] = useState<string[]>([]);
	const systemId = useDesignSystemId();
	const breakpoints = useBreakpointNames(systemId);
	const styleScope = useStyleScope();

	const slots = useMemo(
		() => computeColorPropertySlots(model, property, draftVariants),
		[model, property, draftVariants],
	);

	const setSlots = slots.filter((slot) => slot.entry !== undefined);
	const activeEntry = slots.find(
		(slot) => slot.variantKey === styleScope.scope,
	)?.entry;
	const isSet = setSlots.length > 0;
	const visible = useSectionRow({ id: property, label, isSet, likely });

	const usedVariantKeys = useMemo(
		() => new Set(slots.map((slot) => slot.variantKey).filter(Boolean)),
		[slots],
	);
	const overrideOptions = useMemo(
		() => buildOverrideOptions(breakpoints, usedVariantKeys),
		[breakpoints, usedVariantKeys],
	);

	const crossScopeCount = setSlots.filter(
		(slot) => slot.variantKey !== styleScope.scope,
	).length;

	function handleSet(variants: string[], value: ColorValue) {
		onSet(variants, value);
		setDraftVariants((prev) => prev.filter((v) => v !== variants.join(":")));
	}

	function handleClear(variants: string[]) {
		onClear(variants);
		setDraftVariants((prev) => prev.filter((v) => v !== variants.join(":")));
	}

	if (!visible) return null;

	return (
		<PropertyRow
			label={label}
			onClear={
				isSet ? () => onClearAll(setSlots.map((slot) => slot.variants)) : null
			}
			clearLabel={`Remove ${label.toLowerCase()}`}
			peek={
				<PeekPopover
					label={label}
					heading={`${label} overrides`}
					scope={styleScope.scope}
					crossScopeCount={crossScopeCount}
					idleTitle={`${label}: add override`}
					headerActions={
						overrideOptions.length > 0 ? (
							<AddOverrideMenu
								options={overrideOptions}
								onAdd={(value) =>
									setDraftVariants((prev) =>
										prev.includes(value) ? prev : [...prev, value],
									)
								}
							/>
						) : null
					}
				>
					{slots.map(({ variantKey, variants, entry }) => (
						<SlotRow
							key={variantKey || "base"}
							variantKey={variantKey}
							activeScope={styleScope.scope}
							onClear={entry ? () => handleClear(variants) : null}
							clearLabel={`Clear ${variantKey || "base"} ${label.toLowerCase()}`}
						>
							<div className="min-w-0 flex-1">
								<ColorSlotTrigger
									resolved={resolved}
									entry={entry}
									onPick={(value) => handleSet(variants, value)}
									onClear={() => handleClear(variants)}
								/>
							</div>
						</SlotRow>
					))}
				</PeekPopover>
			}
		>
			<ColorSlotTrigger
				field
				resolved={resolved}
				entry={activeEntry}
				onPick={(value) => handleSet(styleScope.variants, value)}
				onClear={() => handleClear(styleScope.variants)}
			/>
		</PropertyRow>
	);
}

/**
 * Swatch + token name as a ColorPickerPopover trigger; `field` renders it as
 * a quiet-row field shell (the bare control), without it the compact inline
 * form used by peek slot rows.
 */
function ColorSlotTrigger({
	resolved,
	entry,
	field = false,
	onPick,
	onClear,
}: {
	resolved: ResolvedColorTokens;
	entry: PropertyEntry | undefined;
	field?: boolean;
	onPick: (value: ColorValue) => void;
	onClear: () => void;
}) {
	const appearance = entry
		? appearanceFromIntent(entry.intent, resolved)
		: ({ kind: "empty" } as const);
	const tokenLabel = entry ? labelForEntry(entry.intent) : "Pick color";
	const isWarning = appearance.kind === "color" && appearance.warning === true;

	return (
		<ColorPickerPopover
			resolved={resolved}
			onPick={onPick}
			onClear={onClear}
			triggerClassName={
				field ? "h-6 w-full min-w-0 bg-slate-200/60 px-1.5 py-0" : undefined
			}
			trigger={
				<span
					className="flex min-w-0 flex-row items-center gap-1.5"
					data-warning={isWarning ? "true" : undefined}
				>
					<ColorSwatch appearance={appearance} title={tokenLabel} size="sm" />
					<span
						className={`max-w-32 truncate text-xs ${entry ? "text-slate-950" : "text-slate-400"}`}
					>
						{tokenLabel}
					</span>
				</span>
			}
		/>
	);
}

function labelForEntry(intent: {
	token: string | null;
	keyword: string | null;
	arbitraryValue: string | null;
}): string {
	if (intent.keyword) return intent.keyword;
	if (intent.arbitraryValue) return intent.arbitraryValue;
	return intent.token ?? "Pick color";
}
