import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight, Save, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { buildDesignResourceUri } from "../../mcp/resources";
import {
	deleteDesignFile,
	designFileQueryKey,
	designSummariesQueryKey,
	renameDesignFile,
} from "../../queries/design-file";
import type { TrickroomDesignSummary } from "../../types";
import { useProjectScope } from "../contexts";
import { ConfirmationDialog } from "../ui/alert-dialog";
import { Button } from "../ui/button";
import { CopyButton } from "../ui/copy-button";
import { DetailSection, DetailSectionRow } from "../ui/detail-section";
import { EditableTitle } from "../ui/editable-title";
import { Input } from "../ui/input";
import { MetricCard } from "../ui/metric-card";
import { PaneHeader } from "../ui/pane-header";
import { ReadOnlyField } from "../ui/readonly-field";
import { ScrollArea } from "../ui/scroll-area";
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
	const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
	const [draftName, setDraftName] = useState(design.name);
	const resourceUri = buildDesignResourceUri(
		locationId,
		design.uuid,
		design.name,
	);

	const systemName = design.systemName ?? "-";
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

	const renameDesign = (nextName: string) => {
		if (renameMutation.isPending) {
			return;
		}
		renameMutation.mutate(nextName);
	};

	const saveDraftName = () => {
		if (saveNameDisabled) {
			return;
		}
		renameDesign(draftName.trim());
	};

	const deleteSelectedDesign = () => {
		if (deleteMutation.isPending) {
			return;
		}
		deleteMutation.mutate();
	};

	useEffect(() => {
		setDraftName(design.name);
	}, [design.name]);

	return (
		<>
			<div className="flex h-full flex-col overflow-hidden bg-slate-50 text-slate-950">
				<PaneHeader
					eyebrow={<Text variant="eyebrow">Design</Text>}
					title={
						<EditableTitle
							value={design.name}
							aria-label="Design name"
							disabled={isMutatingDesign}
							onRename={renameDesign}
						/>
					}
					meta={
						<Text
							tone="faint"
							className="min-w-0 truncate font-mono text-[11px]"
						>
							{design.uuid}
						</Text>
					}
					errors={
						actionError ? (
							<Text tone="danger" className="text-xs">
								{actionError}
							</Text>
						) : null
					}
					actions={
						<div className="flex shrink-0 items-center">
							<Button
								variant="filled"
								className="flex items-center gap-1.5"
								onClick={() => navigate(`/design/${design.uuid}`)}
							>
								<ArrowUpRight className="size-4" aria-hidden="true" />
								Open design
							</Button>
							<CopyButton
								value={resourceUri}
								subject="resource link"
								className="p-2.5"
								iconClassName="size-4"
							/>
						</div>
					}
				/>

				<ScrollArea className="min-h-0 flex-1">
					<div className="flex min-h-full flex-col gap-6 px-10 py-8">
						<div className="grid grid-cols-[repeat(auto-fit,minmax(14rem,1fr))] gap-4">
							<MetricCard
								label="Boards"
								value={design.boardsCount.toLocaleString()}
								detail="Root boards in this design"
							/>
							<MetricCard
								label="Layers"
								value={design.layersCount.toLocaleString()}
								detail="Total rendered layers"
							/>
							<MetricCard
								label="System"
								value={systemName}
								detail={
									design.systemName ? "Linked system" : "No system linked"
								}
							/>
							<MetricCard
								label="Edited"
								value={editedTime}
								detail="Last file modification"
							/>
						</div>

						<DetailSection title="Identity">
							<div className="flex min-w-0 flex-col gap-1.5">
								<label htmlFor="design-settings-name">
									<Text variant="label" tone="foreground">
										Design name
									</Text>
								</label>
								<div className="flex min-w-0 items-center gap-2">
									<Input
										id="design-settings-name"
										variant="form"
										className="min-w-0 flex-1"
										value={draftName}
										onChange={(event) => setDraftName(event.target.value)}
										onKeyDown={(event) => {
											if (event.key === "Enter") saveDraftName();
										}}
										disabled={isMutatingDesign}
									/>
									<Button
										variant="outlined"
										className="flex items-center gap-1.5"
										onClick={saveDraftName}
										disabled={saveNameDisabled}
									>
										<Save className="size-3.5" aria-hidden="true" />
										{renameMutation.isPending ? "Saving..." : "Save"}
									</Button>
								</div>
								<Text tone="muted" className="text-[11px]">
									Shown in the sidebar, design editor, and resource links.
								</Text>
							</div>
							<ReadOnlyField
								label="Design ID"
								value={design.uuid}
								action={
									<CopyButton
										value={design.uuid}
										subject="design ID"
										className="px-3 py-2"
									/>
								}
							/>
						</DetailSection>

						<DetailSection title="Storage & Resource">
							<ReadOnlyField label="Design file" value={design.file} />
							<ReadOnlyField
								label="Resource URI"
								value={resourceUri}
								action={
									<CopyButton
										value={resourceUri}
										subject="resource URI"
										className="px-3 py-2"
									/>
								}
							/>
						</DetailSection>

						<DetailSection title="Danger Zone" tone="danger">
							<DetailSectionRow
								title="Delete design"
								description="Removes this design file from the project."
								action={
									<Button
										variant="outlined"
										flavor="warning"
										className="flex shrink-0 items-center gap-1.5"
										disabled={isMutatingDesign}
										onClick={() => {
											deleteMutation.reset();
											setDeleteDialogOpen(true);
										}}
									>
										<Trash2 className="size-3.5" aria-hidden="true" />
										{deleteMutation.isPending ? "Deleting..." : "Delete..."}
									</Button>
								}
							/>
						</DetailSection>

						<DetailSection title="Glyph">
							<DesignGlyph
								design={design}
								className="mx-auto aspect-square w-full max-w-[700px]"
							/>
						</DetailSection>
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
