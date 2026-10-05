import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, stat, unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/**
 * Serialises design writes per design file, within a process and across
 * processes (the HTTP server and every MCP stdio process write through the
 * same service). Not design-specific: any file every process rewrites can
 * take a lock keyed by its path (the project registry does).
 *
 * In-process callers wait on a promise queue keyed by design. The queue head
 * then takes a lockfile created with `open(path, "wx")`, so only one process
 * can hold it. Lockfiles live outside the project (by default under the
 * Trickroom home) so they are never committed and never seen by the project
 * file watchers.
 */

export type DesignFileLockOptions = {
	/** Directory holding lockfiles. */
	lockDirectory: string;
	/** Names the lock in timeout messages; defaults to "design file". */
	label?: string;
	/** A lock older than this is considered abandoned. */
	staleAfterMs?: number;
	/** Give up acquiring after this long. */
	acquireTimeoutMs?: number;
	/** Base delay between acquisition attempts; jitter is added. */
	retryDelayMs?: number;
};

type LockContents = {
	pid: number;
	hostname: string;
	token: string;
	acquiredAt: number;
	designPath: string;
};

export class DesignFileLockTimeoutError extends Error {
	readonly lockPath: string;

	constructor(
		lockPath: string,
		holder: Partial<LockContents> | null,
		label = "design file",
	) {
		super(
			holder?.pid !== undefined
				? `Timed out waiting for ${label} lock held by pid ${holder.pid}`
				: `Timed out waiting for ${label} lock`,
		);
		this.name = "DesignFileLockTimeoutError";
		this.lockPath = lockPath;
	}
}

const defaultStaleAfterMs = 10_000;
const defaultAcquireTimeoutMs = 5_000;
const defaultRetryDelayMs = 10;

const queues = new Map<string, Promise<unknown>>();

const runQueued = <T>(key: string, operation: () => Promise<T>) => {
	const previous = queues.get(key);
	const queued = previous
		? previous.catch(() => undefined).then(operation)
		: operation();

	queues.set(key, queued);
	const cleanup = () => {
		if (queues.get(key) === queued) {
			queues.delete(key);
		}
	};
	queued.then(cleanup, cleanup);
	return queued;
};

export const getDesignFileLockPath = (
	lockDirectory: string,
	designPath: string,
) =>
	path.join(
		lockDirectory,
		`${createHash("sha256").update(designPath).digest("hex").slice(0, 32)}.lock`,
	);

const sleep = (ms: number) =>
	new Promise<void>((resolve) => setTimeout(resolve, ms));

const parseLockContents = (contents: string): Partial<LockContents> | null => {
	try {
		const value: unknown = JSON.parse(contents);
		return typeof value === "object" && value !== null
			? (value as Partial<LockContents>)
			: null;
	} catch {
		return null;
	}
};

const isProcessAlive = (pid: number) => {
	if (pid === process.pid) {
		return true;
	}

	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		// EPERM: the process exists but belongs to someone else.
		return (error as NodeJS.ErrnoException).code === "EPERM";
	}
};

const isStale = (
	holder: Partial<LockContents> | null,
	modifiedAtMs: number,
	staleAfterMs: number,
) => {
	const acquiredAt =
		typeof holder?.acquiredAt === "number" ? holder.acquiredAt : modifiedAtMs;
	if (Date.now() - acquiredAt > staleAfterMs) {
		return true;
	}

	// A lock without readable contents may be mid-creation; only age breaks it.
	if (typeof holder?.pid !== "number") {
		return false;
	}

	return holder.hostname === os.hostname() && !isProcessAlive(holder.pid);
};

const readLock = async (lockPath: string) => {
	const [contents, lockStat] = await Promise.all([
		readFile(lockPath, "utf8"),
		stat(lockPath),
	]);
	return { contents, modifiedAtMs: lockStat.mtimeMs };
};

/**
 * Removes the lock when its holder is gone or it has outlived `staleAfterMs`.
 * Returns whether the caller should retry immediately.
 */
const breakStaleLock = async (lockPath: string, staleAfterMs: number) => {
	let current: Awaited<ReturnType<typeof readLock>>;
	try {
		current = await readLock(lockPath);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return { retry: true, holder: null };
		}
		throw error;
	}

	const holder = parseLockContents(current.contents);
	if (!isStale(holder, current.modifiedAtMs, staleAfterMs)) {
		return { retry: false, holder };
	}

	// Re-read right before removing so a lock that was just replaced by a
	// live holder is left alone.
	try {
		const again = await readFile(lockPath, "utf8");
		if (again !== current.contents) {
			return { retry: true, holder: null };
		}
		await unlink(lockPath);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
			throw error;
		}
	}

	return { retry: true, holder: null };
};

const acquireLock = async (
	lockPath: string,
	designPath: string,
	options: Required<DesignFileLockOptions>,
) => {
	const deadline = Date.now() + options.acquireTimeoutMs;
	const contents: LockContents = {
		pid: process.pid,
		hostname: os.hostname(),
		token: randomUUID(),
		acquiredAt: Date.now(),
		designPath,
	};

	for (;;) {
		contents.acquiredAt = Date.now();
		const serialized = JSON.stringify(contents);
		try {
			const handle = await open(lockPath, "wx");
			try {
				await handle.writeFile(serialized, "utf8");
			} finally {
				await handle.close();
			}
			return serialized;
		} catch (error) {
			const code = (error as NodeJS.ErrnoException).code;
			if (code === "ENOENT") {
				await mkdir(options.lockDirectory, { recursive: true });
				continue;
			}
			if (code !== "EEXIST") {
				throw error;
			}
		}

		const { retry, holder } = await breakStaleLock(
			lockPath,
			options.staleAfterMs,
		);
		if (retry) {
			continue;
		}
		if (Date.now() >= deadline) {
			throw new DesignFileLockTimeoutError(lockPath, holder, options.label);
		}
		await sleep(options.retryDelayMs + Math.random() * options.retryDelayMs);
	}
};

const releaseLock = async (lockPath: string, serialized: string) => {
	try {
		// Only remove the lock if it is still ours: a holder that overran
		// `staleAfterMs` may have had its lock broken and replaced.
		if ((await readFile(lockPath, "utf8")) === serialized) {
			await unlink(lockPath);
		}
	} catch {
		// The operation already finished; a lock left behind ages out.
	}
};

/**
 * Runs `operation` while holding the per-design in-process queue and the
 * cross-process lockfile. `designPath` must be canonical (for example with
 * the project root resolved through `realpath`) so every process derives the
 * same lockfile for the same design.
 */
export const withDesignFileLock = <T>(
	designPath: string,
	operation: () => Promise<T>,
	options: DesignFileLockOptions,
): Promise<T> => {
	const resolvedOptions: Required<DesignFileLockOptions> = {
		lockDirectory: options.lockDirectory,
		label: options.label ?? "design file",
		staleAfterMs: options.staleAfterMs ?? defaultStaleAfterMs,
		acquireTimeoutMs: options.acquireTimeoutMs ?? defaultAcquireTimeoutMs,
		retryDelayMs: options.retryDelayMs ?? defaultRetryDelayMs,
	};
	const lockPath = getDesignFileLockPath(
		resolvedOptions.lockDirectory,
		designPath,
	);

	return runQueued(lockPath, async () => {
		const serialized = await acquireLock(lockPath, designPath, resolvedOptions);
		try {
			return await operation();
		} finally {
			await releaseLock(lockPath, serialized);
		}
	});
};
