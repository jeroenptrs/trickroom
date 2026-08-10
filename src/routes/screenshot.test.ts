import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { createScreenshotRoutes, parseScreenshotRequest } from "./screenshot";

describe("screenshot route", () => {
	it("parses presets and explicit viewports", () => {
		expect(
			parseScreenshotRequest({
				designFileId: "design",
				viewport: "tablet",
				theme: "dark",
			}),
		).toMatchObject({
			designFileId: "design",
			viewport: "tablet",
			theme: "dark",
		});
		expect(
			parseScreenshotRequest({
				designFileId: "design",
				viewport: { width: 1200, height: 800 },
			}),
		).toMatchObject({ viewport: { width: 1200, height: 800 } });
		expect(
			parseScreenshotRequest({ designFileId: "design", viewport: "wide" }),
		).toBeNull();
	});

	it("returns capture JSON and forwards auth headers", async () => {
		const capture = vi.fn(async () => ({
			mimeType: "image/png" as const,
			base64: "cG5n",
			bytes: 3,
			width: 100,
			height: 80,
			designFileId: "design",
			boardId: "board",
			theme: "light" as const,
		}));
		const app = new Hono<{
			Variables: { projectRoot: string; config: never };
		}>();
		app.use("*", async (c, next) => {
			c.set("projectRoot", "/project");
			await next();
		});
		app.route("/api/trickroom/screenshot", createScreenshotRoutes(capture));
		const response = await app.request(
			"http://localhost/api/trickroom/screenshot",
			{
				method: "POST",
				headers: {
					"content-type": "application/json",
					cookie: "trickroom_session=token",
				},
				body: JSON.stringify({ designFileId: "design", boardId: "board" }),
			},
		);

		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({ base64: "cG5n" });
		expect(capture).toHaveBeenCalledWith(
			expect.objectContaining({ designFileId: "design", boardId: "board" }),
			expect.objectContaining({
				baseUrl: "http://localhost",
				projectRoot: "/project",
				requestHeaders: { cookie: "trickroom_session=token" },
			}),
		);
	});
});
