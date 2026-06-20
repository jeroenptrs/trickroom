import { describe, expect, it } from "vitest";
import type { SystemComponentSummary } from "../../queries/system-components";
import {
	getComponentPublicationState,
	nextUniqueComponentSlug,
	slugifyComponentName,
} from "./component-catalog";

const baseSummary = (
	overrides: Partial<SystemComponentSummary>,
): SystemComponentSummary => ({
	componentId: "cmp_1",
	slug: "button",
	name: "Button",
	hasDraft: true,
	hasPublished: false,
	createdAt: "2026-05-26T00:00:00.000Z",
	updatedAt: "2026-05-26T00:00:00.000Z",
	...overrides,
});

describe("component-catalog", () => {
	it("distinguishes draft-only, published-only, and draft-over-published states", () => {
		expect(
			getComponentPublicationState(
				baseSummary({ hasDraft: true, hasPublished: false }),
			),
		).toBe("draft-only");
		expect(
			getComponentPublicationState(
				baseSummary({ hasDraft: false, hasPublished: true }),
			),
		).toBe("published-only");
		expect(
			getComponentPublicationState(
				baseSummary({ hasDraft: true, hasPublished: true }),
			),
		).toBe("draft-over-published");
	});

	it("generates a unique slug when the base slug is taken", () => {
		expect(
			nextUniqueComponentSlug("button", [
				baseSummary({ slug: "button" }),
				baseSummary({ componentId: "cmp_2", slug: "button-2" }),
			]),
		).toBe("button-3");
	});

	it("normalizes unicode, punctuation, and consecutive separators", () => {
		expect(slugifyComponentName("Bûton!")).toBe("b-ton");
		expect(slugifyComponentName("Hello--World")).toBe("hello-world");
		expect(slugifyComponentName("Marketing/Card CTA!")).toBe(
			"marketing-card-cta",
		);
	});

	it("does not truncate long names", () => {
		expect(slugifyComponentName(`${"a".repeat(63)} another word`)).toBe(
			`${"a".repeat(63)}-another-word`,
		);
	});

	it("falls back to a valid slug when the name has no slug characters", () => {
		expect(slugifyComponentName("!!!")).toBe("component");
	});
});
