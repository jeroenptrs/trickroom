import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox";
import { Check as CheckIcon } from "lucide-react";

export default function Checkbox(
	props: Omit<CheckboxPrimitive.Root.Props, "className">,
) {
	// TODO: decide on focus-visible state, previously: focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-800
	return (
		<CheckboxPrimitive.Root
			{...props}
			className="flex size-6 items-center justify-center rounded-none data-checked:bg-slate-900 data-unchecked:inset-shadow-[0_0_0_1px] data-unchecked:inset-shadow-slate-900"
		>
			<CheckboxPrimitive.Indicator className="flex text-slate-50 data-unchecked:hidden">
				<CheckIcon className="size-4" />
			</CheckboxPrimitive.Indicator>
		</CheckboxPrimitive.Root>
	);
}
