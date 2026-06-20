import { tv } from "tailwind-variants";

const swatch = tv({
	base: "inline-block size-4 inset-shadow-[0_0_0_1px] inset-shadow-slate-200 shrink-0",
	variants: {
		state: {
			normal: "",
			warning: "inset-shadow-orange-500",
			empty:
				// Diagonal slash to indicate "no color".
				"bg-slate-50 [background-image:linear-gradient(45deg,transparent_45%,var(--color-slate-300)_45%,var(--color-slate-300)_55%,transparent_55%)]",
			transparent:
				// Checkerboard for transparent / clear.
				"[background-image:conic-gradient(var(--color-slate-200)_0%_25%,transparent_0%_50%,var(--color-slate-200)_50%_75%,transparent_0%)] [background-size:8px_8px]",
		},
		size: {
			sm: "size-3.5",
			md: "size-4",
			lg: "size-5",
		},
	},
	defaultVariants: {
		state: "normal",
		size: "md",
	},
});

export type ColorSwatchAppearance =
	| { kind: "color"; cssValue: string; warning?: boolean }
	| { kind: "transparent" }
	| { kind: "empty" };

type ColorSwatchProps = {
	appearance: ColorSwatchAppearance;
	size?: "sm" | "md" | "lg";
	className?: string;
	title?: string;
};

export function ColorSwatch({
	appearance,
	size,
	className,
	title,
}: ColorSwatchProps) {
	if (appearance.kind === "empty") {
		return (
			<span
				aria-hidden="true"
				title={title}
				className={swatch({ state: "empty", size, className })}
			/>
		);
	}

	if (appearance.kind === "transparent") {
		return (
			<span
				aria-hidden="true"
				title={title}
				className={swatch({ state: "transparent", size, className })}
			/>
		);
	}

	return (
		<span
			aria-hidden="true"
			title={title}
			style={{ backgroundColor: appearance.cssValue }}
			className={swatch({
				state: appearance.warning ? "warning" : "normal",
				size,
				className,
			})}
		/>
	);
}
