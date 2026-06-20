import { Separator as SeparatorPrimitive } from "@base-ui/react/separator";
import { tv } from "tailwind-variants/lite";

const { separator } = tv({
	slots: {
		separator:
			"data-[orientation=vertical]:w-px data-[orientation=horizontal]:h-px bg-gray-200",
	},
})();

function Separator({
	className,
	orientation = "horizontal",
	...props
}: SeparatorPrimitive.Props) {
	return (
		<SeparatorPrimitive
			data-slot="separator"
			orientation={orientation}
			className={separator({ className })}
			{...props}
		/>
	);
}

export { Separator };
