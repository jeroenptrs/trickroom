import { useCallback, useMemo } from "react";
import { useResolvedColorTokens } from "../../../hooks/useResolvedColorTokens";
import { useResolvedCustomUtilities } from "../../../hooks/useResolvedCustomUtilities";
import { useDesignSystemId } from "../../../stores/design-store";
import {
	buildPropertyModel,
	type ModelOptions,
	type StyleProperty,
} from "../../../utils/tailwind-classname";
import { ColorPropertyControl } from "./ColorPropertyControl";
import { applyColorChange, applyColorClear } from "./colorPropertiesController";
import { focusUtility } from "./focusPropertiesController";
import { Segmented, type SegmentedOption } from "./StyleControls";
import { StyleOverrideRows } from "./StyleOverrideRows";
import { StyleSection } from "./StyleSection";
import { getStyleIntent, styleValueText } from "./styleSectionController";

type FocusPropertiesProps = {
	className: string;
	onChange: (next: string) => void;
};

const RING_WIDTH_OPTIONS: readonly SegmentedOption<string>[] = [
	{ value: "0", label: "0" },
	{ value: "1", label: "1" },
	{ value: "2", label: "2" },
	{ value: "4", label: "4" },
	{ value: "8", label: "8" },
];

const RING_OFFSET_OPTIONS: readonly SegmentedOption<string>[] = [
	{ value: "0", label: "0" },
	{ value: "1", label: "1" },
	{ value: "2", label: "2" },
	{ value: "4", label: "4" },
	{ value: "8", label: "8" },
];

const OUTLINE_WIDTH_OPTIONS: readonly SegmentedOption<string>[] = [
	{ value: "0", label: "0" },
	{ value: "1", label: "1" },
	{ value: "2", label: "2" },
	{ value: "4", label: "4" },
	{ value: "8", label: "8" },
];

const OUTLINE_STYLE_OPTIONS: readonly SegmentedOption<string>[] = [
	{ value: "solid", label: "Solid" },
	{ value: "dashed", label: "Dash" },
	{ value: "dotted", label: "Dot" },
	{ value: "double", label: "2×" },
	{ value: "none", label: "—" },
];

const COLOR_ROWS = [
	{ property: "ring" as const, label: "Ring" },
	{ property: "ring-offset" as const, label: "Ring offset" },
	{ property: "outline" as const, label: "Outline" },
];

/** Override-aware: ring width/inset/offset, outline width/style. */
export function FocusProperties({ className, onChange }: FocusPropertiesProps) {
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

	const ringWidth = read("focus.ring-width");
	const outlineStyle = read("focus.outline-style");

	const summary =
		[ringWidth && `ring ${ringWidth}`, outlineStyle]
			.filter(Boolean)
			.join(" · ") || undefined;

	return (
		<StyleSection title="Focus" summary={summary}>
			<StyleOverrideRows
				label="Ring width"
				className={className}
				options={options}
				property="focus.ring-width"
				onChange={onChange}
				renderControl={(slot) => (
					<Segmented
						ariaLabel="Ring width"
						options={RING_WIDTH_OPTIONS}
						value={slot.value}
						onChange={(next) =>
							slot.apply(
								next === null ? null : focusUtility("focus.ring-width", next),
							)
						}
					/>
				)}
			/>
			<StyleOverrideRows
				label="Ring inset"
				className={className}
				options={options}
				property="focus.ring-inset"
				onChange={onChange}
				renderControl={(slot) => (
					<Segmented
						ariaLabel="Ring inset"
						options={[{ value: "inset", label: "Inset" }]}
						value={slot.value === "inset" ? "inset" : null}
						onChange={(next) =>
							slot.apply(
								next === null ? null : focusUtility("focus.ring-inset", next),
							)
						}
					/>
				)}
			/>
			<StyleOverrideRows
				label="Ring offset"
				className={className}
				options={options}
				property="focus.ring-offset"
				onChange={onChange}
				renderControl={(slot) => (
					<Segmented
						ariaLabel="Ring offset"
						options={RING_OFFSET_OPTIONS}
						value={slot.value}
						onChange={(next) =>
							slot.apply(
								next === null ? null : focusUtility("focus.ring-offset", next),
							)
						}
					/>
				)}
			/>
			{COLOR_ROWS.map(({ property, label }) => (
				<ColorPropertyControl
					key={property}
					label={label}
					property={property}
					model={model}
					resolved={resolved}
					onSet={(variants, value) =>
						onChange(
							applyColorChange(className, options, {
								property,
								variants,
								value,
							}),
						)
					}
					onClear={(variants) =>
						onChange(
							applyColorClear(className, options, { property, variants }),
						)
					}
				/>
			))}
			<StyleOverrideRows
				label="Outline width"
				className={className}
				options={options}
				property="focus.outline-width"
				onChange={onChange}
				renderControl={(slot) => (
					<Segmented
						ariaLabel="Outline width"
						options={OUTLINE_WIDTH_OPTIONS}
						value={slot.value}
						onChange={(next) =>
							slot.apply(
								next === null
									? null
									: focusUtility("focus.outline-width", next),
							)
						}
					/>
				)}
			/>
			<StyleOverrideRows
				label="Outline style"
				className={className}
				options={options}
				property="focus.outline-style"
				onChange={onChange}
				renderControl={(slot) => (
					<Segmented
						ariaLabel="Outline style"
						options={OUTLINE_STYLE_OPTIONS}
						value={slot.value}
						onChange={(next) =>
							slot.apply(
								next === null
									? null
									: focusUtility("focus.outline-style", next),
							)
						}
					/>
				)}
			/>
		</StyleSection>
	);
}
