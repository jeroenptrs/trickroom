import { afterEach, describe, expect, it } from "vitest";
import type { TrickroomDesign } from "../types";
import {
	createTrickroomMcpProjectFixture,
	createTrickroomMcpTestClient,
	type TrickroomMcpClientSession,
	type TrickroomMcpProjectFixture,
	trickroomMcpTestDesignUuid,
} from "./test-support";

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
			arguments: { designFileId: trickroomMcpTestDesignUuid },
		});
		const validation = validateResult.structuredContent as {
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
		const defaultValidation = defaultResult.structuredContent as {
			tokenDiagnostics: { customUtilities?: unknown } | null;
		};
		expect(defaultValidation.tokenDiagnostics).not.toBeNull();
		expect(defaultValidation.tokenDiagnostics?.customUtilities).toBeUndefined();

		const verboseResult = await session.client.callTool({
			name: "validateDesignFile",
			arguments: {
				designFileId: trickroomMcpTestDesignUuid,
				includeTokenDiagnostics: true,
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
			arguments: { designFileId: trickroomMcpTestDesignUuid },
		});
		const validation = validateResult.structuredContent as {
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

	it("omits warnings from single-element writes and surfaces them via validateDesignFile", async () => {
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

		// Minimal-default contract: single-element writes echo only error-severity
		// issues, never warnings. Diagnostics are reachable via validateDesignFile.
		expect(mutationResult.structuredContent).toMatchObject({
			status: "success",
		});
		expect(mutationResult.structuredContent).not.toHaveProperty("warnings");

		const validateResult = await session.client.callTool({
			name: "validateDesignFile",
			arguments: {
				designFileId: trickroomMcpTestDesignUuid,
			},
		});

		expect(validateResult.structuredContent).toMatchObject({
			issues: expect.arrayContaining([
				expect.objectContaining({
					code: "UNKNOWN_FONT_TOKEN",
					token: "missing",
				}),
				expect.objectContaining({
					code: "OUT_OF_SYSTEM_RADIUS",
					classToken: "rounded-[2rem]",
				}),
			]),
		});
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
			arguments: { designFileId: trickroomMcpTestDesignUuid },
		});
		const validation = validateResult.structuredContent as {
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
			arguments: { designFileId: trickroomMcpTestDesignUuid },
		});
		const validation = validateResult.structuredContent as {
			issues: Array<{ code: string }>;
		};

		expect(validation.issues).not.toEqual(
			expect.arrayContaining([
				expect.objectContaining({ code: "UNKNOWN_TAILWIND_UTILITY" }),
			]),
		);
	});
});
