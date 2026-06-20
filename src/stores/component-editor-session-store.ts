import { createStore, shallow, useSelector } from "@tanstack/react-store";

// Editing-session state shared between the workspace actions bar (which owns the
// single "Save draft" button) and the component rail context panes (which edit
// metadata + variant schema). Those surfaces live far apart in the tree and
// mount independently, so this state cannot live in either component. Keeping
// the loaded-draft hash baselines here makes them single-owned, which prevents a
// save from one surface from looking like an external change to the other.

export type ComponentEditorMetadata = {
	name: string;
	slug: string;
	description: string;
	group: string;
	order: string;
};

export type ComponentEditorSessionState = {
	componentId: string | null;
	metadata: ComponentEditorMetadata;
	metadataBaseline: ComponentEditorMetadata;
	metadataDirty: boolean;
	loadedDraftTemplateHash: string | null;
	loadedDraftVariantSchemaHash: string | null;
	variantsValid: boolean;
	draftConflict: string | null;
};

const emptyMetadata: ComponentEditorMetadata = {
	name: "",
	slug: "",
	description: "",
	group: "",
	order: "",
};

const emptyState: ComponentEditorSessionState = {
	componentId: null,
	metadata: emptyMetadata,
	metadataBaseline: emptyMetadata,
	metadataDirty: false,
	loadedDraftTemplateHash: null,
	loadedDraftVariantSchemaHash: null,
	variantsValid: true,
	draftConflict: null,
};

export const componentEditorSessionStore =
	createStore<ComponentEditorSessionState>(emptyState);

export function metadataSignature(metadata: ComponentEditorMetadata) {
	return JSON.stringify(metadata);
}

export function isEditorMetadataChanged(state: ComponentEditorSessionState) {
	return (
		metadataSignature(state.metadata) !==
		metadataSignature(state.metadataBaseline)
	);
}

// Adopts the server's metadata as the editing baseline. When the selected
// component changes, the local buffer is always reset; otherwise unsaved local
// edits are preserved while the baseline tracks the server.
export function syncEditorSessionMetadata(input: {
	componentId: string;
	metadata: ComponentEditorMetadata;
}) {
	componentEditorSessionStore.setState((state) => {
		const componentChanged = state.componentId !== input.componentId;
		if (componentChanged) {
			return {
				...state,
				componentId: input.componentId,
				metadata: input.metadata,
				metadataBaseline: input.metadata,
				metadataDirty: false,
			};
		}

		return {
			...state,
			metadataBaseline: input.metadata,
			metadata: state.metadataDirty ? state.metadata : input.metadata,
		};
	});
}

export function setEditorMetadataField(
	field: keyof ComponentEditorMetadata,
	value: string,
) {
	componentEditorSessionStore.setState((state) => ({
		...state,
		metadata: { ...state.metadata, [field]: value },
		metadataDirty: true,
	}));
}

export function markEditorMetadataSaved(
	savedMetadata: ComponentEditorMetadata,
) {
	componentEditorSessionStore.setState((state) => {
		// Only mark clean if the buffer has not changed since the save started.
		if (
			metadataSignature(state.metadata) !== metadataSignature(savedMetadata)
		) {
			return { ...state, metadataBaseline: savedMetadata };
		}
		return {
			...state,
			metadataBaseline: savedMetadata,
			metadataDirty: false,
		};
	});
}

export function setLoadedDraftHashes(patch: {
	templateHash?: string | null;
	variantSchemaHash?: string | null;
}) {
	componentEditorSessionStore.setState((state) => ({
		...state,
		...(patch.templateHash !== undefined
			? { loadedDraftTemplateHash: patch.templateHash }
			: {}),
		...(patch.variantSchemaHash !== undefined
			? { loadedDraftVariantSchemaHash: patch.variantSchemaHash }
			: {}),
	}));
}

export function setEditorVariantsValid(valid: boolean) {
	componentEditorSessionStore.setState((state) =>
		state.variantsValid === valid ? state : { ...state, variantsValid: valid },
	);
}

export function setEditorDraftConflict(conflict: string | null) {
	componentEditorSessionStore.setState((state) =>
		state.draftConflict === conflict
			? state
			: { ...state, draftConflict: conflict },
	);
}

export function resetComponentEditorSession() {
	componentEditorSessionStore.setState(() => emptyState);
}

export function useEditorMetadata() {
	return useSelector(componentEditorSessionStore, (state) => state.metadata, {
		compare: shallow,
	});
}

export function useEditorMetadataChanged() {
	return useSelector(componentEditorSessionStore, isEditorMetadataChanged);
}

export function useLoadedDraftTemplateHash() {
	return useSelector(
		componentEditorSessionStore,
		(state) => state.loadedDraftTemplateHash,
	);
}

export function useLoadedDraftVariantSchemaHash() {
	return useSelector(
		componentEditorSessionStore,
		(state) => state.loadedDraftVariantSchemaHash,
	);
}

export function useEditorVariantsValid() {
	return useSelector(
		componentEditorSessionStore,
		(state) => state.variantsValid,
	);
}

export function useEditorDraftConflict() {
	return useSelector(
		componentEditorSessionStore,
		(state) => state.draftConflict,
	);
}
