import { createHash, randomBytes, randomInt } from "node:crypto";
import {
	chmod,
	mkdir,
	readdir,
	readFile,
	stat,
	unlink,
} from "node:fs/promises";
import path from "node:path";
import { writeJsonFileAtomically } from "../server-file-utils";
import { asErrnoException, isRecord } from "../server-utils";
import { resolveTrickroomHome } from "./home";

/**
 * Browser sign-in by pairing code. `trickroom pair` writes a one-time grant
 * here; the server trades the code a browser sends for a session with an
 * expiry. Both are files in `<TRICKROOM_HOME>/auth/`, so the CLI and every
 * server on the machine share them without talking to each other. Only
 * hashes are stored: a pairing code and a session's cookie value cannot be
 * read back from disk.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** How long a pairing code can be used. */
export const PAIRING_CODE_TTL_MS = 2 * 60 * 1000;
/** How long a session lasts after its last use, unless the grant says otherwise. */
export const DEFAULT_SESSION_DAYS = 30;
export const MAX_SESSION_DAYS = 365;
/** A session in use moves its expiry at most this often. */
const SESSION_RENEW_INTERVAL_MS = 60 * 60 * 1000;

/** No 0/O, 1/I/L or U, so a code read aloud or typed is unambiguous. */
const PAIRING_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ23456789";
const PAIRING_CODE_LENGTH = 8;

export type PairingGrant = {
	version: 1;
	createdAt: string;
	expiresAt: string;
	/** Lifetime of the session this code creates, in days. */
	sessionDays: number;
};

export type AuthSession = {
	version: 1;
	/** Public id: the start of the hash of the cookie value. */
	id: string;
	createdAt: string;
	lastSeenAt: string;
	expiresAt: string;
	sessionDays: number;
	/** The browser that paired, as it named itself. */
	userAgent: string | null;
};

const hashSecret = (secret: string) =>
	createHash("sha256").update(secret).digest("hex");

export const resolveAuthDir = (trickroomHome = resolveTrickroomHome()) =>
	path.join(trickroomHome, "auth");
const pairingDir = (home: string) => path.join(resolveAuthDir(home), "pairing");
const sessionsDir = (home: string) =>
	path.join(resolveAuthDir(home), "sessions");
const sessionPath = (home: string, hash: string) =>
	path.join(sessionsDir(home), `${hash}.json`);

const ensurePrivateDir = async (directory: string) => {
	await mkdir(directory, { recursive: true, mode: 0o700 });
};

const writePrivateJson = async (filePath: string, value: unknown) => {
	await ensurePrivateDir(path.dirname(filePath));
	await writeJsonFileAtomically(filePath, value);
	await chmod(filePath, 0o600).catch(() => undefined);
};

const readJson = async (filePath: string): Promise<unknown> => {
	try {
		return JSON.parse(await readFile(filePath, "utf8"));
	} catch {
		return null;
	}
};

const removeFile = async (filePath: string) => {
	try {
		await unlink(filePath);
		return true;
	} catch {
		return false;
	}
};

const isPairingGrant = (value: unknown): value is PairingGrant =>
	isRecord(value) &&
	value.version === 1 &&
	typeof value.createdAt === "string" &&
	typeof value.expiresAt === "string" &&
	typeof value.sessionDays === "number";

const isAuthSession = (value: unknown): value is AuthSession =>
	isRecord(value) &&
	value.version === 1 &&
	typeof value.id === "string" &&
	typeof value.createdAt === "string" &&
	typeof value.lastSeenAt === "string" &&
	typeof value.expiresAt === "string" &&
	typeof value.sessionDays === "number" &&
	(value.userAgent === null || typeof value.userAgent === "string");

/** A code as typed: case, spaces and dashes do not matter. */
export const normalizePairingCode = (code: string) =>
	code.toUpperCase().replace(/[^A-Z0-9]/gu, "");

/** `ABCDEFGH` as `ABCD-EFGH`. */
export const formatPairingCode = (code: string) =>
	`${code.slice(0, 4)}-${code.slice(4)}`;

export const clampSessionDays = (days: number | undefined) =>
	typeof days === "number" && Number.isFinite(days) && days > 0
		? Math.min(days, MAX_SESSION_DAYS)
		: DEFAULT_SESSION_DAYS;

const listJsonFiles = async (directory: string) =>
	(await readdir(directory).catch(() => [] as string[]))
		.filter((name) => name.endsWith(".json"))
		.map((name) => path.join(directory, name));

const pruneExpiredGrants = async (home: string, nowMs: number) => {
	for (const filePath of await listJsonFiles(pairingDir(home))) {
		const grant = await readJson(filePath);
		if (!isPairingGrant(grant) || Date.parse(grant.expiresAt) <= nowMs) {
			await removeFile(filePath);
		}
	}
};

/** Creates a one-time pairing code. The code itself is returned, never stored. */
export const createPairingCode = async ({
	trickroomHome = resolveTrickroomHome(),
	ttlMs = PAIRING_CODE_TTL_MS,
	sessionDays,
	now = new Date(),
}: {
	trickroomHome?: string;
	ttlMs?: number;
	sessionDays?: number;
	now?: Date;
} = {}) => {
	await pruneExpiredGrants(trickroomHome, now.getTime());
	let code = "";
	for (let index = 0; index < PAIRING_CODE_LENGTH; index += 1) {
		code += PAIRING_CODE_ALPHABET[randomInt(PAIRING_CODE_ALPHABET.length)];
	}
	const grant: PairingGrant = {
		version: 1,
		createdAt: now.toISOString(),
		expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
		sessionDays: clampSessionDays(sessionDays),
	};
	await writePrivateJson(
		path.join(pairingDir(trickroomHome), `${hashSecret(code)}.json`),
		grant,
	);
	return { code, formatted: formatPairingCode(code), grant };
};

/**
 * Trades a pairing code for a session. The grant file is removed first, and
 * only the request whose removal succeeds gets the session, so a code works
 * once even when two requests race. Returns null for an unknown, expired or
 * used code.
 */
export const redeemPairingCode = async ({
	trickroomHome = resolveTrickroomHome(),
	code,
	userAgent = null,
	now = new Date(),
}: {
	trickroomHome?: string;
	code: string;
	userAgent?: string | null;
	now?: Date;
}): Promise<{ secret: string; session: AuthSession } | null> => {
	const normalized = normalizePairingCode(code);
	if (normalized.length !== PAIRING_CODE_LENGTH) {
		return null;
	}
	const grantPath = path.join(
		pairingDir(trickroomHome),
		`${hashSecret(normalized)}.json`,
	);
	const grant = await readJson(grantPath);
	if (!isPairingGrant(grant) || !(await removeFile(grantPath))) {
		return null;
	}
	if (Date.parse(grant.expiresAt) <= now.getTime()) {
		return null;
	}

	const secret = randomBytes(32).toString("base64url");
	const hash = hashSecret(secret);
	const sessionDays = clampSessionDays(grant.sessionDays);
	const session: AuthSession = {
		version: 1,
		id: hash.slice(0, 10),
		createdAt: now.toISOString(),
		lastSeenAt: now.toISOString(),
		expiresAt: new Date(now.getTime() + sessionDays * DAY_MS).toISOString(),
		sessionDays,
		userAgent: userAgent ? userAgent.slice(0, 300) : null,
	};
	await writePrivateJson(sessionPath(trickroomHome, hash), session);
	return { secret, session };
};

/** Every session that has not expired, most recently used first. */
export const listAuthSessions = async (
	trickroomHome = resolveTrickroomHome(),
	now = new Date(),
): Promise<AuthSession[]> => {
	const sessions: AuthSession[] = [];
	for (const filePath of await listJsonFiles(sessionsDir(trickroomHome))) {
		const session = await readJson(filePath);
		if (!isAuthSession(session)) continue;
		if (Date.parse(session.expiresAt) <= now.getTime()) {
			await removeFile(filePath);
			continue;
		}
		sessions.push(session);
	}
	return sessions.sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
};

/**
 * Ends the sessions whose id starts with `idPrefix`, or all of them. A
 * running server stops accepting them within `SESSION_RECHECK_MS`. Returns
 * the sessions ended.
 */
export const revokeAuthSessions = async ({
	trickroomHome = resolveTrickroomHome(),
	idPrefix,
}: {
	trickroomHome?: string;
	/** Omit to end every session. */
	idPrefix?: string;
}): Promise<AuthSession[]> => {
	const revoked: AuthSession[] = [];
	for (const filePath of await listJsonFiles(sessionsDir(trickroomHome))) {
		const session = await readJson(filePath);
		if (!isAuthSession(session)) continue;
		if (idPrefix !== undefined && !session.id.startsWith(idPrefix)) continue;
		if (await removeFile(filePath)) revoked.push(session);
	}
	return revoked;
};

/** A cached session is checked against its file at most this often. */
export const SESSION_RECHECK_MS = 5_000;

export type AuthenticatedSession = {
	session: AuthSession;
	/** True when this request moved the expiry: the cookie needs the new one. */
	renewed: boolean;
};

/**
 * Checks session cookies for one server. Sessions are cached so a request
 * costs no file read; each cached session is checked against its file every
 * few seconds, which is how a `trickroom sessions revoke` from another
 * process takes effect. A session in use moves its expiry forward (at most
 * once an hour), so it ends `sessionDays` after its last use.
 */
export const createSessionAuthenticator = (
	trickroomHome = resolveTrickroomHome(),
) => {
	const cache = new Map<string, { session: AuthSession; checkedAt: number }>();

	const load = async (hash: string, nowMs: number) => {
		const filePath = sessionPath(trickroomHome, hash);
		const session = await readJson(filePath);
		if (!isAuthSession(session)) {
			cache.delete(hash);
			return null;
		}
		if (Date.parse(session.expiresAt) <= nowMs) {
			cache.delete(hash);
			await removeFile(filePath);
			return null;
		}
		cache.set(hash, { session, checkedAt: nowMs });
		return session;
	};

	const isPresent = (hash: string) =>
		stat(sessionPath(trickroomHome, hash)).then(
			() => true,
			(error) => asErrnoException(error).code !== "ENOENT",
		);

	return {
		async authenticate(
			secret: string,
			now = new Date(),
		): Promise<AuthenticatedSession | null> {
			// Cookie values of sessions are 43 base64url characters; anything
			// else is not looked up on disk.
			if (!/^[A-Za-z0-9_-]{20,128}$/u.test(secret)) {
				return null;
			}
			const hash = hashSecret(secret);
			const nowMs = now.getTime();
			const cached = cache.get(hash);
			let session: AuthSession | null;
			if (cached && nowMs - cached.checkedAt < SESSION_RECHECK_MS) {
				session = cached.session;
			} else if (cached) {
				// Still there? A stat is enough; the content only changes here.
				if (!(await isPresent(hash))) {
					cache.delete(hash);
					return null;
				}
				cached.checkedAt = nowMs;
				session = cached.session;
			} else {
				session = await load(hash, nowMs);
			}
			if (!session) return null;
			if (Date.parse(session.expiresAt) <= nowMs) {
				cache.delete(hash);
				await removeFile(sessionPath(trickroomHome, hash));
				return null;
			}

			if (nowMs - Date.parse(session.lastSeenAt) < SESSION_RENEW_INTERVAL_MS) {
				return { session, renewed: false };
			}
			// A session revoked a moment ago must not be written back.
			if (!(await isPresent(hash))) {
				cache.delete(hash);
				return null;
			}
			const renewedSession: AuthSession = {
				...session,
				lastSeenAt: now.toISOString(),
				expiresAt: new Date(
					nowMs + clampSessionDays(session.sessionDays) * DAY_MS,
				).toISOString(),
			};
			cache.set(hash, { session: renewedSession, checkedAt: nowMs });
			await writePrivateJson(
				sessionPath(trickroomHome, hash),
				renewedSession,
			).catch(() => undefined);
			return { session: renewedSession, renewed: true };
		},

		/** Ends the session of this cookie value, for sign-out. */
		async revoke(secret: string) {
			const hash = hashSecret(secret);
			cache.delete(hash);
			return removeFile(sessionPath(trickroomHome, hash));
		},
	};
};

export type SessionAuthenticator = ReturnType<
	typeof createSessionAuthenticator
>;
