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

	it("parses shots, scale, maxHeight and component targets", () => {
		expect(
			parseScreenshotRequest({
				designFileId: "design",
				boardId: "board",
				shots: [{ viewport: 1280, theme: "dark" }, { viewport: "mobile" }],
				scale: 0.5,
				maxHeight: 2000,
			}),
		).toEqual({
			designFileId: "design",
			boardId: "board",
			shots: [{ viewport: 1280, theme: "dark" }, { viewport: "mobile" }],
			scale: 0.5,
			maxHeight: 2000,
		});
		expect(
			parseScreenshotRequest({
				component: {
					systemId: "sys",
					componentId: "cmp",
					source: "draft",
					variants: { size: "lg" },
					rows: "intent",
				},
			}),
		).toEqual({
			component: {
				systemId: "sys",
				componentId: "cmp",
				source: "draft",
				variants: { size: "lg" },
				rows: "intent",
			},
		});
		expect(parseScreenshotRequest({ shots: [] })).toBeNull();
		expect(
			parseScreenshotRequest({ designFileId: "d", shots: [{ theme: "x" }] }),
		).toBeNull();
		expect(
			parseScreenshotRequest({ component: { systemId: "sys" } }),
		).toBeNull();
		expect(
			parseScreenshotRequest({ designFileId: "d", scale: "0.5" }),
		).toBeNull();
	});

	it("returns capture JSON and forwards auth headers", async () => {
		const capture = vi.fn(async () => ({
			designFileId: "design",
			boardId: "board",
			captures: [
				{
					mimeType: "image/png" as const,
					base64: "cG5n",
					bytes: 3,
					width: 100,
					height: 80,
					viewport: { width: 1440, height: 900 },
					theme: "light" as const,
					scale: 1,
				},
			],
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
		expect(await response.json()).toMatchObject({
			captures: [{ base64: "cG5n" }],
		});
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
