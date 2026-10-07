import { createHash, randomUUID } from "node:crypto";
import {
	link,
	mkdir,
	open,
	readFile,
	rename,
	stat,
	unlink,
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
 * Takes the lock at `lockPath` out of the way if it still holds `expected`:
 * renames it to a unique sibling (`<lock>.<pid>.<random>`), which only one
 * process can do to one file, and removes it there. A rename that moved a
 * different lock (the stale one was reclaimed and replaced since `expected`
 * was read) puts it back with an exclusive link and reports false. Never
 * unlinks the lock path itself, so it cannot remove a lock it did not judge.
 */
const setAsideIfUnchanged = async (lockPath: string, expected: string) => {
	const aside = `${lockPath}.${process.pid}.${randomUUID()}`;
	try {
		await rename(lockPath, aside);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return false;
		}
		throw error;
	}
	const moved = await readFile(aside, "utf8").catch(() => null);
	if (moved !== expected) {
		// Another holder's lock: restore it, unless yet another lock took
		// its place (then that holder lost it, which its fencing check sees).
		await link(aside, lockPath).catch(() => undefined);
	}
	await unlink(aside).catch(() => undefined);
	return moved === expected;
};

/**
 * Reclaims the lock when its holder is gone or it has outlived
 * `staleAfterMs`, through `setAsideIfUnchanged`. Returns whether the caller
 * should retry the exclusive create immediately; a reclaimer that lost the
 * race goes back to waiting.
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
	const reclaimed = await setAsideIfUnchanged(lockPath, current.contents);
	return { retry: reclaimed, holder: reclaimed ? null : holder };
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
			if (code === "ENOENT" && options.createDirectory) {
				await mkdir(path.dirname(lockPath), { recursive: true });
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
 * Runs `operation` while holding the in-process queue and the cross-process
 * lockfile at `lockPath`, created with `open(lockPath, "wx")`. Every process
 * has to derive the same `lockPath` for the same guarded file. The lock is
 * released when `operation` settles, and broken by others once it is older
 * than `staleAfterMs` or its holder on this host has exited.
 */
export const withFileLock = <T>(
	lockPath: string,
	operation: () => Promise<T>,
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
		const serialized = await acquireLock(
			lockPath,
			options.target ?? lockPath,
			resolvedOptions,
		);
		try {
			return await operation();
		} finally {
			await releaseLock(lockPath, serialized);
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
	operation: () => Promise<T>,
	{ lockDirectory, ...options }: DesignFileLockOptions,
): Promise<T> =>
	withFileLock(getDesignFileLockPath(lockDirectory, designPath), operation, {
		...options,
		target: designPath,
	});
