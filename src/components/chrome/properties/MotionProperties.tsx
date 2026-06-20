import { useCallback, useMemo } from "react";
import type { ModelOptions } from "../../../utils/tailwind-classname";
import { StyleSection } from "./StyleSection";
import { Segmented, type SegmentedOption, ValueField } from "./StyleControls";
import { StyleOverrideRows } from "./StyleOverrideRows";
import {
	motionUtility,
	readMotionValue,
	transitionPropertyUtility,
} from "./motionPropertiesController";

type MotionPropertiesProps = {
	className: string;
	onChange: (next: string) => void;
};

const EMPTY_COLOR_TOKENS = new Set<string>();

const TRANSITION_PROPERTY_OPTIONS: readonly SegmentedOption<string>[] = [
	{ value: "default", label: "Default" },
	{ value: "all", label: "All" },
	{ value: "colors", label: "Colors" },
	{ value: "opacity", label: "Opacity" },
	{ value: "shadow", label: "Shadow" },
	{ value: "transform", label: "Transform" },
	{ value: "none", label: "None" },
];

const DURATION_OPTIONS: readonly SegmentedOption<string>[] = [
	{ value: "75", label: "75" },
	{ value: "150", label: "150" },
	{ value: "300", label: "300" },
	{ value: "500", label: "500" },
	{ value: "700", label: "700" },
];

const DELAY_OPTIONS: readonly SegmentedOption<string>[] = [
	{ value: "0", label: "0" },
	{ value: "75", label: "75" },
	{ value: "150", label: "150" },
	{ value: "300", label: "300" },
];

const EASING_OPTIONS: readonly SegmentedOption<string>[] = [
	{ value: "linear", label: "Linear" },
	{ value: "in", label: "In" },
	{ value: "out", label: "Out" },
	{ value: "in-out", label: "In-out" },
];

const ANIMATION_OPTIONS: readonly SegmentedOption<string>[] = [
	{ value: "none", label: "None" },
	{ value: "spin", label: "Spin" },
	{ value: "ping", label: "Ping" },
	{ value: "pulse", label: "Pulse" },
	{ value: "bounce", label: "Bounce" },
];

export function MotionProperties({ className, onChange }: MotionPropertiesProps) {
	const options = useMemo<ModelOptions>(
		() => ({ colorTokens: EMPTY_COLOR_TOKENS }),
		[],
	);

	const read = useCallback(
		(property: Parameters<typeof readMotionValue>[2]) =>
			readMotionValue(className, options, property),
		[className, options],
	);

	const duration = read("motion.duration");
	const delay = read("motion.delay");
	const easing = read("motion.easing");
	const animation = read("motion.animation");

	const summary =
		[duration && `duration-${duration}`, easing && `ease-${easing}`, animation && animation !== "none" && `animate-${animation}`]
			.filter(Boolean)
			.join(" · ") || undefined;

	return (
		<StyleSection title="Motion" summary={summary}>
			<StyleOverrideRows
				label="Transition"
				className={className}
				options={options}
				property="motion.transition-property"
				onChange={onChange}
				renderControl={(slot) => (
					<Segmented
						ariaLabel="Transition property"
						options={TRANSITION_PROPERTY_OPTIONS}
						value={
							slot.value === "DEFAULT" ? "default" : slot.value
						}
						onChange={(next) => {
							if (next === null) {
								slot.apply(null);
								return;
							}
							const slotValue = next === "default" ? "DEFAULT" : next;
							slot.apply(transitionPropertyUtility(slotValue));
						}}
					/>
				)}
			/>
			<div className="flex flex-col gap-1">
				<span className="px-0.5 text-[10px] text-slate-400">Duration</span>
				<StyleOverrideRows
					label="Duration"
					className={className}
					options={options}
					property="motion.duration"
					onChange={onChange}
					renderControl={(slot) => {
						const preset =
							slot.value && /^\d+$/.test(slot.value) ? slot.value : null;
						return (
							<div className="flex flex-col gap-1">
								<Segmented
									ariaLabel="Duration preset"
									options={DURATION_OPTIONS}
									value={preset}
									onChange={(next) =>
										slot.apply(
											next === null
												? null
												: motionUtility("motion.duration", next),
										)
									}
								/>
								<ValueField
									label="Custom"
									value={preset ? "" : (slot.value ?? "")}
									placeholder="300, [175ms], (--motion-fast)"
									onCommit={(v) =>
										slot.apply(
											v.trim()
												? motionUtility("motion.duration", v.trim())
												: null,
										)
									}
								/>
							</div>
						);
					}}
				/>
			</div>
			<div className="flex flex-col gap-1">
				<span className="px-0.5 text-[10px] text-slate-400">Delay</span>
				<StyleOverrideRows
					label="Delay"
					className={className}
					options={options}
					property="motion.delay"
					onChange={onChange}
					renderControl={(slot) => {
						const preset =
							slot.value && /^\d+$/.test(slot.value) ? slot.value : null;
						return (
							<div className="flex flex-col gap-1">
								<Segmented
									ariaLabel="Delay preset"
									options={DELAY_OPTIONS}
									value={preset}
									onChange={(next) =>
										slot.apply(
											next === null
												? null
												: motionUtility("motion.delay", next),
										)
									}
								/>
								<ValueField
									label="Custom"
									value={preset ? "" : (slot.value ?? "")}
									placeholder="150, [200ms]"
									onCommit={(v) =>
										slot.apply(
											v.trim()
												? motionUtility("motion.delay", v.trim())
												: null,
										)
									}
								/>
							</div>
						);
					}}
				/>
			</div>
			<div className="flex flex-col gap-1">
				<span className="px-0.5 text-[10px] text-slate-400">Easing</span>
				<StyleOverrideRows
					label="Easing"
					className={className}
					options={options}
					property="motion.easing"
					onChange={onChange}
					renderControl={(slot) => {
						const preset =
							slot.value &&
							EASING_OPTIONS.some((option) => option.value === slot.value)
								? slot.value
								: null;
						return (
							<div className="flex flex-col gap-1">
								<Segmented
									ariaLabel="Easing preset"
									options={EASING_OPTIONS}
									value={preset}
									onChange={(next) =>
										slot.apply(
											next === null
												? null
												: motionUtility("motion.easing", next),
										)
									}
								/>
								<ValueField
									label="Custom"
									value={preset ? "" : (slot.value ?? "")}
									placeholder="in-out, [cubic-bezier(0.4,0,0.2,1)]"
									onCommit={(v) =>
										slot.apply(
											v.trim()
												? motionUtility("motion.easing", v.trim())
												: null,
										)
									}
								/>
							</div>
						);
					}}
				/>
			</div>
			<div className="flex flex-col gap-1">
				<span className="px-0.5 text-[10px] text-slate-400">Animation</span>
				<StyleOverrideRows
					label="Animation"
					className={className}
					options={options}
					property="motion.animation"
					onChange={onChange}
					renderControl={(slot) => {
						const preset =
							slot.value &&
							ANIMATION_OPTIONS.some((option) => option.value === slot.value)
								? slot.value
								: null;
						return (
							<div className="flex flex-col gap-1">
								<Segmented
									ariaLabel="Animation preset"
									options={ANIMATION_OPTIONS}
									value={preset}
									onChange={(next) =>
										slot.apply(
											next === null
												? null
												: motionUtility("motion.animation", next),
										)
									}
								/>
								<ValueField
									label="Custom"
									value={preset ? "" : (slot.value ?? "")}
									placeholder="spin, [fade-in_1s_ease-in-out_infinite]"
									onCommit={(v) =>
										slot.apply(
											v.trim()
												? motionUtility("motion.animation", v.trim())
												: null,
										)
									}
								/>
							</div>
						);
					}}
				/>
			</div>
		</StyleSection>
	);
}
