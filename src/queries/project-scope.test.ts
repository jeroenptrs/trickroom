import { describe, expect, it } from "vitest";
import { configFileProjectQueryKey } from "./config-file";
import {
	designFileQueryKey,
	designSummariesProjectQueryKey,
} from "./design-file";
import { getProjectQueryScope } from "./project-scope";
import { systemAssetsQueryKey } from "./system-assets";
import { systemIconSvgQueryKey, systemIconsQueryKey } from "./system-icons";
import { systemsProjectQueryKey } from "./systems";
import { storedTailwindTokensQueryKey } from "./tailwind-sync-tokens";

describe("project-scoped query keys", () => {
	it("uses the active project identity as a cache namespace", () => {
		expect(configFileProjectQueryKey("site-location")).toEqual([
			"trickroom-config",
			"site-location",
		]);
		expect(systemsProjectQueryKey("site-location")).toEqual([
			"trickroom-systems",
			"site-location",
		]);
		expect(designSummariesProjectQueryKey("site-location")).toEqual([
			"trickroom-designs",
			"site-location",
		]);
		expect(designFileQueryKey("home.json", "site-location")).toEqual([
			"trickroom-design",
			"home.json",
			"site-location",
		]);
		expect(
			storedTailwindTokensQueryKey("site-system", "site-location"),
		).toEqual(["trickroom-tailwind-tokens", "site-system", "site-location"]);
		expect(systemAssetsQueryKey("site-system", "site-location")).toEqual([
			"trickroom-system-assets",
			"site-system",
			"site-location",
		]);
		expect(systemIconsQueryKey("site-system", "site-location")).toEqual([
			"trickroom-system-icons",
			"site-system",
			"site-location",
		]);
		expect(
			systemIconSvgQueryKey("site-system", "src/search", "site-location"),
		).toEqual([
			"trickroom-system-icon-svg",
			"site-system",
			"src/search",
			"site-location",
		]);
	});

	it("keeps base keys available for broad invalidation", () => {
		expect(configFileProjectQueryKey()).toEqual(["trickroom-config"]);
		expect(systemsProjectQueryKey()).toEqual(["trickroom-systems"]);
		expect(designSummariesProjectQueryKey()).toEqual(["trickroom-designs"]);
		expect(designFileQueryKey("home.json")).toEqual([
			"trickroom-design",
			"home.json",
		]);
		expect(storedTailwindTokensQueryKey("site-system")).toEqual([
			"trickroom-tailwind-tokens",
			"site-system",
		]);
		expect(systemAssetsQueryKey("site-system")).toEqual([
			"trickroom-system-assets",
			"site-system",
		]);
		expect(systemIconsQueryKey("site-system")).toEqual([
			"trickroom-system-icons",
			"site-system",
		]);
		expect(systemIconSvgQueryKey("site-system", "src/search")).toEqual([
			"trickroom-system-icon-svg",
			"site-system",
			"src/search",
		]);
	});

	it("prefers location id over project id and root", () => {
		expect(
			getProjectQueryScope({
				locationId: "location-1",
				projectId: "project-1",
				projectRoot: "/tmp/project",
			}),
		).toBe("location-1");
	});
});
