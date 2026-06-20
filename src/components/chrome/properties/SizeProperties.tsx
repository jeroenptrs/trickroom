import { useCallback, useMemo } from "react";
import { useResolvedCustomUtilities } from "../../../hooks/useResolvedCustomUtilities";
import { useDesignSystemId } from "../../../stores/design-store";
import type {
	ModelOptions,
	StyleProperty,
} from "../../../utils/tailwind-classname";
import { Segmented, type SegmentedOption, ValueField } from "./StyleControls";
import { StyleOverrideRows } from "./StyleOverrideRows";
import { StyleSection } from "./StyleSection";
import { inputToSizeUtility, readSizeValue } from "./sizePropertiesController";
import { getStyleIntent, styleValueText } from "./styleSectionController";

type SizePropertiesProps = {
	className: string;
	onChange: (next: string) => void;
};

const EMPTY_COLOR_TOKENS = new Set<string>();

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

export function SizeProperties({ className, onChange }: SizePropertiesProps) {
	const systemId = useDesignSystemId();
	const customUtilityRoots = useResolvedCustomUtilities(systemId);

	const options = useMemo<ModelOptions>(
		() => ({ colorTokens: EMPTY_COLOR_TOKENS, ...customUtilityRoots }),
		[customUtilityRoots],
	);

	const read = useCallback(
		(property: StyleProperty) => readSizeValue(className, options, property),
		[className, options],
	);

	const w = read("size.width");
	const h = read("size.height");
	const flex = styleValueText(getStyleIntent(className, options, "size.flex"));
	const grow = styleValueText(getStyleIntent(className, options, "size.grow"));
	const shrink = styleValueText(
		getStyleIntent(className, options, "size.shrink"),
	);

	const summary =
		[w && `w-${w}`, h && `h-${h}`].filter(Boolean).join(" · ") || undefined;

	return (
		<StyleSection title="Size" summary={summary}>
			<div className="flex flex-col gap-2">
				<div className="flex gap-2">
					<StyleOverrideRows
						label="W"
						className={className}
						options={options}
						property="size.width"
						onChange={onChange}
						renderControl={(slot) => (
							<ValueField
								label="W"
								value={slot.value ?? ""}
								placeholder="auto, 4, full"
								onCommit={(v) => slot.apply(inputToSizeUtility("w", v))}
							/>
						)}
					/>
					<StyleOverrideRows
						label="H"
						className={className}
						options={options}
						property="size.height"
						onChange={onChange}
						renderControl={(slot) => (
							<ValueField
								label="H"
								value={slot.value ?? ""}
								placeholder="auto, 4, full"
								onCommit={(v) => slot.apply(inputToSizeUtility("h", v))}
							/>
						)}
					/>
				</div>
				<StyleOverrideRows
					label="Size"
					className={className}
					options={options}
					property="size.size"
					onChange={onChange}
					renderControl={(slot) => (
						<ValueField
							label="Size"
							value={slot.value ?? ""}
							placeholder="4, full, [200px]"
							onCommit={(v) => slot.apply(inputToSizeUtility("size", v))}
						/>
					)}
				/>
				<div className="flex gap-2">
					<StyleOverrideRows
						label="Min W"
						className={className}
						options={options}
						property="size.min-width"
						onChange={onChange}
						renderControl={(slot) => (
							<ValueField
								label="Min W"
								value={slot.value ?? ""}
								placeholder="0, 4, full"
								onCommit={(v) => slot.apply(inputToSizeUtility("min-w", v))}
							/>
						)}
					/>
					<StyleOverrideRows
						label="Max W"
						className={className}
						options={options}
						property="size.max-width"
						onChange={onChange}
						renderControl={(slot) => (
							<ValueField
								label="Max W"
								value={slot.value ?? ""}
								placeholder="4, full, none"
								onCommit={(v) => slot.apply(inputToSizeUtility("max-w", v))}
							/>
						)}
					/>
				</div>
				<div className="flex gap-2">
					<StyleOverrideRows
						label="Min H"
						className={className}
						options={options}
						property="size.min-height"
						onChange={onChange}
						renderControl={(slot) => (
							<ValueField
								label="Min H"
								value={slot.value ?? ""}
								placeholder="0, 4, full"
								onCommit={(v) => slot.apply(inputToSizeUtility("min-h", v))}
							/>
						)}
					/>
					<StyleOverrideRows
						label="Max H"
						className={className}
						options={options}
						property="size.max-height"
						onChange={onChange}
						renderControl={(slot) => (
							<ValueField
								label="Max H"
								value={slot.value ?? ""}
								placeholder="4, full, none"
								onCommit={(v) => slot.apply(inputToSizeUtility("max-h", v))}
							/>
						)}
					/>
				</div>
				<StyleOverrideRows
					label="Aspect"
					className={className}
					options={options}
					property="size.aspect-ratio"
					onChange={onChange}
					renderControl={(slot) => (
						<ValueField
							label="Aspect"
							value={slot.value ?? ""}
							placeholder="auto, square, video"
							onCommit={(v) => slot.apply(inputToSizeUtility("aspect", v))}
						/>
					)}
				/>
			</div>
			<div className="flex flex-col gap-1">
				<span className="px-0.5 text-[10px] text-slate-400">Flex child</span>
				<StyleOverrideRows
					label="Basis"
					className={className}
					options={options}
					property="size.flex-basis"
					onChange={onChange}
					renderControl={(slot) => (
						<ValueField
							label="Basis"
							value={slot.value ?? ""}
							placeholder="auto, 4, full"
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
			</div>
		</StyleSection>
	);
}
