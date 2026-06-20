import { useCallback, useMemo } from "react";
import { useResolvedCustomUtilities } from "../../../hooks/useResolvedCustomUtilities";
import { useDesignSystemId } from "../../../stores/design-store";
import type { ModelOptions } from "../../../utils/tailwind-classname";
import {
	insetUtilityFromInput,
	readPositionValue,
	zIndexUtilityFromInput,
} from "./positionPropertiesController";
import { Segmented, type SegmentedOption, ValueField } from "./StyleControls";
import { StyleOverrideRows } from "./StyleOverrideRows";
import { StyleSection } from "./StyleSection";
import { getStyleIntent, styleValueText } from "./styleSectionController";

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

	const read = useCallback(
		(property: Parameters<typeof readPositionValue>[2]) =>
			readPositionValue(className, options, property),
		[className, options],
	);

	const position = styleValueText(
		getStyleIntent(className, options, "position.position"),
	);
	const zIndex = read("position.z-index");
	const summary =
		[position, zIndex && `z-${zIndex}`].filter(Boolean).join(" · ") ||
		undefined;

	return (
		<StyleSection title="Position" summary={summary}>
			<StyleOverrideRows
				label="Position"
				className={className}
				options={options}
				property="position.position"
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
			<div className="flex flex-col gap-1">
				<span className="px-0.5 text-[10px] text-slate-400">Inset</span>
				<div className="flex gap-2">
					<StyleOverrideRows
						label="All"
						className={className}
						options={options}
						property="position.inset"
						onChange={onChange}
						renderControl={(slot) => (
							<ValueField
								label="All"
								value={slot.value ?? ""}
								placeholder="0, 4, auto"
								onCommit={(v) => slot.apply(insetUtilityFromInput("inset", v))}
							/>
						)}
					/>
					<StyleOverrideRows
						label="X"
						className={className}
						options={options}
						property="position.inset-x"
						onChange={onChange}
						renderControl={(slot) => (
							<ValueField
								label="X"
								value={slot.value ?? ""}
								placeholder="0, 4"
								onCommit={(v) =>
									slot.apply(insetUtilityFromInput("inset-x", v))
								}
							/>
						)}
					/>
					<StyleOverrideRows
						label="Y"
						className={className}
						options={options}
						property="position.inset-y"
						onChange={onChange}
						renderControl={(slot) => (
							<ValueField
								label="Y"
								value={slot.value ?? ""}
								placeholder="0, 4"
								onCommit={(v) =>
									slot.apply(insetUtilityFromInput("inset-y", v))
								}
							/>
						)}
					/>
				</div>
				<div className="grid grid-cols-2 gap-1">
					<StyleOverrideRows
						label="Top"
						className={className}
						options={options}
						property="position.top"
						onChange={onChange}
						renderControl={(slot) => (
							<ValueField
								label="Top"
								value={slot.value ?? ""}
								placeholder="0, 4, -4, auto"
								onCommit={(v) => slot.apply(insetUtilityFromInput("top", v))}
							/>
						)}
					/>
					<StyleOverrideRows
						label="Right"
						className={className}
						options={options}
						property="position.right"
						onChange={onChange}
						renderControl={(slot) => (
							<ValueField
								label="Right"
								value={slot.value ?? ""}
								placeholder="0, 4, auto"
								onCommit={(v) => slot.apply(insetUtilityFromInput("right", v))}
							/>
						)}
					/>
					<StyleOverrideRows
						label="Bottom"
						className={className}
						options={options}
						property="position.bottom"
						onChange={onChange}
						renderControl={(slot) => (
							<ValueField
								label="Bottom"
								value={slot.value ?? ""}
								placeholder="0, 4, auto"
								onCommit={(v) => slot.apply(insetUtilityFromInput("bottom", v))}
							/>
						)}
					/>
					<StyleOverrideRows
						label="Left"
						className={className}
						options={options}
						property="position.left"
						onChange={onChange}
						renderControl={(slot) => (
							<ValueField
								label="Left"
								value={slot.value ?? ""}
								placeholder="0, 4, auto"
								onCommit={(v) => slot.apply(insetUtilityFromInput("left", v))}
							/>
						)}
					/>
				</div>
			</div>
			<StyleOverrideRows
				label="Z-index"
				className={className}
				options={options}
				property="position.z-index"
				onChange={onChange}
				renderControl={(slot) => (
					<ValueField
						label="Z-index"
						value={slot.value ?? ""}
						placeholder="0, 10, auto"
						onCommit={(v) => slot.apply(zIndexUtilityFromInput(v))}
					/>
				)}
			/>
			<div className="flex flex-col gap-1">
				<span className="px-0.5 text-[10px] text-slate-400">Object</span>
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
			</div>
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
