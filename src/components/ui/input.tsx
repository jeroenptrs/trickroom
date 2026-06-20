import { Input as InputPrimitive, type InputProps } from "@base-ui/react/input";
import type { ComponentProps } from "react";
import { tv } from "tailwind-variants";
import { Field, FieldPrimitive } from "./field";

type InputVariant =
	| "inline"
	| "block"
	| "outlined"
	| "form"
	| "formCompact"
	| "formEmbedded";

const input = tv({
	base: "border-none bg-slate-200/60 text-slate-950 w-full rounded-none inset-shadow-[0_0_0_1px] text-xs font-normal file:font-medium placeholder:text-slate-500 focus-visible:outline-none disabled:opacity-50",
	variants: {
		variant: {
			inline: "inset-shadow-cyan-200 leading-5 pl-0.5 pr-1",
			block:
				"inset-shadow-transparent focus-within:inset-shadow-cyan-200 px-1 py-0.5",
			outlined:
				"bg-transparent inset-shadow-slate-200 focus-visible:inset-shadow-cyan-500 px-2 py-1.5",
			form: "bg-transparent px-3 py-2 text-sm inset-shadow-slate-200 focus-visible:inset-shadow-cyan-500 aria-invalid:inset-shadow-red-500",
			formCompact:
				"bg-white px-2 py-1.5 text-sm inset-shadow-slate-200 focus-visible:inset-shadow-cyan-500 aria-invalid:inset-shadow-red-500",
			formEmbedded: "bg-transparent px-2 py-2 text-sm inset-shadow-transparent",
		},
	},
});

function Input({
	className,
	type,
	variant,
	...props
}: Omit<InputProps, "className"> & {
	className?: string;
	variant: InputVariant;
}) {
	return (
		<InputPrimitive
			type={type}
			data-slot="input"
			className={input({ variant, className })}
			{...props}
		/>
	);
}

/** A Base UI Field.Control styled as an input, for use inside `Field`. */
function FieldControl({
	className,
	variant = "block",
	...props
}: Omit<InputProps, "className"> & {
	className?: string;
	variant?: InputVariant;
}) {
	return (
		<FieldPrimitive.Control
			data-slot="field-control"
			className={input({ variant, className })}
			{...props}
		/>
	);
}

function InputField({
	label,
	description,
	className,
	...props
}: Omit<InputProps, "className"> & {
	className?: string;
	label: string;
	description?: string;
}) {
	return (
		<Field label={label} description={description}>
			<FieldControl className={className} {...props} />
		</Field>
	);
}

function TextareaField({
	label,
	description,
	className,
	variant,
	...props
}: Omit<ComponentProps<"textarea">, "className"> & {
	className?: string;
	label: string;
	description?: string;
	variant?: InputVariant;
}) {
	return (
		<Field label={label} description={description}>
			<textarea
				data-slot="field-control"
				className={input({
					className: ["min-h-24 resize-y leading-4", className],
					variant: variant ?? "block",
				})}
				{...props}
			/>
		</Field>
	);
}

export { FieldControl, Input, InputField, TextareaField };
