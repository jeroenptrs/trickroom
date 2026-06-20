import { Grid2x2, Link2, Unlink2 } from "lucide-react";
import { useMemo } from "react";
import {
	buildPropertyModel,
	type ModelOptions,
	SPACING_PROPERTY_TO_PREFIX,
	type SpacingProperty,
} from "../../../utils/tailwind-classname";
import { Button } from "../../ui/button";
import {
	type BoxLinkState,
	type BoxModelGroup,
	type BoxModelValues,
	type BoxSide,
	boxProperties,
	convertBoxShape,
	nextLinkState,
	readBoxModel,
	writeBoxSide,
} from "./boxModelController";
import { PeekPopover, PropertyRow, SlotRow } from "./OverrideRows";
import { computePropertySlots } from "./propertySlots";
import {
	applySpacingChange,
	applySpacingClear,
	formatSpacingInputValue,
	parseSpacingInputValue,
} from "./spacingPropertiesController";
import { useStyleScope } from "./styleScope";
import { useSectionRow } from "./styleSectionRows";
import { TokenField } from "./TokenField";
import type { TokenFieldOption } from "./tokenFieldController";

const SIDE_LABELS: Record<BoxSide, string> = {
	top: "top",
	right: "right",
	bottom: "bottom",
	left: "left",
};

const LINK_STATE_LABELS: Record<BoxLinkState, string> = {
	linked: "linked, one value",
	axis: "split into x/y",
	sides: "split per side",
};

/**
 * Box-model spacing control (right-rail P4, board 03 "Box model · unlinked"):
 * four compact token fields arranged spatially around a link toggle. The
 * toggle cycles linked → axis → per-side, and the produced classes mirror the
 * state exactly (`p-4` ↔ `px-`/`py-` ↔ `pt-/pr-/pb-/pl-`).
 */
export function BoxModelControl({
	label,
	values,
	tokenOptions,
	onSide,
	onCycleLink,
}: {
	label: string;
	values: BoxModelValues;
	tokenOptions: readonly TokenFieldOption[];
	onSide: (side: BoxSide, input: string) => void;
	onCycleLink: () => void;
}) {
	const { linkState, sides } = values;
	const LinkIcon =
		linkState === "linked" ? Link2 : linkState === "axis" ? Unlink2 : Grid2x2;
	const linkTitle = `${label}: ${LINK_STATE_LABELS[linkState]} — click for ${LINK_STATE_LABELS[nextLinkState(linkState)]}`;

	const field = (side: BoxSide) => (
		<TokenField
			compact
			label={`${label} ${SIDE_LABELS[side]}`}
			value={sides[side] ?? ""}
			options={tokenOptions}
			onCommit={(next) => onSide(side, next.trim())}
		/>
	);

	return (
		<div className="flex flex-col gap-1 bg-slate-100 p-1.5">
			<div className="flex justify-center">{field("top")}</div>
			<div className="flex items-center gap-1">
				{field("left")}
				<div className="flex h-8 min-w-0 flex-1 items-center justify-center border border-dashed border-slate-300 bg-white">
					<Button
						type="button"
						variant="block"
						aria-label={linkTitle}
						title={linkTitle}
						onClick={onCycleLink}
						className="p-1"
					>
						<LinkIcon
							className={
								linkState === "linked"
									? "size-3 text-cyan-600"
									: "size-3 text-slate-400"
							}
						/>
					</Button>
				</div>
				{field("right")}
			</div>
			<div className="flex justify-center">{field("bottom")}</div>
		</div>
	);
}

type BoxSlotEntry = {
	property: SpacingProperty;
	prefix: string;
	variantKey: string;
	variants: string[];
	value: string;
};

/**
 * Override-aware box-model row for one spacing group (padding/margin): the
 * box edits the active scope, and the group peek stacks every set
 * (property × scope) slot — the escape hatch replacing seven per-property
 * rows. Registers as a single section row, so an unset group is one ghost
 * chip (board 02's "+ margin").
 */
export function BoxModelRows({
	group,
	label,
	likely,
	className,
	options,
	tokenOptions,
	onChange,
}: {
	group: BoxModelGroup;
	label: string;
	likely?: boolean;
	className: string;
	options: ModelOptions;
	tokenOptions: readonly TokenFieldOption[];
	onChange: (next: string) => void;
}) {
	const styleScope = useStyleScope();

	const model = useMemo(
		() => buildPropertyModel(className, options),
		[className, options],
	);

	// Every set (property × scope) slot of the group, for the peek, the
	// cross-scope dot, and the row-level clear gesture.
	const slotEntries = useMemo<BoxSlotEntry[]>(() => {
		const entries: BoxSlotEntry[] = [];
		for (const property of boxProperties(group)) {
			for (const slot of computePropertySlots(model, property, [])) {
				if (!slot.entry) continue;
				entries.push({
					property,
					prefix: SPACING_PROPERTY_TO_PREFIX[property],
					variantKey: slot.variantKey,
					variants: slot.variants,
					value: formatSpacingInputValue(slot.entry) ?? "",
				});
			}
		}
		return entries;
	}, [model, group]);

	const isSet = slotEntries.length > 0;
	const visible = useSectionRow({
		id: group,
		label,
		isSet,
		likely: likely ?? false,
	});

	const values = useMemo(
		() => readBoxModel(model, group, styleScope.scope),
		[model, group, styleScope.scope],
	);

	if (!visible) return null;

	const crossScopeCount = slotEntries.filter(
		(entry) => entry.variantKey !== styleScope.scope,
	).length;

	function applySlot(entry: BoxSlotEntry, input: string) {
		const trimmed = input.trim();
		if (!trimmed) {
			onChange(
				applySpacingClear(className, options, entry.property, entry.variants),
			);
			return;
		}
		const parsed = parseSpacingInputValue(trimmed, entry.property);
		onChange(
			parsed
				? applySpacingChange(className, options, {
						property: entry.property,
						value: parsed.value,
						negative: parsed.negative,
						variants: entry.variants,
					})
				: applySpacingClear(className, options, entry.property, entry.variants),
		);
	}

	function clearAll() {
		onChange(
			slotEntries.reduce(
				(acc, entry) =>
					applySpacingClear(acc, options, entry.property, entry.variants),
				className,
			),
		);
	}

	return (
		<PropertyRow
			label={label}
			stacked
			onClear={isSet ? clearAll : null}
			clearLabel={`Remove ${label.toLowerCase()}`}
			peek={
				<BoxModelPeek
					label={label}
					scope={styleScope.scope}
					slotEntries={slotEntries}
					crossScopeCount={crossScopeCount}
					tokenOptions={tokenOptions}
					onApply={applySlot}
				/>
			}
		>
			{isSet ? (
				<BoxModelControl
					label={label}
					values={values}
					tokenOptions={tokenOptions}
					onSide={(side, input) =>
						onChange(
							writeBoxSide(
								className,
								options,
								group,
								side,
								input,
								values.linkState,
								styleScope.variants,
							),
						)
					}
					onCycleLink={() =>
						onChange(
							convertBoxShape(
								className,
								options,
								group,
								nextLinkState(values.linkState),
								styleScope.variants,
							),
						)
					}
				/>
			) : (
				// Revealed but still empty: one linked "All" field instead of the
				// four-field box; the box takes over once a value exists.
				<TokenField
					label="All"
					value=""
					placeholder="0, 4, [13px]"
					options={tokenOptions}
					onCommit={(next) => {
						const trimmed = next.trim();
						if (!trimmed) return;
						onChange(
							writeBoxSide(
								className,
								options,
								group,
								"top",
								trimmed,
								values.linkState,
								styleScope.variants,
							),
						);
					}}
				/>
			)}
		</PropertyRow>
	);
}

/**
 * Group peek: every set class of the box, one row per (property × scope),
 * labelled by its utility prefix. Unlike the per-property `OverridePeek`
 * there is no add-draft menu — scoped values are added by picking a scope in
 * the panel scope bar and typing into the box.
 */
function BoxModelPeek({
	label,
	scope,
	slotEntries,
	crossScopeCount,
	tokenOptions,
	onApply,
}: {
	label: string;
	scope: string;
	slotEntries: readonly BoxSlotEntry[];
	crossScopeCount: number;
	tokenOptions: readonly TokenFieldOption[];
	onApply: (entry: BoxSlotEntry, input: string) => void;
}) {
	return (
		<PeekPopover
			label={label}
			heading={`${label} values`}
			scope={scope}
			crossScopeCount={crossScopeCount}
			idleTitle={`${label}: all values`}
		>
			{slotEntries.length === 0 ? (
				<span className="px-0.5 text-[10px] text-slate-400">
					Nothing set yet
				</span>
			) : (
				slotEntries.map((entry) => (
					<SlotRow
						key={`${entry.property}:${entry.variantKey}`}
						variantKey={entry.variantKey}
						activeScope={scope}
						onClear={() => onApply(entry, "")}
						clearLabel={`Clear ${entry.variantKey || "base"} ${entry.prefix}`}
					>
						<span className="w-8 shrink-0 font-mono text-[10px] text-slate-500">
							{entry.prefix}
						</span>
						<div className="min-w-0 flex-1">
							<TokenField
								compact
								label={`${entry.variantKey || "base"} ${entry.prefix}`}
								value={entry.value}
								options={tokenOptions}
								onCommit={(next) => onApply(entry, next)}
							/>
						</div>
					</SlotRow>
				))
			)}
		</PeekPopover>
	);
}
