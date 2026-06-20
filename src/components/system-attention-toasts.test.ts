import { describe, expect, it } from "vitest";
import {
	getSystemAttentionSummary,
	getSystemAttentionToastIds,
} from "./system-attention-toasts";

describe("system attention toast helpers", () => {
	it("namespaces toast ids by project scope", () => {
		expect(getSystemAttentionToastIds("site-location")).toEqual({
			issues: "trickroom-system-sync-issues:site-location",
			review: "trickroom-system-sync-review:site-location",
		});
		expect(getSystemAttentionToastIds(undefined)).toEqual({
			issues: "trickroom-system-sync-issues:no-active-project",
			review: "trickroom-system-sync-review:no-active-project",
		});
	});

	it("only reports attention for systems in the active project list", () => {
		const summary = getSystemAttentionSummary(
			[
				{
					systemId: "site-system",
					systemName: "Site",
					cssPath: "src/site.css",
				},
			],
			{
				"site-system": {
					status: "success",
					data: {
						status: "ok",
						systemId: "site-system",
						systemName: "Site",
						cssPath: "src/site.css",
						tailwindBaselineVersion: "4.2.4",
						tokens: [],
						baselineDiff: {
							added: [],
							overridden: [],
							unchanged: [],
							removed: [],
							missingDefaultTokenNames: [],
						},
						syncedAt: "2026-05-21T00:00:00.000Z",
						reviewRequired: false,
					},
				},
				"warning-system": {
					status: "success",
					data: {
						status: "ok",
						systemId: "warning-system",
						systemName: "Warning",
						cssPath: "src/warning.css",
						tailwindBaselineVersion: "4.2.4",
						tokens: [],
						baselineDiff: {
							added: [],
							overridden: [],
							unchanged: [],
							removed: [],
							missingDefaultTokenNames: [],
						},
						syncedAt: "2026-05-21T00:00:00.000Z",
						reviewRequired: true,
					},
				},
			},
		);

		expect(summary.issueNames).toEqual([]);
		expect(summary.reviewNames).toEqual([]);
		expect(summary.issueKey).toBe("");
		expect(summary.reviewKey).toBe("");
	});

	it("uses active system display names for issue and review summaries", () => {
		const summary = getSystemAttentionSummary(
			[
				{
					systemId: "core",
					systemName: "Core",
					cssPath: "src/core.css",
				},
				{
					systemId: "marketing",
					systemName: "Marketing",
					cssPath: "src/marketing.css",
				},
			],
			{
				core: {
					status: "error",
					error: new Error("No tokens"),
				},
				marketing: {
					status: "updated",
					data: {
						status: "updated",
						systemId: "marketing",
						systemName: "Legacy display name",
						cssPath: "src/marketing.css",
						tailwindBaselineVersion: "4.2.4",
						tokens: [],
						baselineDiff: {
							added: [],
							overridden: [],
							unchanged: [],
							removed: [],
							missingDefaultTokenNames: [],
						},
						syncedAt: "2026-05-21T00:00:00.000Z",
						reviewRequired: true,
					},
				},
			},
		);

		expect(summary.issueNames).toEqual(["Core"]);
		expect(summary.reviewNames).toEqual(["Marketing"]);
		expect(summary.issueKey).toBe("Core");
		expect(summary.reviewKey).toBe("Marketing");
	});
});
