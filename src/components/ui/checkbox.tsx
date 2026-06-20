import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox";
import { RiCheckLine as CheckIcon } from "@remixicon/react";

export default function Checkbox(
	props: Omit<CheckboxPrimitive.Root.Props, "className">,
) {
	// TODO: decide on focus-visible state, previously: focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-800
	return (
		<CheckboxPrimitive.Root
			{...props}
			className="flex size-6 items-center justify-center rounded-none data-checked:bg-gray-900 data-unchecked:inset-shadow-[0_0_0_1px] data-unchecked:inset-shadow-gray-900"
		>
			<CheckboxPrimitive.Indicator className="flex text-gray-50 data-unchecked:hidden">
				<CheckIcon className="size-4" />
			</CheckboxPrimitive.Indicator>
		</CheckboxPrimitive.Root>
	);
}
