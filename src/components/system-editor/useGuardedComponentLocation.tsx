import { TriangleAlert } from "lucide-react";
import {
	type ReactNode,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { useLocation, useNavigate, useNavigationType } from "react-router";
import type { ProjectQueryScope } from "../../queries/project-scope";
import {
	componentDraftStore,
	hasUnsavedComponentDraft,
	resetComponentDraftStore,
} from "../../stores/component-draft-store";
import {
	componentEditorSessionStore,
	resetComponentEditorSession,
} from "../../stores/component-editor-session-store";
import { ConfirmationDialog } from "../ui/alert-dialog";
import { Button } from "../ui/button";
import { getSystemEditorPage } from "./types";
import { useSaveComponentDraft } from "./useSaveComponentDraft";

/** The component whose draft or metadata holds edits that are not saved. */
export function getUnsavedComponentId() {
	if (hasUnsavedComponentDraft()) {
		return componentDraftStore.get().componentId;
	}
	const session = componentEditorSessionStore.get();
	return session.metadataDirty ? session.componentId : null;
}

/** Drops the open component draft and the editing session around it. */
export function discardOpenComponentDraft() {
	resetComponentDraftStore();
	resetComponentEditorSession();
}

type LocationTarget = { pathname: string; search: string };

type LeaveRequest = {
	/** Which navigation asked; a newer one or a cancel makes it obsolete. */
	id: number;
	target: LocationTarget;
	fromComponentId: string;
};

/**
 * Follows URL changes of the System editor route (a "Go to component" link,
 * the component list, the back button, Back and Forward, a tab click) and
 * hands each new search string to `onApply`. A change that leaves the
 * component holding unsaved edits, for another component or for the list, is
 * held back first: the returned dialog asks to save, discard or cancel.
 * Cancel restores the view that was last applied, undoing the pushes it
 * blocked when it can. A request that a cancel or a newer navigation has
 * overtaken is never applied, even when its save completes later.
 */
export function useGuardedComponentLocation({
	systemId,
	projectScope,
	onApply,
	getOpenComponentId,
}: {
	systemId: string;
	projectScope?: ProjectQueryScope;
	onApply: (search: string) => void;
	/** The component currently open on the Components page, if any. */
	getOpenComponentId: () => string | null;
}): ReactNode {
	const location = useLocation();
	const navigate = useNavigate();
	const navigationType = useNavigationType();
	const handledKey = useRef(location.key);
	const lastApplied = useRef<LocationTarget>({
		pathname: location.pathname,
		search: location.search,
	});
	const latestRequestId = useRef(0);
	// Pushes held back since the last applied view; -1 once something else
	// (Back, a replace) was held back, which cannot be undone by going back.
	const blockedPushes = useRef(0);
	const onApplyRef = useRef(onApply);
	onApplyRef.current = onApply;
	const getOpenComponentIdRef = useRef(getOpenComponentId);
	getOpenComponentIdRef.current = getOpenComponentId;
	const [request, setRequest] = useState<LeaveRequest | null>(null);
	const { saveDraftMutation, saveError, canSave } = useSaveComponentDraft({
		systemId,
		projectScope,
		componentId: request?.fromComponentId ?? null,
	});

	const apply = useCallback((target: LocationTarget) => {
		lastApplied.current = target;
		blockedPushes.current = 0;
		setRequest(null);
		onApplyRef.current(target.search);
	}, []);

	useEffect(() => {
		if (handledKey.current === location.key) {
			return;
		}
		handledKey.current = location.key;
		const id = ++latestRequestId.current;
		const target = { pathname: location.pathname, search: location.search };
		const params = new URLSearchParams(target.search);
		const opens = params.get("component");
		const unsaved = getUnsavedComponentId();
		const leaves =
			unsaved !== null &&
			(opens !== null
				? opens !== unsaved
				: getSystemEditorPage(params.get("tab"), null) === "components" &&
					getOpenComponentIdRef.current() === unsaved);
		if (leaves && unsaved !== null) {
			blockedPushes.current =
				navigationType === "PUSH" && blockedPushes.current >= 0
					? blockedPushes.current + 1
					: -1;
			setRequest({ id, target, fromComponentId: unsaved });
			return;
		}
		apply(target);
	}, [location.key, location.pathname, location.search, navigationType, apply]);

	const cancel = () => {
		latestRequestId.current += 1;
		setRequest(null);
		const pushes = blockedPushes.current;
		blockedPushes.current = 0;
		if (pushes > 0) {
			navigate(-pushes);
			return;
		}
		navigate(`${lastApplied.current.pathname}${lastApplied.current.search}`, {
			replace: true,
		});
	};

	return (
		<ConfirmationDialog
			open={request !== null}
			onOpenChange={(open) => {
				if (!open && request) {
					cancel();
				}
			}}
			title="Discard unsaved changes?"
			description="The open component has changes that are not saved. Save them before leaving it, discard them, or stay here."
			icon={<TriangleAlert className="size-4" aria-hidden="true" />}
			tone="default"
			actionLabel={saveDraftMutation.isPending ? "Saving" : "Save"}
			actionDisabled={!canSave || saveDraftMutation.isPending}
			onAction={async () => {
				if (!request) return;
				try {
					await saveDraftMutation.mutateAsync();
				} catch {
					return; // The error is shown in the dialog.
				}
				// Cancelled or overtaken while saving: the edits are saved, but
				// the view is not ours to change any more.
				if (latestRequestId.current !== request.id) return;
				apply(request.target);
			}}
		>
			<div className="flex flex-col gap-2 px-4 pb-4">
				{saveError ? (
					<p role="alert" className="text-xs text-red-700">
						{saveError}
					</p>
				) : null}
				<Button
					type="button"
					variant="outlined"
					flavor="warning"
					className="self-start px-2 py-1.5 text-xs"
					disabled={saveDraftMutation.isPending}
					onClick={() => {
						if (!request) return;
						discardOpenComponentDraft();
						apply(request.target);
					}}
				>
					Discard changes
				</Button>
			</div>
		</ConfirmationDialog>
	);
}
