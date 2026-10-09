import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TailwindSyncController } from "../../hooks/useTailwindSyncController";
import type { LintReport } from "../../lint/report";
import type { LintRuleKindSummary } from "../../lint/rule-catalogue";
import { designSummariesProjectQueryKey } from "../../queries/design-file";
import {
	runSystemLint,
	type SystemLintConfigResponse,
	SystemLintRequestError,
	saveSystemLintConfig,
	systemLintConfigQueryKey,
	systemLintQueryKey,
	systemLintQueryOptions,
} from "../../queries/system-lint";
import { systemsProjectQueryKey } from "../../queries/systems";
import {
	resetEditorChrome,
	setEditorPanelOpen,
} from "../../stores/editor-chrome-store";
import {
	emptyLintFindingsFilter,
	type LintDashboardState,
	resetLintDashboard,
} from "../../stores/lint-dashboard-store";
import { HttpError } from "../../utils/readJsonOrThrow";
import { TailwindSyncControllerContext } from "../contexts";
import { SystemEditor } from "../SystemEditor";
import { findingKey } from "./lint/lint-dashboard-model";
import {
	codeOnlyLintReport,
	fullLintReport,
} from "./lint/lint-report-fixtures";

const syncController: TailwindSyncController = {
	isIdle: true,
	isPending: false,
	isSuccess: false,
	isPartialError: false,
	isError: false,
	results: {},
	statusBySystem: { core: "success" },
	targetsById: {},
	systems: [],
	syncAll: async () => {},
	syncSystem: async () => {},
};

const ruleKinds: LintRuleKindSummary[] = [
	{
		id: "code.variants-file-stale",
		side: "code",
		defaultSeverity: "error",
		description: "A published component's variants file is missing or stale.",
		options: [],
	},
	{
		id: "code.variants-file-orphaned",
		side: "code",
		defaultSeverity: "warning",
		description: "A generated file no selected component generates.",
		options: [],
	},
	{
		id: "code.component-styling-restricted",
		side: "code",
		defaultSeverity: "warning",
		description: "Styling of a component is allowed only in its own files.",
		options: [
			{
				key: "allow",
				label: "Allowed files",
				description: "Globs where any component may be styled.",
				type: "string-list",
			},
			{
				key: "only",
				label: "Per component",
				description: "Files that may style each component.",
				type: "component-map",
			},
		],
	},
];

const configResponse = (
	patch: Partial<SystemLintConfigResponse> = {},
): SystemLintConfigResponse => ({
	systemId: "core",
	systemName: "Core System",
	path: ".trickroom/systems/core/lint.json",
	present: true,
	revision: "sha256:config",
	config: {
		version: 1,
		rules: {
			"code.variants-file-orphaned": { severity: "error" },
			"code.component-styling-restricted": {
				options: {
					allow: ["src/legacy/**"],
					only: { button: ["src/components/ui/button.tsx"] },
					future: { mode: "strict" },
				},
			},
		},
		thresholds: { code: { errors: 1 }, coverage: { bound: 3 } },
	},
	issues: [],
	text: null,
	defaults: {
		source: {
			include: ["src/**/*.{ts,tsx,js,jsx,mjs,cjs}"],
			exclude: ["**/*.d.ts"],
			classCalls: ["tv", "cn"],
		},
	},
	ruleKinds,
	...patch,
});

function renderLintPage({
	report = codeOnlyLintReport,
	currentContractHash = report?.contract.hash ?? null,
	config = configResponse(),
	state = {},
	inspectorOpen = false,
}: {
	report?: LintReport | null;
	currentContractHash?: string | null;
	config?: SystemLintConfigResponse;
	state?: Partial<LintDashboardState>;
	inspectorOpen?: boolean;
} = {}) {
	// No retry on mount, so a seeded 404 renders as the error it is.
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false, retryOnMount: false } },
	});
	queryClient.setQueryData(systemsProjectQueryKey(), {
		systems: [
			{ systemId: "core", systemName: "Core System", cssPath: "core.css" },
		],
	});
	queryClient.setQueryData(["trickroom-system-components", "core"], {
		systemId: "core",
		systemName: "Core System",
		revision: "sha256:components",
		updatedAt: "2026-10-06T00:00:00.000Z",
		components: [],
	});
	queryClient.setQueryData(designSummariesProjectQueryKey(), [
		{
			uuid: "dsg_home",
			file: "designs/home",
			name: "Home",
			boardsCount: 2,
			layersCount: 9,
		},
	]);
	queryClient.setQueryData(systemLintConfigQueryKey("core"), config);
	if (report) {
		queryClient.setQueryData(systemLintQueryKey("core"), {
			systemId: "core",
			systemName: "Core System",
			report,
			current: { contractHash: currentContractHash },
		});
	} else {
		queryClient
			.getQueryCache()
			.build(queryClient, { queryKey: systemLintQueryOptions("core").queryKey })
			.setState({
				status: "error",
				error: new HttpError("No lint report yet.", 404),
				fetchStatus: "idle",
			});
	}
	resetLintDashboard(state);
	if (inspectorOpen) {
		setEditorPanelOpen("system", "inspector", true);
	}
	const router = createMemoryRouter(
		[{ path: "/system/:systemId", element: <SystemEditor /> }],
		{ initialEntries: ["/system/core?tab=lint"] },
	);
	return renderToStaticMarkup(
		<QueryClientProvider client={queryClient}>
			<TailwindSyncControllerContext.Provider value={syncController}>
				<RouterProvider router={router} />
			</TailwindSyncControllerContext.Provider>
		</QueryClientProvider>,
	);
}

const countMatches = (html: string, pattern: RegExp) =>
	html.match(new RegExp(pattern, "g"))?.length ?? 0;

describe("System editor lint page", () => {
	beforeEach(() => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response("{}", { status: 200 })),
		);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		resetEditorChrome();
		resetLintDashboard();
	});

	it("opens from ?tab=lint with the adherence view of a code-only report", () => {
		const html = renderLintPage();

		expect(html).toContain("Core System Lint");
		expect(html).toContain("Lint");
		expect(html).toContain('data-lint-view="adherence"');
		// The ratchet outcome of the stored report, with what got worse.
		expect(html).toContain("Ratchet fail");
		expect(html).toContain("code.errors: 1 → 2");
		expect(html).toContain("coverage.bound: 2 below min 3");
		// Code side counts with the delta, the regression and lint.json's max.
		expect(html).toMatch(/data-lint-side="code"/);
		expect(html).toContain("Regressed");
		expect(html).toContain("max 1");
		// The design side is null in this report.
		expect(html).toContain("Not available yet");
		expect(html).not.toContain('aria-label="Design rules"');
		// One clickable row per rule kind of the code summary.
		expect(countMatches(html, /data-lint-rule="code\./)).toBe(3);
		// A catalogue kind missing from the summary is disabled.
		expect(html).toContain("disabled in lint.json");
		expect(html).not.toContain("data-lint-stale");
	});

	it("shows info for a rule whose only findings are info notes", () => {
		const withoutCodegen: LintReport = {
			...codeOnlyLintReport,
			summary: {
				...codeOnlyLintReport.summary,
				code: {
					...codeOnlyLintReport.summary.code,
					findings: { errors: 0, warnings: 0, info: 1 },
					rules: {
						"code.variants-file-orphaned": { errors: 0, warnings: 0, info: 0 },
						"code.variants-file-stale": { errors: 0, warnings: 0, info: 1 },
					},
				},
			},
		};
		const html = renderLintPage({ report: withoutCodegen });
		const row = html.slice(
			html.indexOf('data-lint-rule="code.variants-file-stale"'),
		);
		const badge = row.slice(0, row.indexOf("</button>"));
		expect(badge).toContain('title="In this report: 1 info"');
		expect(badge).toMatch(/data-slot="badge"[^>]*>info</);
		expect(badge).not.toContain("No findings");
	});

	it("flags a stale report when the system's contract changed", () => {
		const html = renderLintPage({ currentContractHash: "sha256:now" });
		expect(html).toContain("data-lint-stale");
		expect(html).toContain("its contract hash differs");
	});

	it("lists the kinds the run adopted into the baseline", () => {
		const html = renderLintPage({
			report: {
				...codeOnlyLintReport,
				ratchet: {
					...codeOnlyLintReport.ratchet,
					adopted: [{ metric: "rule.code.unknown-variant-value", current: 1 }],
				},
			},
		});
		expect(html).toContain("New rule kinds, adopted into the baseline");
		expect(html).toContain("rule.code.unknown-variant-value: 1");
		expect(renderLintPage()).not.toContain("adopted into the baseline");
	});

	it("shows the design side when the report fills it", () => {
		const html = renderLintPage({ report: fullLintReport });
		expect(html).not.toContain("Not available yet");
		expect(html).toContain('aria-label="Design rules"');
		expect(countMatches(html, /data-lint-rule="design\./)).toBe(2);
	});

	it("shows the CLI command and the run button before the first run", () => {
		const html = renderLintPage({ report: null });
		expect(html).toContain("No lint report yet");
		expect(html).toContain("trickroom lint --system &quot;Core System&quot;");
		expect(html).toContain("Run lint");
	});

	it("lists coverage with gaps first-class and filters by a gap", () => {
		const all = renderLintPage({ state: { view: "coverage" } });
		expect(all).toContain('data-lint-view="coverage"');
		expect(countMatches(all, /data-lint-component="/)).toBe(4);
		expect(all).toContain("3 of 4 components have a gap");
		expect(all).toContain("Under min 3");
		// Badge: published, then three gaps, and an unknown design state.
		const badgeRow = all.slice(
			all.indexOf('data-lint-component="badge"'),
			all.indexOf('data-lint-component="button"'),
		);
		expect(countMatches(badgeRow, /data-state="met"/)).toBe(1);
		expect(countMatches(badgeRow, /data-state="gap"/)).toBe(3);
		expect(countMatches(badgeRow, /data-state="unknown"/)).toBe(1);
		expect(badgeRow).toContain("Not generated");

		const unbound = renderLintPage({
			state: { view: "coverage", coverageFilter: "bound" },
		});
		expect(countMatches(unbound, /data-lint-component="/)).toBe(2);
		expect(unbound).toContain('data-lint-component="badge"');
		expect(unbound).toContain('data-lint-component="dialog"');
	});

	it("virtualizes the coverage table, rendering a screenful of a large system", () => {
		const template = codeOnlyLintReport.components[0];
		const components = Array.from({ length: 5000 }, (_, index) => ({
			...template,
			slug: `component-${String(index).padStart(4, "0")}`,
			componentId: `cmp_${index}`,
			name: `Component ${index}`,
		}));
		const html = renderLintPage({
			report: { ...codeOnlyLintReport, components },
			state: { view: "coverage" },
		});
		expect(html).toContain("of 5000 components have a gap");
		const rendered = countMatches(html, /data-lint-component="/);
		expect(rendered).toBeGreaterThan(5);
		expect(rendered).toBeLessThan(60);
		expect(html).toContain('data-lint-component="component-0000"');
		expect(html).not.toContain('data-lint-component="component-4999"');
	});

	it("renders the codebase heat map as an aggregated file tree", () => {
		const html = renderLintPage({ state: { view: "files" } });
		expect(html).toContain('data-lint-view="files"');
		// Top-level folders start open; deeper ones collapsed.
		expect(html).toContain('data-lint-heat-row="src"');
		expect(html).toContain('data-lint-heat-row="src/components/ui"');
		expect(html).toContain('data-lint-heat-row="src/app.tsx"');
		expect(html).not.toContain(
			'data-lint-heat-row="src/components/ui/card.tsx"',
		);
		expect(html).toContain("components/ui");
		expect(html).toContain("5 files");
		// Discrete swatches on both scales.
		expect(html).toMatch(/data-slot="heat-swatch" data-step="4"/);
		expect(html).toContain("findings (errors + warnings)");
	});

	it("shows the design map empty while the report has no design side", () => {
		const empty = renderLintPage({ state: { view: "designs" } });
		expect(empty).toContain("No design-side results yet");

		const full = renderLintPage({
			report: fullLintReport,
			state: { view: "designs" },
		});
		expect(full).toContain('data-lint-heat-row="design:dsg_home"');
		expect(full).toContain('data-lint-heat-row="board:dsg_home/brd_hero"');
		expect(full).toContain("Home");
	});

	it("filters findings by a folder the heat map links into", () => {
		const html = renderLintPage({
			report: fullLintReport,
			state: {
				view: "findings",
				findingsFilter: {
					...emptyLintFindingsFilter(),
					file: "src/components/ui",
				},
			},
		});
		expect(html).toContain("2 of 5 findings");
		expect(html).toContain("in src/components/ui");
		expect(countMatches(html, /data-lint-finding="/)).toBe(2);
		expect(html).toContain("src/components/ui/badge.variants.ts:1:1");
	});

	it("shows a component's gaps and what to do in the inspector", () => {
		const html = renderLintPage({
			state: {
				view: "coverage",
				selection: { kind: "component", slug: "badge" },
			},
			inspectorOpen: true,
		});
		expect(html).toContain("Inspector");
		expect(html).toContain("Not generated");
		expect(html).toContain("Run &quot;trickroom codegen&quot;");
		expect(html).toContain("This report has no design-side results yet.");
		expect(html).toContain("Show 1 in findings");
	});

	it("shows a component's usages in the app and in designs in the inspector", () => {
		const html = renderLintPage({
			report: fullLintReport,
			state: {
				view: "coverage",
				selection: { kind: "component", slug: "button" },
			},
			inspectorOpen: true,
		});
		expect(html).toMatch(/Usages in app<\/span><span[^>]*>5</);
		expect(html).toMatch(/Usages in designs<\/span><span[^>]*>3</);
	});

	it("opens a design finding in the editor at its board and layer", () => {
		const finding = fullLintReport.findings.find(
			(entry) => entry.rule === "design.unknown-variant-value",
		);
		if (!finding) throw new Error("fixture");
		const key = findingKey(finding);
		const html = renderLintPage({
			report: fullLintReport,
			state: { view: "findings", selection: { kind: "finding", key } },
			inspectorOpen: true,
		});
		expect(html).toContain("Open in editor");
		expect(html).toContain(
			'href="/design/dsg_home?board=brd_hero&amp;layer=el_cta"',
		);
		expect(html).toContain("Home");
	});
});

describe("System editor lint rule configuration", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		resetLintDashboard();
	});

	it("lists every rule kind with severity, threshold and documented options", () => {
		const html = renderLintPage({ state: { view: "config" } });
		expect(html).toContain('data-lint-view="config"');
		expect(html).toContain(".trickroom/systems/core/lint.json");
		expect(countMatches(html, /data-lint-rule-config="/)).toBe(3);
		expect(html).toContain("Default (error)");
		// The documented options get a form; the undocumented one stays as JSON.
		expect(html).toContain('data-lint-option="allow"');
		expect(html).toContain("src/legacy/**");
		expect(html).toContain('data-lint-option="only"');
		expect(html).toContain("src/components/ui/button.tsx");
		expect(html).toContain("other options (read-only)");
		expect(html).toContain("&quot;mode&quot;: &quot;strict&quot;");
		// Thresholds, wrapper overrides and sources with the defaults.
		expect(html).toContain("coverage minima");
		expect(html).toContain("wrapper modules");
		expect(html).toContain("src/**/*.{ts,tsx,js,jsx,mjs,cjs}");
		expect(html).toContain("Save lint.json");
		expect(html).toContain("No changes");
	});

	it("explains an absent file and shows the issues of an invalid one", () => {
		const absent = renderLintPage({
			state: { view: "config" },
			config: configResponse({
				present: false,
				revision: null,
				config: { version: 1 },
			}),
		});
		expect(absent).toContain("No lint.json yet");

		const invalid = renderLintPage({
			state: { view: "config" },
			config: configResponse({
				config: { version: 1 },
				issues: ['rules["code.nope"] names an unknown rule kind.'],
				text: '{ "version": 1, "rules": { "code.nope": {} } }',
			}),
		});
		expect(invalid).toContain("The stored lint.json is invalid");
		expect(invalid).toContain("names an unknown rule kind");
		expect(invalid).toContain("code.nope");
	});

	it("saves through PUT with the revision the edit started from", async () => {
		const fetchMock = vi.fn(
			async () =>
				new Response(JSON.stringify(configResponse()), { status: 200 }),
		);
		vi.stubGlobal("fetch", fetchMock);
		await saveSystemLintConfig("core", {
			config: { version: 1, thresholds: { code: { errors: 0 } } },
			revision: "sha256:config",
		});
		expect(fetchMock).toHaveBeenCalledWith(
			"/api/trickroom/systems/core/lint/config",
			expect.objectContaining({ method: "PUT" }),
		);
		const [, init] = fetchMock.mock.calls[0] as unknown as [
			string,
			RequestInit,
		];
		expect(JSON.parse(String(init.body))).toEqual({
			config: { version: 1, thresholds: { code: { errors: 0 } } },
			revision: "sha256:config",
		});
	});

	it("surfaces the engine's issues and run diagnostics as typed errors", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(
				async () =>
					new Response(
						JSON.stringify({
							error: "lint.json is invalid",
							code: "LINT_CONFIG_INVALID",
							issues: [
								"thresholds.code.errors must be a non-negative integer.",
							],
						}),
						{ status: 422 },
					),
			),
		);
		const saveError = await saveSystemLintConfig("core", {
			config: { version: 1 },
			revision: null,
		}).catch((error: unknown) => error);
		expect(saveError).toBeInstanceOf(SystemLintRequestError);
		expect(saveError).toMatchObject({
			status: 422,
			code: "LINT_CONFIG_INVALID",
			issues: ["thresholds.code.errors must be a non-negative integer."],
		});

		vi.stubGlobal(
			"fetch",
			vi.fn(
				async () =>
					new Response(
						JSON.stringify({
							error: "Lint did not complete.",
							code: "LINT_FAILED",
							diagnostics: [
								{
									code: "INVALID_LINT_CONFIG",
									severity: "error",
									message: "bad",
								},
							],
						}),
						{ status: 500 },
					),
			),
		);
		const runError = await runSystemLint("core").catch(
			(error: unknown) => error,
		);
		expect(runError).toMatchObject({
			code: "LINT_FAILED",
			diagnostics: [{ code: "INVALID_LINT_CONFIG" }],
		});
	});
});
