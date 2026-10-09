import { TriangleAlert } from "lucide-react";
import {
	type ReactNode,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { useLocation, useNavigate } from "react-router";
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

/**
 * Follows URL changes of the System editor route (a "Go to component" link,
 * Back and Forward, a tab click) and hands each new search string to
 * `onApply`. A change that opens another component than the one holding
 * unsaved edits is held back first: the returned dialog asks to save,
 * discard or cancel, and cancelling restores the URL of the last applied
 * view. The editor's own list has no such guard (its back button resets the
 * draft); the URL is the one way in that can arrive without a click on it.
 */
export function useGuardedComponentLocation({
	systemId,
	projectScope,
	onApply,
}: {
	systemId: string;
	projectScope?: ProjectQueryScope;
	onApply: (search: string) => void;
}): ReactNode {
	const location = useLocation();
	const navigate = useNavigate();
	const handledKey = useRef(location.key);
	const lastApplied = useRef<LocationTarget>({
		pathname: location.pathname,
		search: location.search,
	});
	const onApplyRef = useRef(onApply);
	onApplyRef.current = onApply;
	const [request, setRequest] = useState<{
		target: LocationTarget;
		fromComponentId: string;
	} | null>(null);
	const { saveDraftMutation, saveError, canSave } = useSaveComponentDraft({
		systemId,
		projectScope,
		componentId: request?.fromComponentId ?? null,
	});

	const apply = useCallback((target: LocationTarget) => {
		lastApplied.current = target;
		setRequest(null);
		onApplyRef.current(target.search);
	}, []);

	useEffect(() => {
		if (handledKey.current === location.key) {
			return;
		}
		handledKey.current = location.key;
		const target = { pathname: location.pathname, search: location.search };
		const opens = new URLSearchParams(target.search).get("component");
		const unsaved = getUnsavedComponentId();
		if (opens !== null && unsaved !== null && opens !== unsaved) {
			setRequest({ target, fromComponentId: unsaved });
			return;
		}
		apply(target);
	}, [location.key, location.pathname, location.search, apply]);

	const cancel = () => {
		setRequest(null);
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
			description="The open component has changes that are not saved. Save them before opening another component, discard them, or stay here."
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
