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
// once and reports whether another process was inside at the same time.
const worker = `
import { existsSync, writeFileSync, rmSync, readdirSync } from "node:fs";
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
	const overlap = await withFileLock(lockPath, async () => {
		writeFileSync(path.join(dir, "inside-" + label), "");
		if (mode === "hold") {
			writeFileSync(path.join(dir, "held-" + label), "");
			// Until killed: a timer keeps the event loop alive.
			if (Number(holdMs) < 0) setInterval(() => {}, 1000);
			await (Number(holdMs) < 0 ? new Promise(() => {}) : sleep(Number(holdMs)));
		} else {
			await sleep(300);
		}
		const others = readdirSync(dir).filter(
			(name) => name.startsWith("inside-") && name !== "inside-" + label,
		);
		rmSync(path.join(dir, "inside-" + label));
		return others.length > 0;
	}, options);
	console.log(JSON.stringify({ label, outcome: "acquired", overlap }));
} catch (error) {
	console.log(JSON.stringify({ label, outcome: error.name }));
}
`;

// Interleaves two reclaimers of one abandoned lock: each waits at its first
// reclaim of the lockfile (a rename or unlink of it) until both are there,
// and "second" then waits until "first" has created its replacement lock.
const interleave = `
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import path from "node:path";

const { LOCK_PATH: lockPath, BARRIER_DIR: barrier, LABEL: label } = process.env;
const promises = fs.promises;
const until = async (ready, timeoutMs) => {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline && !(await ready())) {
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
};
let reclaimed = false;
const atReclaim = async (target) => {
	if (String(target) !== lockPath || reclaimed) return;
	reclaimed = true;
	await promises.writeFile(path.join(barrier, "reclaim-" + label), "");
	await until(async () => (await promises.readdir(barrier)).filter((name) => name.startsWith("reclaim-")).length >= 2, 3000);
	if (label === "second") {
		await until(() => fs.existsSync(path.join(barrier, "created-first")), 3000);
	}
};
const rename = promises.rename;
promises.rename = async (from, to) => {
	await atReclaim(from);
	return rename(from, to);
};
const unlink = promises.unlink;
promises.unlink = async (target) => {
	await atReclaim(target);
	return unlink(target);
};
const open = promises.open;
promises.open = async (target, flags, ...rest) => {
	const handle = await open(target, flags, ...rest);
	if (String(target) === lockPath && flags === "wx" && label === "first") {
		await promises.writeFile(path.join(barrier, "created-first"), "");
	}
	return handle;
};
syncBuiltinESMExports();
`;

type WorkerResult = {
	label: string;
	outcome: string;
	overlap?: boolean;
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
		dir = path.join(temp, "inside");
		barrier = path.join(temp, "barrier");
		await mkdir(dir);
		await mkdir(barrier);
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
		mode: "hold" | "enter",
		{
			holdMs = -1,
			staleAfterMs = 30_000,
			acquireTimeoutMs = 5_000,
			interleaved = false,
		} = {},
	) => {
		const child = spawn(
			process.execPath,
			[
				"--no-warnings",
				"--import",
				pathToFileURL(hookPath).href,
				...(interleaved
					? ["--import", pathToFileURL(interleavePath).href]
					: []),
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

	it("lets one of two processes reclaim a dead holder's lock, never both at once", async () => {
		const holder = start("holder", "hold");
		await waitFor(path.join(dir, "held-holder"));
		holder.child.kill("SIGKILL");
		await expect(holder.result).resolves.toMatchObject({ outcome: "SIGKILL" });
		await rm(path.join(dir, "inside-holder"), { force: true });
		expect(await exists(lockPath)).toBe(true);

		const [first, second] = await Promise.all([
			start("first", "enter", { interleaved: true }).result,
			start("second", "enter", { interleaved: true }).result,
		]);
		expect(first).toEqual({
			label: "first",
			outcome: "acquired",
			overlap: false,
		});
		expect(second).toEqual({
			label: "second",
			outcome: "acquired",
			overlap: false,
		});
		// Both released; nothing set aside is left behind.
		expect(await readdir(temp)).not.toContainEqual(
			expect.stringContaining(".lock"),
		);
	}, 60_000);
});
