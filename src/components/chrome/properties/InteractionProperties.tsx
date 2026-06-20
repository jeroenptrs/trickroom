import { useCallback, useMemo } from "react";
import { useResolvedColorTokens } from "../../../hooks/useResolvedColorTokens";
import { useResolvedCustomUtilities } from "../../../hooks/useResolvedCustomUtilities";
import { useResolvedDomainTokens } from "../../../hooks/useResolvedDomainTokens";
import { useDesignSystemId } from "../../../stores/design-store";
import {
	buildPropertyModel,
	type ModelOptions,
	type StyleProperty,
} from "../../../utils/tailwind-classname";
import { Segmented, type SegmentedOption } from "../../ui/segmented";
import { ColorPropertyControl } from "./ColorPropertyControl";
import {
	applyColorChange,
	applyColorClear,
	applyColorClearAll,
} from "./colorPropertiesController";
import { spacingTokenOptions } from "./domainTokenOptions";
import { interactionUtility } from "./interactionPropertiesController";
import { StyleOverrideRows } from "./StyleOverrideRows";
import { StyleSection } from "./StyleSection";
import { resolveSpacingBasePx } from "./sizeTokenOptions";
import {
	applyStyleUtility,
	clearStyleProperty,
	getStyleIntent,
	styleValueText,
} from "./styleSectionController";
import { TokenField } from "./TokenField";

type InteractionPropertiesProps = {
	className: string;
	onChange: (next: string) => void;
};

const CURSOR_OPTIONS: readonly SegmentedOption<string>[] = [
	{ value: "auto", label: "Auto" },
	{ value: "default", label: "Default" },
	{ value: "pointer", label: "Pointer" },
	{ value: "wait", label: "Wait" },
	{ value: "text", label: "Text" },
	{ value: "not-allowed", label: "No" },
];

const POINTER_EVENTS_OPTIONS: readonly SegmentedOption<string>[] = [
	{ value: "auto", label: "Auto" },
	{ value: "none", label: "None" },
];

const USER_SELECT_OPTIONS: readonly SegmentedOption<string>[] = [
	{ value: "none", label: "None" },
	{ value: "text", label: "Text" },
	{ value: "all", label: "All" },
	{ value: "auto", label: "Auto" },
];

const RESIZE_OPTIONS: readonly SegmentedOption<string>[] = [
	{ value: "both", label: "Both" },
	{ value: "none", label: "None" },
	{ value: "x", label: "X" },
	{ value: "y", label: "Y" },
];

const APPEARANCE_OPTIONS: readonly SegmentedOption<string>[] = [
	{ value: "auto", label: "Auto" },
	{ value: "none", label: "None" },
];

const SCROLL_BEHAVIOR_OPTIONS: readonly SegmentedOption<string>[] = [
	{ value: "auto", label: "Auto" },
	{ value: "smooth", label: "Smooth" },
];

const SNAP_AXIS_OPTIONS: readonly SegmentedOption<string>[] = [
	{ value: "none", label: "Off" },
	{ value: "x", label: "X" },
	{ value: "y", label: "Y" },
	{ value: "both", label: "Both" },
];

const SNAP_STRICTNESS_OPTIONS: readonly SegmentedOption<string>[] = [
	{ value: "mandatory", label: "Must" },
	{ value: "proximity", label: "Near" },
];

const SNAP_ALIGN_OPTIONS: readonly SegmentedOption<string>[] = [
	{ value: "start", label: "Start" },
	{ value: "end", label: "End" },
	{ value: "center", label: "Center" },
	{ value: "none", label: "—" },
];

const SNAP_STOP_OPTIONS: readonly SegmentedOption<string>[] = [
	{ value: "normal", label: "Normal" },
	{ value: "always", label: "Always" },
];

const TOUCH_OPTIONS: readonly SegmentedOption<string>[] = [
	{ value: "auto", label: "Auto" },
	{ value: "none", label: "None" },
	{ value: "pan-x", label: "Pan X" },
	{ value: "pan-y", label: "Pan Y" },
	{ value: "manipulation", label: "Manip" },
];

const WILL_CHANGE_OPTIONS: readonly SegmentedOption<string>[] = [
	{ value: "auto", label: "Auto" },
	{ value: "scroll", label: "Scroll" },
	{ value: "contents", label: "Contents" },
	{ value: "transform", label: "Xform" },
];

/** Override-aware: cursor through will-change (non-color); accent/caret unchanged. */
export function InteractionProperties({
	className,
	onChange,
}: InteractionPropertiesProps) {
	const systemId = useDesignSystemId();
	const resolved = useResolvedColorTokens(systemId);
	const customUtilityRoots = useResolvedCustomUtilities(systemId);

	const options = useMemo<ModelOptions>(
		() => ({ colorTokens: resolved.names, ...customUtilityRoots }),
		[resolved.names, customUtilityRoots],
	);

	const spacingTokens = useResolvedDomainTokens(systemId, "spacing");
	const scrollMarginOptions = useMemo(
		() => spacingTokenOptions(resolveSpacingBasePx(spacingTokens.values)),
		[spacingTokens.values],
	);

	const model = useMemo(
		() => buildPropertyModel(className, options),
		[className, options],
	);

	const read = useCallback(
		(property: StyleProperty) =>
			styleValueText(getStyleIntent(className, options, property)),
		[className, options],
	);

	const cursor = read("interaction.cursor");
	const pointerEvents = read("interaction.pointer-events");
	const snapType = read("interaction.scroll-snap-type");
	const snapAxis = read("interaction.scroll-snap-axis");

	const summary = [cursor, pointerEvents].filter(
		(value): value is string => value !== null && value !== undefined,
	);

	return (
		<StyleSection title="Interaction" summary={summary}>
			<StyleOverrideRows
				label="Cursor"
				className={className}
				options={options}
				property="interaction.cursor"
				likely
				onChange={onChange}
				renderControl={(slot) => (
					<Segmented
						ariaLabel="Cursor"
						options={CURSOR_OPTIONS}
						value={slot.value}
						onChange={(next) =>
							slot.apply(
								next === null
									? null
									: interactionUtility("interaction.cursor", next),
							)
						}
					/>
				)}
			/>
			<StyleOverrideRows
				label="Pointer events"
				className={className}
				options={options}
				property="interaction.pointer-events"
				onChange={onChange}
				renderControl={(slot) => (
					<Segmented
						ariaLabel="Pointer events"
						options={POINTER_EVENTS_OPTIONS}
						value={slot.value}
						onChange={(next) =>
							slot.apply(
								next === null
									? null
									: interactionUtility("interaction.pointer-events", next),
							)
						}
					/>
				)}
			/>
			<StyleOverrideRows
				label="User select"
				className={className}
				options={options}
				property="interaction.user-select"
				onChange={onChange}
				renderControl={(slot) => (
					<Segmented
						ariaLabel="User select"
						options={USER_SELECT_OPTIONS}
						value={slot.value}
						onChange={(next) =>
							slot.apply(
								next === null
									? null
									: interactionUtility("interaction.user-select", next),
							)
						}
					/>
				)}
			/>
			<StyleOverrideRows
				label="Resize"
				className={className}
				options={options}
				property="interaction.resize"
				onChange={onChange}
				renderControl={(slot) => (
					<Segmented
						ariaLabel="Resize"
						options={RESIZE_OPTIONS}
						value={slot.value}
						onChange={(next) =>
							slot.apply(
								next === null
									? null
									: interactionUtility("interaction.resize", next),
							)
						}
					/>
				)}
			/>
			<StyleOverrideRows
				label="Appearance"
				className={className}
				options={options}
				property="interaction.appearance"
				onChange={onChange}
				renderControl={(slot) => (
					<Segmented
						ariaLabel="Appearance"
						options={APPEARANCE_OPTIONS}
						value={slot.value}
						onChange={(next) =>
							slot.apply(
								next === null
									? null
									: interactionUtility("interaction.appearance", next),
							)
						}
					/>
				)}
			/>
			<ColorPropertyControl
				label="Accent"
				property="accent"
				model={model}
				resolved={resolved}
				onSet={(variants, value) =>
					onChange(
						applyColorChange(className, options, {
							property: "accent",
							variants,
							value,
						}),
					)
				}
				onClear={(variants) =>
					onChange(
						applyColorClear(className, options, {
							property: "accent",
							variants,
						}),
					)
				}
				onClearAll={(chains) =>
					onChange(applyColorClearAll(className, options, "accent", chains))
				}
			/>
			<ColorPropertyControl
				label="Caret"
				property="caret"
				model={model}
				resolved={resolved}
				onSet={(variants, value) =>
					onChange(
						applyColorChange(className, options, {
							property: "caret",
							variants,
							value,
						}),
					)
				}
				onClear={(variants) =>
					onChange(
						applyColorClear(className, options, {
							property: "caret",
							variants,
						}),
					)
				}
				onClearAll={(chains) =>
					onChange(applyColorClearAll(className, options, "caret", chains))
				}
			/>
			<StyleOverrideRows
				label="Scroll behavior"
				className={className}
				options={options}
				property="interaction.scroll-behavior"
				onChange={onChange}
				renderControl={(slot) => (
					<Segmented
						ariaLabel="Scroll behavior"
						options={SCROLL_BEHAVIOR_OPTIONS}
						value={slot.value}
						onChange={(next) =>
							slot.apply(
								next === null
									? null
									: interactionUtility("interaction.scroll-behavior", next),
							)
						}
					/>
				)}
			/>
			<StyleOverrideRows
				label="Scroll snap"
				className={className}
				options={options}
				property="interaction.scroll-snap-axis"
				onChange={onChange}
				renderControl={(slot) => {
					const rowSnapType = styleValueText(
						getStyleIntent(
							className,
							options,
							"interaction.scroll-snap-type",
							slot.variants,
						),
					);
					const rowSnapAxis = styleValueText(
						getStyleIntent(
							className,
							options,
							"interaction.scroll-snap-axis",
							slot.variants,
						),
					);
					return (
						<Segmented
							ariaLabel="Scroll snap"
							options={SNAP_AXIS_OPTIONS}
							value={rowSnapType === "none" ? "none" : rowSnapAxis}
							onChange={(next) => {
								if (next === null) {
									let nextClass = clearStyleProperty(
										className,
										options,
										"interaction.scroll-snap-axis",
										slot.variants,
									);
									nextClass = clearStyleProperty(
										nextClass,
										options,
										"interaction.scroll-snap-type",
										slot.variants,
									);
									onChange(nextClass);
									return;
								}
								if (next === "none") {
									let nextClass = clearStyleProperty(
										className,
										options,
										"interaction.scroll-snap-axis",
										slot.variants,
									);
									nextClass = applyStyleUtility(
										nextClass,
										options,
										"interaction.scroll-snap-type",
										interactionUtility("interaction.scroll-snap-type", "none"),
										{ variants: slot.variants },
									);
									onChange(nextClass);
									return;
								}
								let nextClass = clearStyleProperty(
									className,
									options,
									"interaction.scroll-snap-type",
									slot.variants,
								);
								nextClass = applyStyleUtility(
									nextClass,
									options,
									"interaction.scroll-snap-axis",
									interactionUtility("interaction.scroll-snap-axis", next),
									{ variants: slot.variants },
								);
								onChange(nextClass);
							}}
						/>
					);
				}}
			/>
			{snapType !== "none" && snapAxis ? (
				<>
					<StyleOverrideRows
						label="Snap strictness"
						className={className}
						options={options}
						property="interaction.scroll-snap-strictness"
						onChange={onChange}
						renderControl={(slot) => (
							<Segmented
								ariaLabel="Snap strictness"
								options={SNAP_STRICTNESS_OPTIONS}
								value={slot.value}
								onChange={(next) =>
									slot.apply(
										next === null
											? null
											: interactionUtility(
													"interaction.scroll-snap-strictness",
													next,
												),
									)
								}
							/>
						)}
					/>
					<StyleOverrideRows
						label="Snap align"
						className={className}
						options={options}
						property="interaction.scroll-snap-align"
						onChange={onChange}
						renderControl={(slot) => (
							<Segmented
								ariaLabel="Snap align"
								options={SNAP_ALIGN_OPTIONS}
								value={slot.value}
								onChange={(next) =>
									slot.apply(
										next === null
											? null
											: interactionUtility(
													"interaction.scroll-snap-align",
													next,
												),
									)
								}
							/>
						)}
					/>
					<StyleOverrideRows
						label="Snap stop"
						className={className}
						options={options}
						property="interaction.scroll-snap-stop"
						onChange={onChange}
						renderControl={(slot) => (
							<Segmented
								ariaLabel="Snap stop"
								options={SNAP_STOP_OPTIONS}
								value={slot.value}
								onChange={(next) =>
									slot.apply(
										next === null
											? null
											: interactionUtility(
													"interaction.scroll-snap-stop",
													next,
												),
									)
								}
							/>
						)}
					/>
				</>
			) : null}
			<StyleOverrideRows
				label="Scroll MT"
				className={className}
				options={options}
				property="interaction.scroll-margin-top"
				inline
				onChange={onChange}
				renderControl={(slot) => (
					<TokenField
						label="Scroll MT"
						value={slot.value ?? ""}
						placeholder="4"
						options={scrollMarginOptions}
						onCommit={(next) =>
							slot.apply(
								next.trim()
									? interactionUtility(
											"interaction.scroll-margin-top",
											next.trim(),
										)
									: null,
							)
						}
					/>
				)}
			/>
			<StyleOverrideRows
				label="Touch action"
				className={className}
				options={options}
				property="interaction.touch-action"
				onChange={onChange}
				renderControl={(slot) => (
					<Segmented
						ariaLabel="Touch action"
						options={TOUCH_OPTIONS}
						value={slot.value}
						onChange={(next) =>
							slot.apply(
								next === null
									? null
									: interactionUtility("interaction.touch-action", next),
							)
						}
					/>
				)}
			/>
			<StyleOverrideRows
				label="Will change"
				className={className}
				options={options}
				property="interaction.will-change"
				onChange={onChange}
				renderControl={(slot) => (
					<Segmented
						ariaLabel="Will change"
						options={WILL_CHANGE_OPTIONS}
						value={slot.value}
						onChange={(next) =>
							slot.apply(
								next === null
									? null
									: interactionUtility("interaction.will-change", next),
							)
						}
					/>
				)}
			/>
		</StyleSection>
	);
}
