import { useCallback, useMemo } from "react";
import { useResolvedColorTokens } from "../../../hooks/useResolvedColorTokens";
import { useResolvedCustomUtilities } from "../../../hooks/useResolvedCustomUtilities";
import { useDesignSystemId } from "../../../stores/design-store";
import {
	buildPropertyModel,
	type ModelOptions,
	type StyleProperty,
} from "../../../utils/tailwind-classname";
import { Segmented, type SegmentedOption } from "../../ui/segmented";
import { ColorPropertyControl } from "./ColorPropertyControl";
import {
	applyColorChange,
	applyColorClear,
	applyColorClearAll,
} from "./colorPropertiesController";
import { StyleOverrideRows } from "./StyleOverrideRows";
import { StyleSection } from "./StyleSection";
import { getStyleIntent, styleValueText } from "./styleSectionController";
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
export function VectorProperties({
	className,
	onChange,
}: VectorPropertiesProps) {
	const systemId = useDesignSystemId();
	const resolved = useResolvedColorTokens(systemId);
	const customUtilityRoots = useResolvedCustomUtilities(systemId);

	const options = useMemo<ModelOptions>(
		() => ({ colorTokens: resolved.names, ...customUtilityRoots }),
		[resolved.names, customUtilityRoots],
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

	const strokeWidth = read("vector.stroke-width");

	const summary = [strokeWidth ? `stroke ${strokeWidth}` : null].filter(
		(value): value is string => value !== null,
	);

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
					onChange(
						applyColorClear(className, options, { property: "fill", variants }),
					)
				}
				onClearAll={(chains) =>
					onChange(applyColorClearAll(className, options, "fill", chains))
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
						applyColorClear(className, options, {
							property: "stroke",
							variants,
						}),
					)
				}
				onClearAll={(chains) =>
					onChange(applyColorClearAll(className, options, "stroke", chains))
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
			<StyleOverrideRows
				label="Fill none"
				className={className}
				options={options}
				property="vector.fill"
				onChange={onChange}
				renderControl={(slot) => (
					<Segmented
						ariaLabel="Fill none"
						options={PAINT_NONE_OPTIONS}
						value={slot.value === "none" ? "none" : null}
						onChange={(next) =>
							slot.apply(
								next === null ? null : vectorUtility("vector.fill", next),
							)
						}
					/>
				)}
			/>
			<StyleOverrideRows
				label="Stroke none"
				className={className}
				options={options}
				property="vector.stroke"
				onChange={onChange}
				renderControl={(slot) => (
					<Segmented
						ariaLabel="Stroke none"
						options={PAINT_NONE_OPTIONS}
						value={slot.value === "none" ? "none" : null}
						onChange={(next) =>
							slot.apply(
								next === null ? null : vectorUtility("vector.stroke", next),
							)
						}
					/>
				)}
			/>
		</StyleSection>
	);
}
