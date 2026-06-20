import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { tv } from "tailwind-variants";

interface TextProps extends useRender.ComponentProps<"span"> {
	variant?: "title" | "subtitle" | "label" | "eyebrow" | "section-divider";
}

const text = tv({
	variants: {
		variant: {
			title: "text-xl text-slate-900 font-medium",
			subtitle: "text-sm font-bold",
			label: "text-xs font-semibold",
			text: "text-sm font-normal",
			eyebrow: "font-mono text-[10px] uppercase tracking-wider text-cyan-700",
			"section-divider":
				"bg-slate-50 px-5 py-1.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-slate-500",
		},
	},
	defaultVariants: {
		variant: "text",
	},
});

function Text({ className, variant, ...props }: TextProps) {
	const { render, ...otherProps } = props;

	const element = useRender({
		defaultTagName: "span",
		render,
		props: mergeProps<"span">(
			{ className: text({ className, variant }) },
			otherProps,
		),
	});

	return element;
}

export { Text, type TextProps };
