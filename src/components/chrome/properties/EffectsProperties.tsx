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
import { effectsUtility } from "./effectsPropertiesController";
import { Segmented, type SegmentedOption, ValueField } from "./StyleControls";
import { StyleOverrideRows } from "./StyleOverrideRows";
import { StyleSection } from "./StyleSection";
import { getStyleIntent, styleValueText } from "./styleSectionController";

type EffectsPropertiesProps = {
	className: string;
	onChange: (next: string) => void;
};

const SHADOW_OPTIONS: readonly SegmentedOption<string>[] = [
	{ value: "none", label: "None" },
	{ value: "sm", label: "SM" },
	{ value: "md", label: "MD" },
	{ value: "lg", label: "LG" },
	{ value: "xl", label: "XL" },
	{ value: "2xl", label: "2XL" },
];

const INSET_SHADOW_OPTIONS: readonly SegmentedOption<string>[] = [
	{ value: "none", label: "None" },
	{ value: "xs", label: "XS" },
	{ value: "sm", label: "SM" },
	{ value: "inner", label: "Inner" },
];

const BLUR_OPTIONS: readonly SegmentedOption<string>[] = [
	{ value: "none", label: "None" },
	{ value: "sm", label: "SM" },
	{ value: "md", label: "MD" },
	{ value: "lg", label: "LG" },
	{ value: "xl", label: "XL" },
];

const OPACITY_OPTIONS: readonly SegmentedOption<string>[] = [
	{ value: "0", label: "0" },
	{ value: "25", label: "25" },
	{ value: "50", label: "50" },
	{ value: "75", label: "75" },
	{ value: "100", label: "100" },
];

const COLOR_ROWS = [
	{ property: "shadow" as const, label: "Shadow" },
	{ property: "inset-shadow" as const, label: "Inset shadow" },
	{ property: "text-shadow" as const, label: "Text shadow" },
];

/** Override-aware: box shadow, inset shadow, blur, backdrop blur, opacity, mix blend. */
export function EffectsProperties({
	className,
	onChange,
}: EffectsPropertiesProps) {
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

	const shadow = read("effects.shadow");
	const opacity = read("effects.opacity");

	const summary =
		[shadow && `shadow ${shadow}`, opacity && `${opacity}%`]
			.filter(Boolean)
			.join(" · ") || undefined;

	return (
		<StyleSection title="Effects" summary={summary}>
			<StyleOverrideRows
				label="Box shadow"
				className={className}
				options={options}
				property="effects.shadow"
				onChange={onChange}
				renderControl={(slot) => (
					<Segmented
						ariaLabel="Box shadow"
						options={SHADOW_OPTIONS}
						value={slot.value}
						onChange={(next) =>
							slot.apply(
								next === null ? null : effectsUtility("effects.shadow", next),
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
				label="Inset shadow"
				className={className}
				options={options}
				property="effects.inset-shadow"
				onChange={onChange}
				renderControl={(slot) => (
					<Segmented
						ariaLabel="Inset shadow"
						options={INSET_SHADOW_OPTIONS}
						value={slot.value}
						onChange={(next) =>
							slot.apply(
								next === null
									? null
									: effectsUtility("effects.inset-shadow", next),
							)
						}
					/>
				)}
			/>
			<StyleOverrideRows
				label="Blur"
				className={className}
				options={options}
				property="effects.blur"
				onChange={onChange}
				renderControl={(slot) => (
					<Segmented
						ariaLabel="Blur"
						options={BLUR_OPTIONS}
						value={slot.value}
						onChange={(next) =>
							slot.apply(
								next === null ? null : effectsUtility("effects.blur", next),
							)
						}
					/>
				)}
			/>
			<StyleOverrideRows
				label="Backdrop blur"
				className={className}
				options={options}
				property="effects.backdrop-blur"
				onChange={onChange}
				renderControl={(slot) => (
					<Segmented
						ariaLabel="Backdrop blur"
						options={BLUR_OPTIONS}
						value={slot.value}
						onChange={(next) =>
							slot.apply(
								next === null
									? null
									: effectsUtility("effects.backdrop-blur", next),
							)
						}
					/>
				)}
			/>
			<StyleOverrideRows
				label="Opacity"
				className={className}
				options={options}
				property="effects.opacity"
				onChange={onChange}
				renderControl={(slot) => (
					<Segmented
						ariaLabel="Opacity"
						options={OPACITY_OPTIONS}
						value={slot.value}
						onChange={(next) =>
							slot.apply(
								next === null ? null : effectsUtility("effects.opacity", next),
							)
						}
					/>
				)}
			/>
			<StyleOverrideRows
				label="Mix blend"
				className={className}
				options={options}
				property="effects.mix-blend-mode"
				onChange={onChange}
				renderControl={(slot) => (
					<ValueField
						label="Mix blend"
						value={slot.value ?? ""}
						placeholder="multiply"
						onCommit={(v) =>
							slot.apply(
								v.trim()
									? effectsUtility("effects.mix-blend-mode", v.trim())
									: null,
							)
						}
					/>
				)}
			/>
		</StyleSection>
	);
}
