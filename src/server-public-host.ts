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
