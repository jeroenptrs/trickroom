import { afterEach, describe, expect, it, vi } from "vitest";
import type { TrickroomDesign } from "../types";
import {
	getDesignDiagnostics,
	groupWarnings,
	isDefaultSurfacedWarning,
	isLikelyTypoWarning,
	type McpDesignIssue,
	shapeMutationDiagnostics,
	suggestTailwindClasses,
} from "./diagnostics";
import {
	createTrickroomMcpProjectFixture,
	createTrickroomMcpTestClient,
	type TrickroomMcpClientSession,
	type TrickroomMcpProjectFixture,
	trickroomMcpTestDesignUuid,
} from "./test-support";

// Every registry component currently has a renderer; pretend meter.track has
// none so the MISSING_RENDERER diagnostic can be exercised.
vi.mock("../libraries/renderable-components", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("../libraries/renderable-components")>();
	return {
		...actual,
		hasStageRenderer: (library: string, component: string) =>
			component !== "meter.track" &&
			actual.hasStageRenderer(library, component),
	};
});

/** Error issues plus the ungrouped warnings of a "full" validation result. */
const withWarnings = (content: unknown) => {
	const result = content as { issues: unknown[]; warnings?: unknown[] };
	return { issues: [...result.issues, ...(result.warnings ?? [])] };
};

const expandedDiagnosticsDesign = {
	name: "Expanded Diagnostics Design",
	systemName: "Core",
	boards: [
		{
			id: "board",
			props: {
				"data-trickroom-name": "Board",
				"data-trickroom-library": "trickroom",
				"data-trickroom-component": "container",
				className:
					"p-card p-gap-missing font-missing rounded-missing font-[Inter] rounded-[1.25rem] bg-brand-500 definitely-not-a-tailwind-utility",
			},
			children: [],
		},
	],
} satisfies TrickroomDesign;

describe("MCP expanded class/token diagnostics", () => {
	const fixtures: TrickroomMcpProjectFixture[] = [];
	const sessions: TrickroomMcpClientSession[] = [];

	afterEach(async () => {
		await Promise.all(sessions.splice(0).map((session) => session.close()));
		await Promise.all(fixtures.splice(0).map((fixture) => fixture.cleanup()));
	});

	const createSession = async (
		options: Parameters<typeof createTrickroomMcpProjectFixture>[0] = {},
	) => {
		const fixture = await createTrickroomMcpProjectFixture(options);
		fixtures.push(fixture);
		const session = await createTrickroomMcpTestClient(
			await fixture.readMcpContext(),
		);
		sessions.push(session);
		return { fixture, session };
	};

	const getRevision = async (session: TrickroomMcpClientSession) => {
		const result = await session.client.callTool({
			name: "readDesignFile",
			arguments: { designFileId: trickroomMcpTestDesignUuid },
		});
		return (result.structuredContent as { designFile: { revision: string } })
			.designFile.revision;
	};

	it("reports spacing, font, radius, arbitrary, and unknown utility diagnostics", async () => {
		const { session } = await createSession({
			designs: {
				[trickroomMcpTestDesignUuid]: expandedDiagnosticsDesign,
			},
			tokenSnapshots: [
				{
					systemName: "Core",
					cssPath: "src/index.css",
					tokens: {
						"brand-500": "#2563eb",
					},
					overrides: ["brand-500"],
					baselineDiff: {
						added: [{ name: "brand-500", value: "#2563eb", domain: "color" }],
						overridden: [],
						removed: [],
					},
					domains: {
						spacing: {
							card: "2rem",
						},
					},
					domainBaselineDiffs: {
						spacing: {
							added: [{ name: "card", value: "2rem", domain: "spacing" }],
							overridden: [],
							removed: [],
						},
						font: {
							added: [],
							overridden: [],
							removed: [],
						},
						radius: {
							added: [],
							overridden: [],
							removed: [],
						},
					},
					reviewRequired: false,
				},
			],
		});

		const validateResult = await session.client.callTool({
			name: "validateDesignFile",
			arguments: { designFileId: trickroomMcpTestDesignUuid, response: "full" },
		});
		const validation = withWarnings(validateResult.structuredContent) as {
			issues: Array<{
				code: string;
				token?: string;
				classToken?: string;
				domain?: string;
			}>;
		};

		expect(validation.issues).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "UNKNOWN_SPACING_TOKEN",
					token: "gap-missing",
					domain: "spacing",
					elementId: "board",
				}),
				expect.objectContaining({
					code: "UNKNOWN_FONT_TOKEN",
					token: "missing",
					domain: "font",
					elementId: "board",
				}),
				expect.objectContaining({
					code: "UNKNOWN_RADIUS_TOKEN",
					token: "missing",
					domain: "radius",
					elementId: "board",
				}),
				expect.objectContaining({
					code: "OUT_OF_SYSTEM_FONT",
					classToken: "font-[Inter]",
					domain: "font",
					elementId: "board",
				}),
				expect.objectContaining({
					code: "OUT_OF_SYSTEM_RADIUS",
					classToken: "rounded-[1.25rem]",
					domain: "radius",
					elementId: "board",
				}),
				expect.objectContaining({
					code: "UNKNOWN_TAILWIND_UTILITY",
					classToken: "definitely-not-a-tailwind-utility",
					domain: "tailwind",
					elementId: "board",
				}),
			]),
		);

		expect(validation.issues).not.toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "UNKNOWN_TAILWIND_UTILITY",
					classToken: "bg-brand-500",
				}),
				expect.objectContaining({
					code: "UNKNOWN_COLOR_TOKEN",
					token: "brand-500",
				}),
				expect.objectContaining({
					code: "UNKNOWN_SPACING_TOKEN",
					token: "card",
				}),
			]),
		);
	});

	it("omits heavy custom utility catalogs from validateDesignFile by default", async () => {
		const { session } = await createSession({
			tokenSnapshots: [
				{
					systemName: "Core",
					cssPath: "src/index.css",
					customUtilities: [
						{
							root: "text-interaction",
							kind: "functional",
							consumedNamespaces: ["--db-interaction"],
							completionValues: ["lg", "sm"],
							domains: ["typography"],
						},
					],
				},
			],
		});

		const defaultResult = await session.client.callTool({
			name: "validateDesignFile",
			arguments: { designFileId: trickroomMcpTestDesignUuid },
		});
		expect(defaultResult.structuredContent).not.toHaveProperty(
			"tokenDiagnostics",
		);

		const verboseResult = await session.client.callTool({
			name: "validateDesignFile",
			arguments: {
				designFileId: trickroomMcpTestDesignUuid,
				response: "full",
			},
		});
		const verboseValidation = verboseResult.structuredContent as {
			tokenDiagnostics: { customUtilities?: unknown[] } | null;
		};
		expect(verboseValidation.tokenDiagnostics?.customUtilities).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ root: "text-interaction" }),
			]),
		);
	});

	it("suppresses unknown spacing diagnostics for stored custom spacing tokens", async () => {
		const { session } = await createSession({
			designs: {
				[trickroomMcpTestDesignUuid]: {
					name: "Stored Spacing Token Design",
					systemName: "Core",
					boards: [
						{
							id: "board",
							props: {
								"data-trickroom-name": "Board",
								"data-trickroom-library": "trickroom",
								"data-trickroom-component": "container",
								className: "p-card",
							},
							children: [],
						},
					],
				},
			},
			tokenSnapshots: [
				{
					systemName: "Core",
					cssPath: "src/index.css",
					tokens: {},
					overrides: [],
					baselineDiff: { added: [], overridden: [], removed: [] },
					domains: {
						spacing: {
							card: "2rem",
						},
					},
					domainBaselineDiffs: {
						spacing: {
							added: [{ name: "card", value: "2rem", domain: "spacing" }],
							overridden: [],
							removed: [],
						},
					},
					reviewRequired: false,
				},
			],
		});

		const validateResult = await session.client.callTool({
			name: "validateDesignFile",
			arguments: { designFileId: trickroomMcpTestDesignUuid, response: "full" },
		});
		const validation = withWarnings(validateResult.structuredContent) as {
			issues: Array<{ code: string; token?: string }>;
		};

		expect(validation.issues).not.toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "UNKNOWN_SPACING_TOKEN",
					token: "card",
				}),
			]),
		);
	});

	it("returns typo warnings and a warning count from single-element writes", async () => {
		const { session } = await createSession({
			designs: {
				[trickroomMcpTestDesignUuid]: {
					name: "Mutation Diagnostics Design",
					systemName: "Core",
					boards: [
						{
							id: "board",
							props: {
								"data-trickroom-name": "Board",
								"data-trickroom-library": "trickroom",
								"data-trickroom-component": "container",
								className: "bg-brand-500",
							},
							children: [],
						},
					],
				},
			},
			tokenSnapshots: [
				{
					systemName: "Core",
					cssPath: "src/index.css",
					tokens: {
						"brand-500": "#2563eb",
					},
					overrides: ["brand-500"],
					baselineDiff: {
						added: [{ name: "brand-500", value: "#2563eb", domain: "color" }],
						overridden: [],
						removed: [],
					},
					reviewRequired: false,
				},
			],
		});

		const revision = await getRevision(session);
		const mutationResult = await session.client.callTool({
			name: "updateElementProps",
			arguments: {
				designFileId: trickroomMcpTestDesignUuid,
				expectedRevision: revision,
				elementId: "board",
				className: "font-missing rounded-[2rem]",
			},
		});

		// Default contract: likely-typo warnings (unknown tokens/utilities) on the
		// touched element are returned, grouped; other warnings are only counted.
		expect(mutationResult.structuredContent).toMatchObject({
			status: "success",
			warningCount: 2,
			warnings: [
				{
					code: "UNKNOWN_FONT_TOKEN",
					message: expect.stringContaining('"font-missing"'),
					elementIds: ["board"],
				},
			],
		});
		expect(mutationResult.structuredContent).not.toHaveProperty(
			"tokenDiagnostics",
		);

		// response "full" returns every warning in scope, ungrouped.
		const allWarningsResult = await session.client.callTool({
			name: "updateElementProps",
			arguments: {
				designFileId: trickroomMcpTestDesignUuid,
				expectedRevision: await getRevision(session),
				elementId: "board",
				className: "font-missing rounded-[2rem]",
				response: "full",
			},
		});
		const allWarnings = allWarningsResult.structuredContent as {
			warnings: Array<{ code: string }>;
			warningCount: number;
		};
		expect(allWarnings.warningCount).toBe(2);
		expect(allWarnings.warnings.map((warning) => warning.code).sort()).toEqual([
			"OUT_OF_SYSTEM_RADIUS",
			"UNKNOWN_FONT_TOKEN",
		]);

		const validateResult = await session.client.callTool({
			name: "validateDesignFile",
			arguments: {
				designFileId: trickroomMcpTestDesignUuid,
			},
		});

		expect(validateResult.structuredContent).toMatchObject({
			valid: true,
			summary: {
				errors: 0,
				warnings: 2,
				codes: { OUT_OF_SYSTEM_RADIUS: 1, UNKNOWN_FONT_TOKEN: 1 },
			},
			issues: [],
			warnings: expect.arrayContaining([
				{
					code: "UNKNOWN_FONT_TOKEN",
					message: expect.stringContaining('"font-missing"'),
					elementIds: ["board"],
				},
				{
					code: "OUT_OF_SYSTEM_RADIUS",
					message: expect.stringContaining('"rounded-[2rem]"'),
					elementIds: ["board"],
				},
			]),
		});
	});

	it("only reports unknown tokens for classes the system's Tailwind cannot emit", async () => {
		const { session } = await createSession({
			systemCss: {
				Core: '@import "tailwindcss";\n@theme {\n\t--shadow-elevation-md: 0 1px 2px rgb(0 0 0 / 0.2);\n}\n',
			},
			designs: {
				[trickroomMcpTestDesignUuid]: {
					name: "Static Utilities Design",
					systemName: "Core",
					boards: [
						{
							id: "board",
							props: {
								"data-trickroom-name": "Board",
								"data-trickroom-library": "trickroom",
								"data-trickroom-component": "container",
								className:
									"group/sidebar rounded-full leading-none shadow-elevation-md bg-brand-600 rounded-missing",
							},
							children: [],
						},
					],
				},
			},
			tokenSnapshots: [
				{
					systemName: "Core",
					cssPath: "src/index.css",
					tokens: { "brand-500": "#2563eb" },
					overrides: ["brand-500"],
					reviewRequired: false,
				},
			],
		});

		const validateResult = await session.client.callTool({
			name: "validateDesignFile",
			arguments: { designFileId: trickroomMcpTestDesignUuid, response: "full" },
		});
		const warnings = (
			validateResult.structuredContent as {
				warnings?: Array<{ code: string; classToken?: string }>;
			}
		).warnings;

		expect(
			warnings?.map((warning) => [warning.code, warning.classToken]).sort(),
		).toEqual([
			["UNKNOWN_COLOR_TOKEN", "bg-brand-600"],
			["UNKNOWN_RADIUS_TOKEN", "rounded-missing"],
		]);
	});

	it("emits unknown utility warnings without stored tokens when CSS loads", async () => {
		const { session } = await createSession({
			tokenSnapshots: [],
			designs: {
				[trickroomMcpTestDesignUuid]: {
					name: "No Token Snapshot Design",
					systemName: "Core",
					boards: [
						{
							id: "board",
							props: {
								"data-trickroom-name": "Board",
								"data-trickroom-library": "trickroom",
								"data-trickroom-component": "container",
								className:
									"p-card bg-brand-500 definitely-not-a-tailwind-utility",
							},
							children: [],
						},
					],
				},
			},
		});

		const validateResult = await session.client.callTool({
			name: "validateDesignFile",
			arguments: { designFileId: trickroomMcpTestDesignUuid, response: "full" },
		});
		const validation = withWarnings(validateResult.structuredContent) as {
			issues: Array<{ code: string; classToken?: string; token?: string }>;
		};

		expect(validation.issues).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ code: "DESIGN_TOKENS_NOT_STORED" }),
				expect.objectContaining({
					code: "UNKNOWN_TAILWIND_UTILITY",
					classToken: "definitely-not-a-tailwind-utility",
				}),
			]),
		);
		expect(validation.issues).not.toEqual(
			expect.arrayContaining([
				expect.objectContaining({ code: "UNKNOWN_SPACING_TOKEN" }),
				expect.objectContaining({ code: "UNKNOWN_COLOR_TOKEN" }),
			]),
		);
	});

	it("suggests the nearest class for unknown utilities and tokens", async () => {
		const { session } = await createSession({
			designs: {
				[trickroomMcpTestDesignUuid]: {
					name: "Typo Design",
					systemName: "Core",
					boards: [
						{
							id: "board",
							props: {
								"data-trickroom-name": "Board",
								"data-trickroom-library": "trickroom",
								"data-trickroom-component": "container",
								className: "flex-colum md:itmes-center bg-brand-600",
							},
							children: [],
						},
					],
				},
			},
			tokenSnapshots: [
				{
					systemName: "Core",
					cssPath: "src/index.css",
					tokens: { "brand-500": "#2563eb" },
					overrides: ["brand-500"],
					reviewRequired: false,
				},
			],
		});

		const validateResult = await session.client.callTool({
			name: "validateDesignFile",
			arguments: { designFileId: trickroomMcpTestDesignUuid, response: "full" },
		});
		const issues = (
			withWarnings(validateResult.structuredContent) as {
				issues: Array<{
					code: string;
					classToken?: string;
					suggestions?: string[];
					message: string;
				}>;
			}
		).issues;
		const byToken = (classToken: string) =>
			issues.find((issue) => issue.classToken === classToken);

		expect(byToken("flex-colum")).toMatchObject({
			code: "UNKNOWN_TAILWIND_UTILITY",
			suggestions: expect.arrayContaining(["flex-col"]),
		});
		expect(byToken("md:itmes-center")).toMatchObject({
			code: "UNKNOWN_TAILWIND_UTILITY",
			suggestions: ["md:items-center"],
			message: expect.stringContaining('Did you mean "md:items-center"?'),
		});
		expect(byToken("bg-brand-600")).toMatchObject({
			code: "UNKNOWN_COLOR_TOKEN",
			suggestions: expect.arrayContaining(["bg-brand-500"]),
		});
	});

	it("skips unknown utility warnings when the design system CSS cannot be loaded", async () => {
		const { session } = await createSession({
			systemCss: {
				Core: '@import "./missing-tailwind.css";\n',
			},
			designs: {
				[trickroomMcpTestDesignUuid]: {
					name: "Missing CSS Design",
					systemName: "Core",
					boards: [
						{
							id: "board",
							props: {
								"data-trickroom-name": "Board",
								"data-trickroom-library": "trickroom",
								"data-trickroom-component": "container",
								className: "definitely-not-a-tailwind-utility",
							},
							children: [],
						},
					],
				},
			},
			tokenSnapshots: [
				{
					systemName: "Core",
					cssPath: "src/index.css",
					tokens: {},
					overrides: [],
					baselineDiff: { added: [], overridden: [], removed: [] },
					reviewRequired: false,
				},
			],
		});

		const validateResult = await session.client.callTool({
			name: "validateDesignFile",
			arguments: { designFileId: trickroomMcpTestDesignUuid, response: "full" },
		});
		const validation = withWarnings(validateResult.structuredContent) as {
			issues: Array<{ code: string }>;
		};

		expect(validation.issues).not.toEqual(
			expect.arrayContaining([
				expect.objectContaining({ code: "UNKNOWN_TAILWIND_UTILITY" }),
			]),
		);
	});
});

describe("missing renderer diagnostics", () => {
	const node = (
		id: string,
		library: string,
		component: string,
		children: TrickroomDesign["boards"] = [],
	): TrickroomDesign["boards"][number] => ({
		id,
		props: {
			"data-trickroom-name": id,
			"data-trickroom-library": library,
			"data-trickroom-component": component,
		},
		children,
	});

	it("warns for elements whose registry component has no render component", async () => {
		const design = {
			name: "Missing renderer",
			boards: [
				node("board", "trickroom", "container", [
					node("meter", "base-ui", "meter.root", [
						node("track", "base-ui", "meter.track"),
					]),
				]),
			],
		} satisfies TrickroomDesign;

		const diagnostics = await getDesignDiagnostics(
			{ projectRoot: "/nonexistent" } as Parameters<
				typeof getDesignDiagnostics
			>[0],
			design,
		);

		expect(diagnostics.issues).toEqual([
			expect.objectContaining({
				severity: "warning",
				code: "MISSING_RENDERER",
				path: "boards[0].children[0].children[0]",
				elementId: "track",
			}),
		]);
		expect(diagnostics.issues[0]?.message).toContain("base-ui/meter.track");
	});

	it("surfaces missing renderers on touched elements by default", () => {
		const warning: McpDesignIssue = {
			severity: "warning",
			code: "MISSING_RENDERER",
			message: "no renderer",
			elementId: "track",
		};
		expect(isDefaultSurfacedWarning(warning)).toBe(true);
		expect(isLikelyTypoWarning(warning)).toBe(false);

		const diagnostics = { issues: [warning], tokenSnapshot: null };
		expect(
			shapeMutationDiagnostics(diagnostics, undefined, ["track"]),
		).toMatchObject({
			warningCount: 1,
			warnings: [
				{
					code: "MISSING_RENDERER",
					message: "no renderer",
					elementIds: ["track"],
				},
			],
		});
		expect(shapeMutationDiagnostics(diagnostics, undefined, ["other"])).toEqual(
			expect.objectContaining({ warningCount: 0 }),
		);
		expect(
			shapeMutationDiagnostics(diagnostics, undefined, ["other"]),
		).not.toHaveProperty("warnings");
	});
});

describe("shapeMutationDiagnostics", () => {
	const issues: McpDesignIssue[] = [
		{
			severity: "error",
			code: "UNKNOWN_ICON_ID",
			message: "e",
			elementId: "a",
		},
		{
			severity: "warning",
			code: "UNKNOWN_TAILWIND_UTILITY",
			message: "typo on touched",
			elementId: "a",
		},
		{
			severity: "warning",
			code: "OUT_OF_SYSTEM_COLOR",
			message: "arbitrary on touched",
			elementId: "a",
		},
		{
			severity: "warning",
			code: "UNKNOWN_SPACING_TOKEN",
			message: "typo elsewhere",
			elementId: "b",
		},
		{
			severity: "warning",
			code: "DESIGN_SYSTEM_REVIEW_REQUIRED",
			message: "file level",
		},
	];
	const diagnostics = { issues, tokenSnapshot: null };

	it("classifies unknown utilities and unknown tokens as likely typos", () => {
		expect(
			issues.filter(isLikelyTypoWarning).map((issue) => issue.code),
		).toEqual(["UNKNOWN_TAILWIND_UTILITY", "UNKNOWN_SPACING_TOKEN"]);
	});

	it("returns touched-element typo warnings and an affected-scope count by default", () => {
		const shaped = shapeMutationDiagnostics(diagnostics, undefined, ["a"]);
		expect(shaped.issues.map((issue) => issue.code)).toEqual([
			"UNKNOWN_ICON_ID",
		]);
		expect(shaped.warningCount).toBe(3);
		expect(shaped.warnings).toEqual([
			{
				code: "UNKNOWN_TAILWIND_UTILITY",
				message: "typo on touched",
				elementIds: ["a"],
			},
		]);
		expect(shaped).not.toHaveProperty("tokenDiagnostics");
	});

	it("omits the warnings key when nothing touched has a typo", () => {
		const shaped = shapeMutationDiagnostics(diagnostics, undefined, []);
		expect(shaped.warningCount).toBe(1);
		expect(shaped).not.toHaveProperty("warnings");
	});

	it("returns every scoped warning ungrouped and the token diagnostics with full", () => {
		const shaped = shapeMutationDiagnostics(diagnostics, "full", ["a"]);
		expect(shaped.warningCount).toBe(3);
		expect(shaped.warnings?.map((warning) => warning.message)).toEqual([
			"typo on touched",
			"arbitrary on touched",
			"file level",
		]);
		expect(shaped).toHaveProperty("tokenDiagnostics", null);
	});

	it("scopes the count to the whole design when no ids are passed", () => {
		expect(shapeMutationDiagnostics(diagnostics, undefined).warningCount).toBe(
			4,
		);
	});
});

describe("groupWarnings", () => {
	const typo = (
		elementId: string,
	): McpDesignIssue & { classToken: string } => ({
		severity: "warning",
		code: "UNKNOWN_COLOR_TOKEN",
		message: 'Class "bg-brand-600" references unavailable color token.',
		elementId,
		classToken: "bg-brand-600",
	});

	it("groups by code and class, listing each element once", () => {
		expect(
			groupWarnings([
				typo("a"),
				typo("b"),
				typo("a"),
				{ ...typo("c"), classToken: "bg-brand-700", message: "other" },
				{
					severity: "warning",
					code: "DESIGN_SYSTEM_REVIEW_REQUIRED",
					message: "file",
				},
			]),
		).toEqual([
			{
				code: "UNKNOWN_COLOR_TOKEN",
				message: typo("a").message,
				elementIds: ["a", "b"],
			},
			{ code: "UNKNOWN_COLOR_TOKEN", message: "other", elementIds: ["c"] },
			{ code: "DESIGN_SYSTEM_REVIEW_REQUIRED", message: "file" },
		]);
	});

	it("truncates long groups and reports the total", () => {
		expect(
			groupWarnings([typo("a"), typo("b"), typo("c")], { maxElementIds: 2 }),
		).toEqual([
			{
				code: "UNKNOWN_COLOR_TOKEN",
				message: typo("a").message,
				elementIds: ["a", "b"],
				count: 3,
			},
		]);
	});
});

describe("suggestTailwindClasses", () => {
	const classNames = ["flex", "flex-col", "items-center", "bg-red-500", "p-4"];

	it("keeps variants, important markers, and opacity modifiers", () => {
		expect(suggestTailwindClasses(classNames, "hover:!flex-colum")).toEqual([
			"hover:!flex-col",
		]);
		expect(suggestTailwindClasses(classNames, "bg-red-50O/50")).toEqual([
			"bg-red-500/50",
		]);
	});

	it("skips arbitrary values and very short roots", () => {
		expect(suggestTailwindClasses(classNames, "bg-[#fff]x")).toEqual([]);
		expect(suggestTailwindClasses(classNames, "p")).toEqual([]);
	});
});
