import { describe, expect, it } from "vitest";
import {
	buildSystemComponentPath,
	readSystemComponentDeepLinkNode,
} from "./system-deep-link";

describe("system component deep links", () => {
	it("builds component paths with optional version and template path", () => {
		expect(buildSystemComponentPath("Core System", "cmp_1")).toBe(
			"/system/Core%20System?component=cmp_1",
		);
		expect(
			buildSystemComponentPath("core", "cmp_1", {
				version: "4",
				path: "root.children[0]",
			}),
		).toBe("/system/core?component=cmp_1&version=4&path=root.children%5B0%5D");
	});

	it("reads the template node back, only when a path is named", () => {
		const url = buildSystemComponentPath("core", "cmp_1", {
			version: "4",
			path: "popup/backdrop",
		});
		const params = new URLSearchParams(url.split("?")[1]);
		expect(readSystemComponentDeepLinkNode(params)).toEqual({
			componentId: "cmp_1",
			path: "popup/backdrop",
			version: "4",
		});
		expect(
			readSystemComponentDeepLinkNode(new URLSearchParams("component=cmp_1")),
		).toBeNull();
	});
});
