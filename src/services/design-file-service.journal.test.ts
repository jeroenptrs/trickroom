import { spawn } from "node:child_process";
import {
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Node, TrickroomDesign } from "../types";
import { createDesignFileService } from "./design-file-service";

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

const leaf = (id: string): Node => ({
	id,
	props: {
		"data-trickroom-name": id,
		"data-trickroom-library": "trickroom",
		"data-trickroom-component": "text",
		"data-trickroom-role": "text",
	},
	children: id,
});

const before: TrickroomDesign = {
	name: "Journal",
	boards: [board("a", [leaf("moved")]), board("b"), board("c")],
};

// Moves a layer from board a to board b, deletes board c and renames the
// design: four files change (a, b, c, design.json).
const after = (design: TrickroomDesign): TrickroomDesign => ({
	...design,
	name: "Journal after",
	boards: [board("a"), board("b", [leaf("moved")])],
});

class SimulatedCrash extends Error {}

/** The design without its write time, which every write sets anew. */
const content = ({ updatedAt: _updatedAt, ...design }: TrickroomDesign) =>
	design;

describe("journaled multi-file writes", () => {
	let tempRoot: string;
	let projectRoot: string;
	let lockDirectory: string;

	beforeEach(async () => {
		tempRoot = await mkdtemp(path.join(os.tmpdir(), "trickroom-journal-"));
		projectRoot = path.join(tempRoot, "project");
		lockDirectory = path.join(tempRoot, "home", "locks", "designs");
	});

	afterEach(async () => {
		await rm(tempRoot, { recursive: true, force: true });
	});

	const service = (journalHooks = {}) =>
		createDesignFileService(projectRoot, {
			lock: { lockDirectory },
			journalHooks,
		});
	const designFolder = () =>
		path.join(projectRoot, ".trickroom", "designs", "doc");
	const journalPath = () => path.join(designFolder(), ".journal.json");

	const exists = (filePath: string) =>
		stat(filePath).then(
			() => true,
			() => false,
		);

	it("writes several files through a journal and removes it", async () => {
		const created = await service().createDesignFile("doc", before);
		let journalSeen = false;

		const written = await service({
			afterJournalWritten: async () => {
				journalSeen = await exists(journalPath());
			},
		}).writeDesignFile("doc", after(created.design), {
			expectedRevision: created.revision,
		});

		expect(journalSeen).toBe(true);
		await expect(exists(journalPath())).resolves.toBe(false);
		await expect(readdir(path.join(designFolder(), "boards"))).resolves.toEqual(
			["a.json", "b.json"],
		);
		await expect(service().readDesignFile("doc")).resolves.toMatchObject({
			design: written.design,
			revision: written.revision,
		});
	});

	it("writes a single changed file directly, without a journal", async () => {
		const created = await service().createDesignFile("doc", before);
		let journalWritten = false;

		await service({
			afterJournalWritten: () => {
				journalWritten = true;
			},
		}).writeDesignFile(
			"doc",
			{ ...created.design, name: "Renamed" },
			{ expectedRevision: created.revision },
		);

		expect(journalWritten).toBe(false);
	});

	it("writes one changed board and the new updatedAt without a journal", async () => {
		const created = await createDesignFileService(projectRoot, {
			lock: { lockDirectory },
			now: () => new Date("2026-10-01T10:00:00.000Z"),
		}).createDesignFile("doc", before);
		let journalWritten = false;
		const steps: number[] = [];

		const written = await createDesignFileService(projectRoot, {
			lock: { lockDirectory },
			now: () => new Date("2026-10-02T10:00:00.000Z"),
			journalHooks: {
				afterJournalWritten: () => {
					journalWritten = true;
				},
				afterStep: (step: number) => {
					steps.push(step);
				},
			},
		}).writeDesignFile(
			"doc",
			{
				...created.design,
				boards: [
					board("a", [leaf("moved")]),
					board("b", [leaf("new")]),
					board("c"),
				],
			},
			{ expectedRevision: created.revision },
		);

		expect(journalWritten).toBe(false);
		// The board file is the only step; the manifest follows on its own.
		expect(steps).toEqual([1]);
		expect(written.design.updatedAt).toBe("2026-10-02T10:00:00.000Z");
		const read = await service().readDesignFile("doc");
		expect(read.design.updatedAt).toBe("2026-10-02T10:00:00.000Z");
		expect(read.revision).toBe(written.revision);
		await expect(exists(journalPath())).resolves.toBe(false);
	});

	// Step 0 is right after the journal is in place; steps 1-4 follow each
	// applied file (writes of a, b and design.json, then the unlink of c).
	for (const crashAfter of [0, 1, 2, 3, 4]) {
		it(`recovers the new state when a write stops after step ${crashAfter}`, async () => {
			const created = await service().createDesignFile("doc", before);
			const crash = () => {
				throw new SimulatedCrash();
			};
			const hooks =
				crashAfter === 0
					? { afterJournalWritten: crash }
					: {
							afterStep: (step: number) => {
								if (step === crashAfter) crash();
							},
						};

			await expect(
				service(hooks).writeDesignFile("doc", after(created.design), {
					expectedRevision: created.revision,
				}),
			).rejects.toBeInstanceOf(SimulatedCrash);
			await expect(exists(journalPath())).resolves.toBe(true);

			// The next reader replays the journal under the lock.
			const read = await service().readDesignFile("doc");
			expect(content(read.design)).toEqual(content(after(created.design)));
			expect(read.design.updatedAt).toEqual(expect.any(String));
			await expect(exists(journalPath())).resolves.toBe(false);
			await expect(
				readdir(path.join(designFolder(), "boards")),
			).resolves.toEqual(["a.json", "b.json"]);
		});
	}

	it("keeps the old state when a write stops before its journal is in place", async () => {
		const created = await service().createDesignFile("doc", before);
		// What an interrupted journal write leaves: a temporary file only.
		await writeFile(
			path.join(designFolder(), ".journal.json.123.tmp"),
			'{"version":1,',
			"utf8",
		);

		await expect(service().readDesignFile("doc")).resolves.toMatchObject({
			design: created.design,
			revision: created.revision,
		});
		await expect(service().listDesignSummaries()).resolves.toEqual([
			expect.objectContaining({ uuid: "doc", revision: created.revision }),
		]);
	});

	it("drops a journal that was never completed", async () => {
		const created = await service().createDesignFile("doc", before);
		await writeFile(
			journalPath(),
			'{"version":1,"designId":"doc","wri',
			"utf8",
		);

		await expect(service().readDesignFile("doc")).resolves.toMatchObject({
			revision: created.revision,
		});
		await expect(exists(journalPath())).resolves.toBe(false);
	});

	it("replays before the next write, so the write sees the recovered state", async () => {
		const created = await service().createDesignFile("doc", before);
		await expect(
			service({
				afterStep: (step: number) => {
					if (step === 2) throw new SimulatedCrash();
				},
			}).writeDesignFile("doc", after(created.design), {
				expectedRevision: created.revision,
			}),
		).rejects.toBeInstanceOf(SimulatedCrash);

		// A writer that read before the interrupted write is stale on boards a
		// and b, which the recovered write changed.
		await expect(
			service().writeDesignFile(
				"doc",
				{ ...created.design, boards: [board("a"), board("b"), board("c")] },
				{ expectedRevision: created.revision },
			),
		).rejects.toMatchObject({
			code: "REVISION_MISMATCH",
			mismatch: { staleBoardIds: ["a"] },
		});
		await expect(exists(journalPath())).resolves.toBe(false);
	});

	it("refuses a journal that names files outside the design", async () => {
		await service().createDesignFile("doc", before);
		await writeFile(
			journalPath(),
			JSON.stringify({
				version: 1,
				designId: "doc",
				writes: [{ path: "../config.json", contents: "{}" }],
				unlinks: [],
			}),
			"utf8",
		);

		await expect(service().readDesignFile("doc")).rejects.toThrow(
			/outside the design/,
		);
		await expect(
			readFile(path.join(projectRoot, ".trickroom", "config.json"), "utf8"),
		).rejects.toMatchObject({ code: "ENOENT" });
	});

	describe("in a process that is killed mid-write", () => {
		const servicePath = fileURLToPath(
			new URL("./design-file-service.ts", import.meta.url),
		);
		const resolveHook = `
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";

registerHooks({
	resolve(specifier, context, next) {
		if (specifier.startsWith(".") && context.parentURL?.startsWith("file:")) {
			const url = new URL(specifier, context.parentURL);
			const filePath = fileURLToPath(url);
			if (!existsSync(filePath) || !/\\.[cm]?[jt]s$/.test(filePath)) {
				for (const extension of [".ts", "/index.ts"]) {
					if (existsSync(filePath + extension)) {
						return next(url.href + extension, context);
					}
				}
			}
		}
		return next(specifier, context);
	},
});
`;
		const worker = `
const [serviceUrl, projectRoot, lockDirectory, killAfter, designJson, expectedRevision] =
	process.argv.slice(2);
const { createDesignFileService } = await import(serviceUrl);
const kill = () => process.kill(process.pid, "SIGKILL");
const service = createDesignFileService(projectRoot, {
	lock: { lockDirectory },
	journalHooks: Number(killAfter) === 0
		? { afterJournalWritten: kill }
		: { afterStep: (step) => { if (step === Number(killAfter)) kill(); } },
});
await service.writeDesignFile("doc", JSON.parse(designJson), { expectedRevision });
`;

		for (const killAfter of [0, 2, 4]) {
			it(`recovers after SIGKILL at step ${killAfter}`, async () => {
				const hookPath = path.join(tempRoot, "hook.mjs");
				const workerPath = path.join(tempRoot, "worker.mjs");
				await mkdir(tempRoot, { recursive: true });
				await writeFile(hookPath, resolveHook, "utf8");
				await writeFile(workerPath, worker, "utf8");
				const created = await service().createDesignFile("doc", before);

				const signal = await new Promise<NodeJS.Signals | null>(
					(resolve, reject) => {
						const child = spawn(
							process.execPath,
							[
								"--no-warnings",
								"--import",
								pathToFileURL(hookPath).href,
								workerPath,
								pathToFileURL(servicePath).href,
								projectRoot,
								lockDirectory,
								String(killAfter),
								JSON.stringify(after(created.design)),
								created.revision,
							],
							{ stdio: ["ignore", "ignore", "pipe"] },
						);
						let stderr = "";
						child.stderr.on("data", (chunk) => {
							stderr += chunk;
						});
						child.on("error", reject);
						child.on("exit", (code, exitSignal) => {
							if (exitSignal === null && code !== 0) {
								reject(new Error(stderr));
								return;
							}
							resolve(exitSignal);
						});
					},
				);

				expect(signal).toBe("SIGKILL");
				await expect(exists(journalPath())).resolves.toBe(true);
				// The dead writer's lockfile is broken and the journal replayed.
				const read = await service().readDesignFile("doc");
				expect(content(read.design)).toEqual(content(after(created.design)));
				expect(read.design.updatedAt).toEqual(expect.any(String));
				await expect(exists(journalPath())).resolves.toBe(false);
			}, 30_000);
		}
	});
});
