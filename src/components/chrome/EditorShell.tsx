import { useHotkey } from "@tanstack/react-hotkeys";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FileCheck, FileMinus, FileUp } from "lucide-react";
import { memo, type ReactNode, useCallback, useEffect, useRef } from "react";
import { flushSync } from "react-dom";
import { useNavigate } from "react-router";
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
import {
	type EditorChromePanel,
	handleEditorChromeShortcut,
	isEditorPanelOpen,
	setEditorPanelOpen,
	useEditorPanelOpen,
} from "../../stores/editor-chrome-store";
import type { TrickroomDesign } from "../../types";
import {
	focusEditorRegion,
	getKey,
	useWindowKeyDown,
} from "../../utils/editor-shortcuts";
import { useProjectScope } from "../contexts";
import { Button } from "../ui/button";
import { DesignHeaderContent, DesignPanelToggle } from "./DesignHeader";
import { Layers } from "./Layers";
import { Properties } from "./Properties";
import { WorkspaceToolbar } from "./WorkspaceToolbar";

const AUTOSAVE_DELAY_MS = 1000;

type SaveRequest = {
	design: TrickroomDesign;
	revision: number;
	persistedRevision: DesignFileRevision | null;
};

type SaveControlProps = {
	designId: string;
};

type EditorShellProps = {
	designId: string;
	children: ReactNode;
};

function SaveControl({ designId }: SaveControlProps) {
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

	const error =
		saveMutation.error instanceof Error
			? saveMutation.error.message
			: saveMutation.error
				? "Save failed"
				: null;

	if (error) {
		return (
			<span className="truncate text-red-500" title={error}>
				{error}
			</span>
		);
	}

	return hasUnsavedChanges ? (
		<Button
			variant="filled"
			className="p-1"
			title="Unsaved changes"
			onClick={saveCurrentDesign}
			disabled={!hasUnsavedChanges || conflictPending || saveMutation.isPending}
		>
			<FileMinus className="size-4 text-current" />
		</Button>
	) : saveMutation.isPending ? (
		<span title="Saving" className="p-1">
			<FileUp className="size-4 text-slate-900" />
		</span>
	) : (
		<span title="Saved" className="p-1">
			<FileCheck className="size-4 text-slate-900" />
		</span>
	);
}

function LeftSidebar({ designId }: { designId: string }) {
	return (
		<aside className="flex min-h-0 w-[264px] shrink-0 flex-col border-r border-slate-200 bg-white text-xs">
			<header className="flex h-12 shrink-0 items-center gap-2 border-b border-slate-200 px-3">
				<DesignHeaderContent>
					{/* Only the rail renders the save control: it owns autosave and
					    Mod+S, so it stays mounted exactly once. */}
					<SaveControl designId={designId} />
					<DesignPanelToggle panel="rail" />
				</DesignHeaderContent>
			</header>
			<Layers designId={designId} className="flex-1" />
		</aside>
	);
}

function RightInspector() {
	return (
		// White, matching the right-rail design boards: control shells
		// (slate-100/200) and the receipts footer read against it.
		<aside className="flex min-h-0 w-[336px] shrink-0 flex-col border-l border-slate-200 bg-white text-xs">
			<Properties />
		</aside>
	);
}

/** Opens a collapsed panel, then moves focus into it once it is mounted. */
function revealAndFocusPanel(panel: EditorChromePanel) {
	if (!isEditorPanelOpen("design", panel)) {
		flushSync(() => setEditorPanelOpen("design", panel, true));
	}
	focusEditorRegion(panel);
}

function EditorShellComponent({ designId, children }: EditorShellProps) {
	const navigate = useNavigate();
	const railOpen = useEditorPanelOpen("design", "rail");
	const inspectorOpen = useEditorPanelOpen("design", "inspector");
	const handleFocusShortcut = useCallback(
		(event: KeyboardEvent) => {
			if (
				(event.metaKey || event.ctrlKey) &&
				!event.altKey &&
				!event.shiftKey &&
				event.key === "["
			) {
				navigate("/");
				event.preventDefault();
				return;
			}

			if (handleEditorChromeShortcut(event, "design")) {
				return;
			}

			if (!event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) {
				return;
			}

			const key = getKey(event);
			if (key === "1") {
				revealAndFocusPanel("rail");
			} else if (key === "2") {
				focusEditorRegion("workspace");
			} else if (key === "3") {
				revealAndFocusPanel("inspector");
			} else {
				return;
			}

			event.preventDefault();
		},
		[navigate],
	);

	useWindowKeyDown(handleFocusShortcut);

	return (
		<div className="absolute inset-0 z-10 flex min-h-0 bg-slate-100 text-xs text-slate-950">
			{/* A collapsed rail stays mounted but hidden: it owns autosave and the
			    layer shortcuts, which keep working without it on screen. */}
			<div
				data-editor-region="rail"
				tabIndex={-1}
				className={railOpen ? "flex min-h-0" : "hidden"}
			>
				<LeftSidebar designId={designId} />
			</div>
			<main
				data-editor-region="workspace"
				tabIndex={-1}
				className="flex min-h-0 min-w-0 flex-1 flex-col bg-slate-100 focus-visible:outline-none"
			>
				{/* With the rail collapsed, the toolbar takes over its header. */}
				<WorkspaceToolbar />
				<div className="relative min-h-0 flex-1">{children}</div>
			</main>
			<div
				data-editor-region="inspector"
				tabIndex={-1}
				className="flex min-h-0 focus-visible:outline-none"
			>
				{inspectorOpen ? <RightInspector /> : null}
			</div>
		</div>
	);
}

export const EditorShell = memo(EditorShellComponent);
