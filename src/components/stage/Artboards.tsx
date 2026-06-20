import { createElement, type ReactNode } from "react";
import { getLibraryComponent } from "../../libraries/registry";
import {
	useDesignRoots,
	useElement,
	useChildren,
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

	const children =
		element.role === "text"
			? element.text
			: childIds.map((childId) => (
					<SerializedElement key={childId} id={childId} />
				));
	const libraryComponent = getLibraryComponent(
		element.props["data-trickroom-library"],
		element.props["data-trickroom-component"],
	);

	return createElement(libraryComponent.component, element.props, children);
}

export function Artboards() {
	const rootIds = useDesignRoots();

	return (
		<>
			{rootIds.map((rootId) => (
				<SerializedElement key={rootId} id={rootId} />
			))}
		</>
	);
}
