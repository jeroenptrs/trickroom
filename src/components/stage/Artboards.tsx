import { createElement, memo, type ReactNode, useMemo } from "react";
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
import {
	resolveResponsiveStageActiveBoardId,
	useResponsiveStage,
} from "../responsive-stage-context";

type SerializedElementProps = {
	id: string;
	rootId: string;
	isRoot?: boolean;
};

function SerializedElement({
	id,
	rootId,
	isRoot = false,
}: SerializedElementProps): ReactNode {
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
	if (isRoot) {
		props["data-trickroom-root-id"] = rootId;
	}

	if (element.role === "text") {
		return createElement(resolution.definition.component, props, element.text);
	}

	if (element.role === "leaf") {
		return createElement(resolution.definition.component, props);
	}

	return createElement(
		resolution.definition.component,
		props,
		childIds.map((childId) => (
			<SerializedElement key={childId} id={childId} rootId={rootId} />
		)),
	);
}

export const Artboards = memo(function Artboards() {
	const rootIds = useDesignRoots();
	const systemId = useDesignSystemId() ?? null;
	const { mode, activeBoardId } = useResponsiveStage();

	const visibleRootIds = useMemo(() => {
		if (mode === "canvas") {
			return rootIds;
		}

		// Responsive mode renders one board at a time. In compiled Tailwind mode,
		// useCompiledTailwind scans the iframe DOM for class candidates, so a board
		// switch can trigger a new compile/style pass and brief flicker. MVP accepts
		// this; future mitigations: keep inactive boards mounted but hidden for
		// candidate collection, or collect candidates from the design store.
		const activeRootId = resolveResponsiveStageActiveBoardId(
			rootIds,
			activeBoardId,
		);
		return activeRootId ? [activeRootId] : [];
	}, [activeBoardId, mode, rootIds]);

	return (
		<DesignSystemRenderContext.Provider value={systemId}>
			{visibleRootIds.map((rootId) => (
				<SerializedElement key={rootId} id={rootId} rootId={rootId} isRoot />
			))}
		</DesignSystemRenderContext.Provider>
	);
});
