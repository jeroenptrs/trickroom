import { useCallback, useMemo } from "react";
import { useResolvedCustomUtilities } from "../../../hooks/useResolvedCustomUtilities";
import { useResolvedDomainTokens } from "../../../hooks/useResolvedDomainTokens";
import { useDesignSystemId } from "../../../stores/design-store";
import type { ModelOptions } from "../../../utils/tailwind-classname";
import { Segmented, type SegmentedOption } from "../../ui/segmented";
import {
	animationTokenOptions,
	durationTokenOptions,
	easingTokenOptions,
} from "./domainTokenOptions";
import {
	motionUtility,
	readMotionValue,
	transitionPropertyUtility,
} from "./motionPropertiesController";
import { StyleOverrideRows } from "./StyleOverrideRows";
import { StyleSection } from "./StyleSection";
import { TokenField } from "./TokenField";

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

export function MotionProperties({
	className,
	onChange,
}: MotionPropertiesProps) {
	const systemId = useDesignSystemId();
	const customUtilityRoots = useResolvedCustomUtilities(systemId);

	const options = useMemo<ModelOptions>(
		() => ({ colorTokens: EMPTY_COLOR_TOKENS, ...customUtilityRoots }),
		[customUtilityRoots],
	);

	const easeTokens = useResolvedDomainTokens(systemId, "ease");
	const animateTokens = useResolvedDomainTokens(systemId, "animate");
	const durationOptions = useMemo(() => durationTokenOptions(), []);
	const easingOptions = useMemo(
		() => easingTokenOptions(easeTokens.values),
		[easeTokens.values],
	);
	const animationOptions = useMemo(
		() => animationTokenOptions(animateTokens.values),
		[animateTokens.values],
	);

	const read = useCallback(
		(property: Parameters<typeof readMotionValue>[2]) =>
			readMotionValue(className, options, property),
		[className, options],
	);

	const duration = read("motion.duration");
	const easing = read("motion.easing");
	const animation = read("motion.animation");

	const summary = [
		duration ? `duration-${duration}` : null,
		easing ? `ease-${easing}` : null,
		animation && animation !== "none" ? `animate-${animation}` : null,
	].filter((value): value is string => value !== null);

	return (
		<StyleSection title="Motion" summary={summary}>
			<StyleOverrideRows
				label="Transition"
				className={className}
				options={options}
				property="motion.transition-property"
				likely
				onChange={onChange}
				renderControl={(slot) => (
					<Segmented
						ariaLabel="Transition property"
						options={TRANSITION_PROPERTY_OPTIONS}
						value={slot.value === "DEFAULT" ? "default" : slot.value}
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
			<StyleOverrideRows
				label="Duration"
				className={className}
				options={options}
				property="motion.duration"
				inline
				likely
				onChange={onChange}
				renderControl={(slot) => (
					<TokenField
						label="Duration"
						value={slot.value ?? ""}
						placeholder="300, [175ms], (--motion-fast)"
						options={durationOptions}
						onCommit={(v) =>
							slot.apply(
								v.trim() ? motionUtility("motion.duration", v.trim()) : null,
							)
						}
					/>
				)}
			/>
			<StyleOverrideRows
				label="Delay"
				className={className}
				options={options}
				property="motion.delay"
				inline
				onChange={onChange}
				renderControl={(slot) => (
					<TokenField
						label="Delay"
						value={slot.value ?? ""}
						placeholder="150, [200ms]"
						options={durationOptions}
						onCommit={(v) =>
							slot.apply(
								v.trim() ? motionUtility("motion.delay", v.trim()) : null,
							)
						}
					/>
				)}
			/>
			<StyleOverrideRows
				label="Easing"
				className={className}
				options={options}
				property="motion.easing"
				inline
				onChange={onChange}
				renderControl={(slot) => (
					<TokenField
						label="Easing"
						value={slot.value ?? ""}
						placeholder="in-out, [cubic-bezier(0.4,0,0.2,1)]"
						options={easingOptions}
						onCommit={(v) =>
							slot.apply(
								v.trim() ? motionUtility("motion.easing", v.trim()) : null,
							)
						}
					/>
				)}
			/>
			<StyleOverrideRows
				label="Animation"
				className={className}
				options={options}
				property="motion.animation"
				inline
				onChange={onChange}
				renderControl={(slot) => (
					<TokenField
						label="Animation"
						value={slot.value ?? ""}
						placeholder="spin, [fade-in_1s_ease-in-out_infinite]"
						options={animationOptions}
						onCommit={(v) =>
							slot.apply(
								v.trim() ? motionUtility("motion.animation", v.trim()) : null,
							)
						}
					/>
				)}
			/>
		</StyleSection>
	);
}
