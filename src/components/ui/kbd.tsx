import type { ComponentProps } from "react";

function Kbd({ className, children, ...props }: ComponentProps<"kbd">) {
	return (
		<kbd
			data-slot="kbd"
			className={[
				"inline-flex items-center justify-center rounded-none bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-600",
				className,
			]
				.filter(Boolean)
				.join(" ")}
			{...props}
		>
			{children}
		</kbd>
	);
}

export { Kbd };
