import { type ChildProcess, spawn } from "node:child_process";
import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { typeStrippingResolveHook } from "../test-utils/child-process-hooks";

// Separate Node processes contend for one lockfile through the real
// `withFileLock`, loaded through Node's TypeScript type stripping.
const lockModulePath = fileURLToPath(
	new URL("./design-file-lock.ts", import.meta.url),
);

// Holds the lock (for `holdMs`, or until killed with -1), or enters it
// once. Reports whether another process was inside at the same time and
// whether its fencing check still found its own token before leaving
// (`committed`), as a writer checks right before its rename. "serve"
// stays alive for a while after releasing, like a server process.
const worker = `
import { writeFileSync, rmSync, readdirSync } from "node:fs";
import path from "node:path";
const [lockUrl, lockPath, dir, label, mode, holdMs, staleAfterMs, acquireTimeoutMs] = process.argv.slice(2);
const { withFileLock } = await import(lockUrl);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const options = {
	staleAfterMs: Number(staleAfterMs),
	acquireTimeoutMs: Number(acquireTimeoutMs),
	retryDelayMs: 10,
};
try {
	const inside = await withFileLock(lockPath, async (lock) => {
		writeFileSync(path.join(dir, "inside-" + label), "");
		writeFileSync(path.join(dir, "held-" + label), "");
		if (mode === "hold" && Number(holdMs) < 0) {
			// Until killed: a timer keeps the event loop alive.
			setInterval(() => {}, 1000);
			await new Promise(() => {});
		}
		await sleep(mode === "enter" ? 300 : Number(holdMs));
		const others = readdirSync(dir).filter(
			(name) => name.startsWith("inside-") && name !== "inside-" + label,
		);
		rmSync(path.join(dir, "inside-" + label));
		const committed = await lock.assertHeld().then(() => true, () => false);
		return { overlap: others.length > 0, committed };
	}, options);
	writeFileSync(path.join(dir, "released-" + label), "");
	if (mode === "serve") await sleep(4000);
	console.log(JSON.stringify({ label, outcome: "acquired", ...inside }));
} catch (error) {
	console.log(JSON.stringify({ label, outcome: error.name }));
}
`;

// Choreographs the processes at the lockfile; every wait is bounded, so
// code that never reaches a step only loses time.
// - "race": two reclaimers of one dead lock both pass their re-read, then
//   "first" replaces the lock and "second" replaces it after.
// - "released": "reclaimer" reads the dead lock, then pauses until
//   "server" has reclaimed it; a move-aside reclaimer would put the
//   server's lock back only after the server released it.
const interleave = `
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import path from "node:path";

const { LOCK_PATH: lockPath, BARRIER_DIR: barrier, LABEL: label, SCENARIO: scenario } = process.env;
const promises = fs.promises;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const mark = (name) => promises.writeFile(path.join(barrier, name), "");
const until = async (ready, timeoutMs) => {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline && !(await ready())) await sleep(10);
};
const exists = (name) => () => fs.existsSync(path.join(barrier, name));
const once = new Set();
const first = (key) => !once.has(key) && once.add(key);

const rename = promises.rename;
promises.rename = async (from, to) => {
	if (scenario === "race" && String(to) === lockPath && first("replace")) {
		await mark("replace-" + label);
		await until(async () => (await promises.readdir(barrier)).filter((name) => name.startsWith("replace-")).length >= 2, 3000);
		if (label === "second") await until(exists("replaced-first"), 3000);
		const result = await rename(from, to);
		if (label === "first") await mark("replaced-first");
		return result;
	}
	return rename(from, to);
};
const readFile = promises.readFile;
promises.readFile = async (...args) => {
	const result = await readFile(...args);
	if (scenario === "released" && label === "reclaimer" && String(args[0]) === lockPath && first("read")) {
		await mark("read-reclaimer");
		await until(exists("held-server"), 4000);
	}
	return result;
};
const open = promises.open;
promises.open = async (target, flags, ...rest) => {
	if (scenario === "released" && label === "server" && String(target) === lockPath && first("open")) {
		await until(exists("read-reclaimer"), 4000);
	}
	return open(target, flags, ...rest);
};
const link = promises.link;
promises.link = async (from, to) => {
	if (scenario === "released" && label === "reclaimer") {
		await until(exists("released-server"), 3000);
	}
	return link(from, to);
};
syncBuiltinESMExports();
`;

type WorkerResult = {
	label: string;
	outcome: string;
	overlap?: boolean;
	committed?: boolean;
};

describe("file lock across processes", () => {
	let temp: string;
	let lockPath: string;
	let dir: string;
	let barrier: string;
	let hookPath: string;
	let interleavePath: string;
	let workerPath: string;
	const children: ChildProcess[] = [];

	beforeEach(async () => {
		temp = await mkdtemp(path.join(os.tmpdir(), "trickroom-file-lock-"));
		lockPath = path.join(temp, "lint-report.json.lock");
		// One folder for the workers' markers and the choreography's.
		dir = path.join(temp, "markers");
		barrier = dir;
		await mkdir(dir);
		hookPath = path.join(temp, "hook.mjs");
		interleavePath = path.join(temp, "interleave.mjs");
		workerPath = path.join(temp, "worker.mjs");
		await writeFile(hookPath, typeStrippingResolveHook, "utf8");
		await writeFile(interleavePath, interleave, "utf8");
		await writeFile(workerPath, worker, "utf8");
	});

	afterEach(async () => {
		for (const child of children.splice(0)) child.kill("SIGKILL");
		await rm(temp, { recursive: true, force: true });
	});

	const start = (
		label: string,
		mode: "hold" | "enter" | "serve",
		{
			holdMs = -1,
			staleAfterMs = 30_000,
			acquireTimeoutMs = 5_000,
			scenario = "",
		} = {},
	) => {
		const child = spawn(
			process.execPath,
			[
				"--no-warnings",
				"--import",
				pathToFileURL(hookPath).href,
				...(scenario ? ["--import", pathToFileURL(interleavePath).href] : []),
				workerPath,
				pathToFileURL(lockModulePath).href,
				lockPath,
				dir,
				label,
				mode,
				String(holdMs),
				String(staleAfterMs),
				String(acquireTimeoutMs),
			],
			{
				stdio: ["ignore", "pipe", "pipe"],
				env: {
					...process.env,
					LOCK_PATH: lockPath,
					BARRIER_DIR: barrier,
					LABEL: label,
					SCENARIO: scenario,
				},
			},
		);
		children.push(child);
		let stdout = "";
		let stderr = "";
		child.stdout?.on("data", (chunk) => {
			stdout += chunk;
		});
		child.stderr?.on("data", (chunk) => {
			stderr += chunk;
		});
		const result = new Promise<WorkerResult>((resolve, reject) => {
			child.on("error", reject);
			child.on("exit", (code, signal) => {
				if (signal) {
					resolve({ label, outcome: signal });
					return;
				}
				if (code !== 0) {
					reject(new Error(`${label} exited ${code}: ${stderr}`));
					return;
				}
				resolve(JSON.parse(stdout.trim().split("\n").at(-1) ?? ""));
			});
		});
		return { child, result };
	};

	const exists = (file: string) =>
		stat(file).then(
			() => true,
			() => false,
		);

	const waitFor = async (file: string) => {
		const deadline = Date.now() + 10_000;
		while (!(await exists(file))) {
			if (Date.now() > deadline) throw new Error(`no ${file}`);
			await new Promise((resolve) => setTimeout(resolve, 20));
		}
	};

	const deadLock = async () => {
		const holder = start("holder", "hold");
		await waitFor(path.join(dir, "held-holder"));
		holder.child.kill("SIGKILL");
		await expect(holder.result).resolves.toMatchObject({ outcome: "SIGKILL" });
		await rm(path.join(dir, "inside-holder"), { force: true });
		await rm(path.join(dir, "held-holder"), { force: true });
		expect(await exists(lockPath)).toBe(true);
	};

	const lockFilesLeft = async () =>
		(await readdir(temp)).filter((name) => name.includes(".lock"));

	it("lets only the last of two reclaimers of a dead holder's lock commit", async () => {
		await deadLock();
		// Both judged the dead lock and re-read it unchanged; both replace it,
		// "second" last.
		const [first, second] = await Promise.all([
			start("first", "enter", { scenario: "race" }).result,
			start("second", "enter", { scenario: "race" }).result,
		]);
		expect(second).toMatchObject({ outcome: "acquired", committed: true });
		// "first" was replaced: its fencing check fails, so it writes nothing.
		expect(first).toMatchObject({ outcome: "acquired", committed: false });
		// Its release did not remove the lock it no longer owned; the owner's
		// did. Nothing is left behind.
		expect(await lockFilesLeft()).toEqual([]);
	}, 60_000);

	it("never puts back a lock its owner released, so the next run gets it at once", async () => {
		await deadLock();
		const reclaimer = start("reclaimer", "enter", { scenario: "released" });
		const server = start("server", "serve", {
			holdMs: 1_000,
			scenario: "released",
		});
		// The server released its lock and stays alive.
		await waitFor(path.join(dir, "released-server"));
		await new Promise((resolve) => setTimeout(resolve, 300));
		const next = await start("next", "enter", { acquireTimeoutMs: 1_500 })
			.result;
		expect(next).toMatchObject({ outcome: "acquired", committed: true });
		await expect(server.result).resolves.toMatchObject({
			outcome: "acquired",
			overlap: false,
			committed: true,
		});
		await expect(reclaimer.result).resolves.toMatchObject({
			outcome: "acquired",
			overlap: false,
			committed: true,
		});
		expect(await lockFilesLeft()).toEqual([]);
	}, 60_000);

	it("never reclaims a live holder's lock, however long it holds it", async () => {
		// The holder outlives the contender's stale threshold several times.
		const holder = start("holder", "hold", {
			holdMs: 2_000,
			staleAfterMs: 200,
		});
		await waitFor(path.join(dir, "held-holder"));
		const contender = await start("contender", "enter", {
			staleAfterMs: 200,
			acquireTimeoutMs: 1_000,
		}).result;
		expect(contender).toEqual({
			label: "contender",
			outcome: "DesignFileLockTimeoutError",
		});
		await expect(holder.result).resolves.toEqual({
			label: "holder",
			outcome: "acquired",
			overlap: false,
			committed: true,
		});
	}, 60_000);
});
