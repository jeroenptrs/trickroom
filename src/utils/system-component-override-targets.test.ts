import { describe, expect, it } from "vitest";
import {
	findOverrideTargetForCapability,
	inferOverrideTargetCapabilities,
	normalizeOverrideTargetCapabilities,
	resolveSystemComponentOverrideValue,
} from "./system-component-override-targets";
import type { PublishedSystemComponentVersion } from "./system-components";

const version = {
	version: "1",
	publishedAt: "2026-05-26T14:00:00.000Z",
	templateHash: "sha256:test",
	variantSchemaHash: "sha256:test",
	root: {
		path: "root",
		library: "trickroom",
		component: "container",
		children: [
			{
				path: "label",
				library: "trickroom",
				component: "text",
				text: "Label",
			},
			{
				path: "icon",
				library: "trickroom",
				component: "icon",
			},
		],
	},
	overrideTargets: {
		labelTarget: {
			targetId: "labelTarget",
			label: "Label",
			path: "label",
			capabilities: ["className", "text"],
		},
		iconTarget: {
			targetId: "iconTarget",
			label: "Icon",
			path: "icon",
			capabilities: ["className", "icon"],
		},
	},
} satisfies PublishedSystemComponentVersion;

describe("system-component-override-targets", () => {
	it("defaults missing capabilities to className", () => {
		expect(
			normalizeOverrideTargetCapabilities({
				capabilities: undefined,
			}),
		).toEqual(["className"]);
	});

	it("infers capabilities from template entity metadata", () => {
		expect(
			inferOverrideTargetCapabilities({
				role: "text",
				library: "trickroom",
				component: "text",
			}),
		).toEqual(["className", "text"]);
		expect(
			inferOverrideTargetCapabilities({
				role: "leaf",
				library: "trickroom",
				component: "icon",
			}),
		).toEqual(["className", "icon"]);
	});

	it("resolves override values by path and capability", () => {
		expect(
			findOverrideTargetForCapability(version, "label", "text")?.targetId,
		).toBe("labelTarget");
		expect(
			resolveSystemComponentOverrideValue(version, "label", "text", {
				labelTarget: { text: "Custom label" },
			}),
		).toBe("Custom label");
		expect(
			resolveSystemComponentOverrideValue(version, "icon", "icon", {
				iconTarget: { "data-trickroom-icon-id": "search" },
			}),
		).toBe("search");
	});
});
