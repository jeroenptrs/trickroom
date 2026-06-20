import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { useHotkey } from "@tanstack/react-hotkeys";
import { useMutation } from "@tanstack/react-query";
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
import { saveDesignFile } from "../../queries/design-file";
import {
	clearDirty,
	serializeDesign,
	setDesignName,
	useDesignName,
	useDesignRevision,
	useDesignSystemName,
	useHasUnsavedChanges,
} from "../../stores/design-store";
import type { TrickroomDesign } from "../../types";
import { useIFrameView } from "../contexts";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Layers } from "./Layers";
import { Properties } from "./Properties";

const AUTOSAVE_DELAY_MS = 1000;

type SaveRequest = {
	design: TrickroomDesign;
	revision: number;
};

type SaveControlProps = {
	designFile: string;
};

type EditorShellProps = {
	designFile: string;
	children: ReactNode;
};

function CanvasChrome() {
	const view = useIFrameView();
	return (
		<div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex h-9 items-center justify-between border-t border-slate-200 bg-slate-50 px-3 text-[11px] text-slate-500">
			<span className="text-slate-400">Zoom</span>
			<span className="tabular-nums">{Math.round(view.scale * 100)}%</span>
		</div>
	);
}

function SaveControl({ designFile }: SaveControlProps) {
	const hasUnsavedChanges = useHasUnsavedChanges();
	const revision = useDesignRevision();
	const saveErrorRevisionRef = useRef<number | null>(null);
	const saveMutation = useMutation({
		mutationFn: ({ design }: SaveRequest) => saveDesignFile(designFile, design),
		onSuccess: (_savedDesign, request) => {
			saveErrorRevisionRef.current = null;
			clearDirty(request.revision);
		},
		onError: (_error, request) => {
			saveErrorRevisionRef.current = request.revision;
		},
	});
	const saveCurrentDesign = useCallback(() => {
		if (saveMutation.isPending) {
			return;
		}

		saveMutation.mutate({
			design: serializeDesign(),
			revision,
		});
	}, [revision, saveMutation]);

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
		if (!hasUnsavedChanges || saveMutation.isPending || saveMutation.isError) {
			return;
		}

		const timeout = window.setTimeout(saveCurrentDesign, AUTOSAVE_DELAY_MS);
		return () => window.clearTimeout(timeout);
	}, [
		hasUnsavedChanges,
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
			disabled={!hasUnsavedChanges || saveMutation.isPending}
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
	const subtitle = systemName
		? `${systemName} · design system`
		: "No design system";

	return (
		<aside className="flex min-h-0 w-[264px] shrink-0 flex-col border-r border-slate-200 bg-slate-50 text-xs">
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
				<SaveControl designFile={designFile} />
			</header>
			<Layers designFile={designFile} className="flex-1" />
		</aside>
	);
}

function RightInspector() {
	return (
		<aside className="flex min-h-0 w-[336px] shrink-0 flex-col border-l border-slate-200 bg-slate-50 text-xs">
			<Properties />
		</aside>
	);
}

function EditorShellComponent({ designFile, children }: EditorShellProps) {
	return (
		<div className="absolute inset-0 z-10 flex min-h-0 bg-slate-100 text-xs text-slate-950">
			<LeftSidebar designFile={designFile} />
			<main className="relative min-h-0 min-w-0 flex-1 bg-slate-100">
				<div className="absolute inset-0">{children}</div>
				<CanvasChrome />
			</main>
			<RightInspector />
		</div>
	);
}

export const EditorShell = memo(EditorShellComponent);
