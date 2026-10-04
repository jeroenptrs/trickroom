import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it } from "vitest";
import type { DesignFileRevision } from "../services/design-file-service.types";
import {
	clearDirty,
	designStore,
	forceHydrateDesign,
	hydrateDesign,
	serializeDesign,
	setDesignName,
	setPersistedDesignRevision,
} from "../stores/design-store";
import type { TrickroomDesign } from "../types";
import { getDesignSyncDecision } from "../utils/design-live-sync";
import { type DesignFileSnapshot, designFileQueryKey } from "./design-file";
import { commitDesignSave } from "./design-save";

const designId = "home";
const projectScope = "loc_1";
const queryKey = designFileQueryKey(designId, projectScope);
const loadedRevision: DesignFileRevision = `sha256:${"a".repeat(64)}`;
const savedRevision: DesignFileRevision = `sha256:${"b".repeat(64)}`;

const design: TrickroomDesign = {
	name: "Before",
	boards: [
		{
			id: "root",
			props: {
				"data-trickroom-name": "Root",
				"data-trickroom-library": "trickroom",
				"data-trickroom-component": "container",
				"data-trickroom-role": "branch",
			},
			children: [],
		},
	],
};

// Mirrors the snapshot effect in `Design.tsx`: what the editor does with the
// cached query snapshot once the save is no longer pending.
const syncCachedSnapshot = (queryClient: QueryClient) => {
	const snapshot = queryClient.getQueryData<DesignFileSnapshot>(queryKey);
	if (!snapshot) throw new Error("missing snapshot");
	const state = designStore.get();
	const decision = getDesignSyncDecision({
		snapshotRevision: snapshot.revision,
		persistedRevision: state.persistedRevision ?? null,
		hasUnsavedChanges:
			state.designDirty || Object.keys(state.dirtyIds).length > 0,
		savePending: false,
	});
	if (decision === "reload") {
		hydrateDesign(snapshot.design, snapshot.revision);
	}
	return decision;
};

describe("committing a design save", () => {
	let queryClient: QueryClient;

	beforeEach(() => {
		queryClient = new QueryClient();
		queryClient.setQueryData(queryKey, {
			design,
			revision: loadedRevision,
		} satisfies DesignFileSnapshot);
		forceHydrateDesign(design, loadedRevision);
		clearDirty();
	});

	const saveCurrentDesign = () => {
		const storeRevision = designStore.get().revision;
		const saved: DesignFileSnapshot = {
			design: serializeDesign(),
			revision: savedRevision,
		};
		return { storeRevision, saved };
	};

	it("reproduces the revert when only the store learns about the save", () => {
		setDesignName("After");
		const { storeRevision } = saveCurrentDesign();

		// The previous autosave success handler.
		setPersistedDesignRevision(savedRevision);
		clearDirty(storeRevision);

		expect(syncCachedSnapshot(queryClient)).toBe("reload");
		expect(designStore.get().name).toBe("Before");
		expect(designStore.get().persistedRevision).toBe(loadedRevision);
	});

	it("reproduces a false conflict when editing continued during the save", () => {
		setDesignName("After");
		const { storeRevision } = saveCurrentDesign();
		setDesignName("Later");

		setPersistedDesignRevision(savedRevision);
		clearDirty(storeRevision);

		expect(syncCachedSnapshot(queryClient)).toBe("conflict");
	});

	it("keeps the saved design once the query cache moves with the store", () => {
		setDesignName("After");
		const { storeRevision, saved } = saveCurrentDesign();

		commitDesignSave(queryClient, {
			designId,
			projectScope,
			saved,
			savedStoreRevision: storeRevision,
		});

		expect(syncCachedSnapshot(queryClient)).toBe("ignore");
		expect(designStore.get().name).toBe("After");
		expect(designStore.get().persistedRevision).toBe(savedRevision);
		expect(
			queryClient.getQueryData<DesignFileSnapshot>(queryKey)?.revision,
		).toBe(savedRevision);
	});

	it("leaves edits made during the save dirty without a conflict", () => {
		setDesignName("After");
		const { storeRevision, saved } = saveCurrentDesign();
		setDesignName("Later");

		commitDesignSave(queryClient, {
			designId,
			projectScope,
			saved,
			savedStoreRevision: storeRevision,
		});

		expect(syncCachedSnapshot(queryClient)).toBe("ignore");
		expect(designStore.get().name).toBe("Later");
		expect(designStore.get().designDirty).toBe(true);
	});
});
