import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { TrickroomDesign } from "../types";
import { createDesignFileService } from "./design-file-service";

// Separate Node processes stand in for the HTTP server and MCP stdio
// processes. They load the real service through Node's TypeScript type
// stripping; the hook only adds the extensions the source omits.
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
const [
	serviceUrl,
	projectRoot,
	lockDirectory,
	designId,
	mode,
	label,
	startAt,
	sharedRevision,
] = process.argv.slice(2);
const { createDesignFileService, DesignFileServiceError } = await import(serviceUrl);
const service = createDesignFileService(projectRoot, { lock: { lockDirectory } });

while (Date.now() < Number(startAt)) {}

const withBoardClass = (design, boardId, className) => ({
	...design,
	boards: design.boards.map((board) =>
		board.id === boardId
			? { ...board, props: { ...board.props, className } }
			: board,
	),
});

if (mode === "board" || mode === "same-board" || mode === "update-board") {
	// "board": a browser-style save of the whole design read at the shared
	// revision, changing only this writer's board. "same-board": the same,
	// but every writer changes board-0. "update-board": an MCP-style
	// read-modify-write of this writer's board against the shared revision.
	const boardId = mode === "same-board" ? "board-0" : label.replace("writer", "board");
	try {
		if (mode === "update-board") {
			const outcome = await service.updateDesignFile(designId, {
				expectedRevision: sharedRevision,
				mutate: async (read) => ({
					design: withBoardClass(read.design, boardId, label),
				}),
			});
			console.log(JSON.stringify({
				label,
				outcome: outcome.status === "written" ? "written" : "REVISION_MISMATCH",
			}));
		} else {
			const { design } = JSON.parse(process.env.SHARED_DESIGN);
			await service.writeDesignFile(
				designId,
				withBoardClass(design, boardId, label),
				{ expectedRevision: sharedRevision },
			);
			console.log(JSON.stringify({ label, outcome: "written" }));
		}
	} catch (error) {
		if (!(error instanceof DesignFileServiceError)) throw error;
		console.log(JSON.stringify({ label, outcome: error.code }));
	}
} else if (mode === "compete") {
	// Every worker writes against the revision the parent read, as if they
	// had all read the design before any of them wrote.
	const { design } = await service.readDesignFile(designId);
	try {
		await service.writeDesignFile(designId, { ...design, name: label }, {
			expectedRevision: sharedRevision,
		});
		console.log(JSON.stringify({ label, outcome: "written" }));
	} catch (error) {
		if (!(error instanceof DesignFileServiceError)) throw error;
		console.log(JSON.stringify({ label, outcome: error.code }));
	}
} else {
	// Read-modify-write with retry, the way MCP agents are told to recover
	// from a revision mismatch.
	let attempts = 0;
	for (;;) {
		attempts += 1;
		const { revision, design } = await service.readDesignFile(designId);
		const writers = design.name ? design.name.split(",") : [];
		try {
			await service.writeDesignFile(
				designId,
				{ ...design, name: [...writers, label].join(",") },
				{ expectedRevision: revision },
			);
			break;
		} catch (error) {
			if (error?.code !== "REVISION_MISMATCH") throw error;
		}
	}
	console.log(JSON.stringify({ label, outcome: "written", attempts }));
}
`;

const design: TrickroomDesign = {
	name: "",
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

type WorkerResult = { label: string; outcome: string; attempts?: number };

describe("concurrent design writers in separate processes", () => {
	let tempRoot: string;
	let projectRoot: string;
	let lockDirectory: string;
	let hookPath: string;
	let workerPath: string;

	beforeEach(async () => {
		tempRoot = await mkdtemp(path.join(os.tmpdir(), "trickroom-concurrency-"));
		projectRoot = path.join(tempRoot, "project");
		lockDirectory = path.join(tempRoot, "home", "locks", "designs");
		hookPath = path.join(tempRoot, "hook.mjs");
		workerPath = path.join(tempRoot, "worker.mjs");
		await writeFile(hookPath, resolveHook, "utf8");
		await writeFile(workerPath, worker, "utf8");
	});

	afterEach(async () => {
		await rm(tempRoot, { recursive: true, force: true });
	});

	const runWorkers = (
		mode: "compete" | "append" | "board" | "same-board" | "update-board",
		count: number,
		sharedRevision = "",
		sharedDesign?: TrickroomDesign,
		labels = Array.from({ length: count }, (_, index) => `writer-${index}`),
	) => {
		const startAt = Date.now() + 1_500;
		return Promise.all(
			Array.from({ length: count }, (_, index) => {
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
						"home",
						mode,
						labels[index] as string,
						String(startAt),
						sharedRevision,
					],
					{
						stdio: ["ignore", "pipe", "pipe"],
						env: {
							...process.env,
							SHARED_DESIGN: JSON.stringify({ design: sharedDesign ?? null }),
						},
					},
				);
				let stdout = "";
				let stderr = "";
				child.stdout.on("data", (chunk) => {
					stdout += chunk;
				});
				child.stderr.on("data", (chunk) => {
					stderr += chunk;
				});
				return new Promise<WorkerResult>((resolve, reject) => {
					child.on("error", reject);
					child.on("exit", (code) => {
						if (code !== 0) {
							reject(new Error(`worker ${index} exited ${code}: ${stderr}`));
							return;
						}
						resolve(JSON.parse(stdout.trim()) as WorkerResult);
					});
				});
			}),
		);
	};

	const storedName = async () =>
		(
			await createDesignFileService(projectRoot, {
				lock: { lockDirectory },
			}).readDesignFile("home")
		).design.name;

	it("lets exactly one writer win from a shared revision", async () => {
		const { revision } = await createDesignFileService(projectRoot, {
			lock: { lockDirectory },
		}).createDesignFile("home", design);

		const results = await runWorkers("compete", 6, revision);

		const winners = results.filter((result) => result.outcome === "written");
		const losers = results.filter((result) => result.outcome !== "written");
		expect(winners).toHaveLength(1);
		expect(losers.map((result) => result.outcome)).toEqual(
			Array(5).fill("REVISION_MISMATCH"),
		);
		await expect(storedName()).resolves.toBe(winners[0]?.label);
	}, 30_000);

	it("loses no update when writers retry on mismatch", async () => {
		await createDesignFileService(projectRoot, {
			lock: { lockDirectory },
		}).createDesignFile("home", design);

		const results = await runWorkers("append", 6);

		const writers = (await storedName()).split(",").sort();
		expect(writers).toEqual(results.map((result) => result.label).sort());
	}, 30_000);

	const boardsDesign = (count: number): TrickroomDesign => ({
		name: "Boards",
		boards: Array.from({ length: count }, (_, index) => ({
			...(design.boards[0] as TrickroomDesign["boards"][number]),
			id: `board-${index}`,
		})),
	});

	const boardClasses = async () =>
		(
			await createDesignFileService(projectRoot, {
				lock: { lockDirectory },
			}).readDesignFile("home")
		).design.boards.map((board) => board.props.className ?? null);

	it("lets writers on different boards all win from a shared revision", async () => {
		const created = await createDesignFileService(projectRoot, {
			lock: { lockDirectory },
		}).createDesignFile("home", boardsDesign(4));

		const results = await runWorkers(
			"board",
			4,
			created.revision,
			created.design,
		);

		expect(results.map((result) => result.outcome)).toEqual(
			Array(4).fill("written"),
		);
		await expect(boardClasses()).resolves.toEqual([
			"writer-0",
			"writer-1",
			"writer-2",
			"writer-3",
		]);
	}, 30_000);

	it("lets exactly one writer of the same board win from a shared revision", async () => {
		const created = await createDesignFileService(projectRoot, {
			lock: { lockDirectory },
		}).createDesignFile("home", boardsDesign(2));

		const results = await runWorkers(
			"same-board",
			5,
			created.revision,
			created.design,
		);

		const winners = results.filter((result) => result.outcome === "written");
		expect(winners).toHaveLength(1);
		expect(
			results.filter((result) => result.outcome === "REVISION_MISMATCH"),
		).toHaveLength(4);
		await expect(boardClasses()).resolves.toEqual([winners[0]?.label, null]);
	}, 30_000);

	it("keeps both a browser save of one board and an agent update of another", async () => {
		const service = createDesignFileService(projectRoot, {
			lock: { lockDirectory },
		});
		const created = await service.createDesignFile("home", boardsDesign(2));

		// The browser autosaves board 0 through a whole-design PUT while an
		// agent updates board 1 through MCP, both from the same read.
		const [browser, agent] = await Promise.all([
			runWorkers("board", 1, created.revision, created.design, ["writer-0"]),
			runWorkers("update-board", 1, created.revision, created.design, [
				"writer-1",
			]),
		]);

		expect([browser[0]?.outcome, agent[0]?.outcome]).toEqual([
			"written",
			"written",
		]);
		await expect(boardClasses()).resolves.toEqual(["writer-0", "writer-1"]);
	}, 30_000);
});
