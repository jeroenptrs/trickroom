import { useRender } from "@base-ui/react/use-render";

interface TextProps extends useRender.ComponentProps<"div"> {}

function Text({ ...baseProps }: TextProps) {
	const { render, ...props } = baseProps;

	const element = useRender({
		defaultTagName: "div",
		render,
		props,
	});

	return element;
}

export { Text, type TextProps };
