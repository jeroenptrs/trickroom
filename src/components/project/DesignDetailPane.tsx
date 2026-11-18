import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight, Trash2 } from "lucide-react";
import { useState } from "react";
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
import { Alert } from "../ui/alert";
import { ConfirmationDialog } from "../ui/alert-dialog";
import { Button } from "../ui/button";
import { CopyButton } from "../ui/copy-button";
import { DetailSection, DetailSectionRow } from "../ui/detail-section";
import { EditableTitle } from "../ui/editable-title";
import { MetricCard } from "../ui/metric-card";
import { PaneHeader } from "../ui/pane-header";
import { ReadOnlyField } from "../ui/readonly-field";
import { ScrollArea } from "../ui/scroll-area";
import { Text } from "../ui/text";
import { MemoryNotesButton } from "./memory/MemoryNotesButton";
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
	const resourceUri = buildDesignResourceUri(
		locationId,
		design.uuid,
		design.name,
	);

	const editedTime = formatRelativeTime(design.modifiedAt);
	const renameMutation = useMutation({
		mutationFn: (name: string) => renameDesignFile(design.uuid, name),
		onSuccess: async (renamedDesign) => {
			queryClient.setQueryData(
				designFileQueryKey(design.uuid, projectScope),
				renamedDesign,
			);
			await queryClient.invalidateQueries({
				queryKey: designSummariesQueryKey,
			});
		},
	});
	const deleteMutation = useMutation({
		mutationFn: () => deleteDesignFile(design.uuid),
		onSuccess: async () => {
			queryClient.removeQueries({
				queryKey: designFileQueryKey(design.uuid, projectScope),
			});
			await queryClient.invalidateQueries({
				queryKey: designSummariesQueryKey,
			});
			setDeleteDialogOpen(false);
			onDelete();
		},
	});
	const isMutatingDesign = renameMutation.isPending || deleteMutation.isPending;
	const renameError = (renameMutation.error as Error | null)?.message;
	// The delete error shows inside the dialog, not behind its backdrop.
	const deleteError = (deleteMutation.error as Error | null)?.message;
	const isUnsupportedVersion =
		design.diagnostic?.code === "UNSUPPORTED_DESIGN_VERSION";

	const renameDesign = (nextName: string) => {
		if (renameMutation.isPending) {
			return;
		}
		renameMutation.mutate(nextName);
	};

	const deleteSelectedDesign = () => {
		if (deleteMutation.isPending) {
			return;
		}
		deleteMutation.mutate();
	};

	return (
		<>
			<div className="flex h-full flex-col overflow-hidden bg-slate-50 text-slate-950">
				<PaneHeader
					title={
						<EditableTitle
							value={design.name}
							aria-label="Design name"
							disabled={isMutatingDesign}
							onRename={renameDesign}
						/>
					}
					errors={
						renameError ? (
							<Text tone="danger" className="text-xs">
								Could not rename the design: {renameError}
							</Text>
						) : null
					}
					actions={
						<div className="flex shrink-0 items-center">
							<MemoryNotesButton
								scope={{ kind: "design", designId: design.uuid }}
								projectScope={projectScope}
								title={design.name}
								subtitle={design.uuid}
							/>
							<Button
								variant="filled"
								className="flex items-center gap-1.5"
								disabled={design.diagnostic !== undefined}
								onClick={() => navigate(`/design/${design.uuid}`)}
							>
								<ArrowUpRight className="size-4" aria-hidden="true" />
								Open design
							</Button>
						</div>
					}
				/>

				<ScrollArea className="min-h-0 flex-1">
					<div className="flex min-h-full flex-col gap-6 px-10 py-8">
						{design.diagnostic ? (
							<Alert variant="panel" tone="warning">
								<span className="flex flex-col gap-1">
									<span>This design can't be opened.</span>
									<span className="font-mono">{design.diagnostic.message}</span>
									<span>
										{isUnsupportedVersion
											? "A newer version of Trickroom saved it."
											: "Restore the file from version control."}{" "}
										Board and layer counts may be wrong.
									</span>
								</span>
							</Alert>
						) : null}
						<div className="grid grid-cols-[repeat(auto-fit,minmax(14rem,1fr))] gap-4">
							<MetricCard
								label="Boards"
								value={design.boardsCount.toLocaleString()}
							/>
							<MetricCard
								label="Layers"
								value={design.layersCount.toLocaleString()}
							/>
							<MetricCard label="System" value={design.systemName ?? "None"} />
							<MetricCard label="Edited" value={editedTime} />
						</div>

						<DetailSection title="Details">
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

						<DetailSection title="Danger zone" tone="danger">
							<DetailSectionRow
								title="Delete design"
								description="Deletes the design and its boards from this project."
								action={
									<Button
										variant="outlined"
										flavor="danger"
										className="flex shrink-0 items-center gap-1.5"
										disabled={isMutatingDesign}
										onClick={() => {
											deleteMutation.reset();
											setDeleteDialogOpen(true);
										}}
									>
										<Trash2 className="size-3.5" aria-hidden="true" />
										{deleteMutation.isPending ? "Deleting…" : "Delete…"}
									</Button>
								}
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
						&quot;{design.name}&quot; and its boards are deleted from this
						project. This can't be undone.
					</>
				}
				icon={<Trash2 className="size-4" aria-hidden="true" />}
				actionIcon={<Trash2 className="size-3.5" aria-hidden="true" />}
				actionLabel={deleteMutation.isPending ? "Deleting…" : "Delete design"}
				actionDisabled={deleteMutation.isPending}
				tone="destructive"
				onAction={deleteSelectedDesign}
				error={
					deleteError ? `Could not delete ${design.name}: ${deleteError}` : null
				}
			/>
		</>
	);
}
