import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	createPairingCode,
	listAuthSessions,
	revokeAuthSessions,
} from "./app-state/auth-sessions";
import { createTrickroomApp } from "./server";

describe("pairing a browser", () => {
	let home: string;

	beforeEach(async () => {
		home = await mkdtemp(path.join(os.tmpdir(), "trickroom-auth-routes-"));
	});

	afterEach(async () => {
		await rm(home, { recursive: true, force: true });
	});

	const createApp = () =>
		createTrickroomApp({ trickroomHome: home, sessionToken: "test-token" });

	const pair = async (app: ReturnType<typeof createApp>, code: string) =>
		app.request("/api/trickroom/auth/pair", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"user-agent": "Firefox/1",
			},
			body: JSON.stringify({ code }),
		});

	const cookieOf = (response: Response) =>
		response.headers.get("set-cookie")?.split(";", 1)[0] ?? "";

	it("sends a page load without credentials to the pairing page and back", async () => {
		const app = createApp();

		const page = await app.request("/p/loc_1/design/abc?board=b", {
			headers: { accept: "text/html,application/xhtml+xml" },
		});

		expect(page.status).toBe(302);
		expect(page.headers.get("location")).toBe(
			`/pair?next=${encodeURIComponent("/p/loc_1/design/abc?board=b")}`,
		);
		const pairPage = await app.request("/pair");
		expect(pairPage.status).toBe(200);
		expect(await pairPage.text()).toContain("Pair this browser");
	});

	it("refuses an API call without credentials and says pairing would help", async () => {
		const app = createApp();

		const response = await app.request("/api/trickroom/health", {
			headers: { accept: "text/html" },
		});

		expect(response.status).toBe(403);
		expect(response.headers.get("x-trickroom-auth")).toBe("required");
	});

	it("trades a code for a session cookie that expires", async () => {
		const app = createApp();
		const { formatted } = await createPairingCode({ trickroomHome: home });

		const paired = await pair(app, formatted);

		expect(paired.status).toBe(200);
		const setCookie = paired.headers.get("set-cookie") ?? "";
		expect(setCookie).toContain("HttpOnly");
		expect(setCookie).toContain("SameSite=Strict");
		expect(setCookie).toContain("Expires=");
		expect(setCookie).not.toContain("test-token");
		const cookie = cookieOf(paired);
		expect(
			(await app.request("/api/trickroom/health", { headers: { cookie } }))
				.status,
		).toBe(200);
		const info = await app.request("/api/trickroom/auth/session", {
			headers: { cookie },
		});
		await expect(info.json()).resolves.toMatchObject({
			authRequired: true,
			kind: "session",
		});
		const [session] = await listAuthSessions(home);
		expect(session?.userAgent).toBe("Firefox/1");
	});

	it("refuses a code that was used, and a wrong one", async () => {
		const app = createApp();
		const { code } = await createPairingCode({ trickroomHome: home });
		expect((await pair(app, code)).status).toBe(200);

		const reused = await pair(app, code);
		const wrong = await pair(app, "ZZZZ-ZZZZ");

		expect(reused.status).toBe(401);
		expect(reused.headers.get("set-cookie")).toBeNull();
		expect(wrong.status).toBe(401);
	});

	it("stops taking codes after repeated wrong ones", async () => {
		const app = createApp();
		for (let attempt = 0; attempt < 10; attempt += 1) {
			expect((await pair(app, "ZZZZ-ZZZZ")).status).toBe(401);
		}
		const { code } = await createPairingCode({ trickroomHome: home });

		const blocked = await pair(app, code);

		expect(blocked.status).toBe(429);
		// The real code was not spent while blocked.
		expect(await listAuthSessions(home)).toEqual([]);
	});

	it("signs out, and the cookie stops working", async () => {
		const app = createApp();
		const { code } = await createPairingCode({ trickroomHome: home });
		const cookie = cookieOf(await pair(app, code));

		const signedOut = await app.request("/api/trickroom/auth/sign-out", {
			method: "POST",
			headers: { cookie },
		});

		expect(signedOut.status).toBe(200);
		expect(
			(await app.request("/api/trickroom/health", { headers: { cookie } }))
				.status,
		).toBe(403);
		expect(await listAuthSessions(home)).toEqual([]);
	});

	it("keeps the token working for automation, and never ends it on sign-out", async () => {
		const app = createApp();
		const headers = { "x-trickroom-session": "test-token" };

		const info = await app.request("/api/trickroom/auth/session", { headers });
		await expect(info.json()).resolves.toMatchObject({ kind: "token" });
		await app.request("/api/trickroom/auth/sign-out", {
			method: "POST",
			headers,
		});
		expect(
			(await app.request("/api/trickroom/health", { headers })).status,
		).toBe(200);
	});

	it("skips the pairing page for a browser that is signed in, or a server without sign-in", async () => {
		const app = createApp();
		const { code } = await createPairingCode({ trickroomHome: home });
		const cookie = cookieOf(await pair(app, code));

		const signedIn = await app.request("/pair?next=/p/loc_1/", {
			headers: { cookie },
		});
		const open = await createTrickroomApp({ trickroomHome: home }).request(
			"/pair?next=//evil.example",
		);

		expect(signedIn.headers.get("location")).toBe("/p/loc_1/");
		expect(open.status).toBe(302);
		expect(open.headers.get("location")).toBe("/");
	});

	it("accepts a session only until it is revoked from the CLI", async () => {
		const app = createApp();
		const { code } = await createPairingCode({ trickroomHome: home });
		const cookie = cookieOf(await pair(app, code));

		await revokeAuthSessions({ trickroomHome: home });
		// A fresh server (or this one after its recheck interval) refuses it.
		const response = await createApp().request("/api/trickroom/health", {
			headers: { cookie },
		});

		expect(response.status).toBe(403);
	});
});
