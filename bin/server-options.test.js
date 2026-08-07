import { describe, expect, it } from "vitest";
import { configureServerOptions } from "./server-options.js";

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
});
