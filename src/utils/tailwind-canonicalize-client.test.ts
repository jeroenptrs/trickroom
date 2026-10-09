import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { canonicalizeTailwindCandidatesInWorker } from "./tailwind-canonicalize-client";

const tempProjectRoots: string[] = [];

const createProject = async (css: string) => {
	const projectRoot = await mkdtemp(
		path.join(process.cwd(), ".tmp-tailwind-canonicalize-"),
	);
	tempProjectRoots.push(projectRoot);
	await mkdir(path.join(projectRoot, "src"), { recursive: true });
	await writeFile(path.join(projectRoot, "src", "index.css"), css, "utf8");
	return { projectRoot, cssPath: "src/index.css" };
};

afterEach(() =>
	Promise.all(
		tempProjectRoots
			.splice(0)
			.map((projectRoot) => rm(projectRoot, { force: true, recursive: true })),
	),
);

/**
 * Runs `work` under a 10 ms heartbeat and reports the longest stretch the
 * event loop went without running it. The stretch still open when `work`
 * settles counts too, so a block at the very end is not missed.
 */
const measureEventLoop = async <Result>(work: () => Promise<Result>) => {
	let last = performance.now();
	let longestGap = 0;
	const interval = setInterval(() => {
		const now = performance.now();
		longestGap = Math.max(longestGap, now - last);
		last = now;
	}, 10);
	const started = performance.now();
	try {
		const result = await work();
		const settled = performance.now();
		return {
			result,
			longestGap: Math.max(longestGap, settled - last),
			elapsed: settled - started,
		};
	} finally {
		clearInterval(interval);
	}
};

/** No stall longer than half the wait (a cold build takes seconds), allowing for a loaded machine. */
const stayedResponsive = ({
	longestGap,
	elapsed,
}: {
	longestGap: number;
	elapsed: number;
}) => longestGap < Math.max(500, elapsed / 2);

describe("measureEventLoop", () => {
	it("catches a synchronous block after an asynchronous wait", async () => {
		const measured = await measureEventLoop(async () => {
			await new Promise((resolve) => setTimeout(resolve, 300));
			const until = performance.now() + 1_200;
			while (performance.now() < until) {
				// The block the worker exists to keep off the main thread.
			}
		});
		expect(measured.longestGap).toBeGreaterThanOrEqual(1_150);
		expect(stayedResponsive(measured)).toBe(false);
	});
});

describe("canonicalizeTailwindCandidatesInWorker", () => {
	it("keeps the event loop free while a cold system builds its tables", async () => {
		const system = await createProject('@import "tailwindcss";\n');
		let zeroDelayFired = false;
		const measured = await measureEventLoop(() => {
			const pending = canonicalizeTailwindCandidatesInWorker(system, [
				"bg-[#FFF]",
				"p-2",
			]);
			setTimeout(() => {
				zeroDelayFired = true;
			}, 0);
			return pending;
		});
		expect(measured.result).toEqual(["bg-white", "p-2"]);
		expect(zeroDelayFired).toBe(true);
		expect(stayedResponsive(measured)).toBe(true);
	}, 30_000);

	it("recomputes after the system CSS changes", async () => {
		const system = await createProject('@import "tailwindcss";\n');
		expect(
			await canonicalizeTailwindCandidatesInWorker(system, ["bg-[#123456]"]),
		).toEqual(["bg-[#123456]"]);
		await writeFile(
			path.join(system.projectRoot, system.cssPath),
			'@import "tailwindcss";\n@theme {\n\t--color-brand: #123456;\n}\n',
			"utf8",
		);
		expect(
			await canonicalizeTailwindCandidatesInWorker(system, ["bg-[#123456]"]),
		).toEqual(["bg-brand"]);
	}, 30_000);

	it("rejects when the system CSS cannot be loaded, and keeps serving", async () => {
		const system = await createProject('@import "tailwindcss";\n');
		await expect(
			canonicalizeTailwindCandidatesInWorker(
				{ projectRoot: system.projectRoot, cssPath: "src/missing.css" },
				["p-2"],
			),
		).rejects.toThrow();
		expect(
			await canonicalizeTailwindCandidatesInWorker(system, ["p-2"]),
		).toEqual(["p-2"]);
	}, 30_000);
});

describe("createCanonicalizeClient", () => {
	/** A stand-in worker: echoes, or throws an uncaught error on "crash". */
	const CRASHING_WORKER = `import { parentPort } from "node:worker_threads";
parentPort.on("message", (request) => {
	if (request.candidates[0] === "crash") {
		setImmediate(() => { throw new Error("worker crashed"); });
		return;
	}
	parentPort.postMessage({ id: request.id, ok: true, results: request.candidates });
});
`;

	it("keeps a crashed worker's later events off its replacement, and lets the process exit", async () => {
		const folder = await mkdtemp(
			path.join(tmpdir(), "trickroom-canonicalize-"),
		);
		try {
			const workerFile = path.join(folder, "worker.mjs");
			await writeFile(workerFile, CRASHING_WORKER, "utf8");
			const clientUrl = pathToFileURL(
				path.join(import.meta.dirname, "tailwind-canonicalize-client.ts"),
			).href;
			// The old worker's "exit" arrives after the retry started its
			// replacement; it must neither reject the retry nor keep the
			// replacement referenced. The script ends without exiting itself.
			const script = path.join(folder, "run.mjs");
			await writeFile(
				script,
				`const { createCanonicalizeClient } = await import(${JSON.stringify(clientUrl)});
const client = createCanonicalizeClient(${JSON.stringify(workerFile)});
const system = { projectRoot: "/project", cssPath: "app.css" };
await client.canonicalize(system, ["crash"]).then(
	() => console.log("first: resolved"),
	(error) => console.log("first: rejected " + error.message),
);
await client.canonicalize(system, ["p-2"]).then(
	(results) => console.log("retry: " + JSON.stringify(results)),
	(error) => console.log("retry: rejected " + error.message),
);
`,
				"utf8",
			);
			const child = spawn(process.execPath, [script], {
				stdio: ["ignore", "pipe", "pipe"],
			});
			let output = "";
			child.stdout.on("data", (chunk) => {
				output += chunk;
			});
			child.stderr.on("data", (chunk) => {
				output += chunk;
			});
			const exitCode = await new Promise<number | string>((resolve) => {
				const timer = setTimeout(() => {
					child.kill();
					resolve("did not exit");
				}, 10_000);
				child.on("exit", (code) => {
					clearTimeout(timer);
					resolve(code ?? "signal");
				});
			});
			expect(output).toBe('first: rejected worker crashed\nretry: ["p-2"]\n');
			expect(exitCode).toBe(0);
		} finally {
			await rm(folder, { force: true, recursive: true });
		}
	}, 20_000);
});
