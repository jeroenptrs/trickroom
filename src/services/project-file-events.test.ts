import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Node, TrickroomDesign } from "../types";
import { createDesignFileService } from "./design-file-service";
import { calculateManifestRevision } from "./design-revision";
import {
	classifyTrickroomFile,
	isWatchedTrickroomFile,
	ProjectFileEvents,
	type TrickroomFileEvent,
} from "./project-file-events";

const tempRoots: string[] = [];

afterEach(async () => {
	await Promise.all(
		tempRoots
			.splice(0)
			.map((root) => rm(root, { recursive: true, force: true })),
	);
});

async function createProjectRoot() {
	const root = await mkdtemp(path.join(os.tmpdir(), "trickroom-events-"));
	tempRoots.push(root);
	await mkdir(path.join(root, ".trickroom", "designs"), { recursive: true });
	await mkdir(path.join(root, ".trickroom", "systems"), { recursive: true });
	return root;
}

const board = (id: string, children: Node[] = []): Node => ({
	id,
	props: {
		"data-trickroom-name": id,
		"data-trickroom-library": "trickroom",
		"data-trickroom-component": "container",
		"data-trickroom-role": "branch",
	},
	children,
});

const subscribe = async (root: string) => {
	const events = new ProjectFileEvents(20, {
		trickroomHome: path.join(root, "home"),
	});
	const received: TrickroomFileEvent[] = [];
	events.setProjectRoot(root);
	const unsubscribe = events.subscribe((event) => received.push(event));
	await new Promise((resolve) => setTimeout(resolve, 75));
	return { received, unsubscribe };
};

describe("project file events", () => {
	it("filters to design files, memory and system-owned files", () => {
		expect(isWatchedTrickroomFile("designs/home.json")).toBe(true);
		expect(isWatchedTrickroomFile("designs/home.memory.json")).toBe(true);
		expect(isWatchedTrickroomFile("designs/.gitkeep")).toBe(false);
		expect(isWatchedTrickroomFile("systems/core/tokens.json")).toBe(true);
		expect(isWatchedTrickroomFile("config.json")).toBe(false);

		expect(classifyTrickroomFile("designs/home/design.json")).toEqual({
			kind: "design",
			designId: "home",
			boardId: null,
		});
		expect(classifyTrickroomFile("designs/home/boards/b1.json")).toEqual({
			kind: "design",
			designId: "home",
			boardId: "b1",
		});
		expect(classifyTrickroomFile("designs/home/.journal.json")).toMatchObject({
			kind: "design",
		});
		expect(classifyTrickroomFile("designs/home/memory.json")).toEqual({
			kind: "file",
		});
		for (const ignored of [
			"designs/home/boards/.b1.json.123.abc.tmp",
			"designs/home/.design.json.123.abc.tmp",
			"designs/home/conflicts/b1.json",
			"designs/.home.deleted-1/design.json",
		]) {
			expect(classifyTrickroomFile(ignored)).toBeNull();
		}
	});

	it("broadcasts a debounced design revision to every subscriber", async () => {
		const root = await createProjectRoot();
		const events = new ProjectFileEvents(20);
		const first: TrickroomFileEvent[] = [];
		const second: TrickroomFileEvent[] = [];
		events.setProjectRoot(root);
		const unsubscribeFirst = events.subscribe((event) => first.push(event));
		const unsubscribeSecond = events.subscribe((event) => second.push(event));
		await new Promise((resolve) => setTimeout(resolve, 75));

		await writeFile(
			path.join(root, ".trickroom", "designs", "home.json"),
			'{"name":"Home","boards":[]}',
		);

		await vi.waitFor(() => expect(first).toHaveLength(1), { timeout: 2_000 });
		expect(second).toEqual(first);
		const read = await createDesignFileService(root).readDesignFile("home");
		expect(first[0]).toEqual({
			file: "designs/home",
			designId: "home",
			operation: "changed",
			revision: read.revision,
			boards: [],
			state: {
				manifest: calculateManifestRevision(read.design),
				boards: read.boards,
			},
		});

		unsubscribeFirst();
		unsubscribeSecond();
	});

	it("emits a null revision after deletion", async () => {
		const root = await createProjectRoot();
		const service = createDesignFileService(root, {
			trickroomHome: path.join(root, "home"),
		});
		const { received, unsubscribe } = await subscribe(root);
		await service.createDesignFile("deleted", {
			name: "Delete me",
			boards: [board("a")],
		});
		await vi.waitFor(() => expect(received).toHaveLength(1), {
			timeout: 2_000,
		});
		received.length = 0;

		await service.deleteDesignFile("deleted");

		await vi.waitFor(() => expect(received).toHaveLength(1), {
			timeout: 2_000,
		});
		expect(received[0]).toEqual({
			file: "designs/deleted",
			designId: "deleted",
			operation: "deleted",
			revision: null,
			boards: [{ id: "a", revision: null }],
		});
		unsubscribe();
	});

	it("names the board that changed with its revision", async () => {
		const root = await createProjectRoot();
		const service = createDesignFileService(root, {
			trickroomHome: path.join(root, "home"),
		});
		const created = await service.createDesignFile("home", {
			name: "Home",
			boards: [board("a"), board("b")],
		});
		const { received, unsubscribe } = await subscribe(root);

		const written = await service.writeDesignFile(
			"home",
			{
				...created.design,
				boards: [
					board("a"),
					{ ...board("b"), props: { ...board("b").props, className: "p-4" } },
				],
			},
			{ expectedRevision: created.revision },
		);

		await vi.waitFor(() => expect(received).toHaveLength(1), {
			timeout: 2_000,
		});
		expect(received[0]).toEqual({
			file: "designs/home",
			designId: "home",
			operation: "changed",
			revision: written.revision,
			boards: [{ id: "b", revision: written.boards[1]?.revision }],
			state: {
				manifest: calculateManifestRevision(written.design),
				boards: written.boards,
			},
		});
		unsubscribe();
	});

	it("emits one event for a journaled multi-file write, at its final revision", async () => {
		const root = await createProjectRoot();
		const service = createDesignFileService(root, {
			trickroomHome: path.join(root, "home"),
		});
		const before: TrickroomDesign = {
			name: "Home",
			boards: [board("a", [board("layer")]), board("b"), board("c")],
		};
		const created = await service.createDesignFile("home", before);
		const { received, unsubscribe } = await subscribe(root);

		// Moves a layer from a to b and deletes c, slowly, so the watcher sees
		// the journal and the files change one by one.
		const slow = createDesignFileService(root, {
			trickroomHome: path.join(root, "home"),
			journalHooks: {
				afterStep: () => new Promise((resolve) => setTimeout(resolve, 120)),
			},
		});
		const written = await slow.writeDesignFile(
			"home",
			{ ...created.design, boards: [board("a"), board("b", [board("layer")])] },
			{ expectedRevision: created.revision },
		);

		await vi.waitFor(() => expect(received.length).toBeGreaterThan(0), {
			timeout: 3_000,
		});
		await new Promise((resolve) => setTimeout(resolve, 200));
		expect(received).toHaveLength(1);
		expect(received[0]?.revision).toBe(written.revision);
		expect(
			[...(received[0]?.boards ?? [])].sort((left, right) =>
				left.id.localeCompare(right.id),
			),
		).toEqual([
			{ id: "a", revision: written.boards[0]?.revision },
			{ id: "b", revision: written.boards[1]?.revision },
			{ id: "c", revision: null },
		]);
		unsubscribe();
	});

	it("reports design memory as a file", async () => {
		const root = await createProjectRoot();
		await createDesignFileService(root).createDesignFile("home", {
			name: "Home",
			boards: [],
		});
		const { received, unsubscribe } = await subscribe(root);

		await writeFile(
			path.join(root, ".trickroom", "designs", "home", "memory.json"),
			"{}",
		);

		await vi.waitFor(() => expect(received).toHaveLength(1), {
			timeout: 2_000,
		});
		expect(received[0]).toMatchObject({
			file: "designs/home/memory.json",
			operation: "changed",
		});
		unsubscribe();
	});
});
