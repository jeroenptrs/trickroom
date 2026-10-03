import { isIP } from "node:net";

export const trickroomSessionCookieName = "trickroom_session";
export const trickroomSessionHeaderName = "x-trickroom-session";

const normalizeHost = (host: string) => {
	const normalized = host.trim().toLowerCase();
	if (normalized.startsWith("[") && normalized.endsWith("]")) {
		return normalized.slice(1, -1);
	}
	return normalized;
};

export const isLoopbackHost = (host: string) => {
	const normalized = normalizeHost(host);
	if (normalized === "localhost" || normalized.endsWith(".localhost")) {
		return true;
	}

	if (isIP(normalized) === 4) {
		return normalized.split(".")[0] === "127";
	}

	if (isIP(normalized) === 6) {
		return (
			normalized === "::1" ||
			normalized === "0:0:0:0:0:0:0:1" ||
			normalized.startsWith("::ffff:127.")
		);
	}

	return false;
};

export const formatServerUrlHost = (host: string) => {
	const normalized = normalizeHost(host);
	return isIP(normalized) === 6 ? `[${normalized}]` : normalized;
};

/**
 * Whether the browser reached us over HTTPS, either directly or through a
 * TLS-terminating proxy that sets X-Forwarded-Proto. The header is not
 * authenticated, but it only decides whether the session cookie is marked
 * Secure, so a spoofed value can only break the spoofing client's own session.
 */
export const isSecureRequest = (url: URL, forwardedProto: string | undefined) =>
	url.protocol === "https:" ||
	forwardedProto?.split(",", 1)[0]?.trim().toLowerCase() === "https";

export const requireSessionTokenForHost = (
	host: string,
	sessionToken: string | undefined,
) => {
	if (!isLoopbackHost(host) && !sessionToken?.trim()) {
		throw new Error(
			`Refusing to bind Trickroom to non-loopback host "${host}" without TRICKROOM_SESSION_TOKEN.`,
		);
	}
};
