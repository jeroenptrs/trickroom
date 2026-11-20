import { ContextMenu } from "@base-ui/react/context-menu";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, Unlink } from "lucide-react";
import { useCallback, useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import {
	designFileQueryKey,
	designSummariesQueryKey,
	extractDesignSubtreeToFile,
	saveDesignFile,
} from "../../queries/design-file";
import { commitDesignSave } from "../../queries/design-save";
import { validateRecipeInstances } from "../../recipes/validation";
import {
	designStore,
	detachRecipe,
	isDesignCleanAtRevision,
	serializeDesign,
	updateRecipeInstance,
} from "../../stores/design-store";
import { useProjectScope } from "../contexts";
import { ConfirmationDialog } from "../ui/alert-dialog";
import { contextMenu } from "../ui/context-menu";
import { ExtractSystemComponentDialog } from "./ExtractSystemComponentDialog";
import { requestLayerDelete } from "./layer-delete";

const { trigger, positioner, popup, item } = contextMenu();

type LayerContextMenuProps = ContextMenu.Trigger.Props & {
	className?: string;
	id: string;
	designId: string;
	isBoard: boolean;
	isRecipeOwned: boolean;
	layerName: string;
	recipeInstanceId: string | null;
};

function LayerContextMenu({
	id,
	designId,
	isBoard,
	isRecipeOwned,
	layerName,
	recipeInstanceId,
	className,
	...props
}: LayerContextMenuProps) {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const projectScope = useProjectScope();
	const [isStaleRecipe, setIsStaleRecipe] = useState(false);
	const [extractComponentOpen, setExtractComponentOpen] = useState(false);
	const [recipeConfirm, setRecipeConfirm] = useState<
		"update" | "detach" | null
	>(null);
	const handleOpenChange = useCallback(
		(open: boolean) => {
			if (!open || !recipeInstanceId) {
				setIsStaleRecipe(false);
				return;
			}

			const recipeValidation = validateRecipeInstances(
				serializeDesign().boards,
			);
			setIsStaleRecipe(
				recipeValidation.stale.some(
					(instance) => instance.instanceId === recipeInstanceId,
				),
			);
		},
		[recipeInstanceId],
	);
	const handleUpdateRecipe = () => {
		setRecipeConfirm(null);
		try {
			updateRecipeInstance(id);
			toast.success("Recipe updated");
		} catch (error) {
			toast.error("Recipe not updated", {
				description: error instanceof Error ? error.message : undefined,
			});
		}
	};
	const handleDetachRecipe = () => {
		setRecipeConfirm(null);
		detachRecipe(id);
	};
	const extractMutation = useMutation({
		mutationFn: async () => {
			const revision = designStore.get().revision;
			const designUuid = crypto.randomUUID();
			const sourceDesign = serializeDesign();

			if (!isDesignCleanAtRevision(revision)) {
				const saved = await saveDesignFile(
					designId,
					sourceDesign,
					designStore.get().persistedRevision,
				);
				commitDesignSave(queryClient, {
					designId,
					projectScope,
					sent: sourceDesign,
					saved,
					savedStoreRevision: revision,
				});
			}

			await extractDesignSubtreeToFile({
				sourceDesignId: designId,
				targetDesignId: designUuid,
				elementId: id,
				name: layerName,
			});
			return {
				designUuid,
				revision,
			};
		},
		onSuccess: async ({ designUuid, revision: extractRevision }) => {
			queryClient.removeQueries({
				queryKey: designFileQueryKey(designUuid, projectScope),
			});
			await queryClient.invalidateQueries({
				queryKey: designSummariesQueryKey,
			});
			if (!isDesignCleanAtRevision(extractRevision)) {
				toast.info(`${layerName} extracted to a new design`, {
					description:
						"This design changed while it was extracted, so it stays open.",
				});
				return;
			}

			navigate(`/design/${designUuid}`);
		},
		onError: (error) => {
			toast.error(`${layerName} not extracted to a new design`, {
				description: error instanceof Error ? error.message : undefined,
			});
		},
	});

	return (
		<ContextMenu.Root onOpenChange={handleOpenChange}>
			<ContextMenu.Trigger
				id={id}
				data-slot="context-menu-trigger"
				className={trigger({ className })}
				{...props}
			/>
			<ContextMenu.Portal>
				<ContextMenu.Positioner className={positioner()}>
					<ContextMenu.Popup className={popup()}>
						<ContextMenu.Item
							className={item()}
							disabled={extractMutation.isPending}
							onClick={() => extractMutation.mutate()}
						>
							<span className="truncate">Extract to new design</span>
						</ContextMenu.Item>
						<ContextMenu.Item
							className={item()}
							onClick={() => setExtractComponentOpen(true)}
						>
							<span className="truncate">Extract as component…</span>
						</ContextMenu.Item>
						{isRecipeOwned ? (
							<>
								{isStaleRecipe ? (
									<ContextMenu.Item
										className={item()}
										onClick={() => setRecipeConfirm("update")}
									>
										<span className="truncate">Update recipe…</span>
									</ContextMenu.Item>
								) : null}
								<ContextMenu.Item
									className={item()}
									onClick={() => setRecipeConfirm("detach")}
								>
									<span className="truncate">Detach recipe…</span>
								</ContextMenu.Item>
							</>
						) : null}
						<ContextMenu.Item
							className={item()}
							onClick={() => requestLayerDelete(id)}
						>
							{isBoard ? "Delete board" : "Delete layer"}
						</ContextMenu.Item>
					</ContextMenu.Popup>
				</ContextMenu.Positioner>
			</ContextMenu.Portal>
			<ExtractSystemComponentDialog
				open={extractComponentOpen}
				onOpenChange={setExtractComponentOpen}
				elementId={id}
				layerName={layerName}
			/>
			<ConfirmationDialog
				open={recipeConfirm === "update"}
				onOpenChange={(open) => {
					if (!open) setRecipeConfirm(null);
				}}
				title="Update recipe?"
				description="The structure can change. Settings and slot content are kept where they still fit."
				icon={<RefreshCw className="size-4" aria-hidden="true" />}
				actionLabel="Update recipe"
				onAction={handleUpdateRecipe}
			/>
			<ConfirmationDialog
				open={recipeConfirm === "detach"}
				onOpenChange={(open) => {
					if (!open) setRecipeConfirm(null);
				}}
				tone="destructive"
				title="Detach recipe?"
				description="The layers stay. They no longer update with the recipe. No undo."
				icon={<Unlink className="size-4" aria-hidden="true" />}
				actionLabel="Detach recipe"
				onAction={handleDetachRecipe}
			/>
		</ContextMenu.Root>
	);
}

export { LayerContextMenu };
