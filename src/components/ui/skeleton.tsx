import type { ComponentProps } from "react";
import { tv } from "tailwind-variants";

const skeleton = tv({
	base: "block shrink-0 animate-pulse rounded-none bg-slate-200",
});

/**
 * A square placeholder block. Size it with width and height classes so the
 * skeleton mirrors the final layout. Hidden from screen readers; mark the
 * loading region with `aria-busy` instead.
 */
function Skeleton({ className, ...props }: ComponentProps<"span">) {
	return (
		<span
			data-slot="skeleton"
			aria-hidden="true"
			className={skeleton({ className })}
			{...props}
		/>
	);
}

export { Skeleton };
