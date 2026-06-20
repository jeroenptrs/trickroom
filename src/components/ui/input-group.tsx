import type { LucideIcon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { Button } from "./button";

/**
 * Stamped input group: a focus-tracking frame around an embedded input
 * (variant="formEmbedded") with an optional leading icon and trailing
 * `InputGroupButton`s divided from the field.
 */
function InputGroup({
	icon: Icon,
	className,
	children,
}: {
	icon?: LucideIcon;
	className?: string;
	children: ReactNode;
}) {
	return (
		<div
			className={[
				"group flex min-w-0 items-stretch inset-shadow-[0_0_0_1px] inset-shadow-slate-200 focus-within:inset-shadow-cyan-500",
				className,
			]
				.filter(Boolean)
				.join(" ")}
		>
			{Icon ? (
				<Icon
					className="ml-2 size-4 shrink-0 self-center text-slate-600 group-focus-within:text-cyan-900"
					aria-hidden="true"
				/>
			) : null}
			{children}
		</div>
	);
}

/** Trailing button inside an `InputGroup`, divided from the field by a stamped rule. */
function InputGroupButton({
	className,
	...props
}: Omit<ComponentProps<typeof Button>, "variant">) {
	return (
		<Button
			variant="block"
			className={[
				"shrink-0 inset-shadow-[1px_0_0_0] inset-shadow-slate-200 group-focus-within:inset-shadow-cyan-500 not-disabled:hover:inset-shadow-[0_0_0_1px] not-disabled:active:inset-shadow-[0_0_0_1px] not-disabled:active:inset-shadow-cyan-500",
				className,
			]
				.filter(Boolean)
				.join(" ")}
			{...props}
		/>
	);
}

export { InputGroup, InputGroupButton };
