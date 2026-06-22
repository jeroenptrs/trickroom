import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RECIPE_MARKER_PROP_KEYS } from "../recipes/markers";
import type { TrickroomDesign } from "../types";
import {
	createTrickroomMcpProjectFixture,
	createTrickroomMcpTestClient,
	type TrickroomMcpClientSession,
	type TrickroomMcpProjectFixture,
	trickroomMcpTestDesign,
	trickroomMcpTestDesignUuid,
} from "./test-support";

const secondDesignFileId = "20000000-0000-4000-8000-000000000002";

const diagnosticDesign = {
	name: "Diagnostic Design",
	systemName: "Core",
	boards: [
		{
			id: "board",
			props: {
				"data-trickroom-name": "Board",
				"data-trickroom-library": "trickroom",
				"data-trickroom-component": "container",
				className: "bg-brand-500 text-missing-500 border-[#123456]",
			},
			children: [
				{
					id: "title",
					props: {
						"data-trickroom-name": "Title",
						"data-trickroom-library": "trickroom",
						"data-trickroom-component": "text",
						"data-trickroom-role": "text",
					},
					children: "Diagnostics",
				},
			],
		},
	],
} satisfies TrickroomDesign;

const baselineColorDesign = {
	name: "Baseline Color Design",
	systemName: "Core",
	boards: [
		{
			id: "board",
			props: {
				"data-trickroom-name": "Board",
				"data-trickroom-library": "trickroom",
				"data-trickroom-component": "container",
				className:
					"bg-slate-50 text-slate-950 hover:bg-slate-50 divide-y divide-slate-200 bg-white inset-shadow-slate-200 text-current bg-transparent border-inherit",
			},
			children: [],
		},
	],
} satisfies TrickroomDesign;

describe("MCP Phase 2 and Phase 3 tools", () => {
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

	it("reads a flat design graph with canonical addresses", async () => {
		const { session } = await createSession();

		const result = await session.client.callTool({
			name: "readDesignGraph",
			arguments: {
				designFileId: trickroomMcpTestDesignUuid,
				includeProps: true,
			},
		});

		expect(result.structuredContent).toMatchObject({
			project: {
				name: "Harness Project",
			},
			graph: {
				rootElementIds: ["board"],
				parentIdByElementId: {
					board: null,
					title: "board",
				},
				childIdsByElementId: {
					board: ["title"],
					title: [],
				},
				addressByElementId: {
					board: "/boards/0",
					title: "/boards/0/children/0",
				},
				elementsById: {
					title: {
						role: "text",
						textPreview: "Harness fixture",
						addresses: {
							text: "/boards/0/children/0/children",
							name: "/boards/0/children/0/props/data-trickroom-name",
						},
					},
				},
			},
		});
	});

	it("returns a model-facing authoring contract", async () => {
		const { session } = await createSession();

		const result = await session.client.callTool({
			name: "getDesignAuthoringContract",
			arguments: { designFileId: trickroomMcpTestDesignUuid },
		});

		expect(result.structuredContent).toMatchObject({
			schemaVersion: 1,
			designSchemaVersion: 1,
			catalogVersion: "builtin:trickroom:1",
			catalogHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
			props: {
				writableInstanceProps: ["className", "data-trickroom-name"],
				fixedSystemProps: [
					"data-trickroom-library",
					"data-trickroom-component",
					"data-trickroom-role",
				],
				systemOwnedProps: expect.arrayContaining([...RECIPE_MARKER_PROP_KEYS]),
			},
			compositionRules: {
				roleInvariants: expect.arrayContaining([
					expect.objectContaining({
						role: "text",
						acceptsElementChildren: false,
					}),
				]),
			},
		});
		const contract = result.structuredContent as {
			props: {
				systemOwnedProps: string[];
			};
			registries: Array<{
				library: string;
				components: Array<{
					component: string;
					role?: string;
					inspectTool?: string;
					composition?: { kind: string; acceptsElementChildren: boolean };
					content?: { kind: string; updateTool?: string };
				}>;
			}>;
		};
		expect(contract.props.systemOwnedProps).toEqual(
			[...contract.props.systemOwnedProps].sort(),
		);
		const textComponent = contract.registries
			.find((registry) => registry.library === "trickroom")
			?.components.find((component) => component.component === "text");
		expect(textComponent).toMatchObject({
			component: "text",
			role: "text",
			inspectTool: "describeRegistryComponent",
		});

		const fullResult = await session.client.callTool({
			name: "getDesignAuthoringContract",
			arguments: {
				designFileId: trickroomMcpTestDesignUuid,
				includeRegistryComponents: "full",
			},
		});
		const fullContract = fullResult.structuredContent as {
			registries: Array<{
				library: string;
				components: Array<{
					component: string;
					composition: { kind: string; acceptsElementChildren: boolean };
					content: { kind: string; updateTool?: string };
				}>;
			}>;
		};
		const fullTextComponent = fullContract.registries
			.find((registry) => registry.library === "trickroom")
			?.components.find((component) => component.component === "text");
		expect(fullTextComponent).toMatchObject({
			component: "text",
			composition: {
				kind: "none",
				acceptsElementChildren: false,
			},
			content: {
				kind: "text",
				updateTool: "updateElementText",
			},
		});
	});

	it("dry-runs operations without writing", async () => {
		const { fixture, session } = await createSession();
		const revision = await getRevision(session);

		const result = await session.client.callTool({
			name: "validateOperation",
			arguments: {
				designFileId: trickroomMcpTestDesignUuid,
				expectedRevision: revision,
				operation: "addElement",
				parameters: {
					parentId: "board",
					index: 1,
					library: "trickroom",
					component: "text",
					name: "Caption",
					text: "Dry run only",
				},
			},
		});

		expect(result.isError).toBeFalsy();
		expect(result.structuredContent).toMatchObject({
			status: "success",
			valid: true,
			operation: "addElement",
			predicted: {
				componentRef: "trickroom/text",
				changedElement: {
					name: "Caption",
					role: "text",
					textPreview: "Dry run only",
				},
				context: {
					parentId: "board",
					index: 1,
				},
			},
		});

		const persisted = await fixture.designFileService.readDesignFile(
			fixture.designFileService.getFileForUuid(trickroomMcpTestDesignUuid),
		);
		expect(persisted.revision).toBe(revision);
		expect(persisted.design.boards[0].children).toHaveLength(1);
	});

	it("reports token/class diagnostics from validation and mutation responses", async () => {
		const { session } = await createSession({
			designs: {
				[trickroomMcpTestDesignUuid]: diagnosticDesign,
			},
			tokenSnapshots: [
				{
					systemName: "Core",
					cssPath: "src/index.css",
					tokens: {
						"brand-500": "#2563eb",
					},
					overrides: ["brand-500"],
					reviewRequired: true,
				},
			],
		});

		const validateResult = await session.client.callTool({
			name: "validateDesignFile",
			arguments: { designFileId: trickroomMcpTestDesignUuid },
		});
		expect(validateResult.structuredContent).toMatchObject({
			valid: true,
			tokenDiagnostics: {
				available: true,
				reviewRequired: true,
				tokenCount: 1,
			},
			issues: expect.arrayContaining([
				expect.objectContaining({ code: "DESIGN_SYSTEM_REVIEW_REQUIRED" }),
				expect.objectContaining({
					code: "UNKNOWN_COLOR_TOKEN",
					elementId: "board",
					token: "missing-500",
				}),
				expect.objectContaining({
					code: "OUT_OF_SYSTEM_COLOR",
					elementId: "board",
					classToken: "border-[#123456]",
				}),
			]),
		});

		const revision = await getRevision(session);
		const mutationResult = await session.client.callTool({
			name: "updateElementProps",
			arguments: {
				designFileId: trickroomMcpTestDesignUuid,
				expectedRevision: revision,
				elementId: "board",
				className: "bg-missing-600",
			},
		});
		expect(mutationResult.structuredContent).toMatchObject({
			status: "success",
			warnings: expect.arrayContaining([
				expect.objectContaining({
					code: "UNKNOWN_COLOR_TOKEN",
					token: "missing-600",
				}),
			]),
		});
	});

	it("treats Tailwind baseline colors as available when snapshots contain no meaningful tokens", async () => {
		const { session } = await createSession({
			systemCss: {
				Core: '@import "tailwindcss";\n',
			},
			designs: {
				[trickroomMcpTestDesignUuid]: baselineColorDesign,
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
			issues: Array<{ code: string; token?: string }>;
		};
		expect(validation.issues).not.toContainEqual(
			expect.objectContaining({ code: "UNKNOWN_COLOR_TOKEN" }),
		);

		const revision = await getRevision(session);
		const mutationResult = await session.client.callTool({
			name: "addElement",
			arguments: {
				designFileId: trickroomMcpTestDesignUuid,
				expectedRevision: revision,
				parentId: "board",
				index: 0,
				library: "trickroom",
				component: "text",
				name: "Baseline Token",
				className: "bg-slate-50 text-slate-950 hover:bg-white",
				text: "Baseline token",
			},
		});
		const mutation = mutationResult.structuredContent as {
			warnings: Array<{ code: string; token?: string }>;
		};
		expect(mutation.warnings).not.toContainEqual(
			expect.objectContaining({ code: "UNKNOWN_COLOR_TOKEN" }),
		);
	});

	it("warns for Tailwind defaults explicitly removed from the system snapshot", async () => {
		const { session } = await createSession({
			designs: {
				[trickroomMcpTestDesignUuid]: {
					...baselineColorDesign,
					boards: [
						{
							...baselineColorDesign.boards[0],
							props: {
								...baselineColorDesign.boards[0].props,
								className: "bg-slate-50 text-slate-950",
							},
						},
					],
				},
			},
			tokenSnapshots: [
				{
					systemName: "Core",
					cssPath: "src/index.css",
					tokens: {},
					overrides: ["--color-slate-50"],
					baselineDiff: {
						added: [],
						overridden: [],
						removed: [
							{
								name: "slate-50",
								defaultValue: "oklch(98.4% 0.003 247.858)",
								domain: "color",
							},
						],
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
		const unknownColorWarnings = validation.issues.filter(
			(issue) => issue.code === "UNKNOWN_COLOR_TOKEN",
		);

		expect(unknownColorWarnings).toEqual([
			expect.objectContaining({
				code: "UNKNOWN_COLOR_TOKEN",
				token: "slate-50",
			}),
		]);
		expect(validation.issues).not.toContainEqual(
			expect.objectContaining({
				code: "UNKNOWN_COLOR_TOKEN",
				token: "slate-950",
			}),
		);

		const revision = await getRevision(session);
		const mutationResult = await session.client.callTool({
			name: "addElement",
			arguments: {
				designFileId: trickroomMcpTestDesignUuid,
				expectedRevision: revision,
				parentId: "board",
				index: 0,
				library: "trickroom",
				component: "text",
				name: "Removed Baseline Token",
				className: "bg-slate-50 text-slate-950",
				text: "Removed baseline token",
			},
		});
		const mutation = mutationResult.structuredContent as {
			warnings: Array<{ code: string; token?: string }>;
		};

		expect(mutation.warnings).toContainEqual(
			expect.objectContaining({
				code: "UNKNOWN_COLOR_TOKEN",
				token: "slate-50",
			}),
		);
		expect(mutation.warnings).not.toContainEqual(
			expect.objectContaining({
				code: "UNKNOWN_COLOR_TOKEN",
				token: "slate-950",
			}),
		);
	});

	it("enforces read-only mode and writes audit log entries", async () => {
		const { fixture, session } = await createSession({
			config: {
				mcp: {
					enabled: true,
					mode: "read-only",
					auditLog: true,
				},
			},
		});
		const revision = await getRevision(session);

		const result = await session.client.callTool({
			name: "updateElementText",
			arguments: {
				designFileId: trickroomMcpTestDesignUuid,
				expectedRevision: revision,
				elementId: "title",
				text: "Blocked",
			},
		});

		expect(result.isError).toBe(true);
		expect(result.structuredContent).toMatchObject({
			status: "POLICY_DENIED",
			code: "MCP_READ_ONLY",
			governance: {
				mode: "read-only",
				auditLog: true,
			},
		});

		const auditLog = await readFile(
			path.join(fixture.projectRoot, ".trickroom", "audit-log.jsonl"),
			"utf8",
		);
		const entries = auditLog
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line) as Record<string, unknown>);
		expect(entries).toContainEqual(
			expect.objectContaining({
				toolName: "updateElementText",
				operation: "updateElementText",
				designFileId: trickroomMcpTestDesignUuid,
				expectedRevision: revision,
				success: false,
				status: "POLICY_DENIED",
				code: "MCP_READ_ONLY",
			}),
		);
	});

	it("enforces allowed design file and component policy", async () => {
		const { session } = await createSession({
			config: {
				mcp: {
					enabled: true,
					allowedDesignFileIds: [trickroomMcpTestDesignUuid],
					allowedComponents: ["trickroom/text"],
				},
			},
			designs: {
				[trickroomMcpTestDesignUuid]: trickroomMcpTestDesign,
				[secondDesignFileId]: {
					...trickroomMcpTestDesign,
					name: "Second",
				},
			},
		});

		const listResult = await session.client.callTool({
			name: "listDesignFiles",
			arguments: {},
		});
		expect(listResult.structuredContent).toMatchObject({
			designFiles: [
				expect.objectContaining({ id: trickroomMcpTestDesignUuid }),
			],
		});

		const deniedRead = await session.client.callTool({
			name: "readDesignFile",
			arguments: { designFileId: secondDesignFileId },
		});
		expect(deniedRead.isError).toBe(true);
		expect(deniedRead.structuredContent).toMatchObject({
			status: "POLICY_DENIED",
			code: "MCP_DESIGN_FILE_NOT_ALLOWED",
		});

		const components = await session.client.callTool({
			name: "listRegistryComponents",
			arguments: { library: "trickroom" },
		});
		expect(components.structuredContent).toMatchObject({
			registries: [
				{
					components: [
						expect.objectContaining({
							component: "text",
						}),
					],
				},
			],
		});
		const listedComponents = (
			components.structuredContent as {
				registries: Array<{ components: Array<{ component: string }> }>;
			}
		).registries[0].components.map((component) => component.component);
		expect(listedComponents).not.toContain("container");

		const deniedComponent = await session.client.callTool({
			name: "describeRegistryComponent",
			arguments: {
				library: "trickroom",
				component: "container",
			},
		});
		expect(deniedComponent.isError).toBe(true);
		expect(deniedComponent.structuredContent).toMatchObject({
			status: "POLICY_DENIED",
			code: "MCP_COMPONENT_NOT_ALLOWED",
		});
	});
});
