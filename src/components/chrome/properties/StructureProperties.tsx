import { useCallback, useMemo } from "react";
import { useResolvedCustomUtilities } from "../../../hooks/useResolvedCustomUtilities";
import { useDesignSystemId } from "../../../stores/design-store";
import {
	buildPropertyModel,
	type ModelOptions,
	type StyleProperty,
} from "../../../utils/tailwind-classname";
import { Segmented, type SegmentedOption } from "../../ui/segmented";
import { columnsTokenOptions } from "./domainTokenOptions";
import { propertyHasEntries } from "./propertySlots";
import { ValueField } from "./StyleControls";
import { StyleOverrideRows } from "./StyleOverrideRows";
import { SectionGroupLabel, StyleSection } from "./StyleSection";
import {
	readStructureValue,
	structureUtility,
} from "./structurePropertiesController";
import { TokenField } from "./TokenField";

type StructurePropertiesProps = {
	className: string;
	onChange: (next: string) => void;
};

const EMPTY_COLOR_TOKENS = new Set<string>();

const BOX_SIZING_OPTIONS: readonly SegmentedOption<string>[] = [
	{ value: "border", label: "Border" },
	{ value: "content", label: "Content" },
];

const BOX_DECORATION_OPTIONS: readonly SegmentedOption<string>[] = [
	{ value: "slice", label: "Slice" },
	{ value: "clone", label: "Clone" },
];

const VISIBILITY_OPTIONS: readonly SegmentedOption<string>[] = [
	{ value: "visible", label: "Visible" },
	{ value: "invisible", label: "Hidden" },
	{ value: "collapse", label: "Collapse" },
];

const FLOAT_OPTIONS: readonly SegmentedOption<string>[] = [
	{ value: "left", label: "Left" },
	{ value: "right", label: "Right" },
	{ value: "none", label: "None" },
	{ value: "start", label: "Start" },
	{ value: "end", label: "End" },
];

const CLEAR_OPTIONS: readonly SegmentedOption<string>[] = [
	{ value: "left", label: "Left" },
	{ value: "right", label: "Right" },
	{ value: "both", label: "Both" },
	{ value: "none", label: "None" },
];

const BREAK_OPTIONS: readonly SegmentedOption<string>[] = [
	{ value: "auto", label: "Auto" },
	{ value: "avoid", label: "Avoid" },
	{ value: "all", label: "All" },
	{ value: "avoid-page", label: "Avoid page" },
];

const LIST_TYPE_OPTIONS: readonly SegmentedOption<string>[] = [
	{ value: "none", label: "None" },
	{ value: "disc", label: "Disc" },
	{ value: "decimal", label: "Decimal" },
];

const LIST_POSITION_OPTIONS: readonly SegmentedOption<string>[] = [
	{ value: "inside", label: "Inside" },
	{ value: "outside", label: "Outside" },
];

const TABLE_LAYOUT_OPTIONS: readonly SegmentedOption<string>[] = [
	{ value: "auto", label: "Auto" },
	{ value: "fixed", label: "Fixed" },
];

const BORDER_COLLAPSE_OPTIONS: readonly SegmentedOption<string>[] = [
	{ value: "collapse", label: "Collapse" },
	{ value: "separate", label: "Separate" },
];

const CAPTION_OPTIONS: readonly SegmentedOption<string>[] = [
	{ value: "top", label: "Top" },
	{ value: "bottom", label: "Bottom" },
];

const FLOAT_CLEAR_PROPERTIES: readonly StyleProperty[] = [
	"structure.float",
	"structure.clear",
];

const BREAK_PROPERTIES: readonly StyleProperty[] = [
	"structure.break-before",
	"structure.break-after",
	"structure.break-inside",
];

const LIST_PROPERTIES: readonly StyleProperty[] = [
	"structure.list-style-type",
	"structure.list-style-position",
	"structure.list-image",
];

const TABLE_PROPERTIES: readonly StyleProperty[] = [
	"structure.table-layout",
	"structure.border-collapse",
	"structure.caption-side",
];

/** Override-aware: all box/list/table segmenteds plus columns and list-image fields. */
export function StructureProperties({
	className,
	onChange,
}: StructurePropertiesProps) {
	const systemId = useDesignSystemId();
	const customUtilityRoots = useResolvedCustomUtilities(systemId);

	const options = useMemo<ModelOptions>(
		() => ({ colorTokens: EMPTY_COLOR_TOKENS, ...customUtilityRoots }),
		[customUtilityRoots],
	);

	const columnOptions = useMemo(() => columnsTokenOptions(), []);

	const read = useCallback(
		(property: StyleProperty) =>
			readStructureValue(className, options, property),
		[className, options],
	);

	const model = useMemo(
		() => buildPropertyModel(className, options),
		[className, options],
	);
	const groupAnySet = (ids: readonly StyleProperty[]) =>
		ids.some((property) => propertyHasEntries(model, property));

	const visibility = read("structure.visibility");
	const floatVal = read("structure.float");
	const columns = read("structure.columns");
	const tableLayout = read("structure.table-layout");

	const summary = [
		visibility,
		floatVal ? `float-${floatVal}` : null,
		columns ? `cols ${columns}` : null,
		tableLayout ? `table-${tableLayout}` : null,
	].filter((value): value is string => value !== null);

	return (
		<StyleSection title="Structure" summary={summary}>
			<StyleOverrideRows
				label="Box sizing"
				className={className}
				options={options}
				property="structure.box-sizing"
				onChange={onChange}
				renderControl={(slot) => (
					<Segmented
						ariaLabel="Box sizing"
						options={BOX_SIZING_OPTIONS}
						value={slot.value}
						onChange={(next) =>
							slot.apply(
								next === null
									? null
									: structureUtility("structure.box-sizing", next),
							)
						}
					/>
				)}
			/>
			<StyleOverrideRows
				label="Box decoration break"
				className={className}
				options={options}
				property="structure.box-decoration-break"
				onChange={onChange}
				renderControl={(slot) => (
					<Segmented
						ariaLabel="Box decoration break"
						options={BOX_DECORATION_OPTIONS}
						value={slot.value}
						onChange={(next) =>
							slot.apply(
								next === null
									? null
									: structureUtility("structure.box-decoration-break", next),
							)
						}
					/>
				)}
			/>
			<StyleOverrideRows
				label="Visibility"
				className={className}
				options={options}
				property="structure.visibility"
				onChange={onChange}
				renderControl={(slot) => (
					<Segmented
						ariaLabel="Visibility"
						options={VISIBILITY_OPTIONS}
						value={slot.value}
						onChange={(next) =>
							slot.apply(
								next === null
									? null
									: structureUtility("structure.visibility", next),
							)
						}
					/>
				)}
			/>
			<SectionGroupLabel
				label="Float & clear"
				ids={FLOAT_CLEAR_PROPERTIES}
				anySet={groupAnySet(FLOAT_CLEAR_PROPERTIES)}
			/>
			<StyleOverrideRows
				label="Float"
				className={className}
				options={options}
				property="structure.float"
				onChange={onChange}
				renderControl={(slot) => (
					<Segmented
						ariaLabel="Float"
						options={FLOAT_OPTIONS}
						value={slot.value}
						onChange={(next) =>
							slot.apply(
								next === null
									? null
									: structureUtility("structure.float", next),
							)
						}
					/>
				)}
			/>
			<StyleOverrideRows
				label="Clear"
				className={className}
				options={options}
				property="structure.clear"
				onChange={onChange}
				renderControl={(slot) => (
					<Segmented
						ariaLabel="Clear"
						options={CLEAR_OPTIONS}
						value={slot.value}
						onChange={(next) =>
							slot.apply(
								next === null
									? null
									: structureUtility("structure.clear", next),
							)
						}
					/>
				)}
			/>
			<StyleOverrideRows
				label="Columns"
				className={className}
				options={options}
				property="structure.columns"
				inline
				onChange={onChange}
				renderControl={(slot) => (
					<TokenField
						label="Columns"
						value={slot.value ?? ""}
						placeholder="3, auto, [20rem]"
						options={columnOptions}
						onCommit={(v) =>
							slot.apply(
								v.trim()
									? structureUtility("structure.columns", v.trim())
									: null,
							)
						}
					/>
				)}
			/>
			<SectionGroupLabel
				label="Breaks"
				ids={BREAK_PROPERTIES}
				anySet={groupAnySet(BREAK_PROPERTIES)}
			/>
			<StyleOverrideRows
				label="Break before"
				className={className}
				options={options}
				property="structure.break-before"
				onChange={onChange}
				renderControl={(slot) => (
					<Segmented
						ariaLabel="Break before"
						options={BREAK_OPTIONS}
						value={slot.value}
						onChange={(next) =>
							slot.apply(
								next === null
									? null
									: structureUtility("structure.break-before", next),
							)
						}
					/>
				)}
			/>
			<StyleOverrideRows
				label="Break after"
				className={className}
				options={options}
				property="structure.break-after"
				onChange={onChange}
				renderControl={(slot) => (
					<Segmented
						ariaLabel="Break after"
						options={BREAK_OPTIONS}
						value={slot.value}
						onChange={(next) =>
							slot.apply(
								next === null
									? null
									: structureUtility("structure.break-after", next),
							)
						}
					/>
				)}
			/>
			<StyleOverrideRows
				label="Break inside"
				className={className}
				options={options}
				property="structure.break-inside"
				onChange={onChange}
				renderControl={(slot) => (
					<Segmented
						ariaLabel="Break inside"
						options={BREAK_OPTIONS}
						value={slot.value}
						onChange={(next) =>
							slot.apply(
								next === null
									? null
									: structureUtility("structure.break-inside", next),
							)
						}
					/>
				)}
			/>
			<SectionGroupLabel
				label="List"
				ids={LIST_PROPERTIES}
				anySet={groupAnySet(LIST_PROPERTIES)}
			/>
			<StyleOverrideRows
				label="List style type"
				className={className}
				options={options}
				property="structure.list-style-type"
				onChange={onChange}
				renderControl={(slot) => (
					<Segmented
						ariaLabel="List style type"
						options={LIST_TYPE_OPTIONS}
						value={slot.value}
						onChange={(next) =>
							slot.apply(
								next === null
									? null
									: structureUtility("structure.list-style-type", next),
							)
						}
					/>
				)}
			/>
			<StyleOverrideRows
				label="List style position"
				className={className}
				options={options}
				property="structure.list-style-position"
				onChange={onChange}
				renderControl={(slot) => (
					<Segmented
						ariaLabel="List style position"
						options={LIST_POSITION_OPTIONS}
						value={slot.value}
						onChange={(next) =>
							slot.apply(
								next === null
									? null
									: structureUtility("structure.list-style-position", next),
							)
						}
					/>
				)}
			/>
			<StyleOverrideRows
				label="List image"
				className={className}
				options={options}
				property="structure.list-image"
				inline
				onChange={onChange}
				renderControl={(slot) => (
					<ValueField
						label="List image"
						value={slot.value ?? ""}
						placeholder="none, [url(...)]"
						onCommit={(v) =>
							slot.apply(
								v.trim()
									? structureUtility("structure.list-image", v.trim())
									: null,
							)
						}
					/>
				)}
			/>
			<SectionGroupLabel
				label="Table"
				ids={TABLE_PROPERTIES}
				anySet={groupAnySet(TABLE_PROPERTIES)}
			/>
			<StyleOverrideRows
				label="Table layout"
				className={className}
				options={options}
				property="structure.table-layout"
				onChange={onChange}
				renderControl={(slot) => (
					<Segmented
						ariaLabel="Table layout"
						options={TABLE_LAYOUT_OPTIONS}
						value={slot.value}
						onChange={(next) =>
							slot.apply(
								next === null
									? null
									: structureUtility("structure.table-layout", next),
							)
						}
					/>
				)}
			/>
			<StyleOverrideRows
				label="Border collapse"
				className={className}
				options={options}
				property="structure.border-collapse"
				onChange={onChange}
				renderControl={(slot) => (
					<Segmented
						ariaLabel="Border collapse"
						options={BORDER_COLLAPSE_OPTIONS}
						value={slot.value}
						onChange={(next) =>
							slot.apply(
								next === null
									? null
									: structureUtility("structure.border-collapse", next),
							)
						}
					/>
				)}
			/>
			<StyleOverrideRows
				label="Caption side"
				className={className}
				options={options}
				property="structure.caption-side"
				onChange={onChange}
				renderControl={(slot) => (
					<Segmented
						ariaLabel="Caption side"
						options={CAPTION_OPTIONS}
						value={slot.value}
						onChange={(next) =>
							slot.apply(
								next === null
									? null
									: structureUtility("structure.caption-side", next),
							)
						}
					/>
				)}
			/>
		</StyleSection>
	);
}
