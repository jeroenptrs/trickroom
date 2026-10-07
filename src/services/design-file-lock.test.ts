import { spawn } from "node:child_process";
import {
	mkdir,
	mkdtemp,
	readdir,
	rm,
	utimes,
	writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	DesignFileLockTimeoutError,
	getDesignFileLockPath,
	withDesignFileLock,
} from "./design-file-lock";

const designPath = "/project/.trickroom/designs/home.json";

const findDeadPid = async () => {
	// A process that has exited and been reaped leaves its pid unused.
	const child = spawn(process.execPath, ["-e", ""]);
	await new Promise((resolve) => child.on("exit", resolve));
	return child.pid as number;
};

describe("design file lock", () => {
	let lockDirectory: string;
	let lockPath: string;

	beforeEach(async () => {
		lockDirectory = await mkdtemp(path.join(os.tmpdir(), "trickroom-lock-"));
		lockPath = getDesignFileLockPath(lockDirectory, designPath);
	});

	afterEach(async () => {
		await rm(lockDirectory, { recursive: true, force: true });
	});

	const writeHolder = async (holder: Record<string, unknown>) => {
		await mkdir(lockDirectory, { recursive: true });
		await writeFile(lockPath, JSON.stringify(holder), "utf8");
	};

	it("serialises operations on one design within a process", async () => {
		const events: string[] = [];
		const run = (label: string, delayMs: number) =>
			withDesignFileLock(
				designPath,
				async () => {
					events.push(`${label}:start`);
					await new Promise((resolve) => setTimeout(resolve, delayMs));
					events.push(`${label}:end`);
				},
				{ lockDirectory },
			);

		await Promise.all([run("a", 20), run("b", 0), run("c", 0)]);

		expect(events).toEqual([
			"a:start",
			"a:end",
			"b:start",
			"b:end",
			"c:start",
			"c:end",
		]);
		await expect(readdir(lockDirectory)).resolves.toEqual([]);
	});

	it("releases the lock when the operation throws", async () => {
		await expect(
			withDesignFileLock(
				designPath,
				async () => {
					throw new Error("boom");
				},
				{ lockDirectory },
			),
		).rejects.toThrow("boom");

		await expect(
			withDesignFileLock(designPath, async () => "next", { lockDirectory }),
		).resolves.toBe("next");
	});

	it("waits for a live holder and gives up after the timeout", async () => {
		await writeHolder({
			pid: process.ppid,
			hostname: os.hostname(),
			token: "other",
			acquiredAt: Date.now(),
		});

		const error = await withDesignFileLock(designPath, async () => "never", {
			lockDirectory,
			acquireTimeoutMs: 60,
		}).catch((caught: unknown) => caught);

		expect(error).toBeInstanceOf(DesignFileLockTimeoutError);
		await expect(readdir(lockDirectory)).resolves.toEqual([
			path.basename(lockPath),
		]);
	});

	it("breaks a lock whose holder process is gone", async () => {
		await writeHolder({
			pid: await findDeadPid(),
			hostname: os.hostname(),
			token: "dead",
			acquiredAt: Date.now(),
		});

		await expect(
			withDesignFileLock(designPath, async () => "acquired", {
				lockDirectory,
				acquireTimeoutMs: 1_000,
			}),
		).resolves.toBe("acquired");
	});

	it("never breaks a live holder's lock, however old", async () => {
		await writeHolder({
			pid: process.ppid,
			hostname: os.hostname(),
			token: "old",
			acquiredAt: Date.now() - 60_000,
		});

		await expect(
			withDesignFileLock(designPath, async () => "acquired", {
				lockDirectory,
				staleAfterMs: 1_000,
				acquireTimeoutMs: 100,
			}),
		).rejects.toBeInstanceOf(DesignFileLockTimeoutError);
	});

	it("falls back to age for a holder on another host, whose pid it cannot check", async () => {
		await writeHolder({
			pid: process.ppid,
			hostname: `${os.hostname()}-elsewhere`,
			token: "remote",
			acquiredAt: Date.now() - 60_000,
		});

		await expect(
			withDesignFileLock(designPath, async () => "acquired", {
				lockDirectory,
				staleAfterMs: 1_000,
				acquireTimeoutMs: 1_000,
			}),
		).resolves.toBe("acquired");
	});

	it("only breaks an unreadable lock once it is old", async () => {
		await mkdir(lockDirectory, { recursive: true });
		await writeFile(lockPath, "", "utf8");

		await expect(
			withDesignFileLock(designPath, async () => "acquired", {
				lockDirectory,
				staleAfterMs: 5_000,
				acquireTimeoutMs: 60,
			}),
		).rejects.toBeInstanceOf(DesignFileLockTimeoutError);

		const past = new Date(Date.now() - 60_000);
		await utimes(lockPath, past, past);
		await expect(
			withDesignFileLock(designPath, async () => "acquired", {
				lockDirectory,
				staleAfterMs: 5_000,
				acquireTimeoutMs: 1_000,
			}),
		).resolves.toBe("acquired");
	});

	it("does not remove a lock that was replaced while the operation ran", async () => {
		await withDesignFileLock(
			designPath,
			async () => {
				await writeFile(
					lockPath,
					JSON.stringify({ pid: process.ppid, token: "replacement" }),
					"utf8",
				);
			},
			{ lockDirectory },
		);

		await expect(readdir(lockDirectory)).resolves.toEqual([
			path.basename(lockPath),
		]);
	});

	it("reclaims only through the reclaim lock, never past a live reclaimer, and removes an abandoned one", async () => {
		const reclaimPath = lockPath.replace(/\.lock$/u, ".reclaim");
		const deadHolder = async () =>
			writeHolder({
				pid: await findDeadPid(),
				hostname: os.hostname(),
				token: "dead",
				acquiredAt: Date.now(),
			});
		const attempt = (acquireTimeoutMs: number) =>
			withDesignFileLock(designPath, async () => "acquired", {
				lockDirectory,
				acquireTimeoutMs,
			});

		// Another process is inside the reclaim section: wait, however old.
		await deadHolder();
		await writeFile(
			reclaimPath,
			JSON.stringify({
				pid: process.ppid,
				hostname: os.hostname(),
				token: "reclaiming",
				acquiredAt: Date.now() - 60_000,
			}),
		);
		await expect(attempt(100)).rejects.toBeInstanceOf(
			DesignFileLockTimeoutError,
		);

		// An unreadable reclaim lock (a crash while creating it) is removed
		// only once it is older than 10 seconds.
		await writeFile(reclaimPath, "");
		await expect(attempt(100)).rejects.toBeInstanceOf(
			DesignFileLockTimeoutError,
		);
		const past = new Date(Date.now() - 11_000);
		await utimes(reclaimPath, past, past);
		await expect(attempt(1_000)).resolves.toBe("acquired");
		await expect(readdir(lockDirectory)).resolves.toEqual([]);
	});

	it("keys locks by design path", () => {
		expect(getDesignFileLockPath(lockDirectory, designPath)).not.toBe(
			getDesignFileLockPath(lockDirectory, `${designPath}.other`),
		);
		expect(path.dirname(lockPath)).toBe(lockDirectory);
	});
});
