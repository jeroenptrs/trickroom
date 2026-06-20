import { createElement, memo, type ReactNode } from "react";
import {
	getRenderableProps,
	resolveRenderableRegistryComponent,
} from "../../libraries/render-registry";
import { DesignSystemRenderContext } from "../../libraries/trickroom/render-context";
import {
	useChildren,
	useDesignRoots,
	useDesignSystemId,
	useElement,
} from "../../stores/design-store";

type SerializedElementProps = {
	id: string;
};

function SerializedElement({ id }: SerializedElementProps): ReactNode {
	const element = useElement(id);
	const childIds = useChildren(id);

	if (!element) {
		return null;
	}

	const resolution = resolveRenderableRegistryComponent(
		element.props["data-trickroom-library"],
		element.props["data-trickroom-component"],
	);

	if (resolution.status !== "known") {
		return null;
	}

	const props = getRenderableProps(element.props, resolution.definition);

	if (element.role === "text") {
		return createElement(resolution.definition.component, props, element.text);
	}

	if (element.role === "leaf") {
		return createElement(resolution.definition.component, props);
	}

	return createElement(
		resolution.definition.component,
		props,
		childIds.map((childId) => <SerializedElement key={childId} id={childId} />),
	);
}

export const Artboards = memo(function Artboards() {
	const rootIds = useDesignRoots();
	const systemId = useDesignSystemId() ?? null;

	return (
		<DesignSystemRenderContext.Provider value={systemId}>
			{rootIds.map((rootId) => (
				<SerializedElement key={rootId} id={rootId} />
			))}
		</DesignSystemRenderContext.Provider>
	);
});
