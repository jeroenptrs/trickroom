import { beforeEach, describe, expect, it } from "vitest";
import {
	componentEditorSessionStore,
	isEditorMetadataChanged,
	markEditorMetadataSaved,
	resetComponentEditorSession,
	setEditorMetadataField,
	setLoadedDraftHashes,
	syncEditorSessionMetadata,
} from "./component-editor-session-store";

const serverMetadata = {
	name: "Button",
	slug: "button",
	description: "",
	group: "",
	order: "",
};

describe("component editor session store", () => {
	beforeEach(() => {
		resetComponentEditorSession();
	});

	it("adopts server metadata as the baseline on first sync", () => {
		syncEditorSessionMetadata({
			componentId: "cmp_a",
			metadata: serverMetadata,
		});

		const state = componentEditorSessionStore.get();
		expect(state.metadata).toEqual(serverMetadata);
		expect(state.metadataDirty).toBe(false);
		expect(isEditorMetadataChanged(state)).toBe(false);
	});

	it("preserves unsaved local edits when the server re-syncs the same component", () => {
		syncEditorSessionMetadata({
			componentId: "cmp_a",
			metadata: serverMetadata,
		});
		setEditorMetadataField("name", "Primary Button");

		// A background refetch of the same component must not clobber the edit.
		syncEditorSessionMetadata({
			componentId: "cmp_a",
			metadata: serverMetadata,
		});

		const state = componentEditorSessionStore.get();
		expect(state.metadata.name).toBe("Primary Button");
		expect(state.metadataDirty).toBe(true);
		expect(isEditorMetadataChanged(state)).toBe(true);
	});

	it("resets the buffer when the selected component changes", () => {
		syncEditorSessionMetadata({
			componentId: "cmp_a",
			metadata: serverMetadata,
		});
		setEditorMetadataField("name", "Edited");

		syncEditorSessionMetadata({
			componentId: "cmp_b",
			metadata: { ...serverMetadata, name: "Card", slug: "card" },
		});

		const state = componentEditorSessionStore.get();
		expect(state.metadata.name).toBe("Card");
		expect(state.metadataDirty).toBe(false);
	});

	it("marks metadata clean only when the buffer matches what was saved", () => {
		syncEditorSessionMetadata({
			componentId: "cmp_a",
			metadata: serverMetadata,
		});
		setEditorMetadataField("name", "Saved Name");
		const saved = componentEditorSessionStore.get().metadata;

		markEditorMetadataSaved(saved);
		expect(componentEditorSessionStore.get().metadataDirty).toBe(false);
		expect(isEditorMetadataChanged(componentEditorSessionStore.get())).toBe(
			false,
		);
	});

	it("keeps metadata dirty when it changed again during an in-flight save", () => {
		syncEditorSessionMetadata({
			componentId: "cmp_a",
			metadata: serverMetadata,
		});
		setEditorMetadataField("name", "First");
		const inFlight = componentEditorSessionStore.get().metadata;
		setEditorMetadataField("name", "Second");

		markEditorMetadataSaved(inFlight);

		const state = componentEditorSessionStore.get();
		expect(state.metadataDirty).toBe(true);
		expect(state.metadata.name).toBe("Second");
	});

	it("updates only the requested loaded-draft hash dimension", () => {
		setLoadedDraftHashes({
			templateHash: "sha256:t1",
			variantSchemaHash: "sha256:v1",
		});
		setLoadedDraftHashes({ templateHash: "sha256:t2" });

		const state = componentEditorSessionStore.get();
		expect(state.loadedDraftTemplateHash).toBe("sha256:t2");
		expect(state.loadedDraftVariantSchemaHash).toBe("sha256:v1");
	});
});
