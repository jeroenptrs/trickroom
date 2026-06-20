import { useCallback, useMemo } from "react";
import { useResolvedColorTokens } from "../../../hooks/useResolvedColorTokens";
import { useResolvedCustomUtilities } from "../../../hooks/useResolvedCustomUtilities";
import { useResolvedDomainTokens } from "../../../hooks/useResolvedDomainTokens";
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
import { radiusTokenOptions } from "./domainTokenOptions";
import { propertyHasEntries } from "./propertySlots";
import { StyleOverrideRows } from "./StyleOverrideRows";
import { SectionGroupLabel, StyleSection } from "./StyleSection";
import { getStyleIntent, styleValueText } from "./styleSectionController";
import { TokenField } from "./TokenField";

type BorderPropertiesProps = {
	className: string;
	onChange: (next: string) => void;
};

const BORDER_WIDTH_OPTIONS: readonly SegmentedOption<string>[] = [
	{ value: "0", label: "0" },
	{ value: "DEFAULT", label: "1" },
	{ value: "2", label: "2" },
	{ value: "4", label: "4" },
	{ value: "8", label: "8" },
];

const BORDER_STYLE_OPTIONS: readonly SegmentedOption<string>[] = [
	{ value: "solid", label: "Solid" },
	{ value: "dashed", label: "Dash" },
	{ value: "dotted", label: "Dot" },
	{ value: "double", label: "Dbl" },
	{ value: "none", label: "None" },
];

const RADIUS_OPTIONS: readonly SegmentedOption<string>[] = [
	{ value: "none", label: "0" },
	{ value: "DEFAULT", label: "base" },
	{ value: "sm", label: "sm" },
	{ value: "md", label: "md" },
	{ value: "lg", label: "lg" },
	{ value: "xl", label: "xl" },
	{ value: "full", label: "full" },
];

const DIVIDE_WIDTH_OPTIONS: readonly SegmentedOption<string>[] = [
	{ value: "DEFAULT", label: "1" },
	{ value: "2", label: "2" },
	{ value: "4", label: "4" },
	{ value: "8", label: "8" },
];

const DIVIDE_STYLE_OPTIONS: readonly SegmentedOption<string>[] = [
	{ value: "solid", label: "Solid" },
	{ value: "dashed", label: "Dash" },
	{ value: "dotted", label: "Dot" },
	{ value: "none", label: "None" },
];

const DIVIDE_PROPERTIES: readonly StyleProperty[] = [
	"border.divide-x-width",
	"border.divide-y-width",
	"border.divide-style",
];

/** Map a border-width value to its utility body. "DEFAULT" → bare "border". */
function borderWidthUtility(prefix: string, value: string): string {
	return value === "DEFAULT" ? prefix : `${prefix}-${value}`;
}

/** Map a border-radius value to its utility body. "DEFAULT" → bare "rounded". */
function borderRadiusUtility(value: string): string {
	return value === "DEFAULT" ? "rounded" : `rounded-${value}`;
}

export function BorderProperties({
	className,
	onChange,
}: BorderPropertiesProps) {
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

	const radiusTokens = useResolvedDomainTokens(systemId, "radius");
	const cornerOptions = useMemo(
		() => radiusTokenOptions(radiusTokens.values),
		[radiusTokens.values],
	);

	const read = useCallback(
		(property: StyleProperty) =>
			styleValueText(getStyleIntent(className, options, property)),
		[className, options],
	);

	const borderWidth = read("border.border-width");
	const radius = read("border.radius");

	const borderWidthLabel =
		borderWidth === "DEFAULT"
			? "border"
			: borderWidth
				? `border-${borderWidth}`
				: null;
	const radiusLabel = radius
		? radius === "DEFAULT"
			? "rounded"
			: `rounded-${radius}`
		: null;
	const summary = [borderWidthLabel, radiusLabel].filter(
		(value): value is string => value !== null,
	);

	return (
		<StyleSection title="Border" summary={summary}>
			<ColorPropertyControl
				label="Color"
				property="border"
				model={model}
				resolved={resolved}
				onSet={(variants, value) =>
					onChange(
						applyColorChange(className, options, {
							property: "border",
							variants,
							value,
						}),
					)
				}
				onClear={(variants) =>
					onChange(
						applyColorClear(className, options, {
							property: "border",
							variants,
						}),
					)
				}
				onClearAll={(chains) =>
					onChange(applyColorClearAll(className, options, "border", chains))
				}
			/>
			<StyleOverrideRows
				label="Width"
				className={className}
				options={options}
				property="border.border-width"
				likely
				onChange={onChange}
				renderControl={(slot) => (
					<Segmented
						ariaLabel="Border width"
						options={BORDER_WIDTH_OPTIONS}
						value={slot.value}
						onChange={(next) =>
							slot.apply(
								next === null ? null : borderWidthUtility("border", next),
							)
						}
					/>
				)}
			/>
			<StyleOverrideRows
				label="Style"
				className={className}
				options={options}
				property="border.border-style"
				onChange={onChange}
				renderControl={(slot) => (
					<Segmented
						ariaLabel="Border style"
						options={BORDER_STYLE_OPTIONS}
						value={slot.value}
						onChange={(next) =>
							slot.apply(next === null ? null : `border-${next}`)
						}
					/>
				)}
			/>
			<StyleOverrideRows
				label="Radius"
				className={className}
				options={options}
				property="border.radius"
				likely
				onChange={onChange}
				renderControl={(slot) => (
					<Segmented
						ariaLabel="Border radius"
						options={RADIUS_OPTIONS}
						value={slot.value}
						onChange={(next) =>
							slot.apply(next === null ? null : borderRadiusUtility(next))
						}
					/>
				)}
			/>
			{(
				[
					["border.radius-top-left", "Radius TL", "tl"],
					["border.radius-top-right", "Radius TR", "tr"],
					["border.radius-bottom-left", "Radius BL", "bl"],
					["border.radius-bottom-right", "Radius BR", "br"],
				] as const
			).map(([property, label, corner]) => (
				<StyleOverrideRows
					key={property}
					label={label}
					className={className}
					options={options}
					property={property}
					inline
					onChange={onChange}
					renderControl={(slot) => (
						<TokenField
							label={label}
							value={slot.value ?? ""}
							placeholder="sm, lg, full"
							options={cornerOptions}
							onCommit={(v) =>
								slot.apply(v.trim() ? `rounded-${corner}-${v.trim()}` : null)
							}
						/>
					)}
				/>
			))}
			<SectionGroupLabel
				label="Divide"
				ids={DIVIDE_PROPERTIES}
				anySet={DIVIDE_PROPERTIES.some((property) =>
					propertyHasEntries(model, property),
				)}
			/>
			<StyleOverrideRows
				label="Divide X"
				className={className}
				options={options}
				property="border.divide-x-width"
				onChange={onChange}
				renderControl={(slot) => (
					<Segmented
						ariaLabel="Divide X width"
						options={DIVIDE_WIDTH_OPTIONS}
						value={slot.value}
						onChange={(next) =>
							slot.apply(
								next === null ? null : borderWidthUtility("divide-x", next),
							)
						}
					/>
				)}
			/>
			<StyleOverrideRows
				label="Divide Y"
				className={className}
				options={options}
				property="border.divide-y-width"
				onChange={onChange}
				renderControl={(slot) => (
					<Segmented
						ariaLabel="Divide Y width"
						options={DIVIDE_WIDTH_OPTIONS}
						value={slot.value}
						onChange={(next) =>
							slot.apply(
								next === null ? null : borderWidthUtility("divide-y", next),
							)
						}
					/>
				)}
			/>
			<StyleOverrideRows
				label="Divide style"
				className={className}
				options={options}
				property="border.divide-style"
				onChange={onChange}
				renderControl={(slot) => (
					<Segmented
						ariaLabel="Divide style"
						options={DIVIDE_STYLE_OPTIONS}
						value={slot.value}
						onChange={(next) =>
							slot.apply(next === null ? null : `divide-${next}`)
						}
					/>
				)}
			/>
		</StyleSection>
	);
}
