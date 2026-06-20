import { Menu } from "@base-ui/react/menu";
import { Plus, X } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { useDesignSystemId } from "../../../stores/design-store";
import type {
	PropertyEntry,
	PropertyKey,
	PropertyModel,
} from "../../../utils/tailwind-classname";
import { Button } from "../../ui/button";
import { dropdownMenu } from "../../ui/menu";
import { Popover, PopoverContent, PopoverTrigger } from "../../ui/popover";
import { StatusDot } from "../../ui/status-dot";
import { computePropertySlots } from "./propertySlots";
import {
	buildOverrideOptions,
	OVERRIDE_GROUP_LABELS,
	type OverrideGroup,
	type OverrideOption,
	useBreakpointNames,
} from "./styleOverrides";
import { useStyleScope } from "./styleScope";
import { useSectionRow } from "./styleSectionRows";

const menuSlots = dropdownMenu();

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
	/** Render the base control on one line without the label header — for
	 * controls that carry their own label (e.g. `ValueField`). */
	inline?: boolean;
	/** Offer this property as a dashed ghost chip while unset (see StyleSection). */
	likely?: boolean;
	/** Extra classes on the row root — e.g. `min-w-0 flex-1` inside a row pair. */
	className?: string;
	/** Reads the row's display value from a model entry (domain-specific). */
	readValue: (entry: PropertyEntry | undefined) => string | null;
	/** Applies a payload (or clears with `null`) for a given variant chain. */
	onApply: (variants: string[], payload: string | null) => void;
	/** Clears every given variant chain in one mutation — the row-level ×
	 * (remove property) gesture. Chains must be folded into a single
	 * `onChange`, hence not a loop over `onApply`. */
	onClearAll: (variantChains: string[][]) => void;
	renderControl: (slot: OverrideRowSlot) => ReactNode;
};

/**
 * Quiet, override-aware property row (right-rail P1): the bare control (label
 * + control, no slot chrome) edits one slot, and the per-slot override editor
 * — base row, one row per selector/breakpoint, drafts, grouped Add menu —
 * lives in a peek popover behind a square dot that lights up when the
 * property holds values outside the edited slot.
 * Which slot the bare control edits comes from the panel-level style scope
 * (right-rail P3): the base slot by default, or the active scope's variant
 * chain when a `ScopeBar` scope is selected — the same chains the peek
 * writes, so the scope bar adds no new data path.
 * The `readValue`/`onApply` callbacks let any domain (style, spacing, …) reuse
 * the same slot/draft plumbing — see `StyleOverrideRows`/`SpacingOverrideRows`.
 * Rows also register with the enclosing `StyleSection` and hide while unset
 * (set-only rendering); outside a section they always render.
 */
export function OverrideRows({
	label,
	model,
	property,
	inline = false,
	likely = false,
	className,
	readValue,
	onApply,
	onClearAll,
	renderControl,
}: OverrideRowsProps) {
	const slots = useMemo(
		() => computePropertySlots(model, property, []),
		[model, property],
	);

	const styleScope = useStyleScope();
	const activeEntry = slots.find(
		(slot) => slot.variantKey === styleScope.scope,
	)?.entry;
	const isSet = slots.some((slot) => slot.entry !== undefined);
	const visible = useSectionRow({ id: property, label, isSet, likely });

	function clearAll() {
		onClearAll(slots.filter((slot) => slot.entry).map((slot) => slot.variants));
	}

	if (!visible) return null;

	return (
		<PropertyRow
			label={label}
			inline={inline}
			className={className}
			onClear={isSet ? clearAll : null}
			clearLabel={`Remove ${label}`}
			peek={
				<PropertyOverridePeek
					label={label}
					model={model}
					property={property}
					readValue={readValue}
					onApply={onApply}
					renderControl={renderControl}
				/>
			}
		>
			<div className="min-w-0 flex-1">
				{renderControl({
					variants: styleScope.variants,
					variantKey: styleScope.scope,
					value: readValue(activeEntry),
					apply: (payload) => onApply(styleScope.variants, payload),
				})}
			</div>
		</PropertyRow>
	);
}

/**
 * Shared shell of a quiet property row. Default layout puts the label in a
 * fixed left column beside the control (board 02: a row reads as a property
 * you're setting, not a subsection), with the hover-revealed × and the peek
 * at the row's end. `inline` drops the label column for self-labelled
 * controls (TokenField); `stacked` keeps the label as a header line above
 * the control for full-width spatial blocks (box model).
 */
export function PropertyRow({
	label,
	inline = false,
	stacked = false,
	className,
	onClear,
	clearLabel,
	peek,
	children,
}: {
	label: string;
	inline?: boolean;
	stacked?: boolean;
	/** Extra classes on the row root — e.g. `min-w-0 flex-1` inside a row pair. */
	className?: string;
	/** Row-level remove gesture; `null` hides the button (nothing set). */
	onClear: (() => void) | null;
	clearLabel?: string;
	peek: ReactNode;
	children: ReactNode;
}) {
	const clearButton = onClear ? (
		<Button
			type="button"
			variant="block"
			aria-label={clearLabel ?? `Remove ${label}`}
			title={clearLabel ?? `Remove ${label}`}
			onClick={onClear}
			className="shrink-0 p-1 opacity-0 transition-opacity focus-visible:opacity-100 group-focus-within/property:opacity-100 group-hover/property:opacity-100"
		>
			<X className="size-3 text-slate-950" />
		</Button>
	) : null;

	if (inline) {
		return (
			<div
				className={`group/property flex min-w-0 items-center gap-1.5${className ? ` ${className}` : ""}`}
			>
				{children}
				{clearButton}
				{peek}
			</div>
		);
	}

	if (stacked) {
		return (
			<div
				className={`group/property flex flex-col gap-1${className ? ` ${className}` : ""}`}
			>
				<div className="flex flex-row items-center justify-between">
					<span className="px-0.5 text-[10px] text-slate-400">{label}</span>
					<div className="flex items-center gap-0.5">
						{clearButton}
						{peek}
					</div>
				</div>
				{children}
			</div>
		);
	}

	// items-start so tall controls (alignment matrix) hang below the first
	// line; the label's leading and the actions' h-6 center against a
	// standard one-line control.
	return (
		<div
			className={`group/property flex items-start gap-1.5${className ? ` ${className}` : ""}`}
		>
			<span
				title={label}
				className="w-16 shrink-0 truncate pt-1 text-[10px] leading-4 text-slate-400"
			>
				{label}
			</span>
			<div className="min-w-0 flex-1">{children}</div>
			<div className="flex h-6 shrink-0 items-center gap-0.5">
				{clearButton}
				{peek}
			</div>
		</div>
	);
}

/**
 * Self-contained peek (dot + popover) for one property: owns the draft
 * override rows the user adds but hasn't filled in yet, and derives the
 * cross-scope dot from the model. Split from {@link OverrideRows} so rows
 * whose bare control spans multiple properties (alignment matrix, box model)
 * can still offer the per-property override editor per property.
 */
export function PropertyOverridePeek({
	label,
	model,
	property,
	readValue,
	onApply,
	renderControl,
}: {
	label: string;
	model: PropertyModel;
	property: PropertyKey;
	readValue: (entry: PropertyEntry | undefined) => string | null;
	onApply: (variants: string[], payload: string | null) => void;
	renderControl: (slot: OverrideRowSlot) => ReactNode;
}) {
	const [draftVariants, setDraftVariants] = useState<string[]>([]);
	const systemId = useDesignSystemId();
	const breakpoints = useBreakpointNames(systemId);
	const styleScope = useStyleScope();

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

	// "Varies in another scope": set slots other than the one the bare control
	// is editing — the cross-scope dot (board 02 marker 2). At the base scope
	// this is exactly the old override count.
	const crossScopeCount = slots.filter(
		(slot) => slot.entry && slot.variantKey !== styleScope.scope,
	).length;

	function apply(variants: string[], payload: string | null) {
		onApply(variants, payload);
		setDraftVariants((prev) =>
			prev.filter((draft) => draft !== variants.join(":")),
		);
	}

	return (
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
					onClear={entry ? () => apply(variants, null) : null}
					clearLabel={`Clear ${variantKey || "base"} ${label.toLowerCase()}`}
				>
					<div className="min-w-0 flex-1">
						{renderControl({
							variants,
							variantKey,
							value: readValue(entry),
							apply: (payload) => apply(variants, payload),
						})}
					</div>
				</SlotRow>
			))}
		</PeekPopover>
	);
}

/**
 * Shared peek shell: square-dot trigger (lights when the property holds
 * values outside the active scope) over a w-80 popover with a heading row.
 * `PropertyOverridePeek` and the box model's group peek render through it so
 * the dot semantics and titles stay identical everywhere.
 */
export function PeekPopover({
	label,
	heading,
	scope,
	crossScopeCount,
	idleTitle,
	headerActions,
	children,
}: {
	label: string;
	/** Popover heading, also the trigger's accessible name. */
	heading: string;
	scope: string;
	crossScopeCount: number;
	/** Trigger tooltip while nothing varies outside the active scope. */
	idleTitle: string;
	headerActions?: ReactNode;
	children: ReactNode;
}) {
	const hasCrossScope = crossScopeCount > 0;
	const plural = crossScopeCount === 1 ? "" : "s";
	return (
		<Popover>
			<PopoverTrigger
				render={(props, { open }) => (
					<Button
						{...props}
						variant="block"
						isSelected={open}
						// The dot is information: persistent while the property varies
						// outside the active scope, hover/focus-revealed otherwise so
						// quiet rows carry no standing chrome (board 02 marker 2).
						className={
							hasCrossScope
								? "shrink-0 p-1"
								: "shrink-0 p-1 opacity-0 transition-opacity focus-visible:opacity-100 group-focus-within/property:opacity-100 group-hover/property:opacity-100 data-[popup-open]:opacity-100"
						}
						aria-label={heading}
						title={
							hasCrossScope
								? scope === ""
									? `${label}: ${crossScopeCount} override${plural}`
									: `${label}: ${crossScopeCount} value${plural} in other scopes`
								: idleTitle
						}
					/>
				)}
			>
				<StatusDot
					shape="square"
					tone={hasCrossScope ? "syncing" : "idle"}
					className={hasCrossScope ? undefined : "opacity-30"}
				/>
			</PopoverTrigger>
			<PopoverContent side="bottom" align="end" className="w-80 gap-1 p-2">
				<div className="flex flex-row items-center justify-between">
					<span className="px-0.5 text-[10px] font-semibold text-slate-700">
						{heading}
					</span>
					{headerActions}
				</div>
				<div className="flex flex-col gap-1">{children}</div>
			</PopoverContent>
		</Popover>
	);
}

/**
 * One slot row inside a peek: scope chip (active scope renders cyan), the
 * caller's content, and a hover-revealed × when the slot holds a value.
 */
export function SlotRow({
	variantKey,
	activeScope,
	onClear,
	clearLabel,
	children,
}: {
	variantKey: string;
	activeScope: string;
	onClear: (() => void) | null;
	clearLabel: string;
	children: ReactNode;
}) {
	return (
		<div className="group/slot flex items-center gap-1.5">
			<span
				className={
					variantKey === activeScope
						? "w-12 shrink-0 truncate bg-cyan-100 px-1.5 py-0.5 text-center text-[9px] font-medium text-cyan-900"
						: "w-12 shrink-0 truncate px-1.5 py-0.5 text-center text-[9px] text-slate-500 inset-shadow-[0_0_0_1px] inset-shadow-slate-200"
				}
			>
				{variantKey || "Base"}
			</span>
			{children}
			{onClear ? (
				<Button
					type="button"
					variant="block"
					aria-label={clearLabel}
					title={clearLabel}
					onClick={onClear}
					className="shrink-0 p-0.5 opacity-0 transition-opacity focus-visible:opacity-100 group-hover/slot:opacity-100"
				>
					<X className="size-3 text-slate-950" />
				</Button>
			) : null}
		</div>
	);
}

/**
 * Grouped selector/breakpoint/mode picker behind a + trigger. Shared by the
 * peek's add-override flow and the panel `ScopeBar`'s add-scope flow.
 */
export function AddOverrideMenu({
	options,
	onAdd,
	label = "Add override",
}: {
	options: readonly OverrideOption[];
	onAdd: (value: string) => void;
	label?: string;
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
						aria-label={label}
						title={label}
					/>
				)}
			>
				<Plus className="size-3 text-slate-900" />
			</Menu.Trigger>
			<Menu.Portal>
				<Menu.Positioner sideOffset={4} align="end">
					<Menu.Popup className={menuSlots.popup({ className: "min-w-32" })}>
						{groups.map((group) => {
							const groupOptions = options.filter(
								(option) => option.group === group,
							);
							if (groupOptions.length === 0) return null;
							return (
								<div key={group} className="flex flex-col">
									<span className={menuSlots.groupLabel()}>
										{OVERRIDE_GROUP_LABELS[group]}
									</span>
									{groupOptions.map((option) => (
										<Menu.Item
											key={option.value}
											className={menuSlots.item()}
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
