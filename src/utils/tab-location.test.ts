import { afterEach, describe, expect, it, vi } from "vitest";

/** Loads the module as a page at `pathname` would. */
const loadAt = async (pathname: string) => {
	vi.resetModules();
	vi.stubGlobal("window", { location: { pathname } });
	return import("./tab-location");
};

describe("tab location", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.resetModules();
	});

	it("leaves requests alone in a tab that is not pinned", async () => {
		const fetchMock = vi.fn(async () => new Response("{}"));
		vi.stubGlobal("fetch", fetchMock);
		const tab = await loadAt("/design/abc");
		vi.stubGlobal("fetch", fetchMock);

		expect(tab.tabLocationId).toBeNull();
		expect(tab.tabBasename).toBeUndefined();
		expect(tab.getTabPath()).toBe("/design/abc");
		expect(tab.withTabLocation("/api/trickroom/events?clientId=a")).toBe(
			"/api/trickroom/events?clientId=a",
		);
		await tab.apiFetch("/api/trickroom/designs");
		await tab.apiFetch("/api/trickroom/design", { method: "PUT" });
		expect(fetchMock.mock.calls).toEqual([
			["/api/trickroom/designs"],
			["/api/trickroom/design", { method: "PUT" }],
		]);
	});

	it("names the location of a pinned tab on API requests and URLs", async () => {
		const tab = await loadAt("/p/loc_1/design/abc");
		const fetchMock = vi.fn(
			async (_input: string, _init?: RequestInit) => new Response("{}"),
		);
		vi.stubGlobal("fetch", fetchMock);

		expect(tab.tabLocationId).toBe("loc_1");
		expect(tab.tabBasename).toBe("/p/loc_1");
		expect(tab.getTabPath()).toBe("/design/abc");
		expect(tab.getTabPath("/p/loc_1")).toBe("/");
		expect(tab.withTabLocation("/api/trickroom/events?clientId=a")).toBe(
			"/api/trickroom/events?clientId=a&location=loc_1",
		);
		expect(tab.withTabLocation("/api/trickroom/audit-log/summary")).toBe(
			"/api/trickroom/audit-log/summary?location=loc_1",
		);
		expect(tab.withTabLocation("/trickroom-mark.svg")).toBe(
			"/trickroom-mark.svg",
		);

		await tab.apiFetch("/api/trickroom/design", {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
		});
		const init = fetchMock.mock.calls[0]?.[1];
		const headers = new Headers(init?.headers);
		expect(init?.method).toBe("PUT");
		expect(headers.get("x-trickroom-location")).toBe("loc_1");
		expect(headers.get("content-type")).toBe("application/json");
	});

	it("builds the URL of a checkout", async () => {
		const tab = await loadAt("/");

		expect(tab.getCheckoutUrl("loc_1")).toBe("/p/loc_1/");
		expect(tab.getCheckoutUrl("loc_1", "/design/abc")).toBe(
			"/p/loc_1/design/abc",
		);
		expect(tab.tabLocationId).toBeNull();
	});

	it("does not treat a longer first segment as the prefix", async () => {
		const tab = await loadAt("/preview/loc_1");

		expect(tab.tabLocationId).toBeNull();
	});
});
