import { useHotkey } from "@tanstack/react-hotkeys";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight, Copy, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { getTrickroomDesktopApi } from "../../desktop-api";
import { buildDesignResourceUri } from "../../mcp/resources";
import {
	deleteDesignFile,
	designFileQueryKey,
	designSummariesQueryKey,
	renameDesignFile,
} from "../../queries/design-file";
import type { TrickroomDesignSummary } from "../../types";
import { useProjectScope } from "../contexts";
import { Button } from "../ui/button";
import { ConfirmationDialog } from "../ui/dialog";
import { Separator } from "../ui/separator";
import { Text } from "../ui/text";
import { DesignGlyph } from "./DesignGlyph";
import { formatRelativeTime } from "./project-view-utils";

export function DesignDetailPane({
	design,
	locationId,
	onDelete,
}: {
	design: TrickroomDesignSummary;
	locationId: string;
	onDelete: () => void;
}) {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const projectScope = useProjectScope();
	const [isRenaming, setIsRenaming] = useState(false);
	const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
	const [copied, setCopied] = useState(false);
	const [draftName, setDraftName] = useState(design.name);
	const inputRef = useRef<HTMLInputElement>(null);
	const cancelledRef = useRef(false);
	const shaPreview = design.uuid;

	const systemName = design.systemName ?? "—";
	const boardsCount = design.boardsCount;
	const layersCount = design.layersCount;
	const editedTime = formatRelativeTime(design.modifiedAt);
	const renameMutation = useMutation({
		mutationFn: (name: string) => renameDesignFile(design.file, name),
		onSuccess: async (renamedDesign) => {
			queryClient.setQueryData(
				designFileQueryKey(design.file, projectScope),
				renamedDesign,
			);
			await queryClient.invalidateQueries({
				queryKey: designSummariesQueryKey,
			});
		},
	});
	const deleteMutation = useMutation({
		mutationFn: () => deleteDesignFile(design.file),
		onSuccess: async () => {
			queryClient.removeQueries({
				queryKey: designFileQueryKey(design.file, projectScope),
			});
			await queryClient.invalidateQueries({
				queryKey: designSummariesQueryKey,
			});
			setDeleteDialogOpen(false);
			onDelete();
		},
	});
	const actionError =
		(renameMutation.error as Error | null)?.message ??
		(deleteMutation.error as Error | null)?.message;

	const startRenaming = () => {
		cancelledRef.current = false;
		setDraftName(design.name);
		setIsRenaming(true);
	};

	const confirmRename = () => {
		const nextName = draftName.trim();
		setIsRenaming(false);
		if (nextName.length === 0 || nextName === design.name) {
			return;
		}
		renameMutation.mutate(nextName);
	};

	const cancelRename = () => {
		cancelledRef.current = true;
		setIsRenaming(false);
	};

	const deleteSelectedDesign = () => {
		if (deleteMutation.isPending) {
			return;
		}
		deleteMutation.mutate();
	};

	const copyResourceUri = async () => {
		const uri = buildDesignResourceUri(locationId, design.uuid, design.name);
		const desktopApi = getTrickroomDesktopApi();
		if (desktopApi?.clipboard) {
			desktopApi.clipboard.writeText(uri);
		} else {
			await navigator.clipboard.writeText(uri);
		}
		setCopied(true);
		setTimeout(() => setCopied(false), 1500);
	};

	useHotkey("Enter", confirmRename, {
		enabled: isRenaming,
		ignoreInputs: false,
	});
	useHotkey("Escape", cancelRename, { enabled: isRenaming });
	useEffect(() => {
		if (!isRenaming) {
			return;
		}

		inputRef.current?.focus();
		inputRef.current?.select();
	}, [isRenaming]);

	return (
		<>
			<div className="flex h-full flex-col overflow-hidden">
				{/* Detail Header */}
				<div className="flex items-start justify-between gap-4 border-b border-slate-200 px-10 py-8">
					<div className="flex min-w-0 flex-col gap-1">
						<Text variant="eyebrow">Design</Text>
						{isRenaming ? (
							<input
								ref={inputRef}
								className="min-w-0 border-none bg-transparent p-0 text-xl font-medium text-slate-900 outline-none focus-visible:outline-none"
								value={draftName}
								onChange={(event) => setDraftName(event.target.value)}
								onBlur={() => {
									if (!cancelledRef.current) confirmRename();
								}}
								aria-label="Design name"
							/>
						) : (
							<button
								type="button"
								className="min-w-0 truncate border-none bg-transparent p-0 text-left text-xl font-medium text-slate-900 hover:bg-slate-100 focus-visible:outline-none focus-visible:inset-shadow-[0_0_0_1px] focus-visible:inset-shadow-cyan-500"
								onClick={startRenaming}
							>
								{design.name}
							</button>
						)}
						<p className="font-mono text-[11px] text-slate-400">{shaPreview}</p>
						{actionError ? (
							<p className="text-xs text-red-600">{actionError}</p>
						) : null}
					</div>
					<div className="flex shrink-0 items-center">
						<Button
							variant="blockDark"
							className="flex items-center gap-1.5 bg-slate-950"
							onClick={() => navigate(`/design/${design.uuid}`)}
						>
							<ArrowUpRight className="size-4" aria-hidden="true" />
							Open design
						</Button>
						<Button
							variant="block"
							className="p-2.5"
							aria-label={copied ? "Copied!" : "Copy resource link"}
							onClick={copyResourceUri}
						>
							<Copy
								className={`size-4 ${copied ? "text-cyan-600" : ""}`}
								aria-hidden="true"
							/>
						</Button>
					</div>
				</div>

				{/* Detail Body */}
				<div className="flex flex-1 min-h-0 flex-row gap-8 overflow-hidden px-10 py-8">
					{/* Preview */}
					<div className="flex flex-1 overflow-hidden inset-shadow-[0_0_0_1px] inset-shadow-slate-200">
						<DesignGlyph design={design} className="h-full w-full" />
					</div>

					{/* Side */}
					<div className="flex w-64 shrink-0 flex-col gap-5 overflow-y-auto">
						{/* Stats Card */}
						<div className="flex flex-col gap-2 bg-white px-4 py-3 inset-shadow-[0_0_0_1px] inset-shadow-slate-200">
							<div className="text-sm font-bold">Stats</div>
							<div className="flex flex-col gap-1.5">
								<div className="flex items-baseline justify-between">
									<span className="text-xs text-slate-600">Boards</span>
									<span className="font-mono text-sm">{boardsCount}</span>
								</div>
								<div className="flex items-baseline justify-between">
									<span className="text-xs text-slate-600">Layers</span>
									<span className="font-mono text-sm">{layersCount}</span>
								</div>
								<div className="flex items-baseline justify-between">
									<span className="text-xs text-slate-600">System</span>
									<span className="font-mono text-sm text-cyan-700">
										{systemName}
									</span>
								</div>
								<div className="flex items-baseline justify-between">
									<span className="text-xs text-slate-600">Edited</span>
									<span className="font-mono text-sm">{editedTime}</span>
								</div>
							</div>
						</div>

						{/* Actions Card */}
						<div className="flex flex-col border border-slate-200 bg-white">
							<div className="px-4 pt-3 pb-1 text-sm font-bold">Actions</div>
							<Button
								variant="block"
								className="w-full justify-start text-left"
								disabled={renameMutation.isPending || deleteMutation.isPending}
								onClick={startRenaming}
							>
								Rename
							</Button>
							<Button
								variant="block"
								className="w-full justify-start text-left"
								disabled
							>
								Duplicate
							</Button>
							<Separator />
							<Button
								variant="block"
								flavor="warning"
								className="w-full justify-start text-left"
								disabled={renameMutation.isPending || deleteMutation.isPending}
								onClick={() => {
									deleteMutation.reset();
									setDeleteDialogOpen(true);
								}}
							>
								{deleteMutation.isPending ? "Deleting..." : "Delete design"}
							</Button>
						</div>
					</div>
				</div>
			</div>
			<ConfirmationDialog
				open={deleteDialogOpen}
				onOpenChange={(open) => {
					if (!open && !deleteMutation.isPending) {
						setDeleteDialogOpen(false);
					}
				}}
				title="Delete design"
				description={
					<>
						Delete &quot;{design.name}&quot;? This removes the design file from
						this project.
					</>
				}
				icon={<Trash2 className="size-4" aria-hidden="true" />}
				actionIcon={<Trash2 className="size-3.5" aria-hidden="true" />}
				actionLabel={deleteMutation.isPending ? "Deleting..." : "Delete"}
				actionDisabled={deleteMutation.isPending}
				tone="destructive"
				onAction={deleteSelectedDesign}
			/>
		</>
	);
}
