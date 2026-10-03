import { isIP } from "node:net";

export type PublicHostSource = "flag" | "env" | "settings" | "inferred";

export type ResolvedPublicHost = {
	host: string;
	source: PublicHostSource;
};

export class PublicHostError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "PublicHostError";
	}
}

const hostNamePattern = /^[a-z0-9_]([a-z0-9_.-]*[a-z0-9_])?$/i;

const stripBrackets = (host: string) =>
	host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;

export const isWildcardHost = (host: string) => {
	const normalized = stripBrackets(host.trim().toLowerCase());
	return (
		normalized === "0.0.0.0" ||
		normalized === "::" ||
		normalized === "0:0:0:0:0:0:0:0"
	);
};

/**
 * Validates a user-supplied public host: a bare host name or IP address,
 * without scheme, port, or path. IPv6 literals may be bracketed.
 */
export const parsePublicHost = (value: string, origin: string) => {
	const trimmed = value.trim();
	const unbracketed = stripBrackets(trimmed);
	const valid =
		isIP(unbracketed) === 6 ||
		(trimmed === unbracketed &&
			(isIP(trimmed) === 4 || hostNamePattern.test(trimmed)));
	if (!valid) {
		throw new PublicHostError(
			`${origin} "${value}" must be a bare host name or IP address, without a scheme, port, or path (for example "devbox.local" or "192.168.1.20").`,
		);
	}
	if (isWildcardHost(unbracketed)) {
		throw new PublicHostError(
			`${origin} "${value}" is a wildcard bind address, not a host a browser can open.`,
		);
	}
	return unbracketed.toLowerCase();
};

/**
 * Resolves the host shown in URLs. Precedence: --public-host flag,
 * TRICKROOM_PUBLIC_HOST, settings `server.publicHost`, then inference.
 * Inference replaces a wildcard bind host with the machine hostname and
 * otherwise keeps the bind host.
 */
export const resolvePublicHost = ({
	bindHost,
	flag,
	env,
	settings,
	hostname,
}: {
	bindHost: string;
	flag?: string;
	env?: string;
	settings?: string;
	hostname: () => string;
}): ResolvedPublicHost => {
	const candidates: [PublicHostSource, string | undefined, string][] = [
		["flag", flag, "--public-host"],
		["env", env, "TRICKROOM_PUBLIC_HOST"],
		["settings", settings, "server.publicHost in Trickroom settings"],
	];
	for (const [source, value, origin] of candidates) {
		if (value?.trim()) {
			return { host: parsePublicHost(value, origin), source };
		}
	}

	if (isWildcardHost(bindHost)) {
		const machineHost = hostname().trim();
		if (machineHost) {
			return { host: machineHost.toLowerCase(), source: "inferred" };
		}
	}
	return { host: stripBrackets(bindHost.trim()), source: "inferred" };
};

export type ResolvedPublicUrl = {
	/** Normalized base URL ending in `/`, e.g. `https://devbox.example/`. */
	url: string;
	/** The URL's hostname, unbracketed. */
	host: string;
	source: Exclude<PublicHostSource, "inferred">;
};

/**
 * Validates a user-supplied public base URL: http(s), a host, and an optional
 * port. Path prefixes are rejected because the client loads `/assets/` and
 * `/api/` from the origin root.
 */
export const parsePublicUrl = (value: string, origin: string) => {
	const trimmed = value.trim();
	const fail = (reason: string): never => {
		throw new PublicHostError(`${origin} "${value}" ${reason}.`);
	};
	let parsed: URL;
	try {
		parsed = new URL(trimmed);
	} catch {
		return fail(
			'must be an absolute http or https URL (for example "https://devbox.example")',
		);
	}
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		fail("must use http or https");
	}
	if (parsed.username || parsed.password) {
		fail("must not contain credentials");
	}
	if (trimmed.includes("?") || trimmed.includes("#")) {
		fail("must not contain a query string or fragment");
	}
	if (parsed.pathname !== "/") {
		fail(
			"must not contain a path; Trickroom has to be served from the root of its origin",
		);
	}
	const host = stripBrackets(parsed.hostname);
	if (!host || isWildcardHost(host)) {
		fail("must name a host a browser can open, not a wildcard bind address");
	}
	return { url: `${parsed.protocol}//${parsed.host}/`, host };
};

/**
 * Resolves the configured public base URL, or null when none is configured.
 * Precedence: --public-url flag, TRICKROOM_PUBLIC_URL, settings
 * `server.publicUrl`. A public URL takes precedence over every public host
 * source.
 */
export const resolvePublicUrl = ({
	flag,
	env,
	settings,
}: {
	flag?: string;
	env?: string;
	settings?: string;
}): ResolvedPublicUrl | null => {
	const candidates: [
		ResolvedPublicUrl["source"],
		string | undefined,
		string,
	][] = [
		["flag", flag, "--public-url"],
		["env", env, "TRICKROOM_PUBLIC_URL"],
		["settings", settings, "server.publicUrl in Trickroom settings"],
	];
	for (const [source, value, origin] of candidates) {
		if (value?.trim()) {
			return { ...parsePublicUrl(value, origin), source };
		}
	}
	return null;
};
