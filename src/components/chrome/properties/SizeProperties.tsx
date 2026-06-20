import { useMemo } from "react";
import { useResolvedCustomUtilities } from "../../../hooks/useResolvedCustomUtilities";
import { useResolvedDomainTokens } from "../../../hooks/useResolvedDomainTokens";
import { useDesignSystemId } from "../../../stores/design-store";
import {
	buildPropertyModel,
	type ModelOptions,
	type StyleProperty,
} from "../../../utils/tailwind-classname";
import { Segmented, type SegmentedOption } from "../../ui/segmented";
import { propertyHasEntries } from "./propertySlots";
import { StyleOverrideRows } from "./StyleOverrideRows";
import { SectionGroupLabel, StyleSection } from "./StyleSection";
import { inputToSizeUtility, readSizeValue } from "./sizePropertiesController";
import {
	resolveSpacingBasePx,
	type SizeTokenContext,
	sizeTokenOptions,
} from "./sizeTokenOptions";
import { TokenField } from "./TokenField";
import type { TokenFieldOption } from "./tokenFieldController";

type SizePropertiesProps = {
	className: string;
	onChange: (next: string) => void;
};

const EMPTY_COLOR_TOKENS = new Set<string>();

type SizeFieldDefinition = {
	property: StyleProperty;
	/** Row name: ghost chips, the add-property menu, peek headings. */
	label: string;
	/** Short form inside the token field; defaults to `label`. */
	fieldLabel?: string;
	prefix: string;
	placeholder: string;
	likely?: boolean;
};

/**
 * Rows of one or two fields: natural partners (W+H, min+max) render side by
 * side when visible (board 02's 2-up grid). Pair wrappers use `empty:hidden`,
 * so a fully hidden pair leaves no stray flex gap while its rows stay
 * registered with the section.
 */
const SIZE_FIELD_ROWS: readonly (readonly SizeFieldDefinition[])[] = [
	[
		{
			property: "size.width",
			label: "Width",
			fieldLabel: "W",
			prefix: "w",
			placeholder: "auto, 4, full",
			likely: true,
		},
		{
			property: "size.height",
			label: "Height",
			fieldLabel: "H",
			prefix: "h",
			placeholder: "auto, 4, full",
			likely: true,
		},
	],
	[
		{
			property: "size.size",
			label: "Size",
			prefix: "size",
			placeholder: "4, full, [200px]",
		},
	],
	[
		{
			property: "size.min-width",
			label: "Min width",
			fieldLabel: "Min W",
			prefix: "min-w",
			placeholder: "0, 4, full",
		},
		{
			property: "size.max-width",
			label: "Max width",
			fieldLabel: "Max W",
			prefix: "max-w",
			placeholder: "4, full, none",
		},
	],
	[
		{
			property: "size.min-height",
			label: "Min height",
			fieldLabel: "Min H",
			prefix: "min-h",
			placeholder: "0, 4, full",
		},
		{
			property: "size.max-height",
			label: "Max height",
			fieldLabel: "Max H",
			prefix: "max-h",
			placeholder: "4, full, none",
		},
	],
	[
		{
			property: "size.aspect-ratio",
			label: "Aspect ratio",
			fieldLabel: "Aspect",
			prefix: "aspect",
			placeholder: "auto, square, video",
		},
	],
];

const SIZE_FIELDS: readonly SizeFieldDefinition[] = SIZE_FIELD_ROWS.flat();

const FLEX_CHILD_PROPERTIES: readonly StyleProperty[] = [
	"size.flex-basis",
	"size.flex",
	"size.grow",
	"size.shrink",
];

const FLEX_OPTIONS: readonly SegmentedOption<string>[] = [
	{ value: "1", label: "1" },
	{ value: "auto", label: "Auto" },
	{ value: "initial", label: "Init" },
	{ value: "none", label: "None" },
];

const GROW_OPTIONS: readonly SegmentedOption<string>[] = [
	{ value: "0", label: "0" },
	{ value: "1", label: "1" },
];

const SHRINK_OPTIONS: readonly SegmentedOption<string>[] = [
	{ value: "0", label: "0" },
	{ value: "1", label: "1" },
];

const NO_OPTIONS: readonly TokenFieldOption[] = [];

export function SizeProperties({ className, onChange }: SizePropertiesProps) {
	const systemId = useDesignSystemId();
	const customUtilityRoots = useResolvedCustomUtilities(systemId);

	const options = useMemo<ModelOptions>(
		() => ({ colorTokens: EMPTY_COLOR_TOKENS, ...customUtilityRoots }),
		[customUtilityRoots],
	);

	const model = useMemo(
		() => buildPropertyModel(className, options),
		[className, options],
	);

	const spacingTokens = useResolvedDomainTokens(systemId, "spacing");
	const containerTokens = useResolvedDomainTokens(systemId, "container");
	const aspectTokens = useResolvedDomainTokens(systemId, "aspect");

	const tokenOptionsByProperty = useMemo(() => {
		const context: SizeTokenContext = {
			spacingBasePx: resolveSpacingBasePx(spacingTokens.values),
			containerTokens: containerTokens.values,
			aspectTokens: aspectTokens.values,
		};
		const byProperty = new Map<StyleProperty, TokenFieldOption[]>();
		for (const field of SIZE_FIELDS) {
			byProperty.set(field.property, sizeTokenOptions(field.property, context));
		}
		byProperty.set(
			"size.flex-basis",
			sizeTokenOptions("size.flex-basis", context),
		);
		return byProperty;
	}, [spacingTokens.values, containerTokens.values, aspectTokens.values]);

	const w = readSizeValue(className, options, "size.width");
	const h = readSizeValue(className, options, "size.height");
	const summary = [w && `w-${w}`, h && `h-${h}`].filter(
		(value): value is string => Boolean(value),
	);

	const flexChildAnySet = FLEX_CHILD_PROPERTIES.some((property) =>
		propertyHasEntries(model, property),
	);

	return (
		<StyleSection title="Size" summary={summary}>
			{SIZE_FIELD_ROWS.map((row) => (
				<div key={row[0]?.property} className="flex gap-2 empty:hidden">
					{row.map((field) => (
						<StyleOverrideRows
							key={field.property}
							label={field.label}
							className={className}
							options={options}
							property={field.property}
							inline
							likely={field.likely}
							rowClassName="min-w-0 flex-1"
							onChange={onChange}
							renderControl={(slot) => (
								<TokenField
									label={field.fieldLabel ?? field.label}
									value={slot.value ?? ""}
									placeholder={field.placeholder}
									options={
										tokenOptionsByProperty.get(field.property) ?? NO_OPTIONS
									}
									onCommit={(value) =>
										slot.apply(inputToSizeUtility(field.prefix, value))
									}
								/>
							)}
						/>
					))}
				</div>
			))}
			<SectionGroupLabel
				label="Flex child"
				ids={FLEX_CHILD_PROPERTIES}
				anySet={flexChildAnySet}
			/>
			<StyleOverrideRows
				label="Basis"
				className={className}
				options={options}
				property="size.flex-basis"
				inline
				onChange={onChange}
				renderControl={(slot) => (
					<TokenField
						label="Basis"
						value={slot.value ?? ""}
						placeholder="auto, 4, full"
						options={
							tokenOptionsByProperty.get("size.flex-basis") ?? NO_OPTIONS
						}
						onCommit={(v) => slot.apply(inputToSizeUtility("basis", v))}
					/>
				)}
			/>
			<StyleOverrideRows
				label="Flex"
				className={className}
				options={options}
				property="size.flex"
				onChange={onChange}
				renderControl={(slot) => (
					<Segmented
						ariaLabel="Flex shorthand"
						options={FLEX_OPTIONS}
						value={slot.value}
						onChange={(next) =>
							slot.apply(next === null ? null : `flex-${next}`)
						}
					/>
				)}
			/>
			<StyleOverrideRows
				label="Grow"
				className={className}
				options={options}
				property="size.grow"
				onChange={onChange}
				renderControl={(slot) => (
					<Segmented
						ariaLabel="Grow"
						options={GROW_OPTIONS}
						value={slot.value}
						onChange={(next) =>
							slot.apply(
								next === null
									? null
									: next === "1"
										? "grow"
										: next === "0"
											? "grow-0"
											: null,
							)
						}
					/>
				)}
			/>
			<StyleOverrideRows
				label="Shrink"
				className={className}
				options={options}
				property="size.shrink"
				onChange={onChange}
				renderControl={(slot) => (
					<Segmented
						ariaLabel="Shrink"
						options={SHRINK_OPTIONS}
						value={slot.value}
						onChange={(next) =>
							slot.apply(
								next === null
									? null
									: next === "1"
										? "shrink"
										: next === "0"
											? "shrink-0"
											: null,
							)
						}
					/>
				)}
			/>
		</StyleSection>
	);
}
