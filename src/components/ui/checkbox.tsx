import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox";
import { Check as CheckIcon } from "lucide-react";
import { tv } from "tailwind-variants";

/**
 * A checkbox submits with its form. For a value that applies at once, use
 * `Switch` instead.
 */
const checkbox = tv({
	slots: {
		root: "flex shrink-0 items-center justify-center rounded-none focus-visible:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-500 data-checked:bg-slate-900 data-unchecked:bg-white data-unchecked:inset-shadow-[0_0_0_1px] data-unchecked:inset-shadow-slate-900 data-disabled:opacity-50",
		indicator: "flex text-slate-50 data-unchecked:hidden",
	},
	variants: {
		size: {
			md: { root: "size-6", indicator: "[&_svg]:size-4" },
			sm: { root: "size-4", indicator: "[&_svg]:size-3" },
		},
	},
	defaultVariants: { size: "md" },
});

export default function Checkbox({
	className,
	size,
	...props
}: Omit<CheckboxPrimitive.Root.Props, "className"> & {
	className?: string;
	size?: "md" | "sm";
}) {
	const styles = checkbox({ size });
	return (
		<CheckboxPrimitive.Root {...props} className={styles.root({ className })}>
			<CheckboxPrimitive.Indicator className={styles.indicator()}>
				<CheckIcon />
			</CheckboxPrimitive.Indicator>
		</CheckboxPrimitive.Root>
	);
}
