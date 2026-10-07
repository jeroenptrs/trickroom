import { createHash, randomUUID } from "node:crypto";
import {
	type FileHandle,
	mkdir,
	open,
	readFile,
	rename,
	stat,
	unlink,
	writeFile,
} from "node:fs/promises";
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
 * can hold it. Design lockfiles live outside the project (by default under
 * the Trickroom home) so they are never committed and never seen by the
 * project file watchers. `withFileLock` takes the lockfile path itself, for
 * a lock that belongs next to the file it guards (the lint report's).
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

export type FileLockOptions = Omit<DesignFileLockOptions, "lockDirectory"> & {
	/**
	 * Create the lockfile's folder when it is missing (the default). False
	 * fails instead, for a lock inside a folder that must already exist.
	 */
	createDirectory?: boolean;
};

type LockContents = {
	pid: number;
	hostname: string;
	token: string;
	acquiredAt: number;
	/** The file the lock guards. */
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

/**
 * Thrown by `FileLockHandle.assertHeld` when the lockfile no longer holds
 * this acquisition's token (it was reclaimed and replaced, or removed).
 */
export class FileLockLostError extends Error {
	readonly lockPath: string;

	constructor(lockPath: string, label = "design file") {
		super(`The ${label} lock at ${lockPath} is no longer held by this process`);
		this.name = "FileLockLostError";
		this.lockPath = lockPath;
	}
}

/** What the operation under a lock can ask about it. */
export type FileLockHandle = {
	/**
	 * Fencing: rejects with `FileLockLostError` unless the lockfile still
	 * holds this acquisition's token. Call it right before the write the
	 * lock guards becomes visible (an atomic rename).
	 */
	assertHeld: () => Promise<void>;
};

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
		// Only ESRCH says there is no such process; EPERM means it exists but
		// belongs to someone else, and anything else is not proof of death.
		return (error as NodeJS.ErrnoException).code !== "ESRCH";
	}
};

/**
 * Whether a lock is abandoned. A holder on this host with a readable pid
 * decides by itself: a live process keeps its lock however long it holds
 * it, a dead one loses it at once. Age (`staleAfterMs`, from `acquiredAt`
 * or the file's mtime) is only the fallback when the pid cannot be checked:
 * no readable pid (empty or partly written lock) or a holder on another
 * host.
 */
const isStale = (
	holder: Partial<LockContents> | null,
	modifiedAtMs: number,
	staleAfterMs: number,
) => {
	if (typeof holder?.pid === "number" && holder.hostname === os.hostname()) {
		return !isProcessAlive(holder.pid);
	}
	const acquiredAt =
		typeof holder?.acquiredAt === "number" ? holder.acquiredAt : modifiedAtMs;
	return Date.now() - acquiredAt > staleAfterMs;
};

const readLock = async (lockPath: string) => {
	const [contents, lockStat] = await Promise.all([
		readFile(lockPath, "utf8"),
		stat(lockPath),
	]);
	return { contents, modifiedAtMs: lockStat.mtimeMs };
};

/**
 * Reclaims an abandoned lock (see `isStale`) by replacing it, never by
 * emptying the slot: writes this acquisition's lock (`serialized`) to a
 * temp sibling, reads the lock path again and, only if it still holds
 * exactly the abandoned contents it judged, renames the temp file over it,
 * an atomic replace. Anything else there (another reclaimer's lock, a new
 * owner's) sends the caller back to waiting. Two reclaimers that both pass
 * the re-read both replace; the later one holds the lock, and the earlier
 * one's fencing check (`assertHeld`) fails. Only an owner's release (or
 * its unfinished create) ever empties the slot.
 */
const reclaimStaleLock = async (
	lockPath: string,
	serialized: string,
	staleAfterMs: number,
): Promise<{
	acquired: boolean;
	/** Retry the exclusive create at once: the slot is empty. */
	retry: boolean;
	holder: Partial<LockContents> | null;
}> => {
	let current: Awaited<ReturnType<typeof readLock>>;
	try {
		current = await readLock(lockPath);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return { acquired: false, retry: true, holder: null };
		}
		throw error;
	}

	const holder = parseLockContents(current.contents);
	if (!isStale(holder, current.modifiedAtMs, staleAfterMs)) {
		return { acquired: false, retry: false, holder };
	}
	const temp = `${lockPath}.${process.pid}.${randomUUID()}.tmp`;
	try {
		await writeFile(temp, serialized, "utf8");
		const again = await readFile(lockPath, "utf8").catch(() => null);
		if (again === null) {
			// Released by its owner meanwhile: compete for the exclusive create.
			return { acquired: false, retry: true, holder: null };
		}
		if (again !== current.contents) {
			return {
				acquired: false,
				retry: false,
				holder: parseLockContents(again),
			};
		}
		await rename(temp, lockPath);
		return { acquired: true, retry: false, holder: null };
	} finally {
		// Gone after the replace; left over when the reclaim backed off.
		await unlink(temp).catch(() => undefined);
	}
};

/**
 * Releases a lock this process created but could not finish writing, as
 * its owner: only when what is there is still (a prefix of) the contents it
 * was writing, so another holder's lock is left alone.
 */
const discardUnfinishedLock = async (lockPath: string, serialized: string) => {
	const current = await readFile(lockPath, "utf8").catch(() => null);
	if (current !== null && serialized.startsWith(current)) {
		await unlink(lockPath).catch(() => undefined);
	}
};

type ResolvedLockOptions = Required<Omit<FileLockOptions, "label">> & {
	label: string;
};

const acquireLock = async (
	lockPath: string,
	designPath: string,
	options: ResolvedLockOptions,
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
		// A fresh token per attempt: every acquisition is told apart.
		contents.token = randomUUID();
		contents.acquiredAt = Date.now();
		const serialized = JSON.stringify(contents);
		let handle: FileHandle | null = null;
		try {
			handle = await open(lockPath, "wx");
		} catch (error) {
			const code = (error as NodeJS.ErrnoException).code;
			if (code === "ENOENT" && options.createDirectory) {
				await mkdir(path.dirname(lockPath), { recursive: true });
				continue;
			}
			if (code !== "EEXIST") {
				throw error;
			}
		}
		if (handle) {
			try {
				await handle.writeFile(serialized, "utf8");
				await handle.close();
			} catch (error) {
				// The lock exists but does not say whose it is: release it rather
				// than leave it blocking everyone until it ages.
				await handle.close().catch(() => undefined);
				await discardUnfinishedLock(lockPath, serialized);
				throw error;
			}
			return contents.token;
		}

		const { acquired, retry, holder } = await reclaimStaleLock(
			lockPath,
			serialized,
			options.staleAfterMs,
		);
		if (acquired) {
			return contents.token;
		}
		if (retry) {
			continue;
		}
		if (Date.now() >= deadline) {
			throw new DesignFileLockTimeoutError(lockPath, holder, options.label);
		}
		await sleep(options.retryDelayMs + Math.random() * options.retryDelayMs);
	}
};

const releaseLock = async (lockPath: string, token: string) => {
	try {
		// Only remove the lock if it still holds this acquisition's token: a
		// lock reclaimed and replaced by another process is not ours to remove.
		const current = parseLockContents(await readFile(lockPath, "utf8"));
		if (current?.token === token) {
			await unlink(lockPath);
		}
	} catch {
		// The operation already finished; a lock left behind is reclaimed.
	}
};

/**
 * Runs `operation` while holding the in-process queue and the cross-process
 * lockfile at `lockPath`, created with `open(lockPath, "wx")`. Every process
 * has to derive the same `lockPath` for the same guarded file. The lock is
 * released when `operation` settles. Others reclaim it once its holder on
 * this host has exited (or, when that cannot be checked, once it is older
 * than `staleAfterMs`); `operation` gets a handle to check, right before
 * its write, that it still holds the lock.
 */
export const withFileLock = <T>(
	lockPath: string,
	operation: (lock: FileLockHandle) => Promise<T>,
	options: FileLockOptions & { target?: string } = {},
): Promise<T> => {
	const resolvedOptions: ResolvedLockOptions = {
		label: options.label ?? "design file",
		staleAfterMs: options.staleAfterMs ?? defaultStaleAfterMs,
		acquireTimeoutMs: options.acquireTimeoutMs ?? defaultAcquireTimeoutMs,
		retryDelayMs: options.retryDelayMs ?? defaultRetryDelayMs,
		createDirectory: options.createDirectory ?? true,
	};

	return runQueued(lockPath, async () => {
		const token = await acquireLock(
			lockPath,
			options.target ?? lockPath,
			resolvedOptions,
		);
		const handle: FileLockHandle = {
			assertHeld: async () => {
				const current = await readFile(lockPath, "utf8").catch(() => null);
				if (current === null || parseLockContents(current)?.token !== token) {
					throw new FileLockLostError(lockPath, resolvedOptions.label);
				}
			},
		};
		try {
			return await operation(handle);
		} finally {
			await releaseLock(lockPath, token);
		}
	});
};

/**
 * Runs `operation` while holding the per-design in-process queue and the
 * cross-process lockfile. `designPath` must be canonical (for example with
 * the project root resolved through `realpath`) so every process derives the
 * same lockfile for the same design.
 */
export const withDesignFileLock = <T>(
	designPath: string,
	operation: (lock: FileLockHandle) => Promise<T>,
	{ lockDirectory, ...options }: DesignFileLockOptions,
): Promise<T> =>
	withFileLock(getDesignFileLockPath(lockDirectory, designPath), operation, {
		...options,
		target: designPath,
	});
