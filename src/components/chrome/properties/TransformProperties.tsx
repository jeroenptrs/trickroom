import { useCallback, useMemo } from "react";
import { useResolvedCustomUtilities } from "../../../hooks/useResolvedCustomUtilities";
import { useResolvedDomainTokens } from "../../../hooks/useResolvedDomainTokens";
import { useDesignSystemId } from "../../../stores/design-store";
import type { ModelOptions } from "../../../utils/tailwind-classname";
import { Segmented, type SegmentedOption } from "../../ui/segmented";
import {
	offsetTokenOptions,
	rotateTokenOptions,
	scaleTokenOptions,
	skewTokenOptions,
} from "./domainTokenOptions";
import { StyleOverrideRows } from "./StyleOverrideRows";
import { StyleSection } from "./StyleSection";
import { resolveSpacingBasePx } from "./sizeTokenOptions";
import { TokenField } from "./TokenField";
import type { TokenFieldOption } from "./tokenFieldController";
import {
	readTransformValue,
	transformModeUtility,
	transformUtilityFromInput,
} from "./transformPropertiesController";

type TransformPropertiesProps = {
	className: string;
	onChange: (next: string) => void;
};

const EMPTY_COLOR_TOKENS = new Set<string>();

const TRANSFORM_MODE_OPTIONS: readonly SegmentedOption<string>[] = [
	{ value: "transform", label: "On" },
	{ value: "gpu", label: "GPU" },
	{ value: "cpu", label: "CPU" },
	{ value: "none", label: "Off" },
];

const ORIGIN_OPTIONS: readonly SegmentedOption<string>[] = [
	{ value: "center", label: "Ctr" },
	{ value: "top", label: "T" },
	{ value: "top-right", label: "TR" },
	{ value: "right", label: "R" },
	{ value: "bottom-right", label: "BR" },
	{ value: "bottom", label: "B" },
	{ value: "bottom-left", label: "BL" },
	{ value: "left", label: "L" },
	{ value: "top-left", label: "TL" },
];

type TransformFieldDefinition = {
	property: Parameters<typeof readTransformValue>[2];
	label: string;
	prefix: string;
	placeholder: string;
	likely?: boolean;
};

const TRANSFORM_FIELDS: readonly TransformFieldDefinition[] = [
	{
		property: "transform.translate-x",
		label: "Translate X",
		prefix: "translate-x",
		placeholder: "4, -4, [13px]",
	},
	{
		property: "transform.translate-y",
		label: "Translate Y",
		prefix: "translate-y",
		placeholder: "4, -4, [13px]",
	},
	{
		property: "transform.translate-z",
		label: "Translate Z",
		prefix: "translate-z",
		placeholder: "4, [13px]",
	},
	{
		property: "transform.rotate",
		label: "Rotate",
		prefix: "rotate",
		placeholder: "45, -90, [0.5turn]",
		likely: true,
	},
	{
		property: "transform.rotate-x",
		label: "Rotate X",
		prefix: "rotate-x",
		placeholder: "45, -90",
	},
	{
		property: "transform.rotate-y",
		label: "Rotate Y",
		prefix: "rotate-y",
		placeholder: "45, -90",
	},
	{
		property: "transform.scale",
		label: "Scale",
		prefix: "scale",
		placeholder: "50, 100, 150",
		likely: true,
	},
	{
		property: "transform.scale-x",
		label: "Scale X",
		prefix: "scale-x",
		placeholder: "50, 100",
	},
	{
		property: "transform.scale-y",
		label: "Scale Y",
		prefix: "scale-y",
		placeholder: "50, 100",
	},
	{
		property: "transform.skew-x",
		label: "Skew X",
		prefix: "skew-x",
		placeholder: "6, -6, [10deg]",
	},
	{
		property: "transform.skew-y",
		label: "Skew Y",
		prefix: "skew-y",
		placeholder: "6, -6, [10deg]",
	},
];

export function TransformProperties({
	className,
	onChange,
}: TransformPropertiesProps) {
	const systemId = useDesignSystemId();
	const customUtilityRoots = useResolvedCustomUtilities(systemId);

	const options = useMemo<ModelOptions>(
		() => ({ colorTokens: EMPTY_COLOR_TOKENS, ...customUtilityRoots }),
		[customUtilityRoots],
	);

	const spacingTokens = useResolvedDomainTokens(systemId, "spacing");
	const fieldOptions = useMemo<ReadonlyMap<string, TokenFieldOption[]>>(() => {
		const translate = offsetTokenOptions(
			resolveSpacingBasePx(spacingTokens.values),
		);
		const rotate = rotateTokenOptions();
		const scale = scaleTokenOptions();
		const skew = skewTokenOptions();
		return new Map(
			TRANSFORM_FIELDS.map((field) => [
				field.prefix,
				field.prefix.startsWith("translate")
					? translate
					: field.prefix.startsWith("rotate")
						? rotate
						: field.prefix.startsWith("scale")
							? scale
							: skew,
			]),
		);
	}, [spacingTokens.values]);

	const read = useCallback(
		(property: Parameters<typeof readTransformValue>[2]) =>
			readTransformValue(className, options, property),
		[className, options],
	);

	const rotate = read("transform.rotate");
	const scale = read("transform.scale");
	const translateX = read("transform.translate-x");
	const translateY = read("transform.translate-y");

	const summary = [
		rotate ? `rotate-${rotate}` : null,
		scale ? `scale-${scale}` : null,
		translateX || translateY ? "translate" : null,
	].filter((value): value is string => value !== null);

	return (
		<StyleSection title="Transform" summary={summary}>
			<StyleOverrideRows
				label="Transform mode"
				className={className}
				options={options}
				property="transform.transform-mode"
				onChange={onChange}
				renderControl={(slot) => (
					<Segmented
						ariaLabel="Transform mode"
						options={TRANSFORM_MODE_OPTIONS}
						value={slot.value}
						onChange={(next) =>
							slot.apply(next === null ? null : transformModeUtility(next))
						}
					/>
				)}
			/>
			{TRANSFORM_FIELDS.map((field) => (
				<StyleOverrideRows
					key={field.property}
					label={field.label}
					className={className}
					options={options}
					property={field.property}
					inline
					likely={field.likely}
					onChange={onChange}
					renderControl={(slot) => (
						<TokenField
							label={field.label}
							value={slot.value ?? ""}
							placeholder={field.placeholder}
							options={fieldOptions.get(field.prefix) ?? []}
							onCommit={(v) =>
								slot.apply(transformUtilityFromInput(field.prefix, v))
							}
						/>
					)}
				/>
			))}
			<StyleOverrideRows
				label="Origin"
				className={className}
				options={options}
				property="transform.transform-origin"
				onChange={onChange}
				renderControl={(slot) => (
					<Segmented
						ariaLabel="Transform origin"
						options={ORIGIN_OPTIONS}
						value={slot.value}
						onChange={(next) =>
							slot.apply(next === null ? null : `origin-${next}`)
						}
					/>
				)}
			/>
		</StyleSection>
	);
}
