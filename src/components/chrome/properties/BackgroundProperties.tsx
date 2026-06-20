import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { useResolvedColorTokens } from "../../../hooks/useResolvedColorTokens";
import { useResolvedCustomUtilities } from "../../../hooks/useResolvedCustomUtilities";
import { systemAssetsQueryOptions } from "../../../queries/system-assets";
import { useDesignSystemId } from "../../../stores/design-store";
import {
	assetImageSlotValue,
	assetImageUtility,
} from "../../../utils/asset-background";
import {
	buildPropertyModel,
	type ModelOptions,
	type StyleProperty,
} from "../../../utils/tailwind-classname";
import { useProjectScope } from "../../contexts";
import { Segmented, type SegmentedOption } from "../../ui/segmented";
import { backgroundUtility } from "./backgroundPropertiesController";
import { ColorPropertyControl } from "./ColorPropertyControl";
import {
	applyColorChange,
	applyColorClear,
	applyColorClearAll,
} from "./colorPropertiesController";
import { percentStopTokenOptions } from "./domainTokenOptions";
import { StyleOverrideRows } from "./StyleOverrideRows";
import { StyleSection } from "./StyleSection";
import { getStyleIntent, styleValueText } from "./styleSectionController";
import { TokenField } from "./TokenField";

type BackgroundPropertiesProps = {
	className: string;
	onChange: (next: string) => void;
};

const SIZE_OPTIONS: readonly SegmentedOption<string>[] = [
	{ value: "auto", label: "Auto" },
	{ value: "cover", label: "Cover" },
	{ value: "contain", label: "Contain" },
];

const REPEAT_OPTIONS: readonly SegmentedOption<string>[] = [
	{ value: "no-repeat", label: "None" },
	{ value: "repeat", label: "Repeat" },
	{ value: "repeat-x", label: "X" },
	{ value: "repeat-y", label: "Y" },
];

const ATTACHMENT_OPTIONS: readonly SegmentedOption<string>[] = [
	{ value: "scroll", label: "Scroll" },
	{ value: "fixed", label: "Fixed" },
	{ value: "local", label: "Local" },
];

const GRADIENT_OPTIONS: readonly SegmentedOption<string>[] = [
	{ value: "linear-to-r", label: "→" },
	{ value: "linear-to-b", label: "↓" },
	{ value: "linear-to-br", label: "↘" },
	{ value: "radial", label: "Radial" },
	{ value: "conic", label: "Conic" },
];

const COLOR_ROWS = [
	{ property: "background" as const, label: "Background", likely: true },
	{ property: "gradient-from" as const, label: "From" },
	{ property: "gradient-via" as const, label: "Via" },
	{ property: "gradient-to" as const, label: "To" },
];

export function BackgroundProperties({
	className,
	onChange,
}: BackgroundPropertiesProps) {
	const systemId = useDesignSystemId();
	const resolved = useResolvedColorTokens(systemId);
	const customUtilityRoots = useResolvedCustomUtilities(systemId);

	const options = useMemo<ModelOptions>(
		() => ({ colorTokens: resolved.names, ...customUtilityRoots }),
		[resolved.names, customUtilityRoots],
	);

	const model = useMemo(
		() => buildPropertyModel(className, options),
		[className, options],
	);

	const stopOptions = useMemo(() => percentStopTokenOptions(), []);

	const read = useCallback(
		(property: StyleProperty) =>
			styleValueText(getStyleIntent(className, options, property)),
		[className, options],
	);

	const size = read("background.background-size");
	const gradient = read("background.background-gradient");

	// Background color (color domain) and image (style domain) are independent
	// slots that compose, so surface both in the summary.
	const hasColor = Boolean(model.byMode[""]?.byProperty.background?.[""]);
	const hasImage = Boolean(read("background.background-image"));
	const summary = [
		hasColor ? "color" : null,
		hasImage ? "image" : null,
		size,
		gradient,
	].filter((value): value is string => value !== null);

	return (
		<StyleSection title="Background" summary={summary}>
			{COLOR_ROWS.map(({ property, label, likely }) => (
				<ColorPropertyControl
					key={property}
					label={label}
					property={property}
					model={model}
					resolved={resolved}
					likely={likely}
					onSet={(variants, value) =>
						onChange(
							applyColorChange(className, options, {
								property,
								variants,
								value,
							}),
						)
					}
					onClear={(variants) =>
						onChange(
							applyColorClear(className, options, { property, variants }),
						)
					}
					onClearAll={(chains) =>
						onChange(applyColorClearAll(className, options, property, chains))
					}
				/>
			))}
			<StyleOverrideRows
				label="Image"
				className={className}
				options={options}
				property="background.background-image"
				inline
				onChange={onChange}
				renderControl={(slot) => (
					<BackgroundImageSelect
						systemId={systemId}
						value={slot.value}
						onSelect={(assetId) =>
							slot.apply(assetId ? assetImageUtility(assetId) : null)
						}
					/>
				)}
			/>
			{(
				[
					["background.background-size", "Size", SIZE_OPTIONS],
					["background.background-repeat", "Repeat", REPEAT_OPTIONS],
					[
						"background.background-attachment",
						"Attachment",
						ATTACHMENT_OPTIONS,
					],
					["background.background-gradient", "Gradient", GRADIENT_OPTIONS],
				] as const
			).map(([property, label, segmentedOptions]) => (
				<StyleOverrideRows
					key={property}
					label={label}
					className={className}
					options={options}
					property={property}
					onChange={onChange}
					renderControl={(slot) => (
						<Segmented
							ariaLabel={label}
							options={segmentedOptions}
							value={slot.value}
							onChange={(next) =>
								slot.apply(
									next === null ? null : backgroundUtility(property, next),
								)
							}
						/>
					)}
				/>
			))}
			{(
				[
					["background.gradient-from-position", "From %", "50%"],
					["background.gradient-via-position", "Via %", "25%"],
					["background.gradient-to-position", "To %", "75%"],
				] as const
			).map(([property, label, placeholder]) => (
				<StyleOverrideRows
					key={property}
					label={label}
					className={className}
					options={options}
					property={property}
					inline
					onChange={onChange}
					renderControl={(slot) => (
						<TokenField
							label={label}
							value={slot.value ?? ""}
							placeholder={placeholder}
							options={stopOptions}
							onCommit={(next) =>
								slot.apply(
									next.trim() ? backgroundUtility(property, next.trim()) : null,
								)
							}
						/>
					)}
				/>
			))}
		</StyleSection>
	);
}

/**
 * Picks a system asset to use as the background image, reusing the asset
 * registry/picker. Selecting writes the id-bound utility
 * `bg-(image:--asset-<id>)` through the enclosing override-aware row; the
 * iframe resolves the var via `useInjectSystemAssets`.
 */
function BackgroundImageSelect({
	systemId,
	value,
	onSelect,
}: {
	systemId: string | null | undefined;
	/** Current slot value text (`styleValueText` form), or null when unset. */
	value: string | null;
	/** Called with the picked asset id, or `""` to clear. */
	onSelect: (assetId: string) => void;
}) {
	const projectScope = useProjectScope();
	const assetsQuery = useQuery({
		...systemAssetsQueryOptions(systemId ?? "", projectScope),
		enabled: Boolean(systemId),
	});
	const assets = assetsQuery.data?.assets ?? [];

	const selectedId =
		assets.find((asset) => assetImageSlotValue(asset.id) === value)?.id ?? "";

	return (
		<label className="flex h-6 min-w-0 flex-1 items-center gap-1.5 bg-slate-200/60 px-1.5 text-[11px] inset-shadow-[0_0_0_1px] inset-shadow-transparent focus-within:inset-shadow-cyan-200">
			<span className="shrink-0 text-slate-400">Image</span>
			<select
				className="h-full min-w-0 flex-1 border-none bg-transparent text-xs text-slate-950 focus:outline-none"
				value={selectedId}
				disabled={!systemId || assetsQuery.isPending}
				onChange={(event) => onSelect(event.currentTarget.value)}
			>
				<option value="">
					{!systemId
						? "No linked system"
						: assetsQuery.isPending
							? "Loading assets"
							: "No image"}
				</option>
				{assets.map((asset) => (
					<option key={asset.id} value={asset.id}>
						{asset.name}
					</option>
				))}
			</select>
		</label>
	);
}
