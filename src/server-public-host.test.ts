import { describe, expect, it } from "vitest";
import {
	isWildcardHost,
	PublicHostError,
	parsePublicHost,
	parsePublicUrl,
	resolvePublicHost,
	resolvePublicUrl,
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

describe("resolvePublicUrl", () => {
	it("returns null when nothing is configured", () => {
		expect(resolvePublicUrl({})).toBeNull();
		expect(resolvePublicUrl({ env: " ", settings: "" })).toBeNull();
	});

	it("follows flag > env > settings precedence", () => {
		const all = {
			flag: "https://flag.example",
			env: "https://env.example",
			settings: "https://settings.example",
		};
		expect(resolvePublicUrl(all)).toEqual({
			url: "https://flag.example/",
			host: "flag.example",
			source: "flag",
		});
		expect(resolvePublicUrl({ ...all, flag: undefined })?.source).toBe("env");
		expect(resolvePublicUrl({ settings: all.settings, env: "" })?.source).toBe(
			"settings",
		);
	});

	it("names the offending source in validation errors", () => {
		expect(() =>
			resolvePublicUrl({ settings: "https://devbox.example/trickroom" }),
		).toThrow(
			/server\.publicUrl in Trickroom settings .* must not contain a path/,
		);
		expect(() => resolvePublicUrl({ env: "devbox.example" })).toThrow(
			/TRICKROOM_PUBLIC_URL "devbox.example" must be an absolute http or https URL/,
		);
	});
});

describe("parsePublicUrl", () => {
	it.each([
		[
			"https://devcontainer-82761ffd7f4a.deltablue.io",
			"https://devcontainer-82761ffd7f4a.deltablue.io/",
			"devcontainer-82761ffd7f4a.deltablue.io",
		],
		["https://DevBox.Example/", "https://devbox.example/", "devbox.example"],
		["https://devbox.example:443", "https://devbox.example/", "devbox.example"],
		["http://devbox:8080", "http://devbox:8080/", "devbox"],
		[
			" http://192.168.1.20:18100/ ",
			"http://192.168.1.20:18100/",
			"192.168.1.20",
		],
		["https://[fe80::1]:8443", "https://[fe80::1]:8443/", "fe80::1"],
	])("accepts %s", (value, url, host) =>
		expect(parsePublicUrl(value, "test")).toEqual({ url, host }));

	it.each([
		["devbox.example", /absolute http or https URL/],
		["ftp://devbox.example", /http or https/],
		["https://user:pass@devbox.example", /credentials/],
		["https://user@devbox.example", /credentials/],
		["https://devbox.example/?a=1", /query string or fragment/],
		["https://devbox.example/?", /query string or fragment/],
		["https://devbox.example/#x", /query string or fragment/],
		["https://devbox.example/trickroom/", /must not contain a path/],
		["http://0.0.0.0:18100", /wildcard/],
		["http://[::]:18100", /wildcard/],
	])("rejects %s", (value, message) =>
		expect(() => parsePublicUrl(value, "test")).toThrow(message));
});
