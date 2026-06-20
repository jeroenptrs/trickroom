import { createElement, type ElementType, type Ref } from "react";

const defaultOmittedProps = ["render"];

export function omitProps(
	props: Record<string, unknown>,
	keys: readonly string[],
): Record<string, unknown> {
	const nextProps = { ...props };

	for (const key of [...defaultOmittedProps, ...keys]) {
		delete nextProps[key];
	}

	return nextProps;
}

export function renderFallback(
	element: ElementType,
	props: Record<string, unknown>,
	ref: Ref<unknown>,
	omittedProps: readonly string[] = [],
) {
	return createElement(element, {
		...omitProps(props, omittedProps),
		ref,
	});
}
