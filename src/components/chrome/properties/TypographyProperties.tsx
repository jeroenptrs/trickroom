import { useCallback, useMemo } from "react";
import { useResolvedColorTokens } from "../../../hooks/useResolvedColorTokens";
import { useResolvedFontTokens } from "../../../hooks/useResolvedFontTokens";
import { useDesignSystemId } from "../../../stores/design-store";
import { buildFontFamilyOptions } from "../../../utils/font-family-options";
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
import { getStyleIntent, styleValueText } from "./styleSectionController";
import { typographyUtility } from "./typographyPropertiesController";

type TypographyPropertiesProps = {
	className: string;
	onChange: (next: string) => void;
};

const FONT_SIZE_OPTIONS: readonly SegmentedOption<string>[] = [
	{ value: "xs", label: "XS" },
	{ value: "sm", label: "SM" },
	{ value: "base", label: "Base" },
	{ value: "lg", label: "LG" },
	{ value: "xl", label: "XL" },
	{ value: "2xl", label: "2XL" },
];

const FONT_WEIGHT_OPTIONS: readonly SegmentedOption<string>[] = [
	{ value: "normal", label: "Regular" },
	{ value: "medium", label: "Medium" },
	{ value: "semibold", label: "Semi" },
	{ value: "bold", label: "Bold" },
];

const TEXT_ALIGN_OPTIONS: readonly SegmentedOption<string>[] = [
	{ value: "left", label: "Left" },
	{ value: "center", label: "Center" },
	{ value: "right", label: "Right" },
	{ value: "justify", label: "Justify" },
];

const LINE_HEIGHT_OPTIONS: readonly SegmentedOption<string>[] = [
	{ value: "none", label: "None" },
	{ value: "tight", label: "Tight" },
	{ value: "snug", label: "Snug" },
	{ value: "normal", label: "Normal" },
	{ value: "relaxed", label: "Relaxed" },
];

const TEXT_TRANSFORM_OPTIONS: readonly SegmentedOption<string>[] = [
	{ value: "uppercase", label: "AA" },
	{ value: "lowercase", label: "aa" },
	{ value: "capitalize", label: "Aa" },
	{ value: "normal-case", label: "—" },
];

const DECORATION_OPTIONS: readonly SegmentedOption<string>[] = [
	{ value: "underline", label: "U" },
	{ value: "line-through", label: "S" },
	{ value: "none", label: "—" },
];

const TEXT_WRAP_OPTIONS: readonly SegmentedOption<string>[] = [
	{ value: "wrap", label: "Wrap" },
	{ value: "nowrap", label: "Nowrap" },
	{ value: "balance", label: "Balance" },
	{ value: "pretty", label: "Pretty" },
];

export function TypographyProperties({
	className,
	onChange,
}: TypographyPropertiesProps) {
	const systemId = useDesignSystemId();
	const resolved = useResolvedColorTokens(systemId);
	const resolvedFonts = useResolvedFontTokens(systemId);
	const fontFamilyOptions = useMemo(
		() => buildFontFamilyOptions(resolvedFonts),
		[resolvedFonts],
	);

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

	const fontSize = read("typography.font-size");
	const fontWeight = read("typography.font-weight");

	const summary =
		[fontSize, fontWeight].filter(Boolean).join(" · ") || undefined;

	return (
		<StyleSection title="Typography" summary={summary}>
			<StyleOverrideRows
				label="Font size"
				className={className}
				options={options}
				property="typography.font-size"
				onChange={onChange}
				renderControl={(slot) => (
					<Segmented
						ariaLabel="Font size"
						options={FONT_SIZE_OPTIONS}
						value={slot.value}
						onChange={(next) =>
							slot.apply(
								next === null ? null : typographyUtility("typography.font-size", next),
							)
						}
					/>
				)}
			/>
			<StyleOverrideRows
				label="Font weight"
				className={className}
				options={options}
				property="typography.font-weight"
				onChange={onChange}
				renderControl={(slot) => (
					<Segmented
						ariaLabel="Font weight"
						options={FONT_WEIGHT_OPTIONS}
						value={slot.value}
						onChange={(next) =>
							slot.apply(
								next === null ? null : typographyUtility("typography.font-weight", next),
							)
						}
					/>
				)}
			/>
			<StyleOverrideRows
				label="Font family"
				className={className}
				options={options}
				property="typography.font"
				onChange={onChange}
				renderControl={(slot) => (
					<Segmented
						ariaLabel="Font family"
						options={fontFamilyOptions}
						value={slot.value}
						onChange={(next) =>
							slot.apply(next === null ? null : typographyUtility("typography.font", next))
						}
					/>
				)}
			/>
			<StyleOverrideRows
				label="Text align"
				className={className}
				options={options}
				property="typography.text-align"
				onChange={onChange}
				renderControl={(slot) => (
					<Segmented
						ariaLabel="Text align"
						options={TEXT_ALIGN_OPTIONS}
						value={slot.value}
						onChange={(next) =>
							slot.apply(
								next === null ? null : typographyUtility("typography.text-align", next),
							)
						}
					/>
				)}
			/>
			<StyleOverrideRows
				label="Line height"
				className={className}
				options={options}
				property="typography.line-height"
				onChange={onChange}
				renderControl={(slot) => (
					<Segmented
						ariaLabel="Line height"
						options={LINE_HEIGHT_OPTIONS}
						value={slot.value}
						onChange={(next) =>
							slot.apply(
								next === null ? null : typographyUtility("typography.line-height", next),
							)
						}
					/>
				)}
			/>
			<ColorPropertyControl
				label="Text"
				property="text"
				model={model}
				resolved={resolved}
				onSet={(variants, value) =>
					onChange(
						applyColorChange(className, options, {
							property: "text",
							variants,
							value,
						}),
					)
				}
				onClear={(variants) =>
					onChange(applyColorClear(className, options, { property: "text", variants }))
				}
			/>
			<StyleOverrideRows
				label="Text transform"
				className={className}
				options={options}
				property="typography.text-transform"
				onChange={onChange}
				renderControl={(slot) => (
					<Segmented
						ariaLabel="Text transform"
						options={TEXT_TRANSFORM_OPTIONS}
						value={slot.value}
						onChange={(next) =>
							slot.apply(
								next === null ? null : typographyUtility("typography.text-transform", next),
							)
						}
					/>
				)}
			/>
			<StyleOverrideRows
				label="Text decoration"
				className={className}
				options={options}
				property="typography.text-decoration-line"
				onChange={onChange}
				renderControl={(slot) => (
					<Segmented
						ariaLabel="Text decoration"
						options={DECORATION_OPTIONS}
						value={slot.value === "none" ? "none" : slot.value}
						onChange={(next) =>
							slot.apply(
								next === null
									? null
									: typographyUtility("typography.text-decoration-line", next),
							)
						}
					/>
				)}
			/>
			<StyleOverrideRows
				label="Text wrap"
				className={className}
				options={options}
				property="typography.text-wrap"
				onChange={onChange}
				renderControl={(slot) => (
					<Segmented
						ariaLabel="Text wrap"
						options={TEXT_WRAP_OPTIONS}
						value={slot.value}
						onChange={(next) =>
							slot.apply(
								next === null ? null : typographyUtility("typography.text-wrap", next),
							)
						}
					/>
				)}
			/>
		</StyleSection>
	);
}
