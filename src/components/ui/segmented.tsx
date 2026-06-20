import type { ReactNode } from "react";
import { tv } from "tailwind-variants";
import { Button } from "./button";

const segmented = tv({
	slots: {
		// The slate group shell makes the cells read as one control on the
		// white inspector (right-rail board 02).
		group: "flex gap-px bg-slate-100 p-0.5",
		cell: "flex-1 justify-center px-2 py-1 text-[11px] [&_svg]:size-3.5",
	},
});

const { group, cell } = segmented();

export type SegmentedOption<T extends string> = {
	value: T;
	/** Text or icon; pass `title` for the accessible name when using an icon. */
	label: ReactNode;
	/** Tooltip / accessible text when `label` is an icon. */
	title?: string;
};

type SegmentedProps<T extends string> = {
	options: readonly SegmentedOption<T>[];
	/** Currently active value, or null when the property is unset. */
	value: T | null;
	/** Called with the next value, or null when the active option is toggled off. */
	onChange: (next: T | null) => void;
	ariaLabel: string;
	className?: string;
};

/**
 * Segmented toggle group rendered with the block-variant Button. The selected
 * cell uses the block `isSelected` styling (cyan-100 / cyan-900). Re-clicking
 * the active option clears the property.
 */
export function Segmented<T extends string>({
	options,
	value,
	onChange,
	ariaLabel,
	className,
}: SegmentedProps<T>) {
	return (
		// biome-ignore lint/a11y/useSemanticElements: fieldset's intrinsic min-width breaks the rail layout; role=group + aria-label is the WAI-ARIA-sanctioned equivalent
		<div className={group({ className })} role="group" aria-label={ariaLabel}>
			{options.map((option) => {
				const isSelected = value === option.value;
				return (
					<Button
						key={option.value}
						type="button"
						variant="block"
						isSelected={isSelected}
						title={option.title}
						aria-label={option.title}
						className={cell()}
						onClick={() => onChange(isSelected ? null : option.value)}
					>
						{option.label}
					</Button>
				);
			})}
		</div>
	);
}
