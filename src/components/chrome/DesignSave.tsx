import { useHotkey } from "@tanstack/react-hotkeys";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createStore, useSelector } from "@tanstack/react-store";
import { FileCheck, FileMinus, FileUp } from "lucide-react";
import { useCallback, useEffect, useRef } from "react";
import { saveDesignFile } from "../../queries/design-file";
import { requestDesignResync } from "../../queries/design-live-events";
import { commitDesignSave } from "../../queries/design-save";
import type { DesignFileRevision } from "../../services/design-file-service.types";
import {
	serializeDesign,
	setDesignSavePending,
	useDesignRevision,
	useExternalConflictPending,
	useHasUnsavedChanges,
	usePersistedDesignRevision,
} from "../../stores/design-store";
import type { TrickroomDesign } from "../../types";
import { useProjectScope } from "../contexts";
import { Button } from "../ui/button";
import { Popover } from "../ui/popover";

const AUTOSAVE_DELAY_MS = 1000;

type SaveRequest = {
	design: TrickroomDesign;
	revision: number;
	persistedRevision: DesignFileRevision | null;
};

type DesignSaveStatus = {
	saving: boolean;
	/** The reason the last save failed, or null. */
	error: string | null;
	/** Saves now; null until the autosave hook mounts. */
	save: (() => void) | null;
	/** Whether a save can start (no save running, no open conflict). */
	canSave: boolean;
};

// The save state, written by the one autosave hook and read by the save
// indicator in whichever header is on screen.
const designSaveStatusStore = createStore<DesignSaveStatus>({
	saving: false,
	error: null,
	save: null,
	canSave: false,
});

/**
 * Autosave and `Mod+S` for the open design. Mount it exactly once per editor,
 * outside any panel that can collapse.
 */
export function useDesignAutosave(designId: string) {
	const queryClient = useQueryClient();
	const projectScope = useProjectScope();
	const hasUnsavedChanges = useHasUnsavedChanges();
	const conflictPending = useExternalConflictPending();
	const persistedRevision = usePersistedDesignRevision();
	const revision = useDesignRevision();
	// The store and persisted revisions a failed save was based on: autosave
	// retries once either moves (a new edit, or a resync that caught up with
	// the disk).
	const saveErrorRef = useRef<{
		revision: number;
		persistedRevision: DesignFileRevision | null;
	} | null>(null);
	const saveMutation = useMutation({
		mutationFn: ({ design, persistedRevision }: SaveRequest) =>
			saveDesignFile(designId, design, persistedRevision),
		onSuccess: (saved, request) => {
			saveErrorRef.current = null;
			commitDesignSave(queryClient, {
				designId,
				projectScope,
				sent: request.design,
				saved,
				savedStoreRevision: request.revision,
			});
		},
		onError: (_error, request) => {
			saveErrorRef.current = {
				revision: request.revision,
				persistedRevision: request.persistedRevision,
			};
			// A refused save (typically a revision mismatch) brings in what
			// changed on disk; conflicts, if any, are then raised per board.
			requestDesignResync(designId);
		},
		onSettled: () => setDesignSavePending(false),
	});
	const saveCurrentDesign = useCallback(() => {
		if (saveMutation.isPending || conflictPending) {
			return;
		}

		setDesignSavePending(true);
		saveMutation.mutate({
			design: serializeDesign(),
			revision,
			persistedRevision,
		});
	}, [conflictPending, persistedRevision, revision, saveMutation]);

	useHotkey("Mod+S", saveCurrentDesign, {
		enabled: !saveMutation.isPending,
		preventDefault: true,
	});

	useEffect(() => {
		const failed = saveErrorRef.current;
		if (
			hasUnsavedChanges &&
			saveMutation.isError &&
			(!failed ||
				failed.revision !== revision ||
				failed.persistedRevision !== persistedRevision)
		) {
			saveMutation.reset();
		}
	}, [hasUnsavedChanges, persistedRevision, revision, saveMutation]);

	useEffect(() => {
		if (
			!hasUnsavedChanges ||
			conflictPending ||
			saveMutation.isPending ||
			saveMutation.isError
		) {
			return;
		}

		const timeout = window.setTimeout(saveCurrentDesign, AUTOSAVE_DELAY_MS);
		return () => window.clearTimeout(timeout);
	}, [
		hasUnsavedChanges,
		conflictPending,
		saveCurrentDesign,
		saveMutation.isError,
		saveMutation.isPending,
	]);

	const error = saveMutation.isError
		? saveMutation.error instanceof Error && saveMutation.error.message
			? saveMutation.error.message
			: "The server did not say why."
		: null;
	const saving = saveMutation.isPending;
	const canSave = !saving && !conflictPending;

	useEffect(() => {
		designSaveStatusStore.setState(() => ({
			saving,
			error,
			save: saveCurrentDesign,
			canSave,
		}));
	}, [canSave, error, saveCurrentDesign, saving]);

	useEffect(
		() => () =>
			designSaveStatusStore.setState(() => ({
				saving: false,
				error: null,
				save: null,
				canSave: false,
			})),
		[],
	);
}

/** Runs `useDesignAutosave` in its own component, so edits re-render only it. */
export function DesignAutosave({ designId }: { designId: string }) {
	useDesignAutosave(designId);
	return null;
}

/**
 * Unsaved, saving, saved, or failed with a Retry. Renders in the layers
 * panel header and, with that panel collapsed, in the toolbar.
 */
export function SaveIndicator() {
	const status = useSelector(designSaveStatusStore, (state) => state);
	const hasUnsavedChanges = useHasUnsavedChanges();

	if (status.error) {
		return (
			<span className="flex shrink-0 items-center gap-1" role="alert">
				{/* The words open the reason: the header has no room for an
				    info button beside them. */}
				<Popover
					title="Could not save"
					align="end"
					trigger={
						<button
							type="button"
							className="whitespace-nowrap border-none bg-transparent p-0 text-[11px] text-red-700 underline decoration-dotted underline-offset-2 hover:text-red-900 focus-visible:outline-none focus-visible:inset-shadow-[0_0_0_1px] focus-visible:inset-shadow-cyan-500"
						>
							Could not save
						</button>
					}
				>
					<p className="wrap-break-word">{status.error}</p>
				</Popover>
				<Button
					variant="outlined"
					className="px-1.5 py-0.5 text-[11px]"
					disabled={!status.canSave}
					onClick={() => status.save?.()}
				>
					Retry
				</Button>
			</span>
		);
	}

	if (hasUnsavedChanges && !status.saving) {
		return (
			<Button
				variant="filled"
				className="shrink-0 p-1"
				title="Save (unsaved changes)"
				aria-label="Save (unsaved changes)"
				onClick={() => status.save?.()}
				disabled={!status.canSave}
			>
				<FileMinus className="size-4 text-current" aria-hidden="true" />
			</Button>
		);
	}

	const Icon = status.saving ? FileUp : FileCheck;
	const label = status.saving ? "Saving" : "Saved";
	return (
		<span role="status" title={label} className="shrink-0 p-1">
			<Icon className="size-4 text-slate-900" aria-hidden="true" />
			<span className="sr-only">{label}</span>
		</span>
	);
}
