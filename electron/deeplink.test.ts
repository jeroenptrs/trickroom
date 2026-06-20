import { describe, expect, it } from "vitest";
import {
	findTrickroomDeeplinkInArgs,
	isTrickroomDeeplinkUrl,
	normalizeTrickroomDeeplinkUrl,
} from "./deeplink";

describe("trickroom deeplink helpers", () => {
	it("detects trickroom design resource URLs", () => {
		expect(
			isTrickroomDeeplinkUrl(
				"trickroom://proj/loc_abc/design/assets-test--6efa2422-d01a-4fc7-a550-18c3245359b2",
			),
		).toBe(true);
		expect(isTrickroomDeeplinkUrl("https://example.com")).toBe(false);
	});

	it("normalizes encoded deeplink URLs", () => {
		expect(
			normalizeTrickroomDeeplinkUrl(
				"trickroom%3A%2F%2Fproj%2Floc_abc%2Fdesign%2Fdemo--12345678-1234-4abc-8def-123456789abc",
			),
		).toBe(
			"trickroom://proj/loc_abc/design/demo--12345678-1234-4abc-8def-123456789abc",
		);
	});

	it("finds the first deeplink argument", () => {
		expect(
			findTrickroomDeeplinkInArgs([
				"--foo",
				"trickroom://proj/loc_abc/design/demo--12345678-1234-4abc-8def-123456789abc",
				"/tmp/project",
			]),
		).toBe(
			"trickroom://proj/loc_abc/design/demo--12345678-1234-4abc-8def-123456789abc",
		);
	});
});
