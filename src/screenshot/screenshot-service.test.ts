import path from "node:path";
import { describe, expect, it } from "vitest";
import {
	buildCaptureUrl,
	captureScreenshot,
	resolveScreenshotMaxHeight,
	resolveScreenshotOutputPath,
	resolveScreenshotScale,
	ScreenshotServiceError,
	suffixOutputPath,
} from "./screenshot-service";
import { describeScreenshotViewport, resolveScreenshotViewport } from "./types";

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
	it("treats a bare number as a width and labels viewports", () => {
		expect(resolveScreenshotViewport(1280)).toEqual({
			width: 1280,
			height: 900,
		});
		expect(describeScreenshotViewport(undefined)).toBe("desktop");
		expect(describeScreenshotViewport("mobile")).toBe("mobile");
		expect(describeScreenshotViewport(1280)).toBe("1280x900");
	});

	it("validates scale and maxHeight", () => {
		expect(resolveScreenshotScale(undefined)).toBe(1);
		expect(resolveScreenshotScale(0.5)).toBe(0.5);
		expect(() => resolveScreenshotScale(0.1)).toThrowError(
			ScreenshotServiceError,
		);
		expect(
			resolveScreenshotMaxHeight(undefined, { width: 390, height: 844 }),
		).toBe(1688);
		expect(() =>
			resolveScreenshotMaxHeight(9000, { width: 390, height: 844 }),
		).toThrow(/maxHeight/);
	});

	it("suffixes output paths per capture", () => {
		expect(suffixOutputPath("captures/board.png", "mobile-dark")).toBe(
			"captures/board-mobile-dark.png",
		);
		expect(suffixOutputPath("board.png", "Usage Alerts — Overview")).toBe(
			"board-Usage-Alerts-Overview.png",
		);
	});

	it("builds design and component capture URLs", () => {
		expect(
			buildCaptureUrl(
				{ designFileId: "d 1", boardId: "b", nodeId: "n" },
				"dark",
				"http://127.0.0.1:1/",
			).toString(),
		).toBe("http://127.0.0.1:1/capture/d%201/b?theme=dark&node=n");
		const componentUrl = buildCaptureUrl(
			{
				component: {
					systemId: "sys",
					componentId: "cmp",
					source: "draft",
					variants: { size: "lg", tone: "neutral" },
					rows: "intent",
					columns: "size",
				},
			},
			"light",
			"http://127.0.0.1:1/",
		);
		expect(componentUrl.pathname).toBe("/capture/component/sys/cmp");
		expect(componentUrl.searchParams.getAll("variant")).toEqual([
			"size:lg",
			"tone:neutral",
		]);
		expect(componentUrl.searchParams.get("rows")).toBe("intent");
		expect(componentUrl.searchParams.get("columns")).toBe("size");
		expect(componentUrl.searchParams.get("source")).toBe("draft");
	});

	it("rejects invalid requests before launching a browser", async () => {
		const loadPlaywright = async () => {
			throw new Error("should not load");
		};
		const options = { baseUrl: "http://x/", projectRoot: "/p", loadPlaywright };
		await expect(captureScreenshot({}, options)).rejects.toThrow(
			/designFileId/,
		);
		await expect(
			captureScreenshot(
				{
					designFileId: "d",
					shots: Array.from({ length: 13 }, () => ({})),
				},
				options,
			),
		).rejects.toThrow(/at most 12/);
		await expect(
			captureScreenshot({ designFileId: "d", scale: 3 }, options),
		).rejects.toThrow(/scale/);
		await expect(
			captureScreenshot({ designFileId: "d", viewport: 5000 }, options),
		).rejects.toThrow(/viewport/);
	});
});
