import { Field } from "@base-ui/react/field";
import { Input as InputPrimitive, type InputProps } from "@base-ui/react/input";
import type { ComponentProps } from "react";
import { tv } from "tailwind-variants";

const input = tv({
	base: "border-none bg-gray-200/60 text-black w-full rounded-none inset-shadow-[0_0_0_1px] text-xs font-normal file:font-medium focus-visible:outline-none",
	variants: {
		variant: {
			inline: "inset-shadow-blue-200 leading-5 pl-0.5 pr-1",
			block:
				"inset-shadow-transparent focus-within:inset-shadow-blue-200 px-1 py-0.5",
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
	variant: "inline" | "block";
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
		<Field.Root data-slot="field-root" className="text-xs flex flex-col gap-1">
			<Field.Label data-slot="field-label" className="font-semibold">
				{label}
			</Field.Label>
			<Field.Control
				data-slot="field-control"
				className={input({ className, variant: "block" })}
				{...props}
			/>
			{description ? (
				<Field.Description className="text-gray-900/60 pt-0.5">
					{description}
				</Field.Description>
			) : null}
		</Field.Root>
	);
}

function TextareaField({
	label,
	description,
	className,
	...props
}: Omit<ComponentProps<"textarea">, "className"> & {
	className?: string;
	label: string;
	description?: string;
}) {
	return (
		<Field.Root data-slot="field-root" className="text-xs flex flex-col gap-1">
			<Field.Label data-slot="field-label" className="font-semibold">
				{label}
			</Field.Label>
			<textarea
				data-slot="field-control"
				className={input({
					className: ["min-h-24 resize-y leading-4", className],
					variant: "block",
				})}
				{...props}
			/>
			{description ? (
				<Field.Description className="text-gray-900/60 pt-0.5">
					{description}
				</Field.Description>
			) : null}
		</Field.Root>
	);
}

export { Input, InputField, TextareaField };
