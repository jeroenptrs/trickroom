import { useCallback, useMemo } from "react";
import { useResolvedCustomUtilities } from "../../../hooks/useResolvedCustomUtilities";
import { useResolvedDomainTokens } from "../../../hooks/useResolvedDomainTokens";
import { useDesignSystemId } from "../../../stores/design-store";
import type { ModelOptions } from "../../../utils/tailwind-classname";
import { Segmented, type SegmentedOption } from "../../ui/segmented";
import { offsetTokenOptions, zIndexTokenOptions } from "./domainTokenOptions";
import {
	insetUtilityFromInput,
	readPositionValue,
	zIndexUtilityFromInput,
} from "./positionPropertiesController";
import { StyleOverrideRows } from "./StyleOverrideRows";
import { StyleSection } from "./StyleSection";
import { resolveSpacingBasePx } from "./sizeTokenOptions";
import { getStyleIntent, styleValueText } from "./styleSectionController";
import { TokenField } from "./TokenField";

type PositionPropertiesProps = {
	className: string;
	onChange: (next: string) => void;
};

const EMPTY_COLOR_TOKENS = new Set<string>();

const POSITION_OPTIONS: readonly SegmentedOption<string>[] = [
	{ value: "static", label: "Static" },
	{ value: "relative", label: "Rel" },
	{ value: "absolute", label: "Abs" },
	{ value: "fixed", label: "Fixed" },
	{ value: "sticky", label: "Sticky" },
];

const OBJECT_FIT_OPTIONS: readonly SegmentedOption<string>[] = [
	{ value: "contain", label: "Contain" },
	{ value: "cover", label: "Cover" },
	{ value: "fill", label: "Fill" },
	{ value: "none", label: "None" },
	{ value: "scale-down", label: "Scale" },
];

const OBJECT_POSITION_OPTIONS: readonly SegmentedOption<string>[] = [
	{ value: "center", label: "Center" },
	{ value: "top", label: "Top" },
	{ value: "bottom", label: "Bottom" },
	{ value: "left", label: "Left" },
	{ value: "right", label: "Right" },
];

const ISOLATION_OPTIONS: readonly SegmentedOption<string>[] = [
	{ value: "isolate", label: "Isolate" },
	{ value: "auto", label: "Auto" },
];

type InsetFieldDefinition = {
	property:
		| "position.inset"
		| "position.inset-x"
		| "position.inset-y"
		| "position.top"
		| "position.right"
		| "position.bottom"
		| "position.left";
	label: string;
	prefix: string;
	placeholder: string;
};

const INSET_FIELDS: readonly InsetFieldDefinition[] = [
	{
		property: "position.inset",
		label: "Inset",
		prefix: "inset",
		placeholder: "0, 4, auto",
	},
	{
		property: "position.inset-x",
		label: "Inset X",
		prefix: "inset-x",
		placeholder: "0, 4",
	},
	{
		property: "position.inset-y",
		label: "Inset Y",
		prefix: "inset-y",
		placeholder: "0, 4",
	},
	{
		property: "position.top",
		label: "Top",
		prefix: "top",
		placeholder: "0, 4, -4, auto",
	},
	{
		property: "position.right",
		label: "Right",
		prefix: "right",
		placeholder: "0, 4, auto",
	},
	{
		property: "position.bottom",
		label: "Bottom",
		prefix: "bottom",
		placeholder: "0, 4, auto",
	},
	{
		property: "position.left",
		label: "Left",
		prefix: "left",
		placeholder: "0, 4, auto",
	},
];

export function PositionProperties({
	className,
	onChange,
}: PositionPropertiesProps) {
	const systemId = useDesignSystemId();
	const customUtilityRoots = useResolvedCustomUtilities(systemId);

	const options = useMemo<ModelOptions>(
		() => ({ colorTokens: EMPTY_COLOR_TOKENS, ...customUtilityRoots }),
		[customUtilityRoots],
	);

	const spacingTokens = useResolvedDomainTokens(systemId, "spacing");
	const insetOptions = useMemo(
		() => offsetTokenOptions(resolveSpacingBasePx(spacingTokens.values)),
		[spacingTokens.values],
	);
	const zOptions = useMemo(() => zIndexTokenOptions(), []);

	const read = useCallback(
		(property: Parameters<typeof readPositionValue>[2]) =>
			readPositionValue(className, options, property),
		[className, options],
	);

	const position = styleValueText(
		getStyleIntent(className, options, "position.position"),
	);
	const zIndex = read("position.z-index");
	const summary = [position, zIndex ? `z-${zIndex}` : null].filter(
		(value): value is string => value !== null,
	);

	return (
		<StyleSection title="Position" summary={summary}>
			<StyleOverrideRows
				label="Position"
				className={className}
				options={options}
				property="position.position"
				likely
				onChange={onChange}
				renderControl={(slot) => (
					<Segmented
						ariaLabel="Position"
						options={POSITION_OPTIONS}
						value={slot.value}
						onChange={(next) => slot.apply(next)}
					/>
				)}
			/>
			{INSET_FIELDS.map((field) => (
				<StyleOverrideRows
					key={field.property}
					label={field.label}
					className={className}
					options={options}
					property={field.property}
					inline
					onChange={onChange}
					renderControl={(slot) => (
						<TokenField
							label={field.label}
							value={slot.value ?? ""}
							placeholder={field.placeholder}
							options={insetOptions}
							onCommit={(v) =>
								slot.apply(insetUtilityFromInput(field.prefix, v))
							}
						/>
					)}
				/>
			))}
			<StyleOverrideRows
				label="Z-index"
				className={className}
				options={options}
				property="position.z-index"
				inline
				onChange={onChange}
				renderControl={(slot) => (
					<TokenField
						label="Z-index"
						value={slot.value ?? ""}
						placeholder="0, 10, auto"
						options={zOptions}
						onCommit={(v) => slot.apply(zIndexUtilityFromInput(v))}
					/>
				)}
			/>
			<StyleOverrideRows
				label="Object fit"
				className={className}
				options={options}
				property="position.object-fit"
				onChange={onChange}
				renderControl={(slot) => (
					<Segmented
						ariaLabel="Object fit"
						options={OBJECT_FIT_OPTIONS}
						value={slot.value}
						onChange={(next) =>
							slot.apply(next === null ? null : `object-${next}`)
						}
					/>
				)}
			/>
			<StyleOverrideRows
				label="Object position"
				className={className}
				options={options}
				property="position.object-position"
				onChange={onChange}
				renderControl={(slot) => (
					<Segmented
						ariaLabel="Object position"
						options={OBJECT_POSITION_OPTIONS}
						value={slot.value}
						onChange={(next) =>
							slot.apply(next === null ? null : `object-${next}`)
						}
					/>
				)}
			/>
			<StyleOverrideRows
				label="Isolation"
				className={className}
				options={options}
				property="position.isolation"
				onChange={onChange}
				renderControl={(slot) => (
					<Segmented
						ariaLabel="Isolation"
						options={ISOLATION_OPTIONS}
						value={slot.value}
						onChange={(next) =>
							slot.apply(
								next === null
									? null
									: next === "isolate"
										? "isolate"
										: "isolation-auto",
							)
						}
					/>
				)}
			/>
		</StyleSection>
	);
}
