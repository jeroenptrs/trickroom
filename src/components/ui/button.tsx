import { Button as ButtonPrimitive } from "@base-ui/react/button";
import type { ComponentProps } from "react";
import { tv } from "tailwind-variants";

const button = tv({
	base: "border-none bg-transparent rounded-none inset-shadow-[0_0_0_1px] text-sm font-medium focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50",
	variants: {
		variant: {
			block:
				"inset-shadow-transparent not-disabled:focus-within:inset-shadow-blue-200 px-1 py-0.5 not-disabled:hover:bg-gray-200/60 not-disabled:active:bg-gray-200 not-disabled:active:text-blue-500 not-disabled:active:[&_svg]:fill-blue-500",
		},
		flavor: {
			warning: "",
		},
	},
	compoundVariants: [
		{
			variant: "block",
			flavor: "warning",
			className:
				"not-disabled:focus-within:inset-shadow-orange-200 not-disabled:active:text-orange-500 not-disabled:active:[&_svg]:fill-orange-500",
		},
	],
});

function Button({
	type,
	flavor,
	variant,
	className,
	...props
}: ComponentProps<"button"> & { variant: "block"; flavor?: "warning" }) {
	return (
		<ButtonPrimitive
			type={type}
			data-slot="button"
			className={button({ variant, flavor, className })}
			{...props}
		/>
	);
}

export { Button };
