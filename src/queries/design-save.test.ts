import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	createDesignFileService,
	type DesignFileService,
	type DesignFileWrite,
} from "../services/design-file-service";
import type { DesignFileRevision } from "../services/design-file-service.types";
import { calculateManifestRevision } from "../services/design-revision";
import {
	designStore,
	forceHydrateDesign,
	hydrateDesign,
	serializeDesign,
	setDesignName,
	updateElementProps,
} from "../stores/design-store";
import {
	diskRevisionsFromParts,
	getDiskContentNeeds,
	hasExternalChange,
} from "../stores/design-sync";
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

/**
 * The server stamps `updatedAt` into the manifest on every save. The editor
 * never sends it, and it is not part of the revision, so it must not turn
 * saves into manifest changes, conflicts or reloads.
 */
describe("saves against the design file service, which stamps updatedAt", () => {
	let tempRoot: string;
	let service: DesignFileService;
	let queryClient: QueryClient;
	let clock: number;

	beforeEach(async () => {
		tempRoot = await mkdtemp(path.join(os.tmpdir(), "trickroom-save-stamp-"));
		clock = Date.parse("2026-10-01T10:00:00.000Z");
		service = createDesignFileService(tempRoot, {
			trickroomHome: path.join(tempRoot, "home"),
			now: () => {
				clock += 60_000;
				return new Date(clock);
			},
		});
		queryClient = new QueryClient();
	});

	afterEach(async () => {
		await rm(tempRoot, { recursive: true, force: true });
	});

	/** The parts the HTTP API reports in `x-trickroom-design-state`. */
	const partsOf = (write: Pick<DesignFileWrite, "design" | "boards">) => ({
		manifest: calculateManifestRevision(write.design),
		boards: write.boards.map(({ id, revision }) => ({ id, revision })),
	});

	/** What the editor's autosave does: PUT the store, then commit. */
	const save = async () => {
		const sent = serializeDesign();
		const savedStoreRevision = designStore.get().revision;
		const written = await service.writeDesignFile(designId, sent, {
			expectedRevision: designStore.get().persistedRevision ?? undefined,
		});
		const change = commitDesignSave(queryClient, {
			designId,
			projectScope,
			sent,
			saved: {
				design: written.design,
				revision: written.revision,
				...(written.merged ? { merged: true } : {}),
				parts: partsOf(written),
			},
			savedStoreRevision,
		});
		return { sent, written, change };
	};

	const open = async () => {
		await service.createDesignFile(designId, design);
		const read = await service.readDesignFile(designId);
		queryClient.setQueryData(queryKey, {
			design: read.design,
			revision: read.revision,
		} satisfies DesignFileSnapshot);
		forceHydrateDesign(read.design, read.revision, partsOf(read));
		return read;
	};

	it("keeps saving without a revision mismatch or a manifest change", async () => {
		const opened = await open();
		expect(opened.design.updatedAt).toBe("2026-10-01T10:01:00.000Z");

		updateElementProps("root", { className: "p-2" });
		const first = await save();
		expect(first.sent).not.toHaveProperty("updatedAt");
		expect(first.written.design.updatedAt).toBe("2026-10-01T10:02:00.000Z");
		expect(first.written.merged).toBe(false);
		expect(hasExternalChange(first.change)).toBe(false);
		expect(designStore.get().persistedRevision).toBe(first.written.revision);
		expect(designStore.get().base?.manifestRevision).toBe(
			calculateManifestRevision(opened.design),
		);

		// The next save names the revision the first one returned.
		updateElementProps("root", { className: "p-4" });
		const second = await save();
		expect(second.written.design.updatedAt).toBe("2026-10-01T10:03:00.000Z");
		expect(hasExternalChange(second.change)).toBe(false);
		expect(designStore.get().dirtyBoards).toEqual({});

		// The file event for the editor's own save carries the revision the
		// cache already holds, so it is skipped as an echo.
		const onDisk = await service.readDesignFile(designId);
		expect(onDisk.design.updatedAt).toBe("2026-10-01T10:03:00.000Z");
		expect(
			queryClient.getQueryData<DesignFileSnapshot>(queryKey)?.revision,
		).toBe(onDisk.revision);

		// Rehydrating with the stored design (which has updatedAt) is a no-op.
		const before = designStore.get();
		hydrateDesign(onDisk.design, onDisk.revision, null);
		expect(designStore.get()).toBe(before);
	});

	it("needs only the changed board after another writer's save, and still saves a rename", async () => {
		await open();
		const editorRevision = designStore.get().persistedRevision as string;

		// An agent changes the other board: the manifest file is rewritten
		// with a new updatedAt.
		const agent = await service.updateDesignFile(designId, {
			expectedRevision: editorRevision,
			mutate: async (read) => ({
				design: {
					...read.design,
					boards: read.design.boards.map((entry) =>
						entry.id === "other"
							? { ...entry, props: { ...entry.props, className: "m-2" } }
							: entry,
					),
				},
			}),
		});
		expect(agent.status).toBe("written");
		if (agent.status !== "written") return;

		// The change event's parts: only the other board needs fetching.
		expect(
			getDiskContentNeeds(
				designStore.get(),
				diskRevisionsFromParts(agent.write.revision, partsOf(agent.write)),
			),
		).toEqual({ boardIds: ["other"], manifest: false });

		// Before the editor applies the event, it renames the design and
		// saves against its older revision: the agent's timestamp does not
		// make the rename stale.
		setDesignName("Renamed");
		const renamed = await save();
		expect(renamed.written.merged).toBe(true);
		expect(renamed.written.design.name).toBe("Renamed");
		expect(renamed.written.design.updatedAt).toBe("2026-10-01T10:03:00.000Z");
		expect(designStore.get().entitiesById.other?.props.className).toBe("m-2");
		expect(designStore.get().manifestDirtyAt).toBeNull();
		expect(designStore.get().conflicts).toBeNull();
		expect(designStore.get().persistedRevision).toBe(renamed.written.revision);
	});
});
