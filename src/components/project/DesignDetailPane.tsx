import { useHotkey } from "@tanstack/react-hotkeys";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight, Copy, Save, Trash2 } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
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
import { Input } from "../ui/input";
import { ScrollArea } from "../ui/scroll-area";
import { Text } from "../ui/text";
import { DesignGlyph } from "./DesignGlyph";
import { formatRelativeTime } from "./project-view-utils";

function DesignOverviewMetricCard({
	label,
	value,
	detail,
	isMonospace = false,
}: {
	label: string;
	value: string;
	detail: string;
	isMonospace?: boolean;
}) {
	return (
		<div className="flex min-h-32 min-w-0 flex-col bg-white inset-shadow-[0_0_0_1px] inset-shadow-slate-200">
			<div className="flex items-center justify-between gap-3 px-4 py-3 text-sm font-bold text-slate-950">
				{label}
			</div>
			<div className="flex min-w-0 flex-1 flex-col justify-end gap-1 border-t border-slate-100 px-4 py-3">
				<div
					className={`truncate text-2xl font-medium text-slate-950 ${
						isMonospace ? "font-mono text-lg" : ""
					}`}
					title={value}
				>
					{value}
				</div>
				<div className="truncate text-xs text-slate-500">{detail}</div>
			</div>
		</div>
	);
}

function DesignDetailSection({
	title,
	children,
	tone = "default",
}: {
	title: string;
	children: ReactNode;
	tone?: "default" | "danger";
}) {
	return (
		<section
			className={`flex flex-col border bg-white ${
				tone === "danger" ? "border-red-200" : "border-slate-200"
			}`}
		>
			<div
				className={`flex items-baseline px-4 py-3 text-sm font-bold ${
					tone === "danger" ? "bg-red-50 text-red-900" : "text-slate-950"
				}`}
			>
				{title}
			</div>
			<div
				className={`flex flex-col gap-3 border-t px-4 py-3 ${
					tone === "danger" ? "border-red-200" : "border-slate-100"
				}`}
			>
				{children}
			</div>
		</section>
	);
}

function DesignReadOnlyField({
	label,
	value,
	action,
}: {
	label: string;
	value: string;
	action?: ReactNode;
}) {
	return (
		<div className="flex min-w-0 flex-col gap-1.5">
			<span className="text-xs text-slate-500">{label}</span>
			<div className="flex min-w-0 items-stretch">
				<div
					className={`flex min-w-0 flex-1 items-center border border-slate-200 bg-slate-50 px-2 py-2 font-mono text-sm text-slate-800 ${
						action ? "border-r-0" : ""
					}`}
					title={value}
				>
					<span className="min-w-0 flex-1 truncate">{value}</span>
				</div>
				{action}
			</div>
		</div>
	);
}

async function writeClipboardText(value: string) {
	const desktopApi = getTrickroomDesktopApi();
	if (desktopApi?.clipboard) {
		await desktopApi.clipboard.writeText(value);
		return;
	}

	await navigator.clipboard.writeText(value);
}

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
	const [copiedResource, setCopiedResource] = useState(false);
	const [copiedDesignId, setCopiedDesignId] = useState(false);
	const [draftName, setDraftName] = useState(design.name);
	const inputRef = useRef<HTMLInputElement>(null);
	const cancelledRef = useRef(false);
	const copiedResourceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
		null,
	);
	const copiedDesignIdTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
		null,
	);
	const shaPreview = design.uuid;
	const resourceUri = buildDesignResourceUri(
		locationId,
		design.uuid,
		design.name,
	);

	const systemName = design.systemName ?? "-";
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
	const isMutatingDesign = renameMutation.isPending || deleteMutation.isPending;
	const saveNameDisabled =
		isMutatingDesign ||
		draftName.trim().length === 0 ||
		draftName.trim() === design.name;
	const actionError =
		(renameMutation.error as Error | null)?.message ??
		(deleteMutation.error as Error | null)?.message;

	const startRenaming = () => {
		if (isMutatingDesign) {
			return;
		}

		cancelledRef.current = false;
		setDraftName(design.name);
		setIsRenaming(true);
	};

	const confirmRename = () => {
		if (renameMutation.isPending) {
			return;
		}

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

	const copyResourceUri = () => {
		void writeClipboardText(resourceUri)
			.then(() => {
				setCopiedResource(true);
				if (copiedResourceTimeoutRef.current) {
					clearTimeout(copiedResourceTimeoutRef.current);
				}
				copiedResourceTimeoutRef.current = setTimeout(() => {
					setCopiedResource(false);
				}, 1500);
			})
			.catch(() => {
				setCopiedResource(false);
			});
	};

	const copyDesignId = () => {
		void writeClipboardText(design.uuid)
			.then(() => {
				setCopiedDesignId(true);
				if (copiedDesignIdTimeoutRef.current) {
					clearTimeout(copiedDesignIdTimeoutRef.current);
				}
				copiedDesignIdTimeoutRef.current = setTimeout(() => {
					setCopiedDesignId(false);
				}, 1500);
			})
			.catch(() => {
				setCopiedDesignId(false);
			});
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
	useEffect(() => {
		setDraftName(design.name);
	}, [design.name]);
	useEffect(() => {
		return () => {
			if (copiedResourceTimeoutRef.current) {
				clearTimeout(copiedResourceTimeoutRef.current);
			}
			if (copiedDesignIdTimeoutRef.current) {
				clearTimeout(copiedDesignIdTimeoutRef.current);
			}
		};
	}, []);

	return (
		<>
			<div className="flex h-full flex-col overflow-hidden bg-slate-50 text-slate-950">
				<header className="border-b border-slate-200">
					<div className="flex items-start justify-between gap-4 px-10 pt-8 pb-6">
						<div className="flex min-w-0 flex-1 flex-col gap-1">
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
							<p className="font-mono text-[11px] text-slate-400">
								{shaPreview}
							</p>
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
								aria-label={copiedResource ? "Copied!" : "Copy resource link"}
								onClick={copyResourceUri}
							>
								<Copy
									className={`size-4 ${copiedResource ? "text-cyan-600" : ""}`}
									aria-hidden="true"
								/>
							</Button>
						</div>
					</div>
				</header>

				<ScrollArea className="min-h-0 flex-1">
					<div className="flex min-h-full flex-col gap-6 px-10 py-8">
						<div className="grid grid-cols-[repeat(auto-fit,minmax(14rem,1fr))] gap-4">
							<DesignOverviewMetricCard
								label="Boards"
								value={boardsCount.toLocaleString()}
								detail="Root boards in this design"
							/>
							<DesignOverviewMetricCard
								label="Layers"
								value={layersCount.toLocaleString()}
								detail="Total rendered layers"
							/>
							<DesignOverviewMetricCard
								label="System"
								value={systemName}
								detail={
									design.systemName ? "Linked system" : "No system linked"
								}
							/>
							<DesignOverviewMetricCard
								label="Edited"
								value={editedTime}
								detail="Last file modification"
							/>
						</div>

						<DesignDetailSection title="Identity">
							<div className="flex min-w-0 flex-col gap-1.5">
								<label
									htmlFor="design-settings-name"
									className="text-xs text-slate-500"
								>
									Design name
								</label>
								<div className="flex min-w-0 items-center gap-2">
									<Input
										id="design-settings-name"
										variant="form"
										className="min-w-0 flex-1"
										value={draftName}
										onChange={(event) => setDraftName(event.target.value)}
										onKeyDown={(event) => {
											if (event.key === "Enter") confirmRename();
										}}
										disabled={isMutatingDesign}
									/>
									<Button
										variant="outlined"
										className="flex items-center gap-1.5 px-3 py-2"
										onClick={confirmRename}
										disabled={saveNameDisabled}
									>
										<Save className="size-3.5" aria-hidden="true" />
										{renameMutation.isPending ? "Saving..." : "Save"}
									</Button>
								</div>
								<p className="font-mono text-[10px] text-slate-500">
									Shown in the sidebar, design editor, and resource links.
								</p>
							</div>
							<DesignReadOnlyField
								label="Design ID"
								value={design.uuid}
								action={
									<Button
										variant="outlined"
										className="shrink-0 bg-slate-50 px-3 py-2"
										aria-label={
											copiedDesignId ? "Copied design ID" : "Copy design ID"
										}
										onClick={copyDesignId}
									>
										<Copy
											className={`size-3.5 ${
												copiedDesignId ? "text-cyan-600" : ""
											}`}
											aria-hidden="true"
										/>
									</Button>
								}
							/>
						</DesignDetailSection>

						<DesignDetailSection title="Storage & Resource">
							<DesignReadOnlyField label="Design file" value={design.file} />
							<DesignReadOnlyField
								label="Resource URI"
								value={resourceUri}
								action={
									<Button
										variant="outlined"
										className="shrink-0 bg-slate-50 px-3 py-2"
										aria-label={
											copiedResource
												? "Copied resource URI"
												: "Copy resource URI"
										}
										onClick={copyResourceUri}
									>
										<Copy
											className={`size-3.5 ${
												copiedResource ? "text-cyan-600" : ""
											}`}
											aria-hidden="true"
										/>
									</Button>
								}
							/>
						</DesignDetailSection>

						<DesignDetailSection title="Danger Zone" tone="danger">
							<div className="flex items-center justify-between gap-4">
								<div className="flex min-w-0 flex-col gap-1">
									<span className="text-sm font-medium text-slate-800">
										Delete design
									</span>
									<p className="text-xs text-slate-600">
										Removes this design file from the project.
									</p>
								</div>
								<Button
									variant="outlined"
									flavor="warning"
									className="flex shrink-0 items-center gap-1.5 px-3 py-1.5"
									disabled={isMutatingDesign}
									onClick={() => {
										deleteMutation.reset();
										setDeleteDialogOpen(true);
									}}
								>
									<Trash2 className="size-3.5" aria-hidden="true" />
									{deleteMutation.isPending ? "Deleting..." : "Delete..."}
								</Button>
							</div>
						</DesignDetailSection>

						<DesignDetailSection title="Glyph">
							<DesignGlyph
								design={design}
								className="mx-auto aspect-square w-full max-w-[700px]"
							/>
						</DesignDetailSection>
					</div>
				</ScrollArea>
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
