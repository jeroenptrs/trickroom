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
import { Segmented, type SegmentedOption, ValueField } from "./StyleControls";
import { StyleOverrideRows } from "./StyleOverrideRows";
import { getStyleIntent, styleValueText } from "./styleSectionController";

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

/** Map a border-width value to its utility body. "DEFAULT" → bare "border". */
function borderWidthUtility(prefix: string, value: string): string {
	return value === "DEFAULT" ? prefix : `${prefix}-${value}`;
}

/** Map a border-radius value to its utility body. "DEFAULT" → bare "rounded". */
function borderRadiusUtility(value: string): string {
	return value === "DEFAULT" ? "rounded" : `rounded-${value}`;
}

export function BorderProperties({ className, onChange }: BorderPropertiesProps) {
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

	const borderWidth = read("border.border-width");
	const radius = read("border.radius");

	const borderWidthLabel =
		borderWidth === "DEFAULT" ? "border" : borderWidth ? `border-${borderWidth}` : null;
	const radiusLabel = radius
		? radius === "DEFAULT"
			? "rounded"
			: `rounded-${radius}`
		: null;
	const summary =
		[borderWidthLabel, radiusLabel].filter(Boolean).join(" · ") || undefined;

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
						applyColorClear(className, options, { property: "border", variants }),
					)
				}
			/>
			<StyleOverrideRows
				label="Width"
				className={className}
				options={options}
				property="border.border-width"
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
			<div className="grid grid-cols-2 gap-1">
				<StyleOverrideRows
					label="TL"
					className={className}
					options={options}
					property="border.radius-top-left"
					onChange={onChange}
					renderControl={(slot) => (
						<ValueField
							label="TL"
							value={slot.value ?? ""}
							placeholder="sm, lg, full"
							onCommit={(v) =>
								slot.apply(v.trim() ? `rounded-tl-${v.trim()}` : null)
							}
						/>
					)}
				/>
				<StyleOverrideRows
					label="TR"
					className={className}
					options={options}
					property="border.radius-top-right"
					onChange={onChange}
					renderControl={(slot) => (
						<ValueField
							label="TR"
							value={slot.value ?? ""}
							placeholder="sm, lg, full"
							onCommit={(v) =>
								slot.apply(v.trim() ? `rounded-tr-${v.trim()}` : null)
							}
						/>
					)}
				/>
				<StyleOverrideRows
					label="BL"
					className={className}
					options={options}
					property="border.radius-bottom-left"
					onChange={onChange}
					renderControl={(slot) => (
						<ValueField
							label="BL"
							value={slot.value ?? ""}
							placeholder="sm, lg, full"
							onCommit={(v) =>
								slot.apply(v.trim() ? `rounded-bl-${v.trim()}` : null)
							}
						/>
					)}
				/>
				<StyleOverrideRows
					label="BR"
					className={className}
					options={options}
					property="border.radius-bottom-right"
					onChange={onChange}
					renderControl={(slot) => (
						<ValueField
							label="BR"
							value={slot.value ?? ""}
							placeholder="sm, lg, full"
							onCommit={(v) =>
								slot.apply(v.trim() ? `rounded-br-${v.trim()}` : null)
							}
						/>
					)}
				/>
			</div>
			<div className="flex flex-col gap-1">
				<span className="px-0.5 text-[10px] text-slate-400">Divide</span>
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
			</div>
		</StyleSection>
	);
}
