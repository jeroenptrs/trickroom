import { useEffect, useRef } from "react";
import { matchPath, useLocation, useNavigate } from "react-router";
import { toast } from "sonner";
import {
	editorFocusRequests,
	postEditorFocusAck,
} from "../queries/editor-channel";
import type {
	EditorFocusAck,
	EditorFocusEvent,
} from "../services/editor-channel.types";
import { hasUnsavedComponentDraft } from "../stores/component-draft-store";
import { componentEditorSessionStore } from "../stores/component-editor-session-store";
import { hasPendingDesignWork } from "../stores/design-store";
import { buildDesignPath } from "../utils/design-deep-link";

/** Navigation state that marks a design visit as a focus request. */
export type EditorFocusNavigationState = { editorFocusRequestId: string };

/** Whether leaving the current route now could lose work. */
const leavingLosesWork = (pathname: string) => {
	if (matchPath("/design/:uuid", pathname)) {
		return hasPendingDesignWork();
	}
	if (matchPath("/system/:systemId", pathname)) {
		return (
			hasUnsavedComponentDraft() ||
			componentEditorSessionStore.get().metadataDirty
		);
	}
	return false;
};

const warnBlocked = () =>
	toast.warning("An agent wanted to show you another design", {
		id: "editor-focus-blocked",
		description:
			"You have unsaved changes or an open conflict here, so the view was not switched.",
	});

/**
 * Handles `focus` requests from the editor channel: opens the design, board
 * and layer the agent points at. It never leaves a design with unsaved work
 * and never switches projects; a hidden tab applies the request once shown.
 */
export function useEditorFocusRequests({
	enabled,
	projectId,
}: {
	enabled: boolean;
	projectId: string | null;
}) {
	const navigate = useNavigate();
	const location = useLocation();
	// Refs keep the subscription (and a queued request) across navigations.
	const pathnameRef = useRef(location.pathname);
	pathnameRef.current = location.pathname;
	const navigateRef = useRef(navigate);
	navigateRef.current = navigate;

	useEffect(() => {
		if (!enabled) {
			return;
		}

		let queued: EditorFocusEvent | null = null;

		const respond = (
			request: EditorFocusEvent,
			status: EditorFocusAck["status"],
			outcome: EditorFocusAck["outcome"],
		) => {
			void postEditorFocusAck({
				requestId: request.requestId,
				status,
				outcome,
			});
		};

		/** Returns why the request cannot be applied, or null when it can. */
		const check = (request: EditorFocusEvent) => {
			if (request.projectId && request.projectId !== projectId) {
				return "browser_on_other_project" as const;
			}
			const pathname = pathnameRef.current;
			const openDesign = matchPath("/design/:uuid", pathname)?.params.uuid;
			if (openDesign !== request.designFileId && leavingLosesWork(pathname)) {
				return "blocked_dirty" as const;
			}
			return null;
		};

		const apply = (request: EditorFocusEvent) => {
			const openDesign = matchPath("/design/:uuid", pathnameRef.current)?.params
				.uuid;
			const state: EditorFocusNavigationState = {
				editorFocusRequestId: request.requestId,
			};
			navigateRef.current(
				buildDesignPath(request.designFileId, {
					boardId: request.boardId,
					layerId: request.elementId,
				}),
				{ state },
			);
			return openDesign === request.designFileId ? "revealed" : "navigated";
		};

		const unsubscribe = editorFocusRequests.subscribe((request) => {
			const blocked = check(request);
			if (blocked) {
				respond(request, blocked, null);
				if (blocked === "blocked_dirty") {
					warnBlocked();
				}
				return;
			}
			if (document.visibilityState === "hidden") {
				queued = request;
				respond(request, "ok", "queued");
				return;
			}
			respond(request, "ok", apply(request));
		});

		const onVisibilityChange = () => {
			if (document.visibilityState !== "visible" || !queued) {
				return;
			}
			const request = queued;
			queued = null;
			// The agent already has its answer; recheck in case the human
			// started editing while the tab was hidden.
			const blocked = check(request);
			if (blocked === "blocked_dirty") {
				warnBlocked();
			}
			if (!blocked) {
				apply(request);
			}
		};
		document.addEventListener("visibilitychange", onVisibilityChange);

		return () => {
			unsubscribe();
			document.removeEventListener("visibilitychange", onVisibilityChange);
		};
	}, [enabled, projectId]);
}
