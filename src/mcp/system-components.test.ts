import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	createTrickroomMcpProjectFixture,
	createTrickroomMcpTestClient,
	type TrickroomMcpClientSession,
	type TrickroomMcpProjectFixture,
	toolPayload,
} from "./test-support";

const textRoot = () => ({
	path: "root",
	library: "trickroom",
	component: "text",
	text: "Primary",
});

describe("trickroom MCP system component tools", () => {
	let fixture: TrickroomMcpProjectFixture;
	let session: TrickroomMcpClientSession;

	beforeEach(async () => {
		fixture = await createTrickroomMcpProjectFixture();
		session = await createTrickroomMcpTestClient(
			await fixture.readMcpContext(),
		);
	});

	afterEach(async () => {
		await session.close();
		await fixture.cleanup();
	});

	it("lists, describes, updates, and publishes component drafts with revision metadata", async () => {
		const emptyList = await session.client.callTool({
			name: "component_read",
			arguments: { systemName: "Core" },
		});
		expect(toolPayload(emptyList)).toMatchObject({
			systemName: "Core",
			components: [],
			settings: { autoMigrateComponents: false },
		});
		const initialRevision = String(toolPayload(emptyList)?.revision);

		const created = await session.client.callTool({
			name: "component_draft_create",
			arguments: {
				systemName: "Core",
				expectedRevision: initialRevision,
				slug: "primary-label",
				name: "Primary Label",
				group: "content",
				order: 1,
				draft: { root: textRoot() },
			},
		});
		const componentId = String(toolPayload(created)?.componentId);
		// Writes acknowledge with ids, hashes, and a change summary.
		expect(toolPayload(created)).toMatchObject({
			status: "success",
			valid: true,
			componentId,
			slug: "primary-label",
			draftState: "unpublished",
			changes: {
				created: true,
				nodeCount: 1,
				variantAxes: [],
				slots: [],
				overrideTargets: [],
			},
			diagnostics: [],
		});
		expect(toolPayload(created)).not.toHaveProperty("record");
		expect(toolPayload(created)?.revision).not.toBe(initialRevision);
		expect(toolPayload(created)?.draftTemplateHash).toEqual(
			expect.stringMatching(/^sha256:/),
		);
		expect(toolPayload(created)?.draftVariantSchemaHash).toEqual(
			expect.stringMatching(/^sha256:/),
		);

		const listed = await session.client.callTool({
			name: "component_read",
			arguments: { systemName: "Core" },
		});
		expect(toolPayload(listed)).toMatchObject({
			revision: toolPayload(created)?.revision,
			componentCount: 1,
			components: [
				{
					componentId,
					slug: "primary-label",
					group: "content",
					draft: "unpublished",
				},
			],
		});
		// The name only restates the slug, so the index leaves it out.
		expect(
			(toolPayload(listed) as { components: object[] }).components[0],
		).not.toHaveProperty("name");

		const described = await session.client.callTool({
			name: "component_read",
			arguments: { systemName: "Core", componentId },
		});
		expect(toolPayload(described)).toMatchObject({
			revision: toolPayload(created)?.revision,
			source: { kind: "draft" },
			interface: { variantAxes: [], slots: [], overrideTargets: [] },
			valid: true,
			diagnostics: [],
		});
		expect(toolPayload(described)).not.toHaveProperty("root");
		expect(toolPayload(described)).not.toHaveProperty("record");

		const updated = await session.client.callTool({
			name: "component_draft_update",
			arguments: {
				systemName: "Core",
				componentId,
				expectedRevision: toolPayload(described)?.revision,
				expectedDraftTemplateHash: toolPayload(described)?.draftTemplateHash,
				root: {
					path: "root",
					library: "trickroom",
					component: "container",
					children: [
						{
							path: "label",
							library: "trickroom",
							component: "text",
							text: "Updated",
						},
					],
				},
				slots: {
					content: { name: "content", hostPath: "root", label: "Content" },
				},
				variants: null,
				overrideTargets: {
					label: {
						targetId: "label",
						label: "Label",
						path: "label",
					},
				},
			},
		});
		expect(toolPayload(updated)).toMatchObject({
			status: "success",
			valid: true,
			changes: {
				replaced: ["root", "slots", "variants", "overrideTargets"],
				templateChanged: true,
				variantsChanged: false,
				nodeCount: { from: 1, to: 2 },
				slots: { added: ["content"] },
				overrideTargets: { added: ["label"] },
			},
		});

		const draftDetail = await session.client.callTool({
			name: "component_read",
			arguments: {
				systemName: "Core",
				componentId,
				source: "draft",
				include: ["template", "classes"],
			},
		});
		expect(toolPayload(draftDetail)).toMatchObject({
			interface: {
				slots: [{ name: "content", label: "Content", hostPath: "root" }],
				overrideTargets: [
					{
						targetId: "label",
						label: "Label",
						path: "label",
						capabilities: ["className"],
					},
				],
			},
			root: {
				component: "container",
				children: [expect.objectContaining({ path: "label" })],
			},
			slots: { content: expect.objectContaining({ hostPath: "root" }) },
			overrideTargets: { label: expect.objectContaining({ path: "label" }) },
		});
		expect(toolPayload(updated)?.draftTemplateHash).not.toBe(
			toolPayload(described)?.draftTemplateHash,
		);

		const published = await session.client.callTool({
			name: "component_publish",
			arguments: {
				systemName: "Core",
				componentId,
				expectedRevision: toolPayload(updated)?.revision,
			},
		});
		expect(toolPayload(published)).toMatchObject({
			status: "success",
			componentId,
			publishedVersion: "1",
			published: {
				currentVersion: "1",
				templateHash: (toolPayload(updated) as { draftTemplateHash: string })
					.draftTemplateHash,
			},
			changes: { toVersion: "1", nodeCount: 2, slots: ["content"] },
			valid: true,
			diagnostics: [],
		});
		expect(toolPayload(published)).not.toHaveProperty("draftState");

		const record = await session.client.callTool({
			name: "component_read",
			arguments: { systemName: "Core", componentId, versions: "all" },
		});
		expect(toolPayload(record)).toMatchObject({
			source: { kind: "published", version: "1" },
			versionHistory: [{ version: "1" }],
			record: { published: { currentVersion: "1" } },
		});
	});

	it("filters the component index by query and group", async () => {
		const initial = await session.client.callTool({
			name: "component_read",
			arguments: { systemName: "Core" },
		});
		let revision = (toolPayload(initial) as { revision: string }).revision;
		for (const [slug, group, description] of [
			["button", "actions", "Primary action trigger. Supports icons."],
			["link", "actions", undefined],
			["card", "layout", "A surface for grouped content."],
		] as const) {
			const created = await session.client.callTool({
				name: "component_draft_create",
				arguments: {
					systemName: "Core",
					expectedRevision: revision,
					slug,
					name: slug,
					group,
					...(description ? { description } : {}),
					draft: {
						root: textRoot(),
						variants: {
							axes: {
								tone: {
									label: "Tone",
									defaultValue: "neutral",
									values: { neutral: {}, brand: {} },
								},
							},
						},
					},
				},
			});
			revision = (toolPayload(created) as { revision: string }).revision;
		}

		const actions = await session.client.callTool({
			name: "component_read",
			arguments: { systemName: "Core", group: "Actions" },
		});
		expect(toolPayload(actions)).toMatchObject({
			componentCount: 3,
			matchedCount: 2,
			components: [
				{
					slug: "button",
					variants: "tone: neutral|brand",
					description: "Primary action trigger.",
				},
				{ slug: "link" },
			],
		});

		const surface = await session.client.callTool({
			name: "component_read",
			arguments: { systemName: "Core", query: "SURFACE" },
		});
		expect(toolPayload(surface)).toMatchObject({
			matchedCount: 1,
			components: [{ slug: "card" }],
		});
	});

	it("rejects concurrent createSystemComponentDraft calls with the same expected revision", async () => {
		const initial = await session.client.callTool({
			name: "component_read",
			arguments: { systemName: "Core" },
		});
		const expectedRevision = String(toolPayload(initial)?.revision);

		const [firstResult, secondResult] = await Promise.all([
			session.client.callTool({
				name: "component_draft_create",
				arguments: {
					systemName: "Core",
					expectedRevision,
					slug: "concurrent-a",
					name: "Concurrent A",
				},
			}),
			session.client.callTool({
				name: "component_draft_create",
				arguments: {
					systemName: "Core",
					expectedRevision,
					slug: "concurrent-b",
					name: "Concurrent B",
				},
			}),
		]);

		const outcomes = [firstResult, secondResult];
		const successes = outcomes.filter((outcome) => outcome.isError !== true);
		const staleFailures = outcomes.filter(
			(outcome) =>
				outcome.isError === true &&
				toolPayload(outcome)?.code === "STALE_WRITE",
		);

		expect(successes).toHaveLength(1);
		expect(staleFailures).toHaveLength(1);
		expect(toolPayload(successes[0])).toMatchObject({
			status: "success",
			valid: true,
		});

		const listed = await session.client.callTool({
			name: "component_read",
			arguments: { systemName: "Core" },
		});
		expect(toolPayload(listed)?.components).toHaveLength(1);
		expect(
			["concurrent-a", "concurrent-b"].includes(
				String(toolPayload(listed)?.components?.[0]?.slug),
			),
		).toBe(true);

		const winnerId = String(toolPayload(successes[0]).componentId);
		const described = await session.client.callTool({
			name: "component_read",
			arguments: { systemName: "Core", componentId: winnerId },
		});
		expect(described.isError).not.toBe(true);
		expect(toolPayload(described)).toMatchObject({
			valid: true,
			componentId: winnerId,
		});
	});

	it("fails stale manifest and draft-hash writes clearly", async () => {
		const initial = await session.client.callTool({
			name: "component_read",
			arguments: { systemName: "Core" },
		});
		const created = await session.client.callTool({
			name: "component_draft_create",
			arguments: {
				systemName: "Core",
				expectedRevision: toolPayload(initial)?.revision,
				slug: "stale-test",
				name: "Stale Test",
			},
		});
		const componentId = String(toolPayload(created)?.componentId);

		const staleCreate = await session.client.callTool({
			name: "component_draft_create",
			arguments: {
				systemName: "Core",
				expectedRevision: toolPayload(initial)?.revision,
				slug: "second",
				name: "Second",
			},
		});
		expect(staleCreate.isError).toBe(true);
		expect(toolPayload(staleCreate)).toMatchObject({
			status: "INVALID_OPERATION",
			code: "STALE_WRITE",
		});

		const staleHash = await session.client.callTool({
			name: "component_draft_update",
			arguments: {
				systemName: "Core",
				componentId,
				expectedRevision: toolPayload(created)?.revision,
				expectedDraftTemplateHash: "sha256:not-current",
				root: textRoot(),
			},
		});
		expect(staleHash.isError).toBe(true);
		expect(toolPayload(staleHash)).toMatchObject({
			status: "INVALID_OPERATION",
			code: "DRAFT_HASH_MISMATCH",
		});
	});

	it("publishes draft authoring shape information in MCP tool schemas", async () => {
		const tools = await session.client.listTools();
		const updateTool = tools.tools.find(
			(tool) => tool.name === "component_draft_update",
		);
		const createTool = tools.tools.find(
			(tool) => tool.name === "component_draft_create",
		);

		expect(updateTool).toBeDefined();
		expect(createTool).toBeDefined();

		const updateSchema = JSON.stringify(
			updateTool?.inputSchema.properties ?? {},
		);
		const createSchema = JSON.stringify(
			createTool?.inputSchema.properties ?? {},
		);

		expect(updateSchema).toContain("path");
		expect(updateSchema).toContain("classesByPath");
		expect(updateSchema).toContain("targetId");
		expect(createSchema).toContain("root");
		expect(createSchema).toContain("overrideTargets");
	});

	it("deletes a component from the manifest with revision metadata", async () => {
		const initial = await session.client.callTool({
			name: "component_read",
			arguments: { systemName: "Core" },
		});
		const created = await session.client.callTool({
			name: "component_draft_create",
			arguments: {
				systemName: "Core",
				expectedRevision: toolPayload(initial)?.revision,
				slug: "delete-me",
				name: "Delete Me",
			},
		});
		const componentId = String(toolPayload(created)?.componentId);

		const deleted = await session.client.callTool({
			name: "component_delete",
			arguments: {
				systemName: "Core",
				componentId,
				expectedRevision: toolPayload(created)?.revision,
			},
		});
		expect(deleted.isError).not.toBe(true);
		expect(toolPayload(deleted)).toMatchObject({
			status: "success",
			systemName: "Core",
			componentId,
			deleted: true,
		});
		expect(toolPayload(deleted)?.revision).not.toBe(
			toolPayload(created)?.revision,
		);

		const listed = await session.client.callTool({
			name: "component_read",
			arguments: { systemName: "Core" },
		});
		expect(toolPayload(listed)).toMatchObject({
			revision: toolPayload(deleted)?.revision,
			components: [],
		});

		const described = await session.client.callTool({
			name: "component_read",
			arguments: { systemName: "Core", componentId },
		});
		expect(described.isError).toBe(true);
		expect(toolPayload(described)).toMatchObject({
			code: "COMPONENT_NOT_FOUND",
		});
	});

	it("returns structured diagnostics for malformed draft updates", async () => {
		const initial = await session.client.callTool({
			name: "component_read",
			arguments: { systemName: "Core" },
		});
		const created = await session.client.callTool({
			name: "component_draft_create",
			arguments: {
				systemName: "Core",
				expectedRevision: toolPayload(initial)?.revision,
				slug: "malformed-test",
				name: "Malformed Test",
			},
		});
		const componentId = String(toolPayload(created)?.componentId);

		const malformed = await session.client.callTool({
			name: "component_draft_update",
			arguments: {
				systemName: "Core",
				componentId,
				expectedRevision: toolPayload(created)?.revision,
				root: {
					library: "trickroom",
					component: "container",
				},
				variants: {
					axes: {
						size: {
							label: "Size",
						},
					},
				},
			},
		});

		expect(malformed.isError).toBe(true);
		expect(toolPayload(malformed)).toMatchObject({
			status: "INVALID_OPERATION",
			code: "VALIDATION_FAILED",
			diagnostics: expect.arrayContaining([
				expect.objectContaining({
					code: "INVALID_SYSTEM_COMPONENT_DRAFT_INPUT",
					path: "root.path",
				}),
				expect.objectContaining({
					code: "INVALID_SYSTEM_COMPONENT_DRAFT_INPUT",
					path: "variants.axes.size.values",
				}),
			]),
		});
	});

	it("returns a compact system component draft authoring contract", async () => {
		const result = await session.client.callTool({
			name: "guide",
			arguments: { topic: "component-authoring", systemName: "Core" },
		});

		expect(result.isError).not.toBe(true);
		expect(toolPayload(result)["component-authoring"]).toMatchObject({
			system: { requested: "Core", configured: true },
			topics: expect.objectContaining({
				"component-variants": expect.any(String),
			}),
		});
		expect(JSON.stringify(toolPayload(result)).length).toBeLessThan(6_000);
	});

	it("picks component_read's view from componentId and checks migrate input", async () => {
		const index = toolPayload(
			await session.client.callTool({ name: "component_read", arguments: {} }),
		);
		expect(index).toMatchObject({ systemName: "Core", components: [] });

		const describeWithoutId = await session.client.callTool({
			name: "component_read",
			arguments: { view: "describe" },
		});
		expect(describeWithoutId.isError).toBe(true);
		expect(toolPayload(describeWithoutId)).toMatchObject({
			code: "INVALID_OPERATION_PARAMETERS",
		});

		const oneInstanceWithoutDesign = await session.client.callTool({
			name: "component_migrate",
			arguments: { rootElementId: "root" },
		});
		expect(oneInstanceWithoutDesign.isError).toBe(true);
		expect(toolPayload(oneInstanceWithoutDesign)).toMatchObject({
			code: "INVALID_OPERATION_PARAMETERS",
			message: expect.stringContaining("designFileId and expectedRevision"),
		});
	});
});
