import { describe, expect, it } from "vitest";
import { getDesignDiagnosticLabel } from "./project-view-utils";

describe("getDesignDiagnosticLabel", () => {
	it("names the stored version when a newer Trickroom wrote the file", () => {
		expect(
			getDesignDiagnosticLabel({
				code: "UNSUPPORTED_DESIGN_VERSION",
				message: "",
				version: 3,
			}),
		).toBe("v3 unsupported");
	});

	it("labels unreadable files", () => {
		expect(
			getDesignDiagnosticLabel({ code: "INVALID_DESIGN_JSON", message: "" }),
		).toBe("invalid json");
		expect(
			getDesignDiagnosticLabel({ code: "INVALID_DESIGN_PAYLOAD", message: "" }),
		).toBe("invalid design");
	});
});
