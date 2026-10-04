import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
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

	it("reads a bounded flat design graph with opt-in addresses", async () => {
		const { session } = await createSession();

		const result = await session.client.callTool({
			name: "readDesignGraph",
			arguments: {
				designFileId: trickroomMcpTestDesignUuid,
				includeAddresses: true,
			},
		});

		expect(result.structuredContent).toMatchObject({
			project: {
				projectId: expect.any(String),
			},
			read: {
				depth: null,
				maxNodes: 100,
				truncated: false,
				returnedNodeCount: 2,
			},
			graph: {
				rootElementIds: ["board"],
				elementsById: {
					board: { parentId: null, childCount: 1, address: "/boards/0" },
					title: {
						parentId: "board",
						component: "text",
						text: "Harness fixture",
						address: "/boards/0/children/0",
					},
				},
			},
		});

		const bounded = await session.client.callTool({
			name: "readDesignGraph",
			arguments: {
				designFileId: trickroomMcpTestDesignUuid,
				maxNodes: 1,
				includeProps: true,
			},
		});
		expect(bounded.structuredContent).toMatchObject({
			read: {
				maxNodes: 1,
				truncated: true,
				returnedNodeCount: 1,
				omittedNodeCount: 1,
				next: {
					tool: "readSubtree",
					args: { elementId: "board" },
				},
			},
			graph: {
				elementsById: {
					board: {
						more: 1,
						props: { "data-trickroom-component": "container" },
					},
				},
			},
		});
		expect(
			(bounded.structuredContent as { graph: { elementsById: object } }).graph
				.elementsById,
		).not.toHaveProperty("title");
	});

	it("returns a model-facing authoring contract", async () => {
		const { session } = await createSession();

		const result = await session.client.callTool({
			name: "getDesignAuthoringContract",
			arguments: { designFileId: trickroomMcpTestDesignUuid },
		});
		const core = result.structuredContent as {
			model: string[];
			rules: string[];
			governance: { mode: string };
		};
		expect(core.governance.mode).toBe("read-write");
		expect(core.model.join(" ")).toContain("branch holds child elements");
		expect(core.rules.join(" ")).toContain("data-trickroom-library");

		const registryResult = await session.client.callTool({
			name: "getDesignAuthoringContract",
			arguments: { topic: "registry", library: "trickroom" },
		});
		const { registry } = registryResult.structuredContent as {
			registry: {
				writableProps: string;
				elements: Array<{ component: string; role: string }>;
			};
		};
		expect(registry.writableProps).toContain("data-trickroom-name");
		expect(registry.elements).toEqual(
			expect.arrayContaining([
				{
					component: "trickroom/text",
					label: "Text",
					role: "text",
					description: expect.any(String),
				},
				expect.objectContaining({
					component: "trickroom/container",
					role: "branch",
				}),
			]),
		);
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
		// Warnings are opt-in via response.includeWarnings on batch writes.
		const mutationResult = await session.client.callTool({
			name: "applyDesignOperations",
			arguments: {
				designFileId: trickroomMcpTestDesignUuid,
				expectedRevision: revision,
				operations: [
					{
						operation: "updateElementProps",
						parameters: {
							elementId: "board",
							className: "bg-missing-600",
						},
					},
				],
				response: { includeWarnings: true },
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

	it("applies the minimal-default response contract and verbosity escalation", async () => {
		const { session } = await createSession({
			designs: {
				[trickroomMcpTestDesignUuid]: diagnosticDesign,
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

		const addBadElement = () => ({
			operations: [
				{
					operation: "addElement",
					parameters: {
						parentId: "board",
						index: 0,
						library: "trickroom",
						component: "text",
						name: "Bad Token",
						className: "bg-also-missing-500",
						text: "bad",
					},
				},
			],
		});

		// Default: error issues, a warning count, and typo warnings (unknown
		// tokens/utilities) on touched elements only; no heavy token catalog.
		const defaultRevision = await getRevision(session);
		const defaultResult = await session.client.callTool({
			name: "applyDesignOperations",
			arguments: {
				designFileId: trickroomMcpTestDesignUuid,
				expectedRevision: defaultRevision,
				...addBadElement(),
			},
		});
		expect(defaultResult.structuredContent).toMatchObject({
			status: "success",
			warningCount: expect.any(Number),
			warnings: [
				expect.objectContaining({
					code: "UNKNOWN_COLOR_TOKEN",
					token: "also-missing-500",
				}),
			],
		});
		// applyDesignOperations omits token diagnostics entirely unless requested.
		expect(defaultResult.structuredContent).not.toHaveProperty(
			"tokenDiagnostics",
		);

		// includeWarnings with default scope: only warnings on touched elements;
		// the board's pre-existing bad tokens are not echoed.
		const affectedRevision = await getRevision(session);
		const affectedResult = await session.client.callTool({
			name: "applyDesignOperations",
			arguments: {
				designFileId: trickroomMcpTestDesignUuid,
				expectedRevision: affectedRevision,
				...addBadElement(),
				response: { includeWarnings: true },
			},
		});
		const affected = affectedResult.structuredContent as {
			warnings: Array<{ code: string; token?: string }>;
		};
		expect(affected.warnings).toContainEqual(
			expect.objectContaining({
				code: "UNKNOWN_COLOR_TOKEN",
				token: "also-missing-500",
			}),
		);
		expect(affected.warnings).not.toContainEqual(
			expect.objectContaining({
				code: "UNKNOWN_COLOR_TOKEN",
				token: "missing-500",
			}),
		);

		// warningScope "file": surfaces the whole design's warnings, including the
		// board's pre-existing bad tokens.
		const fileRevision = await getRevision(session);
		const fileResult = await session.client.callTool({
			name: "applyDesignOperations",
			arguments: {
				designFileId: trickroomMcpTestDesignUuid,
				expectedRevision: fileRevision,
				...addBadElement(),
				response: { includeWarnings: true, warningScope: "file" },
			},
		});
		const file = fileResult.structuredContent as {
			warnings: Array<{ code: string; token?: string }>;
		};
		expect(file.warnings).toContainEqual(
			expect.objectContaining({
				code: "UNKNOWN_COLOR_TOKEN",
				token: "missing-500",
			}),
		);
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
			name: "applyDesignOperations",
			arguments: {
				designFileId: trickroomMcpTestDesignUuid,
				expectedRevision: revision,
				operations: [
					{
						operation: "addElement",
						parameters: {
							parentId: "board",
							index: 0,
							library: "trickroom",
							component: "text",
							name: "Baseline Token",
							className: "bg-slate-50 text-slate-950 hover:bg-white",
							text: "Baseline token",
						},
					},
				],
				response: { includeWarnings: true },
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
			name: "applyDesignOperations",
			arguments: {
				designFileId: trickroomMcpTestDesignUuid,
				expectedRevision: revision,
				operations: [
					{
						operation: "addElement",
						parameters: {
							parentId: "board",
							index: 0,
							library: "trickroom",
							component: "text",
							name: "Removed Baseline Token",
							className: "bg-slate-50 text-slate-950",
							text: "Removed baseline token",
						},
					},
				],
				response: { includeWarnings: true },
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
