import {
	chmodSync,
	mkdirSync,
	readFileSync,
	renameSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { readdir, readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { resolveTrickroomHome } from "./home";

/**
 * A running Trickroom HTTP server announces itself to local processes (the
 * MCP server in particular) through one file per server process:
 * `<TRICKROOM_HOME>/runtime/servers/<pid>.json`. The file holds the session
 * token, so the directory is 0700 and the file 0600.
 */
export type ServerDiscoveryRecord = {
	version: 1;
	pid: number;
	/** Loopback-reachable base URL, ending in `/`. Not the public URL. */
	url: string;
	/** Session token, or null when the server runs without session auth. */
	token: string | null;
	/** `projectId` of the server's active project, or null without one. */
	projectId: string | null;
	projectRoot: string | null;
	/** ISO timestamp of when the server started listening. */
	startedAt: string;
};

export type ServerDiscoveryProject = {
	projectId: string | null;
	projectRoot: string | null;
};

export const resolveRuntimeServersDir = (home = resolveTrickroomHome()) =>
	path.join(home, "runtime", "servers");

export const getServerDiscoveryRecordPath = (home: string, pid: number) =>
	path.join(resolveRuntimeServersDir(home), `${pid}.json`);

const wildcardAddresses = new Set([
	"",
	"0.0.0.0",
	"::",
	"::0",
	"0:0:0:0:0:0:0:0",
]);

/**
 * Builds the URL another local process should dial. Wildcard binds are reached
 * through 127.0.0.1; a specific bind address is dialed as bound.
 */
export const resolveLoopbackServerUrl = (address: string, port: number) => {
	const host = wildcardAddresses.has(address) ? "127.0.0.1" : address;
	const urlHost = host.includes(":") ? `[${host}]` : host;
	return `http://${urlHost}:${port}/`;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const isNullableString = (value: unknown): value is string | null =>
	value === null || typeof value === "string";

export const parseServerDiscoveryRecord = (
	value: unknown,
): ServerDiscoveryRecord | null => {
	if (
		!isRecord(value) ||
		value.version !== 1 ||
		typeof value.pid !== "number" ||
		!Number.isInteger(value.pid) ||
		value.pid <= 0 ||
		typeof value.url !== "string" ||
		!isNullableString(value.token) ||
		!isNullableString(value.projectId) ||
		!isNullableString(value.projectRoot) ||
		typeof value.startedAt !== "string"
	) {
		return null;
	}

	try {
		new URL(value.url);
	} catch {
		return null;
	}

	return {
		version: 1,
		pid: value.pid,
		url: value.url,
		token: value.token,
		projectId: value.projectId,
		projectRoot: value.projectRoot,
		startedAt: value.startedAt,
	};
};

export type ServerDiscoveryEntry = {
	path: string;
	/** Null when the file is unreadable or not a valid record. */
	record: ServerDiscoveryRecord | null;
};

export const listServerDiscoveryRecords = async (
	home = resolveTrickroomHome(),
): Promise<ServerDiscoveryEntry[]> => {
	const dir = resolveRuntimeServersDir(home);
	let names: string[];
	try {
		names = await readdir(dir);
	} catch {
		return [];
	}

	return Promise.all(
		names
			.filter((name) => /^\d+\.json$/.test(name))
			.map(async (name) => {
				const filePath = path.join(dir, name);
				try {
					const record = parseServerDiscoveryRecord(
						JSON.parse(await readFile(filePath, "utf8")),
					);
					return { path: filePath, record };
				} catch {
					return { path: filePath, record: null };
				}
			}),
	);
};

export const removeServerDiscoveryRecordFile = async (filePath: string) => {
	await unlink(filePath).catch(() => undefined);
};

const ensurePrivateDir = (dir: string) => {
	mkdirSync(dir, { recursive: true, mode: 0o700 });
	// mkdir's mode only applies to directories it creates.
	chmodSync(dir, 0o700);
	chmodSync(path.dirname(dir), 0o700);
};

const exitSignals = ["SIGINT", "SIGTERM", "SIGHUP"] as const;

export type ServerDiscoveryPublisher = {
	readonly recordPath: string;
	/** Rewrites the record when the active project changes. */
	setProject: (project: ServerDiscoveryProject | null) => void;
	/** Deletes the record and stops listening for process exit. */
	dispose: () => void;
};

export type ServerDiscoveryPublisherOptions = {
	url: string;
	token: string | null;
	project?: ServerDiscoveryProject | null;
	home?: string;
	pid?: number;
	startedAt?: Date;
	/** Remove the record on process exit and SIGINT/SIGTERM/SIGHUP. */
	handleProcessExit?: boolean;
};

/**
 * Writes this server's discovery record and keeps it current. Writes are
 * synchronous and atomic (temp file + rename), so readers never see a partial
 * record and removal on exit works from a synchronous `exit` handler.
 */
export const createServerDiscoveryPublisher = ({
	url,
	token,
	project = null,
	home = resolveTrickroomHome(),
	pid = process.pid,
	startedAt = new Date(),
	handleProcessExit = true,
}: ServerDiscoveryPublisherOptions): ServerDiscoveryPublisher => {
	const dir = resolveRuntimeServersDir(home);
	const recordPath = getServerDiscoveryRecordPath(home, pid);
	const startedAtIso = startedAt.toISOString();
	let current: ServerDiscoveryProject = {
		projectId: project?.projectId ?? null,
		projectRoot: project?.projectRoot ?? null,
	};
	let disposed = false;

	const write = () => {
		const record: ServerDiscoveryRecord = {
			version: 1,
			pid,
			url,
			token,
			projectId: current.projectId,
			projectRoot: current.projectRoot,
			startedAt: startedAtIso,
		};
		ensurePrivateDir(dir);
		const tempPath = `${recordPath}.${process.pid}.tmp`;
		writeFileSync(tempPath, `${JSON.stringify(record, null, "\t")}\n`, {
			mode: 0o600,
		});
		renameSync(tempPath, recordPath);
	};

	// Only remove the file while it is still ours: a restarted server in the
	// same process (Vite restarts) writes the same path.
	const removeOwnRecord = () => {
		try {
			const record = parseServerDiscoveryRecord(
				JSON.parse(readFileSync(recordPath, "utf8")),
			);
			if (record && (record.startedAt !== startedAtIso || record.url !== url)) {
				return;
			}
			unlinkSync(recordPath);
		} catch {
			// Already gone or unreadable; nothing to clean up.
		}
	};

	const onExit = () => removeOwnRecord();
	const onSignal = (signal: NodeJS.Signals) => {
		removeOwnRecord();
		// `once` already removed this listener. If nothing else handles the
		// signal, re-raise it so the default action (exit) still happens.
		if (process.listenerCount(signal) === 0) {
			process.kill(process.pid, signal);
		}
	};

	write();
	if (handleProcessExit) {
		process.on("exit", onExit);
		for (const signal of exitSignals) {
			process.once(signal, onSignal);
		}
	}

	return {
		recordPath,
		setProject(project) {
			const next = {
				projectId: project?.projectId || null,
				projectRoot: project?.projectRoot || null,
			};
			if (
				disposed ||
				(next.projectId === current.projectId &&
					next.projectRoot === current.projectRoot)
			) {
				return;
			}
			current = next;
			try {
				write();
			} catch (error) {
				console.warn(
					`Could not update the Trickroom server discovery record: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		},
		dispose() {
			if (disposed) {
				return;
			}
			disposed = true;
			if (handleProcessExit) {
				process.off("exit", onExit);
				for (const signal of exitSignals) {
					process.off(signal, onSignal);
				}
			}
			removeOwnRecord();
		},
	};
};
