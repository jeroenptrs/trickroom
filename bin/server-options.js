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
	let configuredPort;
	let configuredToken;
	let noOpen = false;
	let silent = false;
	let positionalArgumentCount = 0;

	const requireOptionValue = (option, value) => {
		if (!value || value.startsWith("--")) {
			throw new Error(`${option} requires a value.`);
		}
		return value;
	};

	const parsePort = (value) => {
		if (!/^\d+$/.test(value)) {
			throw new Error("--port must be an integer between 0 and 65535.");
		}
		const port = Number(value);
		if (!Number.isSafeInteger(port) || port < 0 || port > 65_535) {
			throw new Error("--port must be an integer between 0 and 65535.");
		}
		return port;
	};

	for (let index = 2; index < argv.length; index += 1) {
		const argument = argv[index];
		if (argument === "--host") {
			configuredHost = requireOptionValue("--host", argv[index + 1]);
			index += 1;
			continue;
		}
		if (argument.startsWith("--host=")) {
			configuredHost = argument.slice("--host=".length);
			if (!configuredHost) {
				throw new Error("--host requires a value.");
			}
			continue;
		}
		if (argument === "--port") {
			configuredPort = parsePort(requireOptionValue("--port", argv[index + 1]));
			index += 1;
			continue;
		}
		if (argument.startsWith("--port=")) {
			configuredPort = parsePort(argument.slice("--port=".length));
			continue;
		}
		if (argument === "--token") {
			configuredToken = requireOptionValue("--token", argv[index + 1]);
			index += 1;
			continue;
		}
		if (argument.startsWith("--token=")) {
			configuredToken = argument.slice("--token=".length);
			if (!configuredToken) {
				throw new Error("--token requires a value.");
			}
			continue;
		}
		if (argument === "--no-open") {
			noOpen = true;
			continue;
		}
		if (argument === "--silent") {
			silent = true;
			noOpen = true;
			continue;
		}
		if (argument.startsWith("--")) {
			throw new Error(`Unknown serve option "${argument}".`);
		}
		positionalArgumentCount += 1;
		if (positionalArgumentCount > 1) {
			throw new Error("trickroom serve accepts at most one project path.");
		}
		forwardedArgs.push(argument);
	}

	if (configuredHost) {
		environment.TRICKROOM_HTTP_HOST = configuredHost;
	}
	if (configuredPort !== undefined) {
		environment.TRICKROOM_HTTP_PORT = String(configuredPort);
	}
	if (configuredToken !== undefined) {
		environment.TRICKROOM_SESSION_TOKEN = configuredToken;
	}

	const effectiveHost =
		configuredHost ?? environment.TRICKROOM_HTTP_HOST ?? "localhost";
	const effectivePort = parsePort(environment.TRICKROOM_HTTP_PORT ?? "18100");
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
		host: effectiveHost,
		port: effectivePort,
		token: environment.TRICKROOM_SESSION_TOKEN?.trim() || null,
		noOpen,
		silent,
		generatedSessionToken,
		sessionAuthEnabled: Boolean(environment.TRICKROOM_SESSION_TOKEN?.trim()),
	};
};
