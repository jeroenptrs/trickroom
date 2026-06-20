import { describe, expect, it } from "vitest";
import {
	buildDesignResourceUri,
	parseDesignResourceUri,
	slugifyDesignTitle,
} from "./resources";

describe("slugifyDesignTitle", () => {
	it("normalizes ASCII fold, lowercases, collapses non-alphanumeric, trims, and trims length", () => {
		expect(slugifyDesignTitle("  Äccënt — Démo!!!  ")).toBe("accent-demo");
	});

	it("collapses non-alphanumeric runs", () => {
		expect(slugifyDesignTitle("A__b...c$$d")).toBe("a-b-c-d");
	});

	it("caps slugs to 30 characters", () => {
		expect(slugifyDesignTitle("This is a super long title with many words")).toBe(
			"this-is-a-super-long-title-wit",
		);
	});
});

describe("buildDesignResourceUri", () => {
	it("builds slug-bearing URIs", () => {
		expect(
			buildDesignResourceUri(
				"loc-01",
				"12345678-1234-4abc-8def-123456789abc",
				"Design #1",
			),
		).toMatchInlineSnapshot(
			'"trickroom://proj/loc-01/design/design-1--12345678-1234-4abc-8def-123456789abc"',
		);
	});

	it("builds bare-id URIs when slug is not provided", () => {
		expect(
			buildDesignResourceUri(
				"loc-02",
				"12345678-1234-4abc-8def-123456789abd",
			),
		).toMatchInlineSnapshot(
			'"trickroom://proj/loc-02/design/12345678-1234-4abc-8def-123456789abd"',
		);
	});
});

describe("parseDesignResourceUri", () => {
	it("parses slug-bearing URIs", () => {
		expect(
			parseDesignResourceUri(
				"trickroom://proj/loc-01/design/my-design--12345678-1234-4abc-8def-123456789abc",
			),
		).toEqual({
			locationId: "loc-01",
			designId: "12345678-1234-4abc-8def-123456789abc",
			slug: "my-design",
		});
	});

	it("parses bare-id URIs", () => {
		expect(
			parseDesignResourceUri(
				"trickroom://proj/loc-02/design/12345678-1234-4abc-8def-123456789abd",
			),
		).toEqual({
			locationId: "loc-02",
			designId: "12345678-1234-4abc-8def-123456789abd",
		});
	});

	it("rejects malformed URIs", () => {
		expect(() => parseDesignResourceUri("http://proj/loc/design/123")).toThrow(
			/Invalid design resource URI/,
		);
		expect(() =>
			parseDesignResourceUri("trickroom://proj/loc/design/bad-id--12345"),
		).toThrow(/Invalid design resource URI/);
	});
});
