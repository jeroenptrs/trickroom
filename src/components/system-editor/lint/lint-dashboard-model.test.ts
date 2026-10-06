import { describe, expect, it } from "vitest";
import { emptyLintFindingsFilter } from "../../../stores/lint-dashboard-store";
import {
	buildDesignTree,
	buildFileTree,
	buildHeatScale,
	collectFolderIds,
	compareLintMetric,
	countCoverage,
	coverageGaps,
	filterCoverage,
	filterFiles,
	filterFindings,
	findHeatNode,
	findingKey,
	flattenHeatTree,
	formatDelta,
	isReportStale,
	ruleRowSeverity,
	ruleRowsForSide,
	thresholdForMetric,
} from "./lint-dashboard-model";
import { codeOnlyLintReport, fullLintReport } from "./lint-report-fixtures";

describe("lint dashboard file tree", () => {
	it("aggregates usages, findings and file counts into folders", () => {
		const root = buildFileTree(codeOnlyLintReport.files);
		expect(root.fileCount).toBe(7);
		expect(root.usages).toBe(5);
		expect(root.findings).toEqual({ errors: 2, warnings: 1, info: 0 });

		const src = root.children[0];
		expect(src?.name).toBe("src");
		// Folders first, then files, by name.
		expect(src?.children.map((child) => child.name)).toEqual([
			"components/ui",
			"pages",
			"app.tsx",
		]);
		const ui = findHeatNode(root, "src/components/ui");
		expect(ui).toMatchObject({
			kind: "folder",
			name: "components/ui",
			fileCount: 5,
			usages: 0,
			findings: { errors: 1, warnings: 1, info: 0 },
		});
		expect(findHeatNode(root, "src/components/ui/card.tsx")?.file?.role).toBe(
			"wrapper",
		);
	});

	it("compacts single-folder chains and keeps leaf ids as paths", () => {
		const root = buildFileTree([
			{
				file: "packages/ui/src/button.tsx",
				role: null,
				component: null,
				usages: 1,
				findings: { errors: 0, warnings: 0, info: 0 },
			},
		]);
		expect(root.children.map((child) => [child.id, child.name])).toEqual([
			["packages/ui/src", "packages/ui/src"],
		]);
		expect(root.children[0]?.children[0]?.id).toBe(
			"packages/ui/src/button.tsx",
		);
	});

	it("flattens expanded folders depth first and sorts by heat", () => {
		const root = buildFileTree(codeOnlyLintReport.files);
		const collapsed = flattenHeatTree(root, new Set());
		expect(collapsed.map((row) => row.node.id)).toEqual(["src"]);

		const open = flattenHeatTree(root, new Set(["src", "src/components/ui"]));
		expect(open.map((row) => [row.node.id, row.depth])).toEqual([
			["src", 0],
			["src/components/ui", 1],
			["src/components/ui/badge.variants.ts", 2],
			["src/components/ui/button.tsx", 2],
			["src/components/ui/button.variants.ts", 2],
			["src/components/ui/card.tsx", 2],
			["src/components/ui/chip.variants.ts", 2],
			["src/pages", 1],
			["src/app.tsx", 1],
		]);

		const byUsage = flattenHeatTree(root, new Set(["src"]), "usages");
		expect(byUsage.map((row) => row.node.id)).toEqual([
			"src",
			"src/app.tsx",
			"src/pages",
			"src/components/ui",
		]);
		expect(collectFolderIds(root)).toEqual([
			"src",
			"src/components/ui",
			"src/pages",
		]);
	});

	it("filters files by path and by having findings", () => {
		expect(
			filterFiles(codeOnlyLintReport.files, {
				text: "ui/",
				onlyFindings: true,
			}).map((file) => file.file),
		).toEqual([
			"src/components/ui/badge.variants.ts",
			"src/components/ui/chip.variants.ts",
		]);
	});
});

describe("lint dashboard design tree", () => {
	it("groups boards under designs; board-less rows add to the design only", () => {
		const root = buildDesignTree(
			fullLintReport.designs ?? [],
			new Map([["dsg_home", "Home"]]),
		);
		expect(root.children.map((design) => design.name)).toEqual([
			"dsg_settings",
			"Home",
		]);
		const home = root.children[1];
		expect(home).toMatchObject({
			id: "design:dsg_home",
			usages: 4,
			fileCount: 2,
			findings: { errors: 1, warnings: 1, info: 0 },
		});
		expect(home?.children.map((board) => board.id)).toEqual([
			"board:dsg_home/brd_footer",
			"board:dsg_home/brd_hero",
		]);
	});
});

describe("lint dashboard heat scale", () => {
	it("uses discrete quartile steps over non-zero values", () => {
		const scale = buildHeatScale([0, 1, 2, 3, 4, 8, 20, 0]);
		expect(scale.step(0)).toBe(0);
		expect(scale.step(1)).toBe(1);
		expect(scale.step(3)).toBe(2);
		expect(scale.step(8)).toBe(3);
		expect(scale.step(20)).toBe(4);
		expect(scale.step(500)).toBe(4);
		expect(scale.legend.map((entry) => entry.label)).toEqual([
			"0",
			"1–2",
			"3–4",
			"5–8",
			"9+",
		]);
	});

	it("collapses legend steps that cannot occur", () => {
		const scale = buildHeatScale([1, 1, 1, 1]);
		expect(scale.step(1)).toBe(1);
		expect(scale.legend.map((entry) => entry.label)).toEqual(["0", "1", "2+"]);
		expect(buildHeatScale([0, 0]).legend).toEqual([{ step: 0, label: "0" }]);
	});
});

describe("lint dashboard ratchet comparison", () => {
	it("compares this run's numbers with the baseline it ran against", () => {
		expect(
			compareLintMetric(codeOnlyLintReport.ratchet, "code.errors"),
		).toEqual({
			metric: "code.errors",
			current: 2,
			baseline: 1,
			delta: 1,
			worse: true,
			regressed: true,
			breach: null,
		});
		expect(
			compareLintMetric(codeOnlyLintReport.ratchet, "coverage.bound"),
		).toMatchObject({
			delta: 0,
			worse: false,
			breach: { kind: "min", limit: 3 },
		});
		// Higher is better for coverage; a missing number counts as 0.
		expect(
			compareLintMetric(
				{
					...codeOnlyLintReport.ratchet,
					numbers: { "coverage.bound": 1 },
				},
				"coverage.bound",
			),
		).toMatchObject({ delta: -1, worse: true });
		expect(
			compareLintMetric(
				{ ...codeOnlyLintReport.ratchet, baseline: null },
				"code.errors",
			),
		).toMatchObject({ baseline: null, delta: null, worse: false });
		expect([
			formatDelta(null),
			formatDelta(0),
			formatDelta(2),
			formatDelta(-3),
		]).toEqual(["new", "±0", "+2", "−3"]);
	});

	it("reads thresholds from lint.json and lists rule rows per side", () => {
		const thresholds = {
			code: { errors: 0 },
			rules: { "code.variants-file-stale": 2 },
			coverage: { bound: 3 },
		};
		expect(thresholdForMetric(thresholds, "code.errors")).toEqual({
			kind: "max",
			limit: 0,
		});
		expect(
			thresholdForMetric(thresholds, "rule.code.variants-file-stale"),
		).toEqual({ kind: "max", limit: 2 });
		expect(thresholdForMetric(thresholds, "coverage.bound")).toEqual({
			kind: "min",
			limit: 3,
		});
		expect(thresholdForMetric(thresholds, "code.warnings")).toBeNull();

		expect(ruleRowsForSide(codeOnlyLintReport, "design")).toBeNull();
		expect(
			ruleRowsForSide(codeOnlyLintReport, "code")?.map((row) => [
				row.id,
				row.comparison.delta,
			]),
		).toEqual([
			["code.unknown-variant-value", 1],
			["code.variants-file-orphaned", 0],
			["code.variants-file-stale", 0],
		]);
	});

	it("flags a report whose contract hash is not the current one", () => {
		expect(isReportStale(codeOnlyLintReport, "sha256:contract-at-run")).toBe(
			false,
		);
		expect(isReportStale(codeOnlyLintReport, "sha256:changed")).toBe(true);
		expect(isReportStale(codeOnlyLintReport, null)).toBe(false);
	});
});

describe("lint dashboard coverage", () => {
	it("treats false as a gap and null as unknown", () => {
		const [badge, button, card, dialog] = codeOnlyLintReport.components;
		expect(badge && coverageGaps(badge)).toEqual([
			"generated",
			"bound",
			"usedInApp",
		]);
		expect(button && coverageGaps(button)).toEqual([]);
		expect(card && coverageGaps(card)).toEqual(["usedInApp"]);
		expect(dialog && coverageGaps(dialog)).toHaveLength(4);
	});

	it("filters by any gap, by one state's gap and by search", () => {
		const slugs = (
			filter: Parameters<typeof filterCoverage>[1],
			search?: string,
		) =>
			filterCoverage(codeOnlyLintReport.components, filter, search).map(
				(component) => component.slug,
			);
		expect(slugs("all")).toEqual(["badge", "button", "card", "dialog"]);
		expect(slugs("gaps")).toEqual(["badge", "card", "dialog"]);
		expect(slugs("bound")).toEqual(["badge", "dialog"]);
		expect(slugs("published")).toEqual(["dialog"]);
		// Unknown is not a gap.
		expect(slugs("usedInDesigns")).toEqual([]);
		expect(slugs("gaps", "car")).toEqual(["card"]);
		expect(
			filterCoverage(fullLintReport.components, "usedInDesigns").map(
				(component) => component.slug,
			),
		).toEqual(["badge", "dialog"]);
	});

	it("counts components per state", () => {
		const { states, withGaps } = countCoverage(codeOnlyLintReport.components);
		expect(withGaps).toBe(3);
		expect(states.bound).toEqual({ met: 2, gap: 2, unknown: 0 });
		expect(states.usedInDesigns).toEqual({ met: 0, gap: 0, unknown: 4 });
	});
});

describe("lint dashboard findings filter", () => {
	const filter = (patch: Partial<ReturnType<typeof emptyLintFindingsFilter>>) =>
		filterFindings(fullLintReport.findings, {
			...emptyLintFindingsFilter(),
			...patch,
		}).map((finding) => finding.rule);

	it("filters by side, severity, rule and component", () => {
		expect(filter({})).toHaveLength(5);
		expect(filter({ side: "design" })).toEqual([
			"design.unknown-class-token",
			"design.unknown-variant-value",
		]);
		expect(filter({ severity: "warning" })).toEqual([
			"code.variants-file-orphaned",
			"design.unknown-class-token",
		]);
		expect(filter({ rule: "code.variants-file-stale" })).toEqual([
			"code.variants-file-stale",
		]);
		expect(filter({ component: "button" })).toEqual([
			"code.unknown-variant-value",
			"design.unknown-variant-value",
		]);
	});

	it("filters by file or folder, and by design and board", () => {
		expect(filter({ file: "src/components/ui" })).toEqual([
			"code.variants-file-orphaned",
			"code.variants-file-stale",
		]);
		expect(filter({ file: "src/components/u" })).toEqual([]);
		expect(filter({ design: "dsg_home" })).toHaveLength(2);
		expect(filter({ design: "dsg_home", board: "brd_hero" })).toEqual([
			"design.unknown-variant-value",
		]);
		expect(filter({ text: "HOME.TSX" })).toEqual([
			"code.unknown-variant-value",
		]);
	});

	it("keys findings stably and uniquely", () => {
		const keys = fullLintReport.findings.map(findingKey);
		expect(new Set(keys).size).toBe(keys.length);
		const [first] = fullLintReport.findings;
		expect(first && findingKey(structuredClone(first))).toBe(keys[0]);
	});
});

describe("lint dashboard rule row severity", () => {
	it("shows the most severe counted severity, info included", () => {
		expect(
			ruleRowSeverity({ errors: 1, warnings: 2, info: 1 }, "warning"),
		).toEqual({
			severity: "error",
			fromReport: true,
			title: "In this report: 1 error, 2 warnings, 1 info",
		});
		// The codegen check without a codegen block: one info note.
		expect(
			ruleRowSeverity({ errors: 0, warnings: 0, info: 1 }, "error"),
		).toEqual({
			severity: "info",
			fromReport: true,
			title: "In this report: 1 info",
		});
	});

	it("falls back to the configured severity only without findings", () => {
		expect(
			ruleRowSeverity({ errors: 0, warnings: 0, info: 0 }, "error"),
		).toEqual({
			severity: "error",
			fromReport: false,
			title: "No findings in this report; the severity lint.json sets",
		});
		expect(
			ruleRowSeverity({ errors: 0, warnings: 0, info: 0 }, null),
		).toBeNull();
	});
});
