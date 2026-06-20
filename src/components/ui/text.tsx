import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { tv } from "tailwind-variants";

interface TextProps extends useRender.ComponentProps<"span"> {
	variant?: "title" | "subtitle" | "label";
}

const text = tv({
	variants: {
		variant: {
			title: "text-xl text-gray-900 font-medium",
			subtitle: "text-sm font-bold",
			label: "text-xs font-semibold",
			text: "text-sm font-normal",
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
