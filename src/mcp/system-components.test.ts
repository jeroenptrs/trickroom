import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	createTrickroomMcpProjectFixture,
	createTrickroomMcpTestClient,
	type TrickroomMcpClientSession,
	type TrickroomMcpProjectFixture,
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
			name: "listSystemComponents",
			arguments: { systemName: "Core" },
		});
		expect(emptyList.structuredContent).toMatchObject({
			systemName: "Core",
			components: [],
			settings: { autoMigrateComponents: false },
		});
		const initialRevision = String(emptyList.structuredContent?.revision);

		const created = await session.client.callTool({
			name: "createSystemComponentDraft",
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
		const componentId = String(created.structuredContent?.componentId);
		// Writes acknowledge with ids, hashes, and a change summary.
		expect(created.structuredContent).toMatchObject({
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
		expect(created.structuredContent).not.toHaveProperty("record");
		expect(created.structuredContent?.revision).not.toBe(initialRevision);
		expect(created.structuredContent?.draftTemplateHash).toEqual(
			expect.stringMatching(/^sha256:/),
		);
		expect(created.structuredContent?.draftVariantSchemaHash).toEqual(
			expect.stringMatching(/^sha256:/),
		);

		const listed = await session.client.callTool({
			name: "listSystemComponents",
			arguments: { systemName: "Core" },
		});
		expect(listed.structuredContent).toMatchObject({
			revision: created.structuredContent?.revision,
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
			(listed.structuredContent as { components: object[] }).components[0],
		).not.toHaveProperty("name");

		const described = await session.client.callTool({
			name: "describeSystemComponent",
			arguments: { systemName: "Core", componentId },
		});
		expect(described.structuredContent).toMatchObject({
			revision: created.structuredContent?.revision,
			source: { kind: "draft" },
			interface: { variantAxes: [], slots: [], overrideTargets: [] },
			valid: true,
			diagnostics: [],
		});
		expect(described.structuredContent).not.toHaveProperty("root");
		expect(described.structuredContent).not.toHaveProperty("record");

		const updated = await session.client.callTool({
			name: "updateSystemComponentDraft",
			arguments: {
				systemName: "Core",
				componentId,
				expectedRevision: described.structuredContent?.revision,
				expectedDraftTemplateHash:
					described.structuredContent?.draftTemplateHash,
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
		expect(updated.structuredContent).toMatchObject({
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
			name: "describeSystemComponent",
			arguments: {
				systemName: "Core",
				componentId,
				source: "draft",
				include: ["template", "classes"],
			},
		});
		expect(draftDetail.structuredContent).toMatchObject({
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
		expect(updated.structuredContent?.draftTemplateHash).not.toBe(
			described.structuredContent?.draftTemplateHash,
		);

		const published = await session.client.callTool({
			name: "publishSystemComponent",
			arguments: {
				systemName: "Core",
				componentId,
				expectedRevision: updated.structuredContent?.revision,
			},
		});
		expect(published.structuredContent).toMatchObject({
			status: "success",
			componentId,
			publishedVersion: "1",
			published: {
				currentVersion: "1",
				templateHash: (
					updated.structuredContent as { draftTemplateHash: string }
				).draftTemplateHash,
			},
			changes: { toVersion: "1", nodeCount: 2, slots: ["content"] },
			valid: true,
			diagnostics: [],
		});
		expect(published.structuredContent).not.toHaveProperty("draftState");

		const record = await session.client.callTool({
			name: "describeSystemComponent",
			arguments: { systemName: "Core", componentId, versions: "all" },
		});
		expect(record.structuredContent).toMatchObject({
			source: { kind: "published", version: "1" },
			versionHistory: [{ version: "1" }],
			record: { published: { currentVersion: "1" } },
		});
	});

	it("filters the component index by query and group", async () => {
		const initial = await session.client.callTool({
			name: "listSystemComponents",
			arguments: { systemName: "Core" },
		});
		let revision = (initial.structuredContent as { revision: string }).revision;
		for (const [slug, group, description] of [
			["button", "actions", "Primary action trigger. Supports icons."],
			["link", "actions", undefined],
			["card", "layout", "A surface for grouped content."],
		] as const) {
			const created = await session.client.callTool({
				name: "createSystemComponentDraft",
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
			revision = (created.structuredContent as { revision: string }).revision;
		}

		const actions = await session.client.callTool({
			name: "listSystemComponents",
			arguments: { systemName: "Core", group: "Actions" },
		});
		expect(actions.structuredContent).toMatchObject({
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
			name: "listSystemComponents",
			arguments: { systemName: "Core", query: "SURFACE" },
		});
		expect(surface.structuredContent).toMatchObject({
			matchedCount: 1,
			components: [{ slug: "card" }],
		});
	});

	it("rejects concurrent createSystemComponentDraft calls with the same expected revision", async () => {
		const initial = await session.client.callTool({
			name: "listSystemComponents",
			arguments: { systemName: "Core" },
		});
		const expectedRevision = String(initial.structuredContent?.revision);

		const [firstResult, secondResult] = await Promise.all([
			session.client.callTool({
				name: "createSystemComponentDraft",
				arguments: {
					systemName: "Core",
					expectedRevision,
					slug: "concurrent-a",
					name: "Concurrent A",
				},
			}),
			session.client.callTool({
				name: "createSystemComponentDraft",
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
				outcome.structuredContent?.code === "STALE_WRITE",
		);

		expect(successes).toHaveLength(1);
		expect(staleFailures).toHaveLength(1);
		expect(successes[0]?.structuredContent).toMatchObject({
			status: "success",
			valid: true,
		});

		const listed = await session.client.callTool({
			name: "listSystemComponents",
			arguments: { systemName: "Core" },
		});
		expect(listed.structuredContent?.components).toHaveLength(1);
		expect(
			["concurrent-a", "concurrent-b"].includes(
				String(listed.structuredContent?.components?.[0]?.slug),
			),
		).toBe(true);

		const winnerId = String(successes[0]?.structuredContent?.componentId);
		const described = await session.client.callTool({
			name: "describeSystemComponent",
			arguments: { systemName: "Core", componentId: winnerId },
		});
		expect(described.isError).not.toBe(true);
		expect(described.structuredContent).toMatchObject({
			valid: true,
			componentId: winnerId,
		});
	});

	it("fails stale manifest and draft-hash writes clearly", async () => {
		const initial = await session.client.callTool({
			name: "listSystemComponents",
			arguments: { systemName: "Core" },
		});
		const created = await session.client.callTool({
			name: "createSystemComponentDraft",
			arguments: {
				systemName: "Core",
				expectedRevision: initial.structuredContent?.revision,
				slug: "stale-test",
				name: "Stale Test",
			},
		});
		const componentId = String(created.structuredContent?.componentId);

		const staleCreate = await session.client.callTool({
			name: "createSystemComponentDraft",
			arguments: {
				systemName: "Core",
				expectedRevision: initial.structuredContent?.revision,
				slug: "second",
				name: "Second",
			},
		});
		expect(staleCreate.isError).toBe(true);
		expect(staleCreate.structuredContent).toMatchObject({
			status: "INVALID_OPERATION",
			code: "STALE_WRITE",
		});

		const staleHash = await session.client.callTool({
			name: "updateSystemComponentDraft",
			arguments: {
				systemName: "Core",
				componentId,
				expectedRevision: created.structuredContent?.revision,
				expectedDraftTemplateHash: "sha256:not-current",
				root: textRoot(),
			},
		});
		expect(staleHash.isError).toBe(true);
		expect(staleHash.structuredContent).toMatchObject({
			status: "INVALID_OPERATION",
			code: "DRAFT_HASH_MISMATCH",
		});
	});

	it("publishes draft authoring shape information in MCP tool schemas", async () => {
		const tools = await session.client.listTools();
		const updateTool = tools.tools.find(
			(tool) => tool.name === "updateSystemComponentDraft",
		);
		const createTool = tools.tools.find(
			(tool) => tool.name === "createSystemComponentDraft",
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
			name: "listSystemComponents",
			arguments: { systemName: "Core" },
		});
		const created = await session.client.callTool({
			name: "createSystemComponentDraft",
			arguments: {
				systemName: "Core",
				expectedRevision: initial.structuredContent?.revision,
				slug: "delete-me",
				name: "Delete Me",
			},
		});
		const componentId = String(created.structuredContent?.componentId);

		const deleted = await session.client.callTool({
			name: "deleteSystemComponent",
			arguments: {
				systemName: "Core",
				componentId,
				expectedRevision: created.structuredContent?.revision,
			},
		});
		expect(deleted.isError).not.toBe(true);
		expect(deleted.structuredContent).toMatchObject({
			status: "success",
			systemName: "Core",
			componentId,
			deleted: true,
		});
		expect(deleted.structuredContent?.revision).not.toBe(
			created.structuredContent?.revision,
		);

		const listed = await session.client.callTool({
			name: "listSystemComponents",
			arguments: { systemName: "Core" },
		});
		expect(listed.structuredContent).toMatchObject({
			revision: deleted.structuredContent?.revision,
			components: [],
		});

		const described = await session.client.callTool({
			name: "describeSystemComponent",
			arguments: { systemName: "Core", componentId },
		});
		expect(described.isError).toBe(true);
		expect(described.structuredContent).toMatchObject({
			code: "COMPONENT_NOT_FOUND",
		});
	});

	it("returns structured diagnostics for malformed draft updates", async () => {
		const initial = await session.client.callTool({
			name: "listSystemComponents",
			arguments: { systemName: "Core" },
		});
		const created = await session.client.callTool({
			name: "createSystemComponentDraft",
			arguments: {
				systemName: "Core",
				expectedRevision: initial.structuredContent?.revision,
				slug: "malformed-test",
				name: "Malformed Test",
			},
		});
		const componentId = String(created.structuredContent?.componentId);

		const malformed = await session.client.callTool({
			name: "updateSystemComponentDraft",
			arguments: {
				systemName: "Core",
				componentId,
				expectedRevision: created.structuredContent?.revision,
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
		expect(malformed.structuredContent).toMatchObject({
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
			name: "getSystemComponentAuthoringContract",
			arguments: { systemName: "Core" },
		});

		expect(result.isError).not.toBe(true);
		expect(result.structuredContent).toMatchObject({
			contract: "system-component-authoring",
			system: { requested: "Core", configured: true },
			topics: expect.objectContaining({ variants: expect.any(String) }),
		});
		expect(JSON.stringify(result.structuredContent).length).toBeLessThan(6_000);
	});
});
