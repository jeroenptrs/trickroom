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

	it("rejects a missing host value", () => {
		expect(() =>
			configureServerOptions(["node", "trickroom", "--host"], {}),
		).toThrow("--host requires a hostname or IP address");
	});
});
