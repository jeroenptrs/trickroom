import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Node, TrickroomDesign } from "../types";
import { recordTailwindSourceFiles } from "../utils/tailwind-source-files";
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

const subscribe = async (
	root: string,
	options: { maxWaitMs?: number } = {},
) => {
	const events = new ProjectFileEvents(20, {
		trickroomHome: path.join(root, "home"),
		...options,
	});
	const received: TrickroomFileEvent[] = [];
	const receivedAt: number[] = [];
	events.setProjectRoot(root);
	const unsubscribe = events.subscribe((event) => {
		received.push(event);
		receivedAt.push(Date.now());
	});
	await new Promise((resolve) => setTimeout(resolve, 75));
	return { received, receivedAt, unsubscribe };
};

describe("project file events", () => {
	it("filters to design files, memory and system-owned files", () => {
		expect(isWatchedTrickroomFile("designs/home.json")).toBe(true);
		expect(isWatchedTrickroomFile("designs/home.memory.json")).toBe(true);
		expect(isWatchedTrickroomFile("designs/.gitkeep")).toBe(false);
		expect(isWatchedTrickroomFile("systems/core/tokens.json")).toBe(true);
		expect(isWatchedTrickroomFile("systems/core/lint.json")).toBe(true);
		expect(isWatchedTrickroomFile("systems/core/lint-report.json")).toBe(true);
		expect(
			isWatchedTrickroomFile("systems/core/lint-report.json.42.abc.tmp"),
		).toBe(false);
		expect(isWatchedTrickroomFile("systems/core/lint-report.json.lock")).toBe(
			false,
		);
		expect(
			isWatchedTrickroomFile("systems/core/lint-report.json.lock.42.abc"),
		).toBe(false);
		expect(
			isWatchedTrickroomFile("systems/core/lint-report.json.reclaim"),
		).toBe(false);
		expect(isWatchedTrickroomFile("config.json")).toBe(true);
		expect(isWatchedTrickroomFile(".config.json.123.tmp")).toBe(false);

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

	it("reports a board save once, though updatedAt rewrites the manifest after it", async () => {
		const root = await createProjectRoot();
		const service = createDesignFileService(root, {
			trickroomHome: path.join(root, "home"),
		});
		const created = await service.createDesignFile("home", {
			name: "Home",
			boards: [board("a"), board("b")],
		});
		const { received, unsubscribe } = await subscribe(root);

		// The board file is written first and the manifest (only its
		// updatedAt changes) well after the debounce, so the watcher sees
		// them as two changes.
		const slow = createDesignFileService(root, {
			trickroomHome: path.join(root, "home"),
			now: () => new Date(Date.parse(created.design.updatedAt ?? "") + 1_000),
			journalHooks: {
				afterStep: () => new Promise((resolve) => setTimeout(resolve, 120)),
			},
		});
		const written = await slow.writeDesignFile(
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
		expect(written.design.updatedAt).not.toBe(created.design.updatedAt);

		await vi.waitFor(() => expect(received.length).toBeGreaterThan(0), {
			timeout: 2_000,
		});
		await new Promise((resolve) => setTimeout(resolve, 200));
		expect(received).toHaveLength(1);
		expect(received[0]).toMatchObject({
			revision: written.revision,
			boards: [{ id: "b", revision: written.boards[1]?.revision }],
			state: {
				// The browser does not refetch the manifest for a timestamp.
				manifest: calculateManifestRevision(created.design),
				boards: written.boards,
			},
		});
		unsubscribe();
	});

	it("emits during a steady stream of writes, and ends at the final revision", async () => {
		const root = await createProjectRoot();
		const service = createDesignFileService(root, {
			trickroomHome: path.join(root, "home"),
		});
		const created = await service.createDesignFile("home", {
			name: "Home",
			boards: [board("a"), board("b")],
		});
		const { received, receivedAt, unsubscribe } = await subscribe(root, {
			maxWaitMs: 100,
		});

		// Writes closer together than the 20 ms debounce, for 600 ms: without
		// a maximum wait nothing would be emitted until they stop.
		const revisions = new Set<string>();
		let revision = created.revision;
		const startedAt = Date.now();
		for (let index = 0; Date.now() - startedAt < 600; index += 1) {
			const written = await service.writeDesignFile(
				"home",
				{
					...created.design,
					boards: [
						{
							...board("a"),
							props: { ...board("a").props, className: `p-${index}` },
						},
						board("b"),
					],
				},
				{ expectedRevision: revision },
			);
			revision = written.revision;
			revisions.add(revision);
			await new Promise((resolve) => setTimeout(resolve, 5));
		}
		const endedAt = Date.now();

		await vi.waitFor(() => expect(received.at(-1)?.revision).toBe(revision), {
			timeout: 2_000,
		});
		await new Promise((resolve) => setTimeout(resolve, 150));
		const during = receivedAt.filter((time) => time < endedAt);
		expect(during.length).toBeGreaterThanOrEqual(2);
		expect((during[0] as number) - startedAt).toBeLessThan(400);
		for (const event of received) {
			expect(event.designId).toBe("home");
			expect(revisions.has(event.revision as string)).toBe(true);
			expect(event.boards?.map((entry) => entry.id)).toEqual(["a"]);
		}
		// Repeats of the same revision are dropped.
		received.forEach((event, index) => {
			expect(event.revision).not.toBe(received[index - 1]?.revision);
		});
		expect(received.at(-1)?.revision).toBe(revision);
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

	it("reports the project config as a file", async () => {
		const root = await createProjectRoot();
		const { received, unsubscribe } = await subscribe(root);

		await writeFile(path.join(root, ".trickroom", "config.json"), "{}");

		await vi.waitFor(() => expect(received).toHaveLength(1), {
			timeout: 2_000,
		});
		expect(received[0]).toMatchObject({
			file: "config.json",
			operation: "changed",
		});
		unsubscribe();
	});

	it("reports edits to the system stylesheets the Tailwind caches read", async () => {
		const root = await createProjectRoot();
		await mkdir(path.join(root, "styles"), { recursive: true });
		const theme = path.join(root, "styles", "theme.css");
		const vendored = path.join(root, "node_modules", "pkg", "index.css");
		await mkdir(path.dirname(vendored), { recursive: true });
		await writeFile(theme, "@theme {}\n");
		await writeFile(vendored, "\n");
		// Read before the watcher starts, and after: both are watched.
		recordTailwindSourceFiles([theme]);
		const { received, unsubscribe } = await subscribe(root);
		const imported = path.join(root, "styles", "utilities.css");
		await writeFile(imported, "\n");
		recordTailwindSourceFiles([imported, vendored]);
		await new Promise((resolve) => setTimeout(resolve, 150));

		await writeFile(theme, "@theme { --color-brand: red; }\n");
		await writeFile(imported, "@utility card { padding: 1rem; }\n");
		await writeFile(vendored, "/* not watched */\n");

		await vi.waitFor(() => expect(received).toHaveLength(2), {
			timeout: 2_000,
		});
		expect(
			received.map(({ file, kind, operation }) => ({ file, kind, operation })),
		).toEqual(
			expect.arrayContaining([
				{
					file: "styles/theme.css",
					kind: "tailwind-source",
					operation: "changed",
				},
				{
					file: "styles/utilities.css",
					kind: "tailwind-source",
					operation: "changed",
				},
			]),
		);
		await new Promise((resolve) => setTimeout(resolve, 150));
		expect(received).toHaveLength(2);
		unsubscribe();
	});
});
