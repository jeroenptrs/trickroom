import { Menu } from "@base-ui/react/menu";
import {
	RiAddLine as AddLine,
	RiDeleteBin6Line as DeleteBin,
} from "@remixicon/react";
import { useMemo, useState } from "react";
import type { ResolvedColorTokens } from "../../../utils/resolved-color-tokens";
import type {
	ColorProperty,
	ColorValue,
	PropertyModel,
} from "../../../utils/tailwind-classname";
import { Button } from "../../ui/button";
import { Text } from "../../ui/text";
import { ColorPickerPopover } from "./ColorPickerPopover";
import { ColorSwatch } from "./ColorSwatch";
import { appearanceFromIntent } from "./colorSwatchAppearance";
import { computeColorPropertySlots } from "./colorPropertySlots";

const COMMON_VARIANTS = [
	"hover",
	"focus",
	"focus-visible",
	"active",
	"disabled",
	"sm",
	"md",
	"lg",
	"xl",
	"2xl",
] as const;

type ColorPropertyControlProps = {
	label: string;
	property: ColorProperty;
	model: PropertyModel;
	resolved: ResolvedColorTokens;
	onSet: (variants: string[], value: ColorValue) => void;
	onClear: (variants: string[]) => void;
};

export function ColorPropertyControl({
	label,
	property,
	model,
	resolved,
	onSet,
	onClear,
}: ColorPropertyControlProps) {
	const [draftVariants, setDraftVariants] = useState<string[]>([]);

	const slots = useMemo(
		() => computeColorPropertySlots(model, property, draftVariants),
		[model, property, draftVariants],
	);

	const usedVariantKeys = useMemo(
		() => new Set(slots.map((s) => s.variantKey)),
		[slots],
	);
	const availableCommonVariants = COMMON_VARIANTS.filter(
		(variant) => !usedVariantKeys.has(variant),
	);

	function handleSet(variants: string[], value: ColorValue) {
		onSet(variants, value);
		setDraftVariants((prev) => prev.filter((v) => v !== variants.join(":")));
	}

	function handleClear(variants: string[]) {
		const variantKey = variants.join(":");
		onClear(variants);
		setDraftVariants((prev) => prev.filter((v) => v !== variantKey));
	}

	return (
		<div className="flex flex-col gap-1">
			<div className="flex flex-row items-center justify-between">
				<Text variant="label" render={<div />} className="px-1 shrink-0">
					{label}
				</Text>
				{availableCommonVariants.length > 0 ? (
					<AddVariantMenu
						availableVariants={availableCommonVariants}
						onAdd={(variant) => {
							setDraftVariants((prev) =>
								prev.includes(variant) ? prev : [...prev, variant],
							);
						}}
					/>
				) : null}
			</div>
			<div className="flex flex-col gap-0.5">
				{slots.map(({ variantKey, variants, entry }) => {
					const appearance = entry
						? appearanceFromIntent(entry.intent, resolved)
						: ({ kind: "empty" } as const);
					const tokenLabel = entry ? labelForEntry(entry.intent) : "Pick color";
					const isWarning =
						appearance.kind === "color" && appearance.warning === true;
					return (
						<div
							key={variantKey || "default"}
							className="flex flex-row items-center gap-1.5 px-1"
						>
							<div className="flex flex-row items-center">
								{variantKey ? (
									<span className="text-xs text-gray-900 font-semibold w-fit truncate shrink-0">
										{variantKey}:
									</span>
								) : null}
								<ColorPickerPopover
									resolved={resolved}
									onPick={(value) => handleSet(variants, value)}
									onClear={() => handleClear(variants)}
									trigger={
										<span
											className="flex flex-row items-center gap-1.5"
											data-warning={isWarning ? "true" : undefined}
										>
											<ColorSwatch appearance={appearance} title={tokenLabel} />
											<span className="text-xs text-gray-900 truncate max-w-32">
												{tokenLabel}
											</span>
										</span>
									}
								/>
							</div>
							{entry ? (
								<Button
									type="button"
									variant="block"
									title={`Clear ${variantKey || "default"} ${label.toLowerCase()}`}
									onClick={() => handleClear(variants)}
									className="ml-auto p-0.5"
								>
									<DeleteBin className="size-3 fill-gray-900/60" />
								</Button>
							) : null}
						</div>
					);
				})}
			</div>
		</div>
	);
}

function AddVariantMenu({
	availableVariants,
	onAdd,
}: {
	availableVariants: readonly string[];
	onAdd: (variant: string) => void;
}) {
	return (
		<Menu.Root modal>
			<Menu.Trigger
				className="flex flex-row items-center gap-1 text-xs self-start cursor-pointer"
				render={<Button variant="block" />}
			>
				<AddLine className="size-3 fill-gray-900" />
				<span>variant</span>
			</Menu.Trigger>
			<Menu.Portal>
				<Menu.Positioner sideOffset={4} align="start">
					<Menu.Popup className="bg-gray-50 inset-shadow-[0_0_0_1px] inset-shadow-gray-200 p-1 flex flex-col">
						{availableVariants.map((variant) => (
							<Menu.Item
								key={variant}
								className="text-left text-xs px-2 py-0.5 cursor-default data-[highlighted]:bg-gray-200/60"
								onClick={() => onAdd(variant)}
							>
								{variant}
							</Menu.Item>
						))}
					</Menu.Popup>
				</Menu.Positioner>
			</Menu.Portal>
		</Menu.Root>
	);
}

function labelForEntry(intent: {
	token: string | null;
	keyword: string | null;
	arbitraryValue: string | null;
}): string {
	if (intent.keyword) return intent.keyword;
	if (intent.arbitraryValue) return intent.arbitraryValue;
	return intent.token ?? "Pick color";
}
