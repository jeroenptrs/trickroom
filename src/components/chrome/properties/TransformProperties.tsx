import { useCallback, useMemo } from "react";
import { useResolvedCustomUtilities } from "../../../hooks/useResolvedCustomUtilities";
import { useDesignSystemId } from "../../../stores/design-store";
import type { ModelOptions } from "../../../utils/tailwind-classname";
import { Segmented, type SegmentedOption, ValueField } from "./StyleControls";
import { StyleOverrideRows } from "./StyleOverrideRows";
import { StyleSection } from "./StyleSection";
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

	const read = useCallback(
		(property: Parameters<typeof readTransformValue>[2]) =>
			readTransformValue(className, options, property),
		[className, options],
	);

	const rotate = read("transform.rotate");
	const scale = read("transform.scale");
	const translateX = read("transform.translate-x");
	const translateY = read("transform.translate-y");

	const summaryParts = [
		rotate && `rotate-${rotate}`,
		scale && `scale-${scale}`,
		(translateX || translateY) && "translate",
	].filter(Boolean);
	const summary = summaryParts.join(" · ") || undefined;

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
			<div className="flex flex-col gap-1">
				<span className="px-0.5 text-[10px] text-slate-400">Translate</span>
				<div className="flex gap-2">
					<StyleOverrideRows
						label="X"
						className={className}
						options={options}
						property="transform.translate-x"
						onChange={onChange}
						renderControl={(slot) => (
							<ValueField
								label="X"
								value={slot.value ?? ""}
								placeholder="4, -4, [13px]"
								onCommit={(v) =>
									slot.apply(transformUtilityFromInput("translate-x", v))
								}
							/>
						)}
					/>
					<StyleOverrideRows
						label="Y"
						className={className}
						options={options}
						property="transform.translate-y"
						onChange={onChange}
						renderControl={(slot) => (
							<ValueField
								label="Y"
								value={slot.value ?? ""}
								placeholder="4, -4, [13px]"
								onCommit={(v) =>
									slot.apply(transformUtilityFromInput("translate-y", v))
								}
							/>
						)}
					/>
					<StyleOverrideRows
						label="Z"
						className={className}
						options={options}
						property="transform.translate-z"
						onChange={onChange}
						renderControl={(slot) => (
							<ValueField
								label="Z"
								value={slot.value ?? ""}
								placeholder="4, [13px]"
								onCommit={(v) =>
									slot.apply(transformUtilityFromInput("translate-z", v))
								}
							/>
						)}
					/>
				</div>
			</div>
			<div className="flex flex-col gap-1">
				<span className="px-0.5 text-[10px] text-slate-400">Rotate</span>
				<div className="flex gap-2">
					<StyleOverrideRows
						label="All"
						className={className}
						options={options}
						property="transform.rotate"
						onChange={onChange}
						renderControl={(slot) => (
							<ValueField
								label="All"
								value={slot.value ?? ""}
								placeholder="45, -90, [0.5turn]"
								onCommit={(v) =>
									slot.apply(transformUtilityFromInput("rotate", v))
								}
							/>
						)}
					/>
					<StyleOverrideRows
						label="X"
						className={className}
						options={options}
						property="transform.rotate-x"
						onChange={onChange}
						renderControl={(slot) => (
							<ValueField
								label="X"
								value={slot.value ?? ""}
								placeholder="45, -90"
								onCommit={(v) =>
									slot.apply(transformUtilityFromInput("rotate-x", v))
								}
							/>
						)}
					/>
					<StyleOverrideRows
						label="Y"
						className={className}
						options={options}
						property="transform.rotate-y"
						onChange={onChange}
						renderControl={(slot) => (
							<ValueField
								label="Y"
								value={slot.value ?? ""}
								placeholder="45, -90"
								onCommit={(v) =>
									slot.apply(transformUtilityFromInput("rotate-y", v))
								}
							/>
						)}
					/>
				</div>
			</div>
			<div className="flex flex-col gap-1">
				<span className="px-0.5 text-[10px] text-slate-400">Scale</span>
				<div className="flex gap-2">
					<StyleOverrideRows
						label="All"
						className={className}
						options={options}
						property="transform.scale"
						onChange={onChange}
						renderControl={(slot) => (
							<ValueField
								label="All"
								value={slot.value ?? ""}
								placeholder="50, 100, 150"
								onCommit={(v) =>
									slot.apply(transformUtilityFromInput("scale", v))
								}
							/>
						)}
					/>
					<StyleOverrideRows
						label="X"
						className={className}
						options={options}
						property="transform.scale-x"
						onChange={onChange}
						renderControl={(slot) => (
							<ValueField
								label="X"
								value={slot.value ?? ""}
								placeholder="50, 100"
								onCommit={(v) =>
									slot.apply(transformUtilityFromInput("scale-x", v))
								}
							/>
						)}
					/>
					<StyleOverrideRows
						label="Y"
						className={className}
						options={options}
						property="transform.scale-y"
						onChange={onChange}
						renderControl={(slot) => (
							<ValueField
								label="Y"
								value={slot.value ?? ""}
								placeholder="50, 100"
								onCommit={(v) =>
									slot.apply(transformUtilityFromInput("scale-y", v))
								}
							/>
						)}
					/>
				</div>
			</div>
			<div className="flex flex-col gap-1">
				<span className="px-0.5 text-[10px] text-slate-400">Skew</span>
				<div className="flex gap-2">
					<StyleOverrideRows
						label="X"
						className={className}
						options={options}
						property="transform.skew-x"
						onChange={onChange}
						renderControl={(slot) => (
							<ValueField
								label="X"
								value={slot.value ?? ""}
								placeholder="6, -6, [10deg]"
								onCommit={(v) =>
									slot.apply(transformUtilityFromInput("skew-x", v))
								}
							/>
						)}
					/>
					<StyleOverrideRows
						label="Y"
						className={className}
						options={options}
						property="transform.skew-y"
						onChange={onChange}
						renderControl={(slot) => (
							<ValueField
								label="Y"
								value={slot.value ?? ""}
								placeholder="6, -6, [10deg]"
								onCommit={(v) =>
									slot.apply(transformUtilityFromInput("skew-y", v))
								}
							/>
						)}
					/>
				</div>
			</div>
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
