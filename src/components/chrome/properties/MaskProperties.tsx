import { useCallback, useMemo } from "react";
import { useResolvedCustomUtilities } from "../../../hooks/useResolvedCustomUtilities";
import { useDesignSystemId } from "../../../stores/design-store";
import type {
	ModelOptions,
	StyleProperty,
} from "../../../utils/tailwind-classname";
import { Segmented, type SegmentedOption } from "../../ui/segmented";
import {
	percentStopTokenOptions,
	rotateTokenOptions,
} from "./domainTokenOptions";
import { maskUtility } from "./maskPropertiesController";
import { StyleOverrideRows } from "./StyleOverrideRows";
import { StyleSection } from "./StyleSection";
import { getStyleIntent, styleValueText } from "./styleSectionController";
import { TokenField } from "./TokenField";

type MaskPropertiesProps = {
	className: string;
	onChange: (next: string) => void;
};

const EMPTY_COLOR_TOKENS = new Set<string>();

const IMAGE_OPTIONS: readonly SegmentedOption<string>[] = [
	{ value: "none", label: "None" },
];

const MODE_OPTIONS: readonly SegmentedOption<string>[] = [
	{ value: "alpha", label: "Alpha" },
	{ value: "luminance", label: "Luma" },
];

const SIZE_OPTIONS: readonly SegmentedOption<string>[] = [
	{ value: "auto", label: "Auto" },
	{ value: "cover", label: "Cover" },
	{ value: "contain", label: "Contain" },
];

const POSITION_OPTIONS: readonly SegmentedOption<string>[] = [
	{ value: "center", label: "Center" },
	{ value: "top", label: "Top" },
	{ value: "bottom", label: "Bottom" },
	{ value: "left", label: "Left" },
	{ value: "right", label: "Right" },
];

const REPEAT_OPTIONS: readonly SegmentedOption<string>[] = [
	{ value: "no-repeat", label: "None" },
	{ value: "repeat", label: "Repeat" },
	{ value: "repeat-x", label: "X" },
	{ value: "repeat-y", label: "Y" },
];

const BOX_EDGE_OPTIONS: readonly SegmentedOption<string>[] = [
	{ value: "border", label: "Border" },
	{ value: "padding", label: "Padding" },
	{ value: "content", label: "Content" },
];

const COMPOSITE_OPTIONS: readonly SegmentedOption<string>[] = [
	{ value: "add", label: "Add" },
	{ value: "subtract", label: "Sub" },
	{ value: "intersect", label: "Int" },
	{ value: "exclude", label: "Exc" },
];

const RADIAL_AT_OPTIONS: readonly SegmentedOption<string>[] = [
	{ value: "center", label: "Center" },
	{ value: "top", label: "Top" },
	{ value: "bottom", label: "Bottom" },
	{ value: "left", label: "Left" },
	{ value: "right", label: "Right" },
	{ value: "bottom-left", label: "↙" },
	{ value: "bottom-right", label: "↘" },
];

const LINEAR_ANGLE_OPTIONS: readonly SegmentedOption<string>[] = [
	{ value: "0", label: "0°" },
	{ value: "90", label: "90°" },
	{ value: "180", label: "180°" },
	{ value: "45", label: "45°" },
];

const CONIC_ANGLE_OPTIONS: readonly SegmentedOption<string>[] = [
	{ value: "0", label: "0°" },
	{ value: "45", label: "45°" },
	{ value: "90", label: "90°" },
	{ value: "180", label: "180°" },
];

/** Override-aware: all mask segmenteds and linear/radial/conic value fields. */
export function MaskProperties({ className, onChange }: MaskPropertiesProps) {
	const systemId = useDesignSystemId();
	const customUtilityRoots = useResolvedCustomUtilities(systemId);

	const options = useMemo<ModelOptions>(
		() => ({ colorTokens: EMPTY_COLOR_TOKENS, ...customUtilityRoots }),
		[customUtilityRoots],
	);

	const stopOptions = useMemo(() => percentStopTokenOptions(), []);
	const conicOptions = useMemo(() => rotateTokenOptions(), []);

	const read = useCallback(
		(property: StyleProperty) =>
			styleValueText(getStyleIntent(className, options, property)),
		[className, options],
	);

	const maskMode = read("mask.mask-mode");
	const maskSize = read("mask.mask-size");
	const maskLinear = read("mask.mask-linear");

	const summary = [maskSize, maskMode, maskLinear].filter(
		(value): value is string => value !== null && value !== undefined,
	);

	return (
		<StyleSection title="Mask" summary={summary}>
			<StyleOverrideRows
				label="Mask image"
				className={className}
				options={options}
				property="mask.mask-image"
				onChange={onChange}
				renderControl={(slot) => (
					<Segmented
						ariaLabel="Mask image"
						options={IMAGE_OPTIONS}
						value={slot.value === "none" ? "none" : null}
						onChange={(next) =>
							slot.apply(
								next === null ? null : maskUtility("mask.mask-image", next),
							)
						}
					/>
				)}
			/>
			<StyleOverrideRows
				label="Mask mode"
				className={className}
				options={options}
				property="mask.mask-mode"
				onChange={onChange}
				renderControl={(slot) => (
					<Segmented
						ariaLabel="Mask mode"
						options={MODE_OPTIONS}
						value={slot.value}
						onChange={(next) =>
							slot.apply(
								next === null ? null : maskUtility("mask.mask-mode", next),
							)
						}
					/>
				)}
			/>
			<StyleOverrideRows
				label="Mask size"
				className={className}
				options={options}
				property="mask.mask-size"
				onChange={onChange}
				renderControl={(slot) => (
					<Segmented
						ariaLabel="Mask size"
						options={SIZE_OPTIONS}
						value={slot.value}
						onChange={(next) =>
							slot.apply(
								next === null ? null : maskUtility("mask.mask-size", next),
							)
						}
					/>
				)}
			/>
			<StyleOverrideRows
				label="Mask position"
				className={className}
				options={options}
				property="mask.mask-position"
				onChange={onChange}
				renderControl={(slot) => (
					<Segmented
						ariaLabel="Mask position"
						options={POSITION_OPTIONS}
						value={slot.value}
						onChange={(next) =>
							slot.apply(
								next === null ? null : maskUtility("mask.mask-position", next),
							)
						}
					/>
				)}
			/>
			<StyleOverrideRows
				label="Mask repeat"
				className={className}
				options={options}
				property="mask.mask-repeat"
				onChange={onChange}
				renderControl={(slot) => (
					<Segmented
						ariaLabel="Mask repeat"
						options={REPEAT_OPTIONS}
						value={slot.value}
						onChange={(next) =>
							slot.apply(
								next === null ? null : maskUtility("mask.mask-repeat", next),
							)
						}
					/>
				)}
			/>
			<StyleOverrideRows
				label="Mask origin"
				className={className}
				options={options}
				property="mask.mask-origin"
				onChange={onChange}
				renderControl={(slot) => (
					<Segmented
						ariaLabel="Mask origin"
						options={BOX_EDGE_OPTIONS}
						value={slot.value}
						onChange={(next) =>
							slot.apply(
								next === null ? null : maskUtility("mask.mask-origin", next),
							)
						}
					/>
				)}
			/>
			<StyleOverrideRows
				label="Mask clip"
				className={className}
				options={options}
				property="mask.mask-clip"
				onChange={onChange}
				renderControl={(slot) => (
					<Segmented
						ariaLabel="Mask clip"
						options={BOX_EDGE_OPTIONS}
						value={slot.value}
						onChange={(next) =>
							slot.apply(
								next === null ? null : maskUtility("mask.mask-clip", next),
							)
						}
					/>
				)}
			/>
			<StyleOverrideRows
				label="Mask composite"
				className={className}
				options={options}
				property="mask.mask-composite"
				onChange={onChange}
				renderControl={(slot) => (
					<Segmented
						ariaLabel="Mask composite"
						options={COMPOSITE_OPTIONS}
						value={slot.value}
						onChange={(next) =>
							slot.apply(
								next === null ? null : maskUtility("mask.mask-composite", next),
							)
						}
					/>
				)}
			/>
			<StyleOverrideRows
				label="Linear mask angle"
				className={className}
				options={options}
				property="mask.mask-linear"
				onChange={onChange}
				renderControl={(slot) => (
					<Segmented
						ariaLabel="Linear mask angle"
						options={LINEAR_ANGLE_OPTIONS}
						value={slot.value}
						onChange={(next) =>
							slot.apply(
								next === null ? null : maskUtility("mask.mask-linear", next),
							)
						}
					/>
				)}
			/>
			<StyleOverrideRows
				label="Linear from"
				className={className}
				options={options}
				property="mask.mask-linear-from"
				inline
				onChange={onChange}
				renderControl={(slot) => (
					<TokenField
						label="Linear from"
						value={slot.value ?? ""}
						placeholder="0%"
						options={stopOptions}
						onCommit={(next) =>
							slot.apply(
								next.trim()
									? maskUtility("mask.mask-linear-from", next.trim())
									: null,
							)
						}
					/>
				)}
			/>
			<StyleOverrideRows
				label="Linear to"
				className={className}
				options={options}
				property="mask.mask-linear-to"
				inline
				onChange={onChange}
				renderControl={(slot) => (
					<TokenField
						label="Linear to"
						value={slot.value ?? ""}
						placeholder="100%"
						options={stopOptions}
						onCommit={(next) =>
							slot.apply(
								next.trim()
									? maskUtility("mask.mask-linear-to", next.trim())
									: null,
							)
						}
					/>
				)}
			/>
			<StyleOverrideRows
				label="Radial mask at"
				className={className}
				options={options}
				property="mask.mask-radial-position"
				onChange={onChange}
				renderControl={(slot) => (
					<Segmented
						ariaLabel="Radial mask at"
						options={RADIAL_AT_OPTIONS}
						value={slot.value}
						onChange={(next) =>
							slot.apply(
								next === null
									? null
									: maskUtility("mask.mask-radial-position", next),
							)
						}
					/>
				)}
			/>
			<StyleOverrideRows
				label="Radial from"
				className={className}
				options={options}
				property="mask.mask-radial-from"
				inline
				onChange={onChange}
				renderControl={(slot) => (
					<TokenField
						label="Radial from"
						value={slot.value ?? ""}
						placeholder="0%"
						options={stopOptions}
						onCommit={(next) =>
							slot.apply(
								next.trim()
									? maskUtility("mask.mask-radial-from", next.trim())
									: null,
							)
						}
					/>
				)}
			/>
			<StyleOverrideRows
				label="Radial to"
				className={className}
				options={options}
				property="mask.mask-radial-to"
				inline
				onChange={onChange}
				renderControl={(slot) => (
					<TokenField
						label="Radial to"
						value={slot.value ?? ""}
						placeholder="100%"
						options={stopOptions}
						onCommit={(next) =>
							slot.apply(
								next.trim()
									? maskUtility("mask.mask-radial-to", next.trim())
									: null,
							)
						}
					/>
				)}
			/>
			<StyleOverrideRows
				label="Conic mask angle"
				className={className}
				options={options}
				property="mask.mask-conic"
				onChange={onChange}
				renderControl={(slot) => (
					<Segmented
						ariaLabel="Conic mask angle"
						options={CONIC_ANGLE_OPTIONS}
						value={slot.value}
						onChange={(next) =>
							slot.apply(
								next === null ? null : maskUtility("mask.mask-conic", next),
							)
						}
					/>
				)}
			/>
			<StyleOverrideRows
				label="Conic from"
				className={className}
				options={options}
				property="mask.mask-conic-from"
				inline
				onChange={onChange}
				renderControl={(slot) => (
					<TokenField
						label="Conic from"
						value={slot.value ?? ""}
						placeholder="0"
						options={conicOptions}
						onCommit={(next) =>
							slot.apply(
								next.trim()
									? maskUtility("mask.mask-conic-from", next.trim())
									: null,
							)
						}
					/>
				)}
			/>
			<StyleOverrideRows
				label="Conic to"
				className={className}
				options={options}
				property="mask.mask-conic-to"
				inline
				onChange={onChange}
				renderControl={(slot) => (
					<TokenField
						label="Conic to"
						value={slot.value ?? ""}
						placeholder="180"
						options={conicOptions}
						onCommit={(next) =>
							slot.apply(
								next.trim()
									? maskUtility("mask.mask-conic-to", next.trim())
									: null,
							)
						}
					/>
				)}
			/>
		</StyleSection>
	);
}
