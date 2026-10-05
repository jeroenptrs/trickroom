import {
	type CSSProperties,
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
} from "react";
import { useFrame } from "react-frame-component";

/**
 * Stage-only portal target for the board an overlay is authored in.
 *
 * Every board renders into one shared iframe document, so portalling overlays
 * to that document's body stacks every board's dialog, sheet and popover on
 * top of each other against the editor pane. Inside a board, portal wrappers
 * target a host element inside the board instead; the board is the containing
 * block for `fixed` descendants (see `contain: layout` in the iframe shell),
 * so a `fixed inset-0` backdrop covers its own board and moves with pan/zoom.
 *
 * Render-time only: nothing here reaches the design file or exports.
 */
export type StageBoardPortal = {
	/** The board's portal host, or null until it has mounted. */
	container: HTMLElement | null;
	/** Whether the board renders on the canvas (shared, pannable pane). */
	canvas: boolean;
	/** Ask the board to mount its host; returns the release callback. */
	requestContainer: () => () => void;
};

export const StageBoardPortalContext = createContext<StageBoardPortal | null>(
	null,
);

export const STAGE_BOARD_PORTAL_ATTRIBUTE = "data-trickroom-board-portal";

/**
 * Whether the caller renders inside a board on the canvas, where every board
 * shares one document. Several boards can each hold an open modal there, and
 * each modal marks everything outside itself (the other boards' overlays
 * included) `aria-hidden`, adds a scroll lock and traps focus; a click on the
 * canvas would also dismiss non-modal overlays. The responsive view and
 * capture mount a single board, so they keep the authored modal behaviour.
 */
export function useIsCanvasBoard() {
	return useContext(StageBoardPortalContext)?.canvas === true;
}

/** Root props that keep a canvas overlay open, non-modal and inert to pans. */
export const CANVAS_OVERLAY_ROOT_PROPS = {
	modal: false,
	disablePointerDismissal: true,
} as const;

/**
 * Popup props for a canvas overlay: no initial focus unless authored, so a
 * dialog mounting on the canvas does not pull keyboard focus out of the
 * editor chrome into the stage iframe.
 */
export function useCanvasPopupProps<P extends { initialFocus?: unknown }>(
	props: P,
): P {
	const canvas = useIsCanvasBoard();
	return canvas && props.initialFocus === undefined
		? { ...props, initialFocus: false }
		: props;
}

/**
 * Resolves the container a Base UI portal wrapper should render into. An
 * explicit container always wins. Inside a board this is the board's host
 * (`null` while it mounts, which Base UI treats as "wait"); elsewhere it is
 * the frame document's body.
 */
export function useStagePortalContainer<T>(
	container: T | undefined,
	enabled: boolean,
): T | HTMLElement | null | undefined {
	const { document: frameDocument } = useFrame();
	const board = useContext(StageBoardPortalContext);
	const requestContainer =
		enabled && container === undefined ? board?.requestContainer : undefined;

	useEffect(() => requestContainer?.(), [requestContainer]);

	if (container !== undefined) {
		return container;
	}
	if (board) {
		return board.container;
	}
	return frameDocument?.body;
}

type StagePositionerProps = {
	collisionAvoidance?: unknown;
	collisionBoundary?: unknown;
};

const CANVAS_COLLISION_AVOIDANCE = { side: "none", align: "none" } as const;

/**
 * Collision defaults for Floating UI positioners (popover, menu, select,
 * tooltip, ...) inside a board. Collision detection always clips against the
 * iframe viewport, which on the canvas is the editor pane: a board partly
 * panned out of view would flip and shift its popups as the user pans. The
 * canvas therefore places popups exactly as authored; the responsive view and
 * capture keep collision avoidance but treat the board as the page edge.
 * `stageDefaults` adds component-specific stage defaults. Authored props
 * always win.
 */
export function useStagePositionerProps<P extends StagePositionerProps>(
	props: P,
	stageDefaults: Partial<P> = {},
): P {
	const board = useContext(StageBoardPortalContext);
	if (!board) {
		return props;
	}
	const boardElement = board.container?.parentElement;
	const defaults: Partial<P> = board.canvas
		? { collisionAvoidance: CANVAS_COLLISION_AVOIDANCE, ...stageDefaults }
		: {
				...(boardElement ? { collisionBoundary: boardElement } : {}),
				...stageDefaults,
			};
	const resolved = { ...props };
	for (const key of Object.keys(defaults) as Array<keyof P>) {
		if (resolved[key] === undefined) {
			resolved[key] = defaults[key] as P[keyof P];
		}
	}
	return resolved;
}

// Out of flow so the host never becomes a flex item or grid cell, covers the
// board so Floating UI can derive the canvas zoom from its size, and sits
// above board content the way a body-level portal would. Inline so authored
// child selectors on the board (`*:`, `space-y-*`, `divide-*`) cannot move it.
const hostStyle: CSSProperties = {
	position: "absolute",
	inset: 0,
	zIndex: 2147483647,
	display: "block",
	margin: 0,
	padding: 0,
	border: 0,
	background: "none",
	pointerEvents: "none",
};

/**
 * State for one board's portal host. The host only mounts while a portal in
 * the board asks for it, so boards without overlays render unchanged.
 */
export function useStageBoardPortal(canvas: boolean): {
	value: StageBoardPortal;
	host: ReactNode;
} {
	const [requestCount, setRequestCount] = useState(0);
	const [container, setContainer] = useState<HTMLElement | null>(null);
	const requestContainer = useCallback(() => {
		setRequestCount((count) => count + 1);
		return () => setRequestCount((count) => count - 1);
	}, []);
	const value = useMemo(
		() => ({ container, canvas, requestContainer }),
		[container, canvas, requestContainer],
	);
	const host =
		requestCount > 0 ? (
			<div
				key={STAGE_BOARD_PORTAL_ATTRIBUTE}
				ref={setContainer}
				{...{ [STAGE_BOARD_PORTAL_ATTRIBUTE]: "" }}
				style={hostStyle}
			/>
		) : null;

	return { value, host };
}
