import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { sha256Hex } from "./sha256";

describe("sha256Hex", () => {
	it("matches known sha256 test vectors", () => {
		expect(sha256Hex("abc")).toBe(
			"ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
		);
		expect(sha256Hex("")).toBe(
			"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
		);
	});

	it("matches node crypto for UTF-8 input", () => {
		const input = "Trickroom sha256 sample: café 🚀";
		expect(sha256Hex(input)).toBe(
			createHash("sha256").update(input).digest("hex"),
		);
	});
});
