import { describe, expect, it } from "vitest";
import {
	formatServerUrlHost,
	isLoopbackHost,
	requireSessionTokenForHost,
} from "./server-auth";

describe("server auth host policy", () => {
	it.each([
		"localhost",
		"app.localhost",
		"127.0.0.1",
		"127.20.30.40",
		"::1",
		"[::1]",
	])("recognizes %s as loopback", (host) =>
		expect(isLoopbackHost(host)).toBe(true));

	it.each([
		"0.0.0.0",
		"::",
		"192.168.1.20",
		"trickroom.example.com",
	])("recognizes %s as non-loopback", (host) =>
		expect(isLoopbackHost(host)).toBe(false));

	it("requires a token for non-loopback binds", () => {
		expect(() => requireSessionTokenForHost("0.0.0.0", undefined)).toThrow(
			"without TRICKROOM_SESSION_TOKEN",
		);
		expect(() => requireSessionTokenForHost("0.0.0.0", "token")).not.toThrow();
		expect(() =>
			requireSessionTokenForHost("localhost", undefined),
		).not.toThrow();
	});

	it("formats IPv6 hosts for URLs", () => {
		expect(formatServerUrlHost("::1")).toBe("[::1]");
		expect(formatServerUrlHost("[::1]")).toBe("[::1]");
		expect(formatServerUrlHost("localhost")).toBe("localhost");
	});
});
