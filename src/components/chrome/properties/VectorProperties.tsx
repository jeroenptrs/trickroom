import { useCallback, useMemo } from "react";
import { useResolvedColorTokens } from "../../../hooks/useResolvedColorTokens";
import { useDesignSystemId } from "../../../stores/design-store";
import {
	buildPropertyModel,
	type ModelOptions,
	type StyleProperty,
} from "../../../utils/tailwind-classname";
import {
	applyColorChange,
	applyColorClear,
} from "./colorPropertiesController";
import { ColorPropertyControl } from "./ColorPropertyControl";
import { StyleSection } from "./StyleSection";
import { Segmented, type SegmentedOption } from "./StyleControls";
import { StyleOverrideRows } from "./StyleOverrideRows";
import {
	applyStyleUtility,
	clearStyleProperty,
	getStyleIntent,
	styleValueText,
} from "./styleSectionController";
import { vectorUtility } from "./vectorPropertiesController";

type VectorPropertiesProps = {
	className: string;
	onChange: (next: string) => void;
};

const STROKE_WIDTH_OPTIONS: readonly SegmentedOption<string>[] = [
	{ value: "0", label: "0" },
	{ value: "1", label: "1" },
	{ value: "2", label: "2" },
	{ value: "4", label: "4" },
];

const PAINT_NONE_OPTIONS: readonly SegmentedOption<string>[] = [
	{ value: "none", label: "None" },
];

/** Override-aware: stroke width only; fill/stroke colors unchanged. */
export function VectorProperties({ className, onChange }: VectorPropertiesProps) {
	const systemId = useDesignSystemId();
	const resolved = useResolvedColorTokens(systemId);

	const options = useMemo<ModelOptions>(
		() => ({ colorTokens: resolved.names }),
		[resolved.names],
	);

	const model = useMemo(
		() => buildPropertyModel(className, options),
		[className, options],
	);

	const read = useCallback(
		(property: StyleProperty) =>
			styleValueText(getStyleIntent(className, options, property)),
		[className, options],
	);

	const apply = useCallback(
		(property: StyleProperty, next: string | null) => {
			if (next === null) {
				onChange(clearStyleProperty(className, options, property));
				return;
			}
			onChange(
				applyStyleUtility(className, options, property, vectorUtility(property, next)),
			);
		},
		[className, onChange, options],
	);

	const strokeWidth = read("vector.stroke-width");
	const fillNone = read("vector.fill");
	const strokeNone = read("vector.stroke");

	const summary =
		[strokeWidth && `stroke ${strokeWidth}`].filter(Boolean).join(" · ") ||
		undefined;

	return (
		<StyleSection title="Vector" summary={summary}>
			<ColorPropertyControl
				label="Fill"
				property="fill"
				model={model}
				resolved={resolved}
				onSet={(variants, value) =>
					onChange(
						applyColorChange(className, options, {
							property: "fill",
							variants,
							value,
						}),
					)
				}
				onClear={(variants) =>
					onChange(applyColorClear(className, options, { property: "fill", variants }))
				}
			/>
			<ColorPropertyControl
				label="Stroke"
				property="stroke"
				model={model}
				resolved={resolved}
				onSet={(variants, value) =>
					onChange(
						applyColorChange(className, options, {
							property: "stroke",
							variants,
							value,
						}),
					)
				}
				onClear={(variants) =>
					onChange(
						applyColorClear(className, options, { property: "stroke", variants }),
					)
				}
			/>
			<StyleOverrideRows
				label="Stroke width"
				className={className}
				options={options}
				property="vector.stroke-width"
				onChange={onChange}
				renderControl={(slot) => (
					<Segmented
						ariaLabel="Stroke width"
						options={STROKE_WIDTH_OPTIONS}
						value={slot.value}
						onChange={(next) =>
							slot.apply(
								next === null
									? null
									: vectorUtility("vector.stroke-width", next),
							)
						}
					/>
				)}
			/>
			<Segmented
				ariaLabel="Fill none"
				options={PAINT_NONE_OPTIONS}
				value={fillNone === "none" ? "none" : null}
				onChange={(next) => apply("vector.fill", next)}
			/>
			<Segmented
				ariaLabel="Stroke none"
				options={PAINT_NONE_OPTIONS}
				value={strokeNone === "none" ? "none" : null}
				onChange={(next) => apply("vector.stroke", next)}
			/>
		</StyleSection>
	);
}
