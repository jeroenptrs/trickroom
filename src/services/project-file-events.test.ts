import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
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

describe("project file events", () => {
	it("filters to design JSON and system-owned files", () => {
		expect(isWatchedTrickroomFile("designs/home.json")).toBe(true);
		expect(isWatchedTrickroomFile("designs/home.memory.json")).toBe(true);
		expect(isWatchedTrickroomFile("designs/.gitkeep")).toBe(false);
		expect(isWatchedTrickroomFile("systems/core/tokens.json")).toBe(true);
		expect(isWatchedTrickroomFile("config.json")).toBe(false);
	});

	it("broadcasts a debounced content revision to every subscriber", async () => {
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
		expect(first[0]).toMatchObject({
			file: "designs/home.json",
			operation: "changed",
		});
		expect(first[0]?.revision).toMatch(/^sha256:[a-f0-9]{64}$/);

		unsubscribeFirst();
		unsubscribeSecond();
	});

	it("emits a null revision after deletion", async () => {
		const root = await createProjectRoot();
		const designPath = path.join(root, ".trickroom", "designs", "deleted.json");
		const events = new ProjectFileEvents(20);
		const received: TrickroomFileEvent[] = [];
		events.setProjectRoot(root);
		const unsubscribe = events.subscribe((event) => received.push(event));
		await new Promise((resolve) => setTimeout(resolve, 75));
		await writeFile(designPath, '{"name":"Delete me","boards":[]}');
		await vi.waitFor(() => expect(received).toHaveLength(1), {
			timeout: 2_000,
		});
		received.length = 0;

		await rm(designPath);

		await vi.waitFor(() => expect(received).toHaveLength(1), {
			timeout: 2_000,
		});
		expect(received[0]).toEqual({
			file: "designs/deleted.json",
			operation: "deleted",
			revision: null,
		});
		unsubscribe();
	});
});
