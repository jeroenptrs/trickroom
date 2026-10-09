import { createElement, memo, type ReactNode, useMemo } from "react";
import {
	getRenderableProps,
	resolveRenderableRegistryComponent,
} from "../../libraries/render-registry";
import {
	StageBoardPortalContext,
	useStageBoardPortal,
} from "../../libraries/stage-portal";
import { DesignSystemRenderContext } from "../../libraries/trickroom/render-context";
import {
	useChildren,
	useDesignRoots,
	useDesignSystemId,
	useElement,
	useInstanceRootMarkers,
} from "../../stores/design-store";
import {
	resolveResponsiveStageActiveBoardId,
	useResponsiveStage,
} from "../responsive-stage-context";
import { resolveBoardSizing } from "./board-sizing";
import { useClassMergeContext } from "./class-merge-context";
import { MissingRenderer } from "./MissingRenderer";

type BoardRender = {
	/** Canvas boards get the default width floor from the iframe shell. */
	canvas: boolean;
	/** The board's portal host, rendered ahead of the board's children. */
	portalHost: ReactNode;
};

type SerializedElementProps = {
	id: string;
	rootId: string;
	board?: BoardRender;
};

// Memoised on its ids: an element re-renders only when its own entity or
// child list changes in the store, not when a parent or sibling does.
const SerializedElement = memo(function SerializedElementView({
	id,
	rootId,
	board,
}: SerializedElementProps): ReactNode {
	const isRoot = board !== undefined;
	const element = useElement(id);
	const childIds = useChildren(id);
	const classSource = useClassMergeContext().source;
	const instanceRoot = useInstanceRootMarkers(id);

	if (!element) {
		return null;
	}

	const resolution = resolveRenderableRegistryComponent(
		element.props["data-trickroom-library"],
		element.props["data-trickroom-component"],
	);

	if (resolution.status !== "known") {
		return (
			<MissingRenderer
				library={resolution.library}
				component={resolution.component}
				data-trickroom-node-id={id}
				data-trickroom-root-id={isRoot ? rootId : undefined}
			>
				{element.role === "text"
					? element.text
					: withPortalHost(
							board,
							childIds.map((childId) => (
								<SerializedElement key={childId} id={childId} rootId={rootId} />
							)),
						)}
			</MissingRenderer>
		);
	}

	const props = getRenderableProps(
		element.props,
		resolution.definition,
		classSource ? { source: classSource, root: instanceRoot } : null,
	);
	props["data-trickroom-node-id"] = id;
	if (isRoot) {
		props["data-trickroom-root-id"] = rootId;
		const sizing = resolveBoardSizing(props.className, props.style);
		if (board.canvas && sizing.defaultWidth) {
			props["data-trickroom-board-default-width"] = "";
		}
		// Only takes effect while an overlay is open in the board, so a
		// backdrop and a centred dialog have room even when content is short:
		// the canvas default height, or the viewport height elsewhere.
		if (sizing.defaultHeight) {
			props["data-trickroom-board-default-height"] = board.canvas
				? "canvas"
				: "viewport";
		}
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
		withPortalHost(
			board,
			childIds.map((childId) => (
				<SerializedElement key={childId} id={childId} rootId={rootId} />
			)),
		),
	);
});

function withPortalHost(board: BoardRender | undefined, children: ReactNode[]) {
	return board?.portalHost ? [board.portalHost, ...children] : children;
}

/**
 * A board root: the containing block and portal target for its own overlays,
 * so an open dialog centres on its board and a sheet pins to its board's edge
 * instead of the shared iframe viewport.
 */
const SerializedBoard = memo(function SerializedBoard({
	rootId,
	canvas,
}: {
	rootId: string;
	canvas: boolean;
}) {
	const { value, host } = useStageBoardPortal(canvas);

	return (
		<StageBoardPortalContext.Provider value={value}>
			<SerializedElement
				id={rootId}
				rootId={rootId}
				board={{ canvas, portalHost: host }}
			/>
		</StageBoardPortalContext.Provider>
	);
});

export const Artboards = memo(function Artboards() {
	const rootIds = useDesignRoots();
	const systemId = useDesignSystemId() ?? null;
	const { mode, activeBoardId } = useResponsiveStage();
	// Component classes merge like the project's code; the boards wait for
	// the settings so they never paint unmerged first.
	const classMergeReady = useClassMergeContext().ready;

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

	if (!classMergeReady) {
		return null;
	}

	return (
		<DesignSystemRenderContext.Provider value={systemId}>
			{visibleRootIds.map((rootId) => (
				<SerializedBoard
					key={rootId}
					rootId={rootId}
					canvas={mode === "canvas"}
				/>
			))}
		</DesignSystemRenderContext.Provider>
	);
});
