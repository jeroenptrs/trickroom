import { describe, expect, it } from "vitest";
import {
	isWildcardHost,
	PublicHostError,
	parsePublicHost,
	resolvePublicHost,
} from "./server-public-host";

const hostname = () => "DevBox";

describe("resolvePublicHost", () => {
	it("follows flag > env > settings precedence", () => {
		const all = { flag: "flag", env: "env", settings: "settings" };
		expect(
			resolvePublicHost({ bindHost: "0.0.0.0", hostname, ...all }),
		).toEqual({ host: "flag", source: "flag" });
		expect(
			resolvePublicHost({
				bindHost: "0.0.0.0",
				hostname,
				...all,
				flag: undefined,
			}),
		).toEqual({ host: "env", source: "env" });
		expect(
			resolvePublicHost({
				bindHost: "0.0.0.0",
				hostname,
				settings: "settings",
				env: "  ",
			}),
		).toEqual({ host: "settings", source: "settings" });
	});

	it.each([
		"0.0.0.0",
		"::",
		"[::]",
	])("infers the machine hostname for wildcard bind host %s", (bindHost) =>
		expect(resolvePublicHost({ bindHost, hostname })).toEqual({
			host: "devbox",
			source: "inferred",
		}));

	it.each([
		["localhost", "localhost"],
		["127.0.0.1", "127.0.0.1"],
		["192.168.1.20", "192.168.1.20"],
		["devbox.lan", "devbox.lan"],
		["::1", "::1"],
		["[::1]", "::1"],
	])("keeps non-wildcard bind host %s", (bindHost, host) =>
		expect(resolvePublicHost({ bindHost, hostname })).toEqual({
			host,
			source: "inferred",
		}));

	it("falls back to the bind host when the machine hostname is empty", () => {
		expect(
			resolvePublicHost({ bindHost: "0.0.0.0", hostname: () => "" }).host,
		).toBe("0.0.0.0");
	});

	it("names the offending source in validation errors", () => {
		expect(() =>
			resolvePublicHost({
				bindHost: "0.0.0.0",
				hostname,
				settings: "http://devbox",
			}),
		).toThrow(/server\.publicHost in Trickroom settings "http:\/\/devbox"/);
		expect(() =>
			resolvePublicHost({ bindHost: "0.0.0.0", hostname, flag: "devbox:80" }),
		).toThrow(/--public-host "devbox:80"/);
	});
});

describe("parsePublicHost", () => {
	it.each([
		["devbox", "devbox"],
		["DevBox.Local", "devbox.local"],
		[" 192.168.1.20 ", "192.168.1.20"],
		["fe80::1", "fe80::1"],
		["[fe80::1]", "fe80::1"],
		["my_host", "my_host"],
	])("accepts %s", (value, expected) =>
		expect(parsePublicHost(value, "test")).toBe(expected));

	it.each([
		"http://devbox",
		"devbox:8080",
		"192.168.1.20:8080",
		"[::1]:8080",
		"devbox/path",
		"devbox?x=1",
		"user@devbox",
		"dev box",
		"-devbox",
		"0.0.0.0",
		"[::]",
	])("rejects %s", (value) =>
		expect(() => parsePublicHost(value, "test")).toThrow(PublicHostError));
});

describe("isWildcardHost", () => {
	it.each([
		["0.0.0.0", true],
		["::", true],
		["[::]", true],
		["0:0:0:0:0:0:0:0", true],
		["localhost", false],
		["::1", false],
	])("%s -> %s", (host, expected) =>
		expect(isWildcardHost(host)).toBe(expected));
});
