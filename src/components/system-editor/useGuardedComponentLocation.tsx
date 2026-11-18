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
import { buildSystemComponentSearch } from "../../utils/system-deep-link";
import { ConfirmationDialog } from "../ui/alert-dialog";
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
	const { saveDraftMutation, saveError, canSave, saveBlockedReason } =
		useSaveComponentDraft({
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
		const toList =
			opens === null &&
			getSystemEditorPage(params.get("tab"), null) === "components";
		if (
			toList &&
			unsaved !== null &&
			getOpenComponentIdRef.current() === null
		) {
			// Edits kept while another tab was open: the Components page would
			// clear them with its list, so it reopens their component instead.
			navigate(
				{
					pathname: target.pathname,
					search: buildSystemComponentSearch(unsaved),
				},
				{ replace: true },
			);
			return;
		}
		const leaves =
			unsaved !== null &&
			(opens !== null
				? opens !== unsaved
				: toList && getOpenComponentIdRef.current() === unsaved);
		if (leaves && unsaved !== null) {
			blockedPushes.current =
				navigationType === "PUSH" && blockedPushes.current >= 0
					? blockedPushes.current + 1
					: -1;
			setRequest({ id, target, fromComponentId: unsaved });
			return;
		}
		apply(target);
	}, [
		location.key,
		location.pathname,
		location.search,
		navigationType,
		navigate,
		apply,
	]);

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
			title="Save changes before leaving?"
			description="This component has unsaved changes."
			icon={<TriangleAlert className="size-4" aria-hidden="true" />}
			tone="default"
			actionLabel={saveDraftMutation.isPending ? "Saving" : "Save draft"}
			actionDisabled={!canSave || saveDraftMutation.isPending}
			error={saveError}
			secondaryAction={{
				label: "Discard changes",
				tone: "destructive",
				disabled: saveDraftMutation.isPending,
				onClick: () => {
					if (!request) return;
					discardOpenComponentDraft();
					apply(request.target);
				},
			}}
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
			{saveBlockedReason ? (
				<p className="px-4 pb-3 text-xs text-slate-700">{saveBlockedReason}</p>
			) : null}
		</ConfirmationDialog>
	);
}
