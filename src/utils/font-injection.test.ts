import { describe, expect, it } from "vitest";
import { buildSystemFontInjectionPlan } from "./font-injection";
import type { FontManifest } from "./font-manifest-service";

describe("font injection", () => {
	it("builds stylesheet links and @font-face rules for registered sources", () => {
		const manifest: FontManifest = {
			version: 1,
			metadata: { updatedAt: "2026-05-25T00:00:00.000Z" },
			fonts: {
				brand: {
					name: "Brand",
					family: "Brand Sans",
					faces: [
						{
							style: "normal",
							weight: "400",
							display: "swap",
							sources: [
								{
									kind: "remoteStylesheet",
									url: "https://fonts.googleapis.com/css2?family=Brand+Sans",
								},
								{
									kind: "projectFile",
									path: "src/fonts/brand.woff2",
									format: "woff2",
								},
							],
						},
					],
					createdAt: "2026-05-25T00:00:00.000Z",
					updatedAt: "2026-05-25T00:00:00.000Z",
				},
			},
		};

		const plan = buildSystemFontInjectionPlan("sys_core", manifest);
		expect(plan.stylesheetUrls).toEqual([
			"https://fonts.googleapis.com/css2?family=Brand+Sans",
		]);
		expect(plan.fontFaceCss).toContain('font-family: "Brand Sans"');
		expect(plan.fontFaceCss).toContain(
			'/api/trickroom/systems/sys_core/fonts/project-file?path=src%2Ffonts%2Fbrand.woff2',
		);
	});

	it("rejects unsafe characters in injected font-family strings", () => {
		const manifest: FontManifest = {
			version: 1,
			metadata: { updatedAt: "2026-05-25T00:00:00.000Z" },
			fonts: {
				unsafe: {
					name: "Unsafe",
					family: "Unsafe\nFamily",
					faces: [
						{
							style: "normal",
							weight: "400",
							sources: [
								{
									kind: "remoteFile",
									url: "https://cdn.example.com/font.woff2",
									format: "woff2",
								},
							],
						},
					],
					createdAt: "2026-05-25T00:00:00.000Z",
					updatedAt: "2026-05-25T00:00:00.000Z",
				},
			},
		};

		expect(() => buildSystemFontInjectionPlan("sys_core", manifest)).toThrow(
			"Unsafe CSS string value.",
		);
	});
});
