import { Menu } from "@base-ui/react/menu";
import { ArrowDown, ArrowRight, ChevronDown } from "lucide-react";
import { useCallback, useMemo } from "react";
import { useResolvedCustomUtilities } from "../../../hooks/useResolvedCustomUtilities";
import { useDesignSystemId } from "../../../stores/design-store";
import {
	buildPropertyModel,
	type ModelOptions,
	type PropertyEntry,
	type PropertyModel,
	type StyleProperty,
} from "../../../utils/tailwind-classname";
import { Button } from "../../ui/button";
import { dropdownMenu } from "../../ui/menu";
import { Segmented, type SegmentedOption } from "../../ui/segmented";
import { AlignmentMatrix } from "./AlignmentMatrix";
import {
	type AlignAxisValue,
	DISTRIBUTE_VALUES,
	type DistributeValue,
	isDistributeValue,
	normalizeFlexAxis,
} from "./alignmentMatrixController";
import {
	type OverrideRowSlot,
	PropertyOverridePeek,
	PropertyRow,
} from "./OverrideRows";
import { computePropertySlots, propertyHasEntries } from "./propertySlots";
import { StyleOverrideRows } from "./StyleOverrideRows";
import { StyleSection } from "./StyleSection";
import { useStyleScope } from "./styleScope";
import {
	applyStyleUtility,
	clearStyleProperty,
	getStyleIntent,
	styleValueText,
} from "./styleSectionController";
import { useSectionRow } from "./styleSectionRows";

type LayoutPropertiesProps = {
	className: string;
	onChange: (next: string) => void;
};

const EMPTY_COLOR_TOKENS = new Set<string>();

const menuSlots = dropdownMenu();

/**
 * Reference Style-tab section. Demonstrates the shared building blocks every
 * other domain section mirrors: a `StyleSection` shell, block-variant controls,
 * and `StyleOverrideRows` to make each property override-aware (base +
 * selector/breakpoint rows, #403). Each option maps a semantic value to the
 * Tailwind utility body the model expects.
 */
const DISPLAY_OPTIONS: readonly SegmentedOption<string>[] = [
	{ value: "flex", label: "Flex" },
	{ value: "grid", label: "Grid" },
	{ value: "block", label: "Block" },
	{ value: "hidden", label: "None" },
];

const DIRECTION_OPTIONS: readonly SegmentedOption<string>[] = [
	{ value: "row", label: <ArrowRight />, title: "Row" },
	{ value: "col", label: <ArrowDown />, title: "Column" },
];

const JUSTIFY_OPTIONS: readonly SegmentedOption<string>[] = [
	{ value: "start", label: "Start" },
	{ value: "center", label: "Center" },
	{ value: "end", label: "End" },
	{ value: "between", label: "Between" },
];

const ALIGN_OPTIONS: readonly SegmentedOption<string>[] = [
	{ value: "start", label: "Start" },
	{ value: "center", label: "Center" },
	{ value: "end", label: "End" },
	{ value: "stretch", label: "Stretch" },
];

export function LayoutProperties({
	className,
	onChange,
}: LayoutPropertiesProps) {
	const systemId = useDesignSystemId();
	const customUtilityRoots = useResolvedCustomUtilities(systemId);

	const options = useMemo<ModelOptions>(
		() => ({ colorTokens: EMPTY_COLOR_TOKENS, ...customUtilityRoots }),
		[customUtilityRoots],
	);

	const model = useMemo(
		() => buildPropertyModel(className, options),
		[className, options],
	);

	const base = useCallback(
		(property: StyleProperty) =>
			styleValueText(getStyleIntent(className, options, property)),
		[className, options],
	);

	const display = base("layout.display");
	const direction = base("layout.flex-direction");
	const summary = [display, direction].filter(
		(value): value is string => value !== null,
	);
	const isFlex = display === "flex";

	return (
		<StyleSection title="Layout" summary={summary}>
			<StyleOverrideRows
				label="Display"
				className={className}
				options={options}
				property="layout.display"
				likely
				onChange={onChange}
				renderControl={(slot) => (
					<Segmented
						ariaLabel="Display"
						options={DISPLAY_OPTIONS}
						value={slot.value}
						onChange={(next) => slot.apply(next)}
					/>
				)}
			/>
			{isFlex ? (
				<>
					<StyleOverrideRows
						label="Direction"
						className={className}
						options={options}
						property="layout.flex-direction"
						likely
						onChange={onChange}
						renderControl={(slot) => (
							<Segmented
								ariaLabel="Direction"
								options={DIRECTION_OPTIONS}
								value={slot.value}
								onChange={(next) =>
									slot.apply(next === null ? null : `flex-${next}`)
								}
							/>
						)}
					/>
					<AlignmentRow
						className={className}
						options={options}
						model={model}
						onChange={onChange}
					/>
				</>
			) : null}
		</StyleSection>
	);
}

const JUSTIFY_PROPERTY: StyleProperty = "layout.justify-content";
const ALIGN_PROPERTY: StyleProperty = "layout.align-items";

function readStyleEntryValue(entry: PropertyEntry | undefined): string | null {
	return entry && entry.intent.kind === "style"
		? styleValueText(entry.intent)
		: null;
}

/**
 * Justify × align as one spatial row (right-rail P4, board 02 marker 4): the
 * direction-aware matrix writes both properties in one mutation, the
 * distribute menu covers the justify values the matrix cannot show, and each
 * property keeps its own override peek (with the familiar segmented controls)
 * as the escape hatch for the rest (stretch, per-scope values).
 */
function AlignmentRow({
	className,
	options,
	model,
	onChange,
}: {
	className: string;
	options: ModelOptions;
	model: PropertyModel;
	onChange: (next: string) => void;
}) {
	const styleScope = useStyleScope();

	const isSet =
		propertyHasEntries(model, JUSTIFY_PROPERTY) ||
		propertyHasEntries(model, ALIGN_PROPERTY);
	const visible = useSectionRow({
		id: "layout.alignment",
		label: "Align",
		isSet,
		likely: true,
	});

	const justify = styleValueText(
		getStyleIntent(className, options, JUSTIFY_PROPERTY, styleScope.variants),
	);
	const align = styleValueText(
		getStyleIntent(className, options, ALIGN_PROPERTY, styleScope.variants),
	);
	// The matrix orients along the container's main axis: the active scope's
	// direction when it sets one, the base direction otherwise.
	const axis = normalizeFlexAxis(
		styleValueText(
			getStyleIntent(
				className,
				options,
				"layout.flex-direction",
				styleScope.variants,
			),
		) ??
			styleValueText(
				getStyleIntent(className, options, "layout.flex-direction"),
			),
	);

	if (!visible) return null;

	const applyProperty = (
		current: string,
		property: StyleProperty,
		utility: string | null,
	) =>
		utility === null
			? clearStyleProperty(current, options, property, styleScope.variants)
			: applyStyleUtility(current, options, property, utility, {
					variants: styleScope.variants,
				});

	function selectCell(nextJustify: AlignAxisValue, nextAlign: AlignAxisValue) {
		// Re-picking the selected cell clears both, matching the segmented
		// controls' toggle-off gesture. Both writes fold into one mutation.
		const isToggleOff = justify === nextJustify && align === nextAlign;
		const next = applyProperty(
			applyProperty(
				className,
				JUSTIFY_PROPERTY,
				isToggleOff ? null : `justify-${nextJustify}`,
			),
			ALIGN_PROPERTY,
			isToggleOff ? null : `items-${nextAlign}`,
		);
		onChange(next);
	}

	function selectDistribute(value: DistributeValue | null) {
		if (value === null) {
			if (isDistributeValue(justify)) {
				onChange(applyProperty(className, JUSTIFY_PROPERTY, null));
			}
			return;
		}
		onChange(applyProperty(className, JUSTIFY_PROPERTY, `justify-${value}`));
	}

	function clearAll() {
		let next = className;
		for (const property of [JUSTIFY_PROPERTY, ALIGN_PROPERTY]) {
			for (const slot of computePropertySlots(model, property, [])) {
				if (slot.entry) {
					next = clearStyleProperty(next, options, property, slot.variants);
				}
			}
		}
		onChange(next);
	}

	const onApplyFor =
		(property: StyleProperty) => (variants: string[], payload: string | null) =>
			onChange(
				payload === null
					? clearStyleProperty(className, options, property, variants)
					: applyStyleUtility(className, options, property, payload, {
							variants,
						}),
			);

	return (
		<PropertyRow
			label="Align"
			onClear={isSet ? clearAll : null}
			clearLabel="Remove alignment"
			peek={
				<>
					<PropertyOverridePeek
						label="Justify"
						model={model}
						property={JUSTIFY_PROPERTY}
						readValue={readStyleEntryValue}
						onApply={onApplyFor(JUSTIFY_PROPERTY)}
						renderControl={(slot: OverrideRowSlot) => (
							<Segmented
								ariaLabel="Justify content"
								options={JUSTIFY_OPTIONS}
								value={slot.value}
								onChange={(next) =>
									slot.apply(next === null ? null : `justify-${next}`)
								}
							/>
						)}
					/>
					<PropertyOverridePeek
						label="Align"
						model={model}
						property={ALIGN_PROPERTY}
						readValue={readStyleEntryValue}
						onApply={onApplyFor(ALIGN_PROPERTY)}
						renderControl={(slot: OverrideRowSlot) => (
							<Segmented
								ariaLabel="Align items"
								options={ALIGN_OPTIONS}
								value={slot.value}
								onChange={(next) =>
									slot.apply(next === null ? null : `items-${next}`)
								}
							/>
						)}
					/>
				</>
			}
		>
			<div className="flex items-start gap-1.5">
				<AlignmentMatrix
					axis={axis}
					justify={justify}
					align={align}
					onSelect={selectCell}
				/>
				<DistributeMenu value={justify} onSelect={selectDistribute} />
			</div>
		</PropertyRow>
	);
}

const DISTRIBUTE_LABELS: Record<DistributeValue, string> = {
	between: "between",
	around: "around",
	evenly: "evenly",
};

/** Justify distributions the matrix cannot represent, as a field-like menu. */
function DistributeMenu({
	value,
	onSelect,
}: {
	value: string | null;
	onSelect: (next: DistributeValue | null) => void;
}) {
	const active = isDistributeValue(value) ? value : null;
	return (
		<Menu.Root modal>
			<Menu.Trigger
				render={(props, { open }) => (
					<Button
						{...props}
						variant="block"
						isSelected={open}
						aria-label="Distribute"
						title="Distribute"
						className="flex h-6 min-w-0 flex-1 items-center justify-between gap-1 bg-slate-200/60 px-2 py-0 text-xs font-normal"
					/>
				)}
			>
				<span className={active ? "truncate" : "truncate text-slate-400"}>
					{active ? DISTRIBUTE_LABELS[active] : "packed"}
				</span>
				<ChevronDown className="size-3 shrink-0 text-slate-400" />
			</Menu.Trigger>
			<Menu.Portal>
				<Menu.Positioner sideOffset={4} align="start">
					<Menu.Popup className={menuSlots.popup()}>
						<Menu.Item
							className={menuSlots.item({
								className: active === null ? "text-cyan-900" : undefined,
							})}
							onClick={() => onSelect(null)}
						>
							packed
						</Menu.Item>
						{DISTRIBUTE_VALUES.map((option) => (
							<Menu.Item
								key={option}
								className={menuSlots.item({
									className: active === option ? "text-cyan-900" : undefined,
								})}
								onClick={() => onSelect(option)}
							>
								{DISTRIBUTE_LABELS[option]}
							</Menu.Item>
						))}
					</Menu.Popup>
				</Menu.Positioner>
			</Menu.Portal>
		</Menu.Root>
	);
}
