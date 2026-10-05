import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it } from "vitest";
import type { DesignFileRevision } from "../services/design-file-service.types";
import {
	designStore,
	forceHydrateDesign,
	serializeDesign,
	setDesignName,
	updateElementProps,
} from "../stores/design-store";
import type { Node, TrickroomDesign } from "../types";
import { type DesignFileSnapshot, designFileQueryKey } from "./design-file";
import { commitDesignSave } from "./design-save";

const designId = "home";
const projectScope = "loc_1";
const queryKey = designFileQueryKey(designId, projectScope);
const loadedRevision: DesignFileRevision = "r2.loaded";
const savedRevision: DesignFileRevision = "r2.saved";

const board = (id: string, className = ""): Node => ({
	id,
	props: {
		"data-trickroom-name": id,
		"data-trickroom-library": "trickroom",
		"data-trickroom-component": "container",
		"data-trickroom-role": "branch",
		className,
	},
	children: [],
});

const design: TrickroomDesign = {
	name: "Before",
	boards: [board("root"), board("other")],
};

const parts = (revisions: Record<string, string>, manifest = "m1") => ({
	manifest,
	boards: Object.entries(revisions).map(([id, revision]) => ({ id, revision })),
});

describe("committing a design save", () => {
	let queryClient: QueryClient;

	beforeEach(() => {
		queryClient = new QueryClient();
		queryClient.setQueryData(queryKey, {
			design,
			revision: loadedRevision,
		} satisfies DesignFileSnapshot);
		forceHydrateDesign(
			design,
			loadedRevision,
			parts({ root: "root-1", other: "other-1" }),
		);
	});

	const startSave = () => ({
		sent: serializeDesign(),
		savedStoreRevision: designStore.get().revision,
	});

	it("moves the cache, the persisted revision and the base to the save", () => {
		setDesignName("After");
		const { sent, savedStoreRevision } = startSave();

		commitDesignSave(queryClient, {
			designId,
			projectScope,
			sent,
			saved: {
				design: sent,
				revision: savedRevision,
				parts: parts({ root: "root-1", other: "other-1" }, "m2"),
			},
			savedStoreRevision,
		});

		const state = designStore.get();
		expect(state.name).toBe("After");
		expect(state.persistedRevision).toBe(savedRevision);
		expect(state.manifestDirtyAt).toBeNull();
		expect(state.base?.manifest.name).toBe("After");
		expect(
			queryClient.getQueryData<DesignFileSnapshot>(queryKey)?.revision,
		).toBe(savedRevision);
	});

	it("leaves edits made during the save dirty without a conflict", () => {
		setDesignName("After");
		const { sent, savedStoreRevision } = startSave();
		setDesignName("Later");

		commitDesignSave(queryClient, {
			designId,
			projectScope,
			sent,
			saved: { design: sent, revision: savedRevision },
			savedStoreRevision,
		});

		const state = designStore.get();
		expect(state.name).toBe("Later");
		expect(state.manifestDirtyAt).not.toBeNull();
		expect(state.conflicts).toBeNull();
	});

	it("applies another writer's board kept by a merged save without reloading", () => {
		updateElementProps("root", { className: "p-2" });
		const { sent, savedStoreRevision } = startSave();
		const rootEntity = designStore.get().entitiesById.root;
		const agentBoard = board("other", "bg-cyan-500");

		commitDesignSave(queryClient, {
			designId,
			projectScope,
			sent,
			saved: {
				design: { ...sent, boards: [sent.boards[0] as Node, agentBoard] },
				revision: savedRevision,
				merged: true,
				parts: parts({ root: "root-2", other: "other-2" }),
			},
			savedStoreRevision,
		});

		const state = designStore.get();
		expect(state.entitiesById.other?.props.className).toBe("bg-cyan-500");
		expect(state.entitiesById.root).toBe(rootEntity);
		expect(state.persistedRevision).toBe(savedRevision);
		expect(state.dirtyBoards).toEqual({});
		expect(state.conflicts).toBeNull();
	});

	it("merges a merged save with edits made meanwhile to another board", () => {
		updateElementProps("root", { className: "p-2" });
		const { sent, savedStoreRevision } = startSave();
		updateElementProps("root", { className: "p-4" });
		const agentBoard = board("other", "bg-cyan-500");

		commitDesignSave(queryClient, {
			designId,
			projectScope,
			sent,
			saved: {
				design: { ...sent, boards: [sent.boards[0] as Node, agentBoard] },
				revision: savedRevision,
				merged: true,
				parts: parts({ root: "root-2", other: "other-2" }),
			},
			savedStoreRevision,
		});

		const state = designStore.get();
		expect(state.entitiesById.root?.props.className).toBe("p-4");
		expect(state.entitiesById.other?.props.className).toBe("bg-cyan-500");
		expect(Object.keys(state.dirtyBoards ?? {})).toEqual(["root"]);
		expect(state.persistedRevision).toBe(savedRevision);
		expect(state.conflicts).toBeNull();
	});
});
