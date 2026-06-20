import { useRender } from "@base-ui/react/use-render";

interface ContainerProps extends useRender.ComponentProps<"div"> {}

function Container({ ...baseProps }: ContainerProps) {
	const { render, ...props } = baseProps;

	const element = useRender({
		defaultTagName: "div",
		render,
		props,
	});

	return element;
}

export { Container, type ContainerProps };
