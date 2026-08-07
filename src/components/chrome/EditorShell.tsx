import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { useHotkey } from "@tanstack/react-hotkeys";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, FileCheck, FileMinus, FileUp } from "lucide-react";
import {
	memo,
	type ReactNode,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { useNavigate } from "react-router";
import { designFileQueryKey, saveDesignFile } from "../../queries/design-file";
import type { DesignFileRevision } from "../../services/design-file-service.types";
import {
	clearDirty,
	serializeDesign,
	setDesignName,
	setDesignSavePending,
	setPersistedDesignRevision,
	useDesignName,
	useDesignRevision,
	useDesignSystemId,
	useDesignSystemName,
	useExternalConflictPending,
	useHasUnsavedChanges,
	usePersistedDesignRevision,
} from "../../stores/design-store";
import type { TrickroomDesign } from "../../types";
import {
	focusEditorRegion,
	getKey,
	useWindowKeyDown,
} from "../../utils/editor-shortcuts";
import { useProjectScope } from "../contexts";
import { OpenDesignTokensButton } from "../OpenDesignTokensButton";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
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
	designFile: string;
};

type EditorShellProps = {
	designFile: string;
	children: ReactNode;
};

function SaveControl({ designFile }: SaveControlProps) {
	const queryClient = useQueryClient();
	const projectScope = useProjectScope();
	const hasUnsavedChanges = useHasUnsavedChanges();
	const conflictPending = useExternalConflictPending();
	const persistedRevision = usePersistedDesignRevision();
	const revision = useDesignRevision();
	const saveErrorRevisionRef = useRef<number | null>(null);
	const saveMutation = useMutation({
		mutationFn: ({ design, persistedRevision }: SaveRequest) =>
			saveDesignFile(designFile, design, persistedRevision),
		onSuccess: (saved, request) => {
			saveErrorRevisionRef.current = null;
			setPersistedDesignRevision(saved.revision);
			clearDirty(request.revision);
		},
		onError: (_error, request) => {
			saveErrorRevisionRef.current = request.revision;
			void queryClient.invalidateQueries({
				queryKey: designFileQueryKey(designFile, projectScope),
			});
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
		if (
			hasUnsavedChanges &&
			saveMutation.isError &&
			saveErrorRevisionRef.current !== revision
		) {
			saveMutation.reset();
		}
	}, [hasUnsavedChanges, revision, saveMutation]);

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

function DesignTitle() {
	const designName = useDesignName();
	const [isRenaming, setIsRenaming] = useState(false);
	const [draftName, setDraftName] = useState("");
	const cancelledRef = useRef(false);

	const startRenaming = () => {
		cancelledRef.current = false;
		setDraftName(designName);
		setIsRenaming(true);
	};

	const confirmRename = () => {
		const nextName = draftName.trim();
		if (!nextName) {
			setDraftName(designName);
			return;
		}

		setDesignName(nextName);
		setIsRenaming(false);
	};

	const cancelRename = () => {
		cancelledRef.current = true;
		setIsRenaming(false);
	};

	useHotkey("Enter", confirmRename, {
		enabled: isRenaming,
		ignoreInputs: false,
	});
	useHotkey("Escape", cancelRename, { enabled: isRenaming });

	if (isRenaming) {
		return (
			<Input
				variant="inline"
				className="w-full text-[13px] font-medium"
				value={draftName}
				onChange={(e) => setDraftName(e.target.value)}
				onBlur={() => {
					if (!cancelledRef.current) confirmRename();
				}}
				onFocus={(e) => (e.target as HTMLInputElement).select()}
				autoFocus
			/>
		);
	}

	return (
		<ButtonPrimitive
			className="w-full truncate text-left text-[13px] font-medium text-slate-950 hover:bg-slate-100 cursor-text focus-visible:outline-none"
			onClick={startRenaming}
		>
			{designName}
		</ButtonPrimitive>
	);
}

function LeftSidebar({ designFile }: { designFile: string }) {
	const navigate = useNavigate();
	const systemName = useDesignSystemName();
	const systemId = useDesignSystemId();
	const subtitle = systemName
		? `${systemName} · design system`
		: "No design system";

	return (
		<aside className="flex min-h-0 w-[264px] shrink-0 flex-col border-r border-slate-200 bg-white text-xs">
			<header className="flex h-12 shrink-0 items-center gap-2 border-b border-slate-200 px-3">
				<Button
					variant="block"
					className="flex size-7 shrink-0 items-center justify-center p-0"
					onClick={() => navigate("/")}
					title="Back to project"
				>
					<ArrowLeft className="size-4 text-slate-500" />
				</Button>
				<div className="flex min-w-0 flex-1 flex-col">
					<DesignTitle />
					<span className="truncate text-[10px] text-slate-400">
						{subtitle}
					</span>
				</div>
				<OpenDesignTokensButton systemId={systemId} />
				<SaveControl designFile={designFile} />
			</header>
			<Layers designFile={designFile} className="flex-1" />
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

function EditorShellComponent({ designFile, children }: EditorShellProps) {
	const navigate = useNavigate();
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

			if (!event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) {
				return;
			}

			const key = getKey(event);
			if (key === "1") {
				focusEditorRegion("rail");
			} else if (key === "2") {
				focusEditorRegion("workspace");
			} else if (key === "3") {
				focusEditorRegion("inspector");
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
			<div data-editor-region="rail" tabIndex={-1} className="flex min-h-0">
				<LeftSidebar designFile={designFile} />
			</div>
			<main
				data-editor-region="workspace"
				tabIndex={-1}
				className="flex min-h-0 min-w-0 flex-1 flex-col bg-slate-100 focus-visible:outline-none"
			>
				<WorkspaceToolbar />
				<div className="relative min-h-0 flex-1">{children}</div>
			</main>
			<div
				data-editor-region="inspector"
				tabIndex={-1}
				className="flex min-h-0 focus-visible:outline-none"
			>
				<RightInspector />
			</div>
		</div>
	);
}

export const EditorShell = memo(EditorShellComponent);
