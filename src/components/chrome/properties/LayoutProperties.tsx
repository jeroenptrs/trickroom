import { useCallback, useMemo } from "react";
import type {
	ModelOptions,
	StyleProperty,
} from "../../../utils/tailwind-classname";
import { StyleSection } from "./StyleSection";
import { Segmented, type SegmentedOption } from "./StyleControls";
import { StyleOverrideRows } from "./StyleOverrideRows";
import { getStyleIntent, styleValueText } from "./styleSectionController";

type LayoutPropertiesProps = {
	className: string;
	onChange: (next: string) => void;
};

const EMPTY_COLOR_TOKENS = new Set<string>();

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
	{ value: "row", label: "Row" },
	{ value: "col", label: "Column" },
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

export function LayoutProperties({ className, onChange }: LayoutPropertiesProps) {
	const options = useMemo<ModelOptions>(
		() => ({ colorTokens: EMPTY_COLOR_TOKENS }),
		[],
	);

	const base = useCallback(
		(property: StyleProperty) =>
			styleValueText(getStyleIntent(className, options, property)),
		[className, options],
	);

	const display = base("layout.display");
	const direction = base("layout.flex-direction");
	const summary = [display, direction].filter(Boolean).join(" · ") || undefined;
	const isFlex = display === "flex";

	return (
		<StyleSection title="Layout" summary={summary}>
			<StyleOverrideRows
				label="Display"
				className={className}
				options={options}
				property="layout.display"
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
					<StyleOverrideRows
						label="Justify"
						className={className}
						options={options}
						property="layout.justify-content"
						onChange={onChange}
						renderControl={(slot) => (
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
					<StyleOverrideRows
						label="Align"
						className={className}
						options={options}
						property="layout.align-items"
						onChange={onChange}
						renderControl={(slot) => (
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
			) : null}
		</StyleSection>
	);
}
