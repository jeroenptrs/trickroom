import path from "node:path";
import { describe, expect, it } from "vitest";
import {
	resolveScreenshotOutputPath,
	ScreenshotServiceError,
} from "./screenshot-service";
import { resolveScreenshotViewport } from "./types";

describe("screenshot service helpers", () => {
	it("resolves viewport presets", () => {
		expect(resolveScreenshotViewport("mobile")).toEqual({
			width: 390,
			height: 844,
		});
		expect(resolveScreenshotViewport(undefined)).toEqual({
			width: 1440,
			height: 900,
		});
	});

	it("keeps relative screenshot paths inside the project", () => {
		expect(resolveScreenshotOutputPath("/project", "captures/board.png")).toBe(
			path.resolve("/project/captures/board.png"),
		);
		expect(() =>
			resolveScreenshotOutputPath("/project", "../board.png"),
		).toThrowError(ScreenshotServiceError);
		expect(() =>
			resolveScreenshotOutputPath("/project", "captures/board.jpg"),
		).toThrow(/\.png/);
	});
});
