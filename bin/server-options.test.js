import { describe, expect, it } from "vitest";
import { configureServerOptions, isWildcardHost } from "./server-options.js";

describe("configureServerOptions", () => {
	it("keeps loopback hosts frictionless", () => {
		const environment = {};
		const result = configureServerOptions(
			["node", "trickroom", "--host", "127.0.0.1", "."],
			environment,
			() => "generated-token",
		);

		expect(environment).toEqual({ TRICKROOM_HTTP_HOST: "127.0.0.1" });
		expect(result).toEqual({
			argv: ["node", "trickroom", "."],
			host: "127.0.0.1",
			publicHost: null,
			publicUrl: null,
			port: 18100,
			token: null,
			noOpen: false,
			silent: false,
			generatedSessionToken: false,
			sessionAuthEnabled: false,
		});
	});

	it("generates auth for a non-loopback host", () => {
		const environment = {};
		const result = configureServerOptions(
			["node", "trickroom", "--host=0.0.0.0", "/project"],
			environment,
			() => "generated-token",
		);

		expect(environment).toEqual({
			TRICKROOM_HTTP_HOST: "0.0.0.0",
			TRICKROOM_SESSION_TOKEN: "generated-token",
		});
		expect(result.generatedSessionToken).toBe(true);
		expect(result.sessionAuthEnabled).toBe(true);
		expect(result.token).toBe("generated-token");
		expect(result.argv).toEqual(["node", "trickroom", "/project"]);
	});

	it("preserves an explicitly configured token", () => {
		const environment = { TRICKROOM_SESSION_TOKEN: "chosen-token" };
		const result = configureServerOptions(
			["node", "trickroom", "--host", "192.168.1.20"],
			environment,
			() => "generated-token",
		);

		expect(environment.TRICKROOM_SESSION_TOKEN).toBe("chosen-token");
		expect(result.generatedSessionToken).toBe(false);
		expect(result.sessionAuthEnabled).toBe(true);
	});

	it("configures port, token, and browser behavior", () => {
		const environment = {};
		const result = configureServerOptions(
			[
				"node",
				"trickroom",
				"--port=0",
				"--token",
				"chosen-token",
				"--no-open",
				"/project",
			],
			environment,
		);

		expect(environment).toEqual({
			TRICKROOM_HTTP_PORT: "0",
			TRICKROOM_SESSION_TOKEN: "chosen-token",
		});
		expect(result).toMatchObject({
			argv: ["node", "trickroom", "/project"],
			port: 0,
			token: "chosen-token",
			noOpen: true,
			silent: false,
		});
	});

	it("makes silent mode imply no-open", () => {
		const result = configureServerOptions(
			["node", "trickroom", "--silent"],
			{},
		);

		expect(result.silent).toBe(true);
		expect(result.noOpen).toBe(true);
	});

	it.each([
		"-1",
		"65536",
		"1.5",
		"not-a-port",
	])("rejects invalid port %s", (port) => {
		expect(() =>
			configureServerOptions(["node", "trickroom", "--port", port], {}),
		).toThrow("--port must be an integer between 0 and 65535");
	});

	it("rejects unknown options", () => {
		expect(() =>
			configureServerOptions(["node", "trickroom", "--wat"], {}),
		).toThrow('Unknown serve option "--wat"');
	});

	it("rejects multiple project paths", () => {
		expect(() =>
			configureServerOptions(["node", "trickroom", "/first", "/second"], {}),
		).toThrow("at most one project path");
	});

	it("rejects a missing host value", () => {
		expect(() =>
			configureServerOptions(["node", "trickroom", "--host"], {}),
		).toThrow("--host requires a value");
	});

	it("forwards --public-host to the server without changing the bind host", () => {
		const environment = {};
		const result = configureServerOptions(
			["node", "trickroom", "--host", "0.0.0.0", "--public-host", "devbox"],
			environment,
			() => "generated-token",
		);

		expect(environment).toEqual({
			TRICKROOM_HTTP_HOST: "0.0.0.0",
			TRICKROOM_CLI_PUBLIC_HOST: "devbox",
			TRICKROOM_SESSION_TOKEN: "generated-token",
		});
		expect(result.host).toBe("0.0.0.0");
		expect(result.publicHost).toBe("devbox");
	});

	it("keeps requiring a token for a wildcard bind with a local-looking public host", () => {
		const environment = {};
		const result = configureServerOptions(
			["node", "trickroom", "--host=0.0.0.0", "--public-host=localhost"],
			environment,
			() => "generated-token",
		);

		expect(result.sessionAuthEnabled).toBe(true);
		expect(environment.TRICKROOM_SESSION_TOKEN).toBe("generated-token");
	});

	it("prefers --public-host over TRICKROOM_PUBLIC_HOST", () => {
		const environment = { TRICKROOM_PUBLIC_HOST: "from-env" };
		expect(
			configureServerOptions(
				["node", "trickroom", "--public-host=from-flag"],
				environment,
			).publicHost,
		).toBe("from-flag");
		expect(
			configureServerOptions(["node", "trickroom"], {
				TRICKROOM_PUBLIC_HOST: "from-env",
			}).publicHost,
		).toBe("from-env");
	});

	it.each([
		["node", "trickroom", "--public-host"],
		["node", "trickroom", "--public-host", "--no-open"],
		["node", "trickroom", "--public-host="],
	])("requires a --public-host value", (...argv) => {
		expect(() => configureServerOptions(argv, {})).toThrow(
			"--public-host requires a value.",
		);
	});

	it.each([
		"0.0.0.0",
		"::",
		"[::]",
		" 0.0.0.0 ",
	])("recognizes %s as a wildcard host", (host) =>
		expect(isWildcardHost(host)).toBe(true));

	it("forwards --public-url to the server and prefers it over TRICKROOM_PUBLIC_URL", () => {
		const environment = { TRICKROOM_PUBLIC_URL: "https://from-env.example" };
		const result = configureServerOptions(
			[
				"node",
				"trickroom",
				"--host=0.0.0.0",
				"--public-url",
				"https://from-flag.example",
			],
			environment,
			() => "generated-token",
		);

		expect(environment.TRICKROOM_CLI_PUBLIC_URL).toBe(
			"https://from-flag.example",
		);
		expect(result.publicUrl).toBe("https://from-flag.example");
		expect(result.host).toBe("0.0.0.0");
		expect(result.sessionAuthEnabled).toBe(true);
		expect(
			configureServerOptions(["node", "trickroom"], {
				TRICKROOM_PUBLIC_URL: "https://from-env.example",
			}).publicUrl,
		).toBe("https://from-env.example");
	});

	it.each([
		["node", "trickroom", "--public-url"],
		["node", "trickroom", "--public-url", "--no-open"],
		["node", "trickroom", "--public-url="],
	])("requires a --public-url value", (...argv) => {
		expect(() => configureServerOptions(argv, {})).toThrow(
			"--public-url requires a value.",
		);
	});
});
