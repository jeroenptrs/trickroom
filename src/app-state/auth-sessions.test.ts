import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	createPairingCode,
	createSessionAuthenticator,
	listAuthSessions,
	normalizePairingCode,
	redeemPairingCode,
	revokeAuthSessions,
	SESSION_RECHECK_MS,
} from "./auth-sessions";

const DAY_MS = 24 * 60 * 60 * 1000;

describe("pairing codes and sessions", () => {
	let home: string;
	const now = new Date("2026-11-19T12:00:00.000Z");
	const later = (ms: number) => new Date(now.getTime() + ms);

	beforeEach(async () => {
		home = await mkdtemp(path.join(os.tmpdir(), "trickroom-auth-"));
	});

	afterEach(async () => {
		await rm(home, { recursive: true, force: true });
	});

	const pair = async (sessionDays?: number) => {
		const { code } = await createPairingCode({
			trickroomHome: home,
			sessionDays,
			now,
		});
		const redeemed = await redeemPairingCode({
			trickroomHome: home,
			code,
			userAgent: "Firefox/130.0",
			now,
		});
		if (!redeemed) throw new Error("Expected the code to pair.");
		return redeemed;
	};

	it("creates a code that reads unambiguously and stores only its hash", async () => {
		const { code, formatted } = await createPairingCode({
			trickroomHome: home,
			now,
		});

		expect(code).toMatch(/^[ABCDEFGHJKMNPQRSTVWXYZ2-9]{8}$/u);
		expect(formatted).toBe(`${code.slice(0, 4)}-${code.slice(4)}`);
		const directory = path.join(home, "auth", "pairing");
		const [file] = await readdir(directory);
		const stored = await readFile(path.join(directory, file ?? ""), "utf8");
		expect(file).not.toContain(code);
		expect(stored).not.toContain(code);
		expect((await stat(path.join(directory, file ?? ""))).mode & 0o777).toBe(
			0o600,
		);
	});

	it("accepts a code however it is typed", () => {
		expect(normalizePairingCode(" abcd-efgh ")).toBe("ABCDEFGH");
	});

	it("pairs once, and not with a wrong or expired code", async () => {
		const { code, formatted } = await createPairingCode({
			trickroomHome: home,
			now,
		});

		expect(
			await redeemPairingCode({ trickroomHome: home, code: "ZZZZ-ZZZZ", now }),
		).toBeNull();
		const first = await redeemPairingCode({
			trickroomHome: home,
			code: formatted.toLowerCase(),
			now,
		});
		expect(first?.session.expiresAt).toBe(later(30 * DAY_MS).toISOString());
		expect(
			await redeemPairingCode({ trickroomHome: home, code, now }),
		).toBeNull();

		const expired = await createPairingCode({ trickroomHome: home, now });
		expect(
			await redeemPairingCode({
				trickroomHome: home,
				code: expired.code,
				now: later(2 * 60 * 1000 + 1),
			}),
		).toBeNull();
	});

	it("gives one session when two requests send the same code", async () => {
		const { code } = await createPairingCode({ trickroomHome: home, now });

		const results = await Promise.all(
			Array.from({ length: 8 }, () =>
				redeemPairingCode({ trickroomHome: home, code, now }),
			),
		);

		expect(results.filter(Boolean)).toHaveLength(1);
	});

	it("stores a session by the hash of its cookie value", async () => {
		const { secret, session } = await pair();

		const directory = path.join(home, "auth", "sessions");
		const [file] = await readdir(directory);
		expect(file).not.toContain(secret);
		expect(
			await readFile(path.join(directory, file ?? ""), "utf8"),
		).not.toContain(secret);
		expect(file?.startsWith(session.id)).toBe(true);
		expect(await listAuthSessions(home, now)).toEqual([session]);
	});

	it("authenticates a session until it expires", async () => {
		const { secret } = await pair(1);
		const authenticator = createSessionAuthenticator(home);

		expect(await authenticator.authenticate(secret, now)).toMatchObject({
			renewed: false,
		});
		expect(await authenticator.authenticate("not-a-session", now)).toBeNull();
		expect(
			await authenticator.authenticate(secret, later(DAY_MS + 1)),
		).toBeNull();
		expect(await listAuthSessions(home, later(DAY_MS + 1))).toEqual([]);
	});

	it("moves the expiry of a session in use", async () => {
		const { secret } = await pair(7);
		const authenticator = createSessionAuthenticator(home);
		const inUse = later(3 * DAY_MS);

		const renewed = await authenticator.authenticate(secret, inUse);

		expect(renewed?.renewed).toBe(true);
		expect(renewed?.session.expiresAt).toBe(
			new Date(inUse.getTime() + 7 * DAY_MS).toISOString(),
		);
		// A second server reading the file sees the new expiry.
		expect((await listAuthSessions(home, inUse))[0]?.expiresAt).toBe(
			renewed?.session.expiresAt,
		);
		expect(
			(await authenticator.authenticate(secret, later(3 * DAY_MS + 1000)))
				?.renewed,
		).toBe(false);
	});

	it("stops accepting a session another process revoked", async () => {
		const { secret, session } = await pair();
		const authenticator = createSessionAuthenticator(home);
		expect(await authenticator.authenticate(secret, now)).not.toBeNull();

		expect(
			await revokeAuthSessions({ trickroomHome: home, idPrefix: "nope" }),
		).toEqual([]);
		const revoked = await revokeAuthSessions({
			trickroomHome: home,
			idPrefix: session.id.slice(0, 6),
		});

		expect(revoked.map((entry) => entry.id)).toEqual([session.id]);
		expect(
			await authenticator.authenticate(secret, later(SESSION_RECHECK_MS + 1)),
		).toBeNull();
	});

	it("does not write a revoked session back when it would renew", async () => {
		const { secret } = await pair();
		const authenticator = createSessionAuthenticator(home);
		await authenticator.authenticate(secret, now);

		await revokeAuthSessions({ trickroomHome: home });

		expect(
			await authenticator.authenticate(secret, later(2 * 60 * 60 * 1000)),
		).toBeNull();
		expect(await listAuthSessions(home, now)).toEqual([]);
	});

	it("signs out one session and keeps the others", async () => {
		const first = await pair();
		const second = await pair();
		const authenticator = createSessionAuthenticator(home);

		expect(await authenticator.revoke(first.secret)).toBe(true);

		expect(await authenticator.authenticate(first.secret, now)).toBeNull();
		expect(await authenticator.authenticate(second.secret, now)).not.toBeNull();
	});
});
