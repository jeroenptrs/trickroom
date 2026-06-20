import { describe, expect, it } from "vitest";
import { isAllowedAppUrl, isSafeExternalUrl } from "./url-policy";

describe("navigation guard helpers", () => {
	const origin = "http://127.0.0.1:18100";

	it("allows only the backend app origin", () => {
		expect(isAllowedAppUrl("http://127.0.0.1:18100/", origin)).toBe(true);
		expect(isAllowedAppUrl("http://127.0.0.1:18100/design/a", origin)).toBe(
			true,
		);
		expect(isAllowedAppUrl("http://localhost:18100/", origin)).toBe(false);
		expect(isAllowedAppUrl("https://example.com", origin)).toBe(false);
		expect(isAllowedAppUrl("not a url", origin)).toBe(false);
	});

	it("allows only explicit safe external URL schemes", () => {
		expect(isSafeExternalUrl("https://example.com")).toBe(true);
		expect(isSafeExternalUrl("mailto:support@example.com")).toBe(true);
		expect(isSafeExternalUrl("http://example.com")).toBe(false);
		expect(isSafeExternalUrl("file:///etc/passwd")).toBe(false);
		expect(isSafeExternalUrl("javascript:alert(1)")).toBe(false);
		expect(isSafeExternalUrl("not a url")).toBe(false);
	});
});
