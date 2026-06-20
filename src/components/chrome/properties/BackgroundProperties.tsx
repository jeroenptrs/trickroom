import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { useResolvedColorTokens } from "../../../hooks/useResolvedColorTokens";
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
import {
	applyColorChange,
	applyColorClear,
} from "./colorPropertiesController";
import { ColorPropertyControl } from "./ColorPropertyControl";
import { StyleSection } from "./StyleSection";
import { Segmented, ValueField, type SegmentedOption } from "./StyleControls";
import {
	applyStyleUtility,
	clearStyleProperty,
	getStyleIntent,
	styleValueText,
} from "./styleSectionController";
import { backgroundUtility } from "./backgroundPropertiesController";

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
	{ property: "background" as const, label: "Background" },
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

	const options = useMemo<ModelOptions>(
		() => ({ colorTokens: resolved.names }),
		[resolved.names],
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

	const apply = useCallback(
		(property: StyleProperty, next: string | null) => {
			if (next === null) {
				onChange(clearStyleProperty(className, options, property));
				return;
			}
			onChange(
				applyStyleUtility(
					className,
					options,
					property,
					backgroundUtility(property, next),
				),
			);
		},
		[className, onChange, options],
	);

	const size = read("background.background-size");
	const repeat = read("background.background-repeat");
	const attachment = read("background.background-attachment");
	const gradient = read("background.background-gradient");
	const fromPos = read("background.gradient-from-position");
	const viaPos = read("background.gradient-via-position");
	const toPos = read("background.gradient-to-position");

	// Background color (color domain) and image (style domain) are independent
	// slots that compose, so surface both in the summary.
	const hasColor = Boolean(model.byMode[""]?.byProperty.background?.[""]);
	const hasImage = Boolean(read("background.background-image"));
	const summary =
		[hasColor && "color", hasImage && "image", size, gradient]
			.filter(Boolean)
			.join(" · ") || undefined;

	return (
		<StyleSection title="Background" summary={summary}>
			{COLOR_ROWS.map(({ property, label }) => (
				<ColorPropertyControl
					key={property}
					label={label}
					property={property}
					model={model}
					resolved={resolved}
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
						onChange(applyColorClear(className, options, { property, variants }))
					}
				/>
			))}
			<BackgroundImagePicker
				className={className}
				options={options}
				systemId={systemId}
				onChange={onChange}
			/>
			<Segmented
				ariaLabel="Background size"
				options={SIZE_OPTIONS}
				value={size}
				onChange={(next) => apply("background.background-size", next)}
			/>
			<Segmented
				ariaLabel="Background repeat"
				options={REPEAT_OPTIONS}
				value={repeat}
				onChange={(next) => apply("background.background-repeat", next)}
			/>
			<Segmented
				ariaLabel="Background attachment"
				options={ATTACHMENT_OPTIONS}
				value={attachment}
				onChange={(next) => apply("background.background-attachment", next)}
			/>
			<Segmented
				ariaLabel="Gradient"
				options={GRADIENT_OPTIONS}
				value={gradient}
				onChange={(next) => apply("background.background-gradient", next)}
			/>
			<ValueField
				label="From %"
				value={fromPos ?? ""}
				placeholder="50%"
				onCommit={(next) =>
					apply(
						"background.gradient-from-position",
						next.trim() ? next.trim() : null,
					)
				}
			/>
			<ValueField
				label="Via %"
				value={viaPos ?? ""}
				placeholder="25%"
				onCommit={(next) =>
					apply(
						"background.gradient-via-position",
						next.trim() ? next.trim() : null,
					)
				}
			/>
			<ValueField
				label="To %"
				value={toPos ?? ""}
				placeholder="75%"
				onCommit={(next) =>
					apply(
						"background.gradient-to-position",
						next.trim() ? next.trim() : null,
					)
				}
			/>
		</StyleSection>
	);
}

/**
 * Picks a system asset to use as the background image, reusing the asset
 * registry/picker. Writes the id-bound utility `bg-(image:--asset-<id>)`; the
 * iframe resolves the var via `useInjectSystemAssets`.
 */
function BackgroundImagePicker({
	className,
	options,
	systemId,
	onChange,
}: {
	className: string;
	options: ModelOptions;
	systemId: string | null | undefined;
	onChange: (next: string) => void;
}) {
	const projectScope = useProjectScope();
	const assetsQuery = useQuery({
		...systemAssetsQueryOptions(systemId ?? "", projectScope),
		enabled: Boolean(systemId),
	});
	const assets = assetsQuery.data?.assets ?? [];

	const current = styleValueText(
		getStyleIntent(className, options, "background.background-image"),
	);
	const selectedId =
		assets.find((asset) => assetImageSlotValue(asset.id) === current)?.id ?? "";

	return (
		<label className="flex min-w-0 items-center gap-2 text-[11px]">
			<span className="w-16 shrink-0 text-slate-400">Image</span>
			<select
				className="h-6 min-w-0 flex-1 border-none bg-slate-200/60 px-1 text-xs text-slate-950 inset-shadow-[0_0_0_1px_transparent] focus:inset-shadow-[0_0_0_1px_#67e8f9] focus:outline-none"
				value={selectedId}
				disabled={!systemId || assetsQuery.isPending}
				onChange={(event) => {
					const assetId = event.currentTarget.value;
					onChange(
						assetId
							? applyStyleUtility(
									className,
									options,
									"background.background-image",
									assetImageUtility(assetId),
								)
							: clearStyleProperty(
									className,
									options,
									"background.background-image",
								),
					);
				}}
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
