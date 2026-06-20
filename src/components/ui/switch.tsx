import { Switch as SwitchPrimitive } from "@base-ui/react/switch";
import { tv } from "tailwind-variants";

// Tracks Checkbox: slate-900 when on, square geometry, cyan focus ring.
const switchStyles = tv({
	slots: {
		root: "flex h-4 w-7 shrink-0 items-center rounded-none p-0.5 inset-shadow-[0_0_0_1px] inset-shadow-transparent transition-colors data-checked:bg-slate-900 data-unchecked:bg-slate-300 not-disabled:focus-visible:outline-none not-disabled:focus-visible:inset-shadow-cyan-500 disabled:pointer-events-none disabled:opacity-50",
		thumb:
			"size-3 rounded-none bg-white transition-transform data-checked:translate-x-3",
	},
});

const { root, thumb } = switchStyles();

function Switch({
	className,
	...props
}: SwitchPrimitive.Root.Props & { className?: string }) {
	return (
		<SwitchPrimitive.Root
			data-slot="switch"
			className={root({ className })}
			{...props}
		>
			<SwitchPrimitive.Thumb data-slot="switch-thumb" className={thumb()} />
		</SwitchPrimitive.Root>
	);
}

export { Switch };
