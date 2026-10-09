import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { ProjectQueryScope } from "../../queries/project-scope";
import {
	invalidateSystemComponents,
	systemComponentQueryOptions,
	updateSystemComponentDraft,
	updateSystemComponentMetadata,
} from "../../queries/system-components";
import {
	clearComponentDraftDirty,
	componentDraftStore,
	getComponentDraftTemplateHash,
	isComponentDraftForComponent,
	serializeComponentDraftState,
	serializeComponentDraftVariants,
	useComponentDraftComponentId,
	useComponentDraftRevision,
	useComponentDraftRootPath,
	useComponentDraftTemplateDirty,
	useComponentDraftVariantsDirty,
} from "../../stores/component-draft-store";
import {
	componentEditorSessionStore,
	isEditorMetadataChanged,
	markEditorMetadataSaved,
	setLoadedDraftHashes,
	useEditorDraftConflict,
	useEditorMetadataChanged,
	useEditorVariantsValid,
	useLoadedDraftTemplateHash,
	useLoadedDraftVariantSchemaHash,
} from "../../stores/component-editor-session-store";
import { isSystemComponentSlug } from "../../utils/system-components";

/**
 * The single save path for a component's draft: metadata, template tree and
 * variant schema. Shared by the workspace's "Save draft" button and by the
 * discard confirmation, which saves the draft it is about to leave.
 */
export function useSaveComponentDraft({
	systemId,
	projectScope,
	componentId,
}: {
	systemId: string;
	projectScope?: ProjectQueryScope;
	componentId: string | null;
}) {
	const queryClient = useQueryClient();
	const draftRevision = useComponentDraftRevision();
	const templateDirty = useComponentDraftTemplateDirty();
	const variantsDirty = useComponentDraftVariantsDirty();
	const draftComponentId = useComponentDraftComponentId();
	const draftRootPath = useComponentDraftRootPath();
	const metadataChanged = useEditorMetadataChanged();
	const loadedDraftTemplateHash = useLoadedDraftTemplateHash();
	const loadedDraftVariantSchemaHash = useLoadedDraftVariantSchemaHash();
	const variantsValid = useEditorVariantsValid();
	const draftConflict = useEditorDraftConflict();
	const componentQuery = useQuery({
		...systemComponentQueryOptions(systemId, componentId ?? "", projectScope),
		enabled: componentId !== null,
	});
	const [saveError, setSaveError] = useState<string | null>(null);

	const saveDraftMutation = useMutation({
		// The single save path for the whole draft: component metadata, the
		// template tree, and the variant schema. Metadata is edited in the
		// inspector but persisted here so this stays the only "Save draft" button.
		mutationFn: async () => {
			if (!componentId || !componentQuery.data?.record.draft) {
				throw new Error("Select a component draft before saving.");
			}

			const session = componentEditorSessionStore.get();
			const storeRevision = draftRevision;
			let expectedRevision = componentQuery.data.revision;
			const trimmedName = session.metadata.name.trim();
			if (!trimmedName) {
				throw new Error("Component name is required.");
			}
			const trimmedSlug = session.metadata.slug.trim();
			if (!trimmedSlug) {
				throw new Error("Component slug is required.");
			}
			if (!isSystemComponentSlug(trimmedSlug)) {
				throw new Error(
					"Component slug must use lowercase alphanumeric segments separated by hyphens.",
				);
			}
			if (!session.variantsValid) {
				throw new Error("Resolve variant diagnostics before saving.");
			}

			const draftDirty = templateDirty || variantsDirty;
			if (draftDirty && !isComponentDraftForComponent(componentId)) {
				throw new Error(
					"The open draft no longer matches the selected component. Reload the component before saving.",
				);
			}

			const savedMetadata = session.metadata;
			if (isEditorMetadataChanged(session)) {
				const metadataResult = await updateSystemComponentMetadata(
					systemId,
					componentId,
					{
						expectedRevision,
						name: trimmedName,
						slug: trimmedSlug,
						description: session.metadata.description.trim()
							? session.metadata.description
							: null,
						group: session.metadata.group.trim()
							? session.metadata.group
							: null,
						order: session.metadata.order.trim()
							? Number(session.metadata.order)
							: null,
					},
				);
				expectedRevision = metadataResult.revision;
			}

			let savedDraftTemplate = false;
			let savedDraftVariants = false;
			if (draftDirty) {
				if (templateDirty && session.draftConflict) {
					throw new Error(session.draftConflict);
				}
				const state = componentDraftStore.get();
				if (templateDirty && !state.rootPath) {
					throw new Error("Add a root layer before saving the draft.");
				}
				const savedTemplateHash = getComponentDraftTemplateHash(state);
				savedDraftTemplate = templateDirty;
				savedDraftVariants = variantsDirty;
				await updateSystemComponentDraft(systemId, componentId, {
					expectedRevision,
					expectedDraftTemplateHash: templateDirty
						? (loadedDraftTemplateHash ?? undefined)
						: undefined,
					expectedDraftVariantSchemaHash: variantsDirty
						? (loadedDraftVariantSchemaHash ?? undefined)
						: undefined,
					...(templateDirty
						? {
								root: serializeComponentDraftState(state),
								slots: Object.keys(state.slots).length > 0 ? state.slots : null,
								overrideTargets:
									Object.keys(state.overrideTargets).length > 0
										? state.overrideTargets
										: null,
							}
						: {}),
					...(variantsDirty
						? { variants: serializeComponentDraftVariants(state) }
						: {}),
				});
				if (
					templateDirty &&
					savedTemplateHash === getComponentDraftTemplateHash()
				) {
					clearComponentDraftDirty(storeRevision);
				}
			}

			return {
				savedMetadata,
				savedDraftTemplate,
				savedDraftVariants,
				storeRevision,
			};
		},
		onMutate: () => setSaveError(null),
		onError: async (error) => {
			setSaveError(
				error instanceof Error
					? error.message
					: "Failed to save component draft.",
			);
			if (componentId) {
				await invalidateSystemComponents(
					queryClient,
					systemId,
					projectScope,
					componentId,
				);
			}
		},
		onSuccess: async ({
			savedMetadata,
			savedDraftTemplate,
			savedDraftVariants,
			storeRevision,
		}) => {
			clearComponentDraftDirty(storeRevision);
			markEditorMetadataSaved(savedMetadata);
			setSaveError(null);
			if (componentId) {
				if (savedDraftTemplate || savedDraftVariants) {
					const refreshed = await queryClient.fetchQuery(
						systemComponentQueryOptions(systemId, componentId, projectScope),
					);
					setLoadedDraftHashes({
						...(savedDraftTemplate
							? { templateHash: refreshed.draftTemplateHash ?? null }
							: {}),
						...(savedDraftVariants
							? {
									variantSchemaHash: refreshed.draftVariantSchemaHash ?? null,
								}
							: {}),
					});
				}
				await invalidateSystemComponents(
					queryClient,
					systemId,
					projectScope,
					componentId,
				);
			}
		},
	});

	const hasUnsavedTemplateOrVariantChanges =
		componentId !== null &&
		draftComponentId === componentId &&
		(templateDirty || variantsDirty);
	const draftNeedsRoot =
		hasUnsavedTemplateOrVariantChanges && templateDirty && !draftRootPath;
	const canSave =
		Boolean(componentQuery.data?.record.draft) &&
		!draftConflict &&
		variantsValid &&
		!draftNeedsRoot &&
		(metadataChanged || hasUnsavedTemplateOrVariantChanges);

	return { saveDraftMutation, saveError, canSave };
}
