import { ContextMenu } from "@base-ui/react/context-menu";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { tv } from "tailwind-variants";
import {
	designFileQueryKey,
	designSummariesQueryKey,
	extractDesignSubtreeToFile,
	getDesignFileForUuid,
	saveDesignFile,
} from "../../queries/design-file";
import { validateRecipeInstances } from "../../recipes/validation";
import {
	clearDirty,
	deleteElement,
	designStore,
	detachRecipe,
	isDesignCleanAtRevision,
	serializeDesign,
	updateRecipeInstance,
} from "../../stores/design-store";
import { useProjectScope } from "../contexts";

const contextMenu = tv({
	slots: {
		trigger: "select-none",
		positioner: "outline-hidden",
		popup:
			"min-w-25 origin-[var(--transform-origin)] transition-[opacity] data-[ending-style]:opacity-0 shadow-lg shadow-slate-500/10 bg-slate-50 text-slate-950 inset-shadow-[0_0_0_1px] inset-shadow-slate-200",
		item: "flex max-w-56 cursor-default p-1 text-xs outline-hidden select-none data-[disabled]:opacity-50 data-[highlighted]:bg-slate-200 data-[highlighted]:active:text-cyan-500 data-highlighted:active:bg-cyan-50",
	},
});

const { trigger, positioner, popup, item } = contextMenu();

type LayerContextMenuProps = ContextMenu.Trigger.Props & {
	className?: string;
	id: string;
	designFile: string;
	isRecipeOwned: boolean;
	layerName: string;
	recipeInstanceId: string | null;
};

function LayerContextMenu({
	id,
	designFile,
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
		const confirmed = window.confirm(
			`Update the recipe instance containing "${layerName}"? Recipe structure may change while editable settings and slot contents are preserved where possible.`,
		);
		if (!confirmed) {
			return;
		}

		try {
			updateRecipeInstance(id);
			toast.success("Updated recipe.");
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Failed to update recipe.",
			);
		}
	};
	const handleDetachRecipe = () => {
		const confirmed = window.confirm(
			`Detach the recipe instance containing "${layerName}"? This keeps the layers but removes recipe protection from the whole instance.`,
		);
		if (!confirmed) {
			return;
		}

		detachRecipe(id);
	};
	const extractMutation = useMutation({
		mutationFn: async () => {
			const revision = designStore.get().revision;
			const designUuid = crypto.randomUUID();
			const targetFile = getDesignFileForUuid(designUuid);
			const sourceDesign = serializeDesign();

			if (!isDesignCleanAtRevision(revision)) {
				await saveDesignFile(designFile, sourceDesign);
				clearDirty(revision);
				queryClient.setQueryData(
					designFileQueryKey(designFile, projectScope),
					sourceDesign,
				);
			}

			const extractedDesign = await extractDesignSubtreeToFile({
				sourceFile: designFile,
				targetFile,
				elementId: id,
				name: layerName,
			});
			return {
				designUuid,
				extractedDesign,
				revision,
				targetFile,
			};
		},
		onSuccess: async ({
			designUuid,
			extractedDesign,
			revision: extractRevision,
			targetFile,
		}) => {
			queryClient.setQueryData(
				designFileQueryKey(targetFile, projectScope),
				extractedDesign,
			);
			await queryClient.invalidateQueries({
				queryKey: designSummariesQueryKey,
			});
			if (!isDesignCleanAtRevision(extractRevision)) {
				toast.info(
					"Extracted layer to a new design. Stayed here because this design changed during extraction.",
				);
				return;
			}

			navigate(`/design/${designUuid}`);
		},
		onError: (error) => {
			toast.error(
				error instanceof Error
					? error.message
					: "Failed to extract layer to a new design.",
			);
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
							<span className="truncate">Extract as {layerName}</span>
						</ContextMenu.Item>
						{isRecipeOwned ? (
							<>
								{isStaleRecipe ? (
									<ContextMenu.Item
										className={item()}
										onClick={handleUpdateRecipe}
									>
										<span className="truncate">Update recipe</span>
									</ContextMenu.Item>
								) : null}
								<ContextMenu.Item
									className={item()}
									onClick={handleDetachRecipe}
								>
									<span className="truncate">Detach recipe</span>
								</ContextMenu.Item>
							</>
						) : null}
						<ContextMenu.Item
							className={item()}
							onClick={() => deleteElement(id)}
						>
							Delete
						</ContextMenu.Item>
					</ContextMenu.Popup>
				</ContextMenu.Positioner>
			</ContextMenu.Portal>
		</ContextMenu.Root>
	);
}

export { LayerContextMenu };
