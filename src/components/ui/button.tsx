import { Button as ButtonPrimitive } from "@base-ui/react/button";
import type { ComponentProps } from "react";
import { tv } from "tailwind-variants";

const button = tv({
	base: "border-none bg-transparent rounded-none inset-shadow-[0_0_0_1px] inset-shadow-transparent text-sm font-medium px-3 py-2 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50",
	variants: {
		variant: {
			block:
				"text-slate-950 not-disabled:focus-within:inset-shadow-cyan-500 not-disabled:hover:bg-slate-100 not-disabled:active:bg-cyan-100 not-disabled:active:text-cyan-900 not-disabled:active:[&_svg]:text-cyan-900",
			blockDark:
				"text-slate-100 not-disabled:focus-within:inset-shadow-cyan-500 not-disabled:hover:bg-slate-800 not-disabled:active:bg-cyan-100 not-disabled:active:text-cyan-900 not-disabled:active:[&_svg]:text-cyan-900",
			filled:
				"bg-slate-950 text-slate-100 not-disabled:hover:bg-slate-800 not-disabled:focus-within:inset-shadow-cyan-500 not-disabled:active:bg-cyan-100 not-disabled:active:text-cyan-900 not-disabled:active:[&_svg]:text-cyan-900",
			outlined:
				"text-slate-950 inset-shadow-slate-200 not-disabled:focus-within:inset-shadow-cyan-500 not-disabled:hover:bg-slate-100 not-disabled:active:inset-shadow-cyan-500 not-disabled:active:bg-cyan-100 not-disabled:active:text-cyan-900 not-disabled:active:[&_svg]:text-cyan-900",
		},
		flavor: {
			warning: "",
		},
		isSelected: {
			true: "",
		},
	},
	compoundVariants: [
		{
			variant: "block",
			flavor: "warning",
			className:
				"not-disabled:focus-within:inset-shadow-red-500 not-disabled:active:bg-red-100 not-disabled:active:text-red-900 not-disabled:active:[&_svg]:text-red-900",
		},
		{
			variant: "blockDark",
			flavor: "warning",
			className:
				"text-red-100 not-disabled:focus-within:inset-shadow-red-500 not-disabled:hover:bg-red-950 not-disabled:active:bg-red-100 not-disabled:active:text-red-950 not-disabled:active:[&_svg]:text-red-950",
		},
		{
			variant: "outlined",
			flavor: "warning",
			className:
				"text-red-700 inset-shadow-red-300 not-disabled:focus-within:inset-shadow-red-500 not-disabled:hover:bg-red-50 not-disabled:active:inset-shadow-red-500 not-disabled:active:bg-red-100 not-disabled:active:text-red-900 not-disabled:active:[&_svg]:text-red-900",
		},
		{
			variant: "block",
			isSelected: true,
			className:
				"bg-cyan-100 text-cyan-900 [&_svg]:text-cyan-900 not-disabled:hover:bg-cyan-100",
		},
		{
			variant: "block",
			flavor: "warning",
			isSelected: true,
			className:
				"bg-red-100 text-red-900 [&_svg]:text-red-900 not-disabled:hover:bg-red-100",
		},
		{
			variant: "blockDark",
			isSelected: true,
			className:
				"bg-cyan-100 text-cyan-900 [&_svg]:text-cyan-900 not-disabled:hover:bg-cyan-100",
		},
		{
			variant: "blockDark",
			flavor: "warning",
			isSelected: true,
			className:
				"bg-red-100 text-red-950 [&_svg]:text-red-950 not-disabled:hover:bg-red-100",
		},
	],
});

function Button({
	type,
	flavor,
	variant,
	className,
	isSelected,
	...props
}: ComponentProps<"button"> & {
	variant: "block" | "blockDark" | "filled" | "outlined";
	flavor?: "warning";
	isSelected?: boolean;
}) {
	return (
		<ButtonPrimitive
			type={type}
			data-slot="button"
			className={button({ variant, flavor, isSelected, className })}
			{...props}
		/>
	);
}

export { Button };
