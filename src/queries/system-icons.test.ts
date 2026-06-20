import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	systemIconSvgQueriesQueryKey,
	systemIconSvgQueryKey,
	systemIconSvgQueryOptions,
} from "./system-icons";

describe("system icon SVG query", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("fetches URL-encoded icon SVG text", async () => {
		const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
			new Response('<svg viewBox="0 0 24 24"></svg>', {
				status: 200,
				headers: { "content-type": "image/svg+xml" },
			}),
		);
		vi.stubGlobal("fetch", fetchMock);
		const queryClient = new QueryClient();

		const svg = await queryClient.fetchQuery(
			systemIconSvgQueryOptions("Core System", "src/search icon"),
		);

		expect(fetchMock).toHaveBeenCalledWith(
			"/api/trickroom/systems/Core%20System/icons/src%2Fsearch%20icon/svg",
		);
		expect(svg).toBe('<svg viewBox="0 0 24 24"></svg>');
		expect(
			queryClient.getQueryData(
				systemIconSvgQueryKey("Core System", "src/search icon"),
			),
		).toBe(svg);
	});

	it("exposes a system-wide SVG cache key prefix", () => {
		expect(systemIconSvgQueriesQueryKey("Core System")).toEqual([
			"trickroom-system-icon-svg",
			"Core System",
		]);
		expect(systemIconSvgQueryKey("Core System", "src/search icon")).toEqual([
			"trickroom-system-icon-svg",
			"Core System",
			"src/search icon",
		]);
		expect(
			systemIconSvgQueryKey("Core System", "src/search icon", "site-location"),
		).toEqual([
			"trickroom-system-icon-svg",
			"Core System",
			"src/search icon",
			"site-location",
		]);
	});

	it("returns null for non-OK responses without retrying", async () => {
		const fetchMock = vi
			.fn<typeof fetch>()
			.mockResolvedValue(new Response("Missing", { status: 404 }));
		vi.stubGlobal("fetch", fetchMock);
		const queryClient = new QueryClient();

		const svg = await queryClient.fetchQuery(
			systemIconSvgQueryOptions("Core", "src/missing"),
		);

		expect(svg).toBeNull();
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("surfaces fetch errors without retrying", async () => {
		const fetchMock = vi
			.fn<typeof fetch>()
			.mockRejectedValue(new Error("network unavailable"));
		vi.stubGlobal("fetch", fetchMock);
		const queryClient = new QueryClient();

		await expect(
			queryClient.fetchQuery(systemIconSvgQueryOptions("Core", "src/search")),
		).rejects.toThrow("network unavailable");
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});
});
