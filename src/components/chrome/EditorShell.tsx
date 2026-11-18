import { memo, type ReactNode, useCallback } from "react";
import { flushSync } from "react-dom";
import { useNavigate } from "react-router";
import { handleAnnotationModeShortcut } from "../../stores/annotation-mode-store";
import { useDesignRoots } from "../../stores/design-store";
import {
	type EditorChromePanel,
	handleEditorChromeShortcut,
	isEditorPanelOpen,
	setEditorPanelOpen,
	useEditorPanelOpen,
} from "../../stores/editor-chrome-store";
import {
	focusEditorRegion,
	getKey,
	useWindowKeyDown,
} from "../../utils/editor-shortcuts";
import { DesignHeaderContent, DesignPanelToggle } from "./DesignHeader";
import { DesignAutosave, SaveErrorRow, SaveIndicator } from "./DesignSave";
import { Layers } from "./Layers";
import { NoBoards } from "./NoBoards";
import { Properties } from "./Properties";
import { WorkspaceToolbar } from "./WorkspaceToolbar";

type EditorShellProps = {
	designId: string;
	children: ReactNode;
};

/** Over the empty stage, so a design with no boards says so with the rail collapsed. */
function StageNoBoards() {
	const hasBoards = useDesignRoots().length > 0;
	if (hasBoards) return null;
	return (
		<div className="absolute inset-0 flex items-center justify-center">
			<NoBoards />
		</div>
	);
}

function LeftSidebar({ designId }: { designId: string }) {
	return (
		<aside className="flex min-h-0 w-[264px] shrink-0 flex-col border-r border-slate-200 bg-white text-xs">
			<header className="flex h-12 shrink-0 items-center gap-2 border-b border-slate-200 px-3">
				<DesignHeaderContent>
					<SaveIndicator />
					<DesignPanelToggle panel="rail" />
				</DesignHeaderContent>
			</header>
			<SaveErrorRow />
			<Layers designId={designId} className="flex-1" />
		</aside>
	);
}

function RightInspector({ designId }: { designId: string }) {
	return (
		// White, matching the right-rail design boards: control shells
		// (slate-100/200) and the receipts footer read against it.
		<aside className="flex min-h-0 w-[336px] shrink-0 flex-col border-l border-slate-200 bg-white text-xs">
			<Properties designId={designId} />
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

			if (
				handleEditorChromeShortcut(event, "design") ||
				handleAnnotationModeShortcut(event)
			) {
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
			{/* Autosave and Mod+S, mounted once whichever header shows the state. */}
			<DesignAutosave designId={designId} />
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
				{/* With the rail collapsed, its header is in the toolbar: the
				    save error goes under that. */}
				{railOpen ? null : <SaveErrorRow />}
				<div className="relative min-h-0 flex-1">
					{children}
					<StageNoBoards />
				</div>
			</main>
			<div
				data-editor-region="inspector"
				tabIndex={-1}
				className="flex min-h-0 focus-visible:outline-none"
			>
				{inspectorOpen ? <RightInspector designId={designId} /> : null}
			</div>
		</div>
	);
}

export const EditorShell = memo(EditorShellComponent);
