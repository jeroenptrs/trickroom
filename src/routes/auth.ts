import { type Context, Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import {
	type AuthSession,
	redeemPairingCode,
	type SessionAuthenticator,
} from "../app-state/auth-sessions";
import { isSecureRequest, trickroomSessionCookieName } from "../server-auth";
import { isRecord, jsonError } from "../server-utils";

/** Where a browser pairs. Reachable without credentials. */
export const pairPagePath = "/pair";
export const pairApiPath = "/api/trickroom/auth/pair";
/** Set on a 403 that pairing would fix, so the app can send the tab to pair. */
export const authRequiredHeaderName = "x-trickroom-auth";

/** Failed codes allowed per window, across all browsers. */
const MAX_FAILED_ATTEMPTS = 10;
const FAILED_ATTEMPT_WINDOW_MS = 5 * 60 * 1000;

export type RequestAuth =
	| { kind: "none" }
	| { kind: "token" }
	| { kind: "session"; session: AuthSession };

export const setSessionCookie = (
	c: Context,
	value: string,
	expiresAt?: string,
) => {
	setCookie(c, trickroomSessionCookieName, value, {
		httpOnly: true,
		path: "/",
		sameSite: "Strict",
		secure: isSecureRequest(
			new URL(c.req.url),
			c.req.header("x-forwarded-proto"),
		),
		...(expiresAt ? { expires: new Date(expiresAt) } : {}),
	});
};

/** A path on this origin to go to after pairing; anything else becomes `/`. */
export const sanitizeNextPath = (next: string | undefined | null) =>
	next?.startsWith("/") && !next.startsWith("//") && !next.includes("\\")
		? next
		: "/";

const pairPageHtml = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Pair this browser - Trickroom</title>
<style>
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f8fafc;color:#020617;font-family:"IBM Plex Sans",ui-sans-serif,system-ui,sans-serif}
main{width:100%;max-width:26rem;margin:1rem;background:#fff;box-shadow:inset 0 0 0 1px #e2e8f0}
header{padding:1.25rem 1.5rem;border-bottom:1px solid #e2e8f0;font-size:1rem;font-weight:500;letter-spacing:-.01em}
form{display:flex;flex-direction:column;gap:.75rem;padding:1.5rem}
h1{margin:0;font-size:1.5rem;font-weight:500;letter-spacing:-.02em}
p{margin:0;font-size:.875rem;line-height:1.4;color:#475569}
code,input{font-family:"IBM Plex Mono",ui-monospace,SFMono-Regular,Menlo,monospace}
code{font-size:.8125rem;background:#f1f5f9;padding:.0625rem .25rem;color:#020617}
label{margin-top:.5rem;font-size:.75rem;font-weight:600}
input{width:100%;padding:.625rem .75rem;border:0;border-radius:0;box-shadow:inset 0 0 0 1px #cbd5e1;font-size:1.125rem;letter-spacing:.12em;text-transform:uppercase;outline:none;background:#fff;color:#020617}
input:focus-visible{box-shadow:inset 0 0 0 1px #06b6d4}
input[aria-invalid=true]{box-shadow:inset 0 0 0 1px #dc2626}
button{padding:.625rem .75rem;border:0;border-radius:0;background:#020617;color:#f8fafc;font:inherit;font-size:.875rem;font-weight:500;cursor:pointer}
button:hover{background:#1e293b}
button:focus-visible{outline:none;box-shadow:inset 0 0 0 1px #06b6d4}
button:disabled{opacity:.5;cursor:default}
[role=alert]{font-size:.75rem;color:#7f1d1d;min-height:1rem}
</style>
</head>
<body>
<main>
<header>Trickroom</header>
<form id="pair" novalidate>
<h1>Pair this browser</h1>
<p>Run <code>trickroom pair</code> on the machine that runs Trickroom, then enter the code it prints.</p>
<label for="code">Pairing code</label>
<input id="code" name="code" autocomplete="one-time-code" autocapitalize="characters" spellcheck="false" maxlength="12" placeholder="XXXX-XXXX" aria-describedby="error" autofocus>
<div id="error" role="alert"></div>
<button id="submit" type="submit">Pair browser</button>
</form>
</main>
<script>
(function () {
	var form = document.getElementById("pair");
	var input = document.getElementById("code");
	var button = document.getElementById("submit");
	var error = document.getElementById("error");
	var next = new URLSearchParams(location.search).get("next") || "/";
	if (next.charAt(0) !== "/" || next.charAt(1) === "/" || next.indexOf("\\\\") !== -1) next = "/";
	function fail(message) {
		error.textContent = message;
		input.setAttribute("aria-invalid", "true");
		button.disabled = false;
		button.textContent = "Pair browser";
		input.focus();
		input.select();
	}
	function pair(code) {
		if (!code.trim()) return fail("Enter the pairing code.");
		button.disabled = true;
		button.textContent = "Pairing…";
		error.textContent = "";
		input.removeAttribute("aria-invalid");
		fetch("${pairApiPath}", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ code: code }),
		}).then(function (response) {
			if (response.ok) return location.replace(next);
			return response.json().then(
				function (body) { fail(body && body.error ? body.error : "Could not pair this browser."); },
				function () { fail("Could not pair this browser."); }
			);
		}, function () { fail("Could not reach Trickroom. Check the connection, then try again."); });
	}
	form.addEventListener("submit", function (event) {
		event.preventDefault();
		pair(input.value);
	});
	// A link from \`trickroom pair\` carries the code after the #, which
	// browsers do not send to the server or keep in its logs.
	var fromLink = decodeURIComponent(location.hash.slice(1));
	if (fromLink) {
		history.replaceState(null, "", location.pathname + location.search);
		input.value = fromLink;
		pair(fromLink);
	}
})();
</script>
</body>
</html>
`;

/**
 * Pairing and sign-out. `getAuth` reads what the auth middleware found for
 * the request. Mounted on the app root: the page at `/pair`, the API under
 * `/api/trickroom/auth`.
 */
export const createAuthRoutes = ({
	trickroomHome,
	authenticator,
	authRequired,
	getAuth,
}: {
	trickroomHome: string;
	authenticator: SessionAuthenticator;
	authRequired: boolean;
	getAuth: (c: Context) => RequestAuth;
}) => {
	const routes = new Hono();
	let failedAttempts: number[] = [];

	routes.get(pairPagePath, (c) => {
		// Nothing to pair with: the server asks for no credentials, or this
		// browser already has them.
		if (!authRequired || getAuth(c).kind !== "none") {
			return c.redirect(sanitizeNextPath(c.req.query("next")));
		}
		c.header("Cache-Control", "no-store");
		c.header("Referrer-Policy", "no-referrer");
		return c.html(pairPageHtml);
	});

	routes.post(pairApiPath, async (c) => {
		const now = Date.now();
		failedAttempts = failedAttempts.filter(
			(at) => now - at < FAILED_ATTEMPT_WINDOW_MS,
		);
		if (failedAttempts.length >= MAX_FAILED_ATTEMPTS) {
			return jsonError(
				"Too many attempts. Wait a few minutes, then run trickroom pair for a new code.",
				429,
			);
		}

		const body = await c.req.json().catch(() => null);
		const code =
			isRecord(body) && typeof body.code === "string" ? body.code : "";
		const redeemed = code
			? await redeemPairingCode({
					trickroomHome,
					code,
					userAgent: c.req.header("user-agent") ?? null,
				})
			: null;
		if (!redeemed) {
			failedAttempts.push(now);
			return jsonError(
				"That code is unknown, expired, or already used. Run trickroom pair for a new one.",
				401,
			);
		}

		setSessionCookie(c, redeemed.secret, redeemed.session.expiresAt);
		return c.json({ ok: true, expiresAt: redeemed.session.expiresAt });
	});

	routes.get("/api/trickroom/auth/session", (c) => {
		const auth = getAuth(c);
		return c.json({
			authRequired,
			kind: auth.kind,
			...(auth.kind === "session"
				? { id: auth.session.id, expiresAt: auth.session.expiresAt }
				: {}),
		});
	});

	routes.post("/api/trickroom/auth/sign-out", async (c) => {
		const auth = getAuth(c);
		const cookie = getCookie(c, trickroomSessionCookieName);
		if (auth.kind === "session" && cookie) {
			await authenticator.revoke(cookie);
		}
		deleteCookie(c, trickroomSessionCookieName, { path: "/" });
		return c.json({ ok: true });
	});

	return routes;
};
