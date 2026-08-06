import { randomBytes } from "node:crypto";
import { isIP } from "node:net";

const isLoopbackHost = (host) => {
	const normalized = host
		.trim()
		.toLowerCase()
		.replace(/^\[|\]$/g, "");
	if (normalized === "localhost" || normalized.endsWith(".localhost")) {
		return true;
	}
	if (isIP(normalized) === 4) {
		return normalized.split(".")[0] === "127";
	}
	return (
		isIP(normalized) === 6 &&
		(normalized === "::1" ||
			normalized === "0:0:0:0:0:0:0:1" ||
			normalized.startsWith("::ffff:127."))
	);
};

export const configureServerOptions = (
	argv = process.argv,
	environment = process.env,
	generateToken = () => randomBytes(32).toString("base64url"),
) => {
	const forwardedArgs = argv.slice(0, 2);
	let configuredHost;

	for (let index = 2; index < argv.length; index += 1) {
		const argument = argv[index];
		if (argument === "--host") {
			const value = argv[index + 1];
			if (!value || value.startsWith("--")) {
				throw new Error("--host requires a hostname or IP address.");
			}
			configuredHost = value;
			index += 1;
			continue;
		}
		if (argument.startsWith("--host=")) {
			configuredHost = argument.slice("--host=".length);
			if (!configuredHost) {
				throw new Error("--host requires a hostname or IP address.");
			}
			continue;
		}
		forwardedArgs.push(argument);
	}

	if (configuredHost) {
		environment.TRICKROOM_HTTP_HOST = configuredHost;
	}

	const effectiveHost =
		configuredHost ?? environment.TRICKROOM_HTTP_HOST ?? "localhost";
	let generatedSessionToken = false;
	if (
		!isLoopbackHost(effectiveHost) &&
		!environment.TRICKROOM_SESSION_TOKEN?.trim()
	) {
		environment.TRICKROOM_SESSION_TOKEN = generateToken();
		generatedSessionToken = true;
	}

	return {
		argv: forwardedArgs,
		generatedSessionToken,
		sessionAuthEnabled: Boolean(environment.TRICKROOM_SESSION_TOKEN?.trim()),
	};
};
