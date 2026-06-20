import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	getSystemEditorPath,
	OpenSystemEditorAction,
} from "./SystemDetailPane";

beforeEach(() => {
	vi.clearAllMocks();
});

afterEach(() => {
	vi.clearAllMocks();
});

describe("SystemDetailPane launch action", () => {
	it("builds encoded editor path for a system", () => {
		expect(getSystemEditorPath("Core System")).toBe("/system/Core%20System");
	});

	it("keeps launch action API in place", () => {
		expect(typeof OpenSystemEditorAction).toBe("function");
	});
});
