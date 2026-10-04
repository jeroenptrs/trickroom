import { writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Node } from "../types";
import {
	getSystemComponentMarkerProps,
	getSystemComponentStructuralMetadata,
	SYSTEM_COMPONENT_MARKER_PROP_KEYS,
	systemComponentIdProp,
	systemComponentInstanceProp,
	systemComponentRootProp,
} from "../utils/system-component-markers";
import {
	applyOperation,
	createTrickroomMcpProjectFixture,
	createTrickroomMcpTestClient,
	type TrickroomMcpClientSession,
	type TrickroomMcpProjectFixture,
	toolPayload,
	trickroomMcpTestDesignUuid,
} from "./test-support";

const textRoot = () => ({
	path: "root",
	library: "trickroom",
	component: "text",
	text: "Primary",
});

const secondDesignUuid = "00000000-0000-4000-8000-000000000002";
const unlinkedDesignUuid = "00000000-0000-4000-8000-000000000003";

const expectNoSystemComponentMarkers = (node: Node) => {
	for (const markerProp of SYSTEM_COMPONENT_MARKER_PROP_KEYS) {
		expect(node.props).not.toHaveProperty(markerProp);
	}
	if (Array.isArray(node.children)) {
		for (const child of node.children) {
			expectNoSystemComponentMarkers(child);
		}
	}
};

describe("trickroom MCP system component instance tools", () => {
	let fixture: TrickroomMcpProjectFixture;
	let session: TrickroomMcpClientSession;
	let systemId: string;
	let componentId: string;

	const publishBadgeComponent = async (
		targetSession: TrickroomMcpClientSession = session,
	) => {
		const listed = await targetSession.client.callTool({
			name: "component_read",
			arguments: { systemName: "Core" },
		});
		systemId = String(toolPayload(listed)?.systemId);

		const created = await targetSession.client.callTool({
			name: "component_draft_create",
			arguments: {
				systemName: "Core",
				expectedRevision: toolPayload(listed)?.revision,
				slug: "badge",
				name: "Badge",
				draft: { root: textRoot() },
			},
		});
		componentId = String(toolPayload(created)?.componentId);

		const updated = await targetSession.client.callTool({
			name: "component_draft_update",
			arguments: {
				systemName: "Core",
				componentId,
				expectedRevision: toolPayload(created)?.revision,
				root: {
					path: "root",
					library: "trickroom",
					component: "container",
					className: "card",
					children: [
						{
							path: "label",
							library: "trickroom",
							component: "text",
							text: "Badge",
							className: "label",
						},
					],
				},
				variants: {
					axes: {
						tone: {
							label: "Tone",
							defaultValue: "neutral",
							values: {
								brand: {
									classesByPath: { root: "brand", label: "label-brand" },
								},
								neutral: { classesByPath: { root: "neutral" } },
							},
						},
					},
				},
				overrideTargets: {
					rootTarget: { targetId: "rootTarget", label: "Root", path: "root" },
				},
			},
		});

		await targetSession.client.callTool({
			name: "component_publish",
			arguments: {
				systemName: "Core",
				componentId,
				expectedRevision: toolPayload(updated)?.revision,
			},
		});
	};

	const getDesignRevision = async (
		targetSession: TrickroomMcpClientSession = session,
		designFileId = trickroomMcpTestDesignUuid,
	) => {
		const read = await targetSession.client.callTool({
			name: "design_read",
			arguments: { designFileId },
		});
		return String(
			(toolPayload(read) as { designFile: { revision: string } }).designFile
				.revision,
		);
	};

	const addBadgeInstance = async (
		designFileId = trickroomMcpTestDesignUuid,
		targetSession: TrickroomMcpClientSession = session,
	) => {
		const revision = await getDesignRevision(targetSession, designFileId);
		return applyOperation(targetSession.client, "addSystemComponent", {
			designFileId,
			expectedRevision: revision,
			parentId: "board",
			index: 0,
			systemId,
			componentId,
		});
	};

	const publishBadgeVersion = async (
		text: string,
		targetSession: TrickroomMcpClientSession = session,
	) => {
		const listed = await targetSession.client.callTool({
			name: "component_read",
			arguments: { systemName: "Core" },
		});
		const updated = await targetSession.client.callTool({
			name: "component_draft_update",
			arguments: {
				systemName: "Core",
				componentId,
				expectedRevision: toolPayload(listed)?.revision,
				root: {
					path: "root",
					library: "trickroom",
					component: "container",
					className: "card",
					children: [
						{
							path: "label",
							library: "trickroom",
							component: "text",
							text,
							className: "label",
						},
					],
				},
			},
		});

		return targetSession.client.callTool({
			name: "component_publish",
			arguments: {
				systemName: "Core",
				componentId,
				expectedRevision: toolPayload(updated)?.revision,
			},
		});
	};

	const publishOptionalToneComponent = async () => {
		const listed = await session.client.callTool({
			name: "component_read",
			arguments: { systemName: "Core" },
		});
		const created = await session.client.callTool({
			name: "component_draft_create",
			arguments: {
				systemName: "Core",
				expectedRevision: toolPayload(listed)?.revision,
				slug: "optional-badge",
				name: "Optional Badge",
				draft: {
					root: {
						path: "root",
						library: "trickroom",
						component: "container",
						className: "card",
					},
					variants: {
						axes: {
							tone: {
								label: "Tone",
								values: {
									brand: { classesByPath: { root: "brand" } },
									neutral: { classesByPath: { root: "neutral" } },
								},
							},
						},
					},
				},
			},
		});
		const optionalComponentId = String(toolPayload(created)?.componentId);
		await session.client.callTool({
			name: "component_publish",
			arguments: {
				systemName: "Core",
				componentId: optionalComponentId,
				expectedRevision: toolPayload(created)?.revision,
			},
		});
		return optionalComponentId;
	};

	beforeEach(async () => {
		fixture = await createTrickroomMcpProjectFixture();
		session = await createTrickroomMcpTestClient(
			await fixture.readMcpContext(),
		);
		await publishBadgeComponent();
	});

	afterEach(async () => {
		await session.close();
		await fixture.cleanup();
	});

	it("suggests the component id when addSystemComponent gets a component name", async () => {
		const result = await applyOperation(session.client, "addSystemComponent", {
			designFileId: trickroomMcpTestDesignUuid,
			expectedRevision: await getDesignRevision(),
			parentId: "board",
			index: 0,
			systemId,
			componentId: "Badge",
		});
		expect(result.isError).toBe(true);
		expect(toolPayload(result)).toMatchObject({
			code: "UNKNOWN_SYSTEM_COMPONENT",
			suggestions: [componentId],
			availableComponents: [{ componentId, name: "Badge" }],
			message: expect.stringContaining("Pass the componentId"),
		});
	});

	it("describes the interface by default and the record only on request", async () => {
		await publishBadgeVersion("Second");

		const current = await session.client.callTool({
			name: "component_read",
			arguments: { systemName: "Core", componentId },
		});
		expect(toolPayload(current)).toMatchObject({
			source: { kind: "published", version: "2" },
			interface: {
				variantAxes: [
					{ axis: "tone", values: expect.arrayContaining(["brand"]) },
				],
			},
			versionHistory: [{ version: "1" }, { version: "2" }],
		});
		expect(toolPayload(current)).not.toHaveProperty("record");

		const record = await session.client.callTool({
			name: "component_read",
			arguments: { systemName: "Core", componentId, include: ["record"] },
		});
		const recordContent = toolPayload(record) as {
			record: {
				published: {
					currentVersion: string;
					versions: Record<string, unknown>;
				};
			};
		};
		expect(Object.keys(recordContent.record.published.versions)).toEqual([
			recordContent.record.published.currentVersion,
		]);

		const all = await session.client.callTool({
			name: "component_read",
			arguments: { systemName: "Core", componentId, versions: "all" },
		});
		const allContent = toolPayload(all) as {
			record: { published: { versions: Record<string, unknown> } };
		};
		expect(Object.keys(allContent.record.published.versions)).toHaveLength(2);
	});

	it("adds, updates, and detaches a published system component instance", async () => {
		const revision = await getDesignRevision();

		const added = await applyOperation(session.client, "addSystemComponent", {
			designFileId: trickroomMcpTestDesignUuid,
			expectedRevision: revision,
			parentId: "board",
			index: 1,
			systemId,
			componentId,
			variantValues: { tone: "brand" },
			overrides: { rootTarget: { className: "rounded-md" } },
			response: "full",
		});
		expect(added.isError).not.toBe(true);
		const [addStep] = toolPayload(added).steps;
		const rootElementId = String(addStep.changedElementId);
		expect(toolPayload(added).status).toBe("success");
		expect(addStep.summary).toMatchObject({
			systemComponent: {
				systemId,
				componentId,
				version: "1",
				variantValues: { tone: "brand" },
				overrides: { rootTarget: { className: "rounded-md" } },
			},
		});

		const afterAddRevision = String(toolPayload(added)?.newRevision);
		const updated = await applyOperation(
			session.client,
			"updateSystemComponentInstance",
			{
				designFileId: trickroomMcpTestDesignUuid,
				expectedRevision: afterAddRevision,
				rootElementId,
				variantValues: { tone: "neutral" },
				overrides: { rootTarget: { className: "shadow-sm" } },
				response: "full",
			},
		);
		expect(updated.isError).not.toBe(true);
		expect(toolPayload(updated)).toMatchObject({
			status: "success",
			steps: [
				{
					summary: {
						rootElementId,
						variantValues: { tone: "neutral" },
						overrides: { rootTarget: { className: "shadow-sm" } },
					},
				},
			],
		});

		const afterUpdateRevision = String(toolPayload(updated)?.newRevision);
		const detached = await applyOperation(
			session.client,
			"detachSystemComponent",
			{
				designFileId: trickroomMcpTestDesignUuid,
				expectedRevision: afterUpdateRevision,
				elementId: rootElementId,
				response: "full",
			},
		);
		expect(detached.isError).not.toBe(true);
		expect(toolPayload(detached)).toMatchObject({
			status: "success",
			steps: [
				{
					summary: {
						systemComponent: { systemId, componentId },
						detachedElementIds: expect.arrayContaining([rootElementId]),
					},
				},
			],
		});

		const persisted = await fixture.designFileService.readDesignFile(
			fixture.designFileService.getFileForUuid(trickroomMcpTestDesignUuid),
		);
		const board = persisted.design.boards[0];
		const detachedRoot = Array.isArray(board.children)
			? board.children.find((child) => child.id === rootElementId)
			: null;
		expect(detachedRoot?.props[systemComponentRootProp]).toBeUndefined();
		expect(detachedRoot?.props[systemComponentInstanceProp]).toBeUndefined();
	});

	it("clears optional variant axes through updateSystemComponentInstance", async () => {
		const optionalComponentId = await publishOptionalToneComponent();
		const revision = await getDesignRevision();
		const added = await applyOperation(session.client, "addSystemComponent", {
			designFileId: trickroomMcpTestDesignUuid,
			expectedRevision: revision,
			parentId: "board",
			index: 0,
			systemId,
			componentId: optionalComponentId,
			variantValues: { tone: "brand" },
		});
		expect(added.isError).not.toBe(true);
		const rootElementId = String(toolPayload(added).created[0].id);

		const updated = await applyOperation(
			session.client,
			"updateSystemComponentInstance",
			{
				designFileId: trickroomMcpTestDesignUuid,
				expectedRevision: String(toolPayload(added)?.newRevision),
				rootElementId,
				unsetVariantAxes: ["tone"],
				response: "full",
			},
		);
		expect(updated.isError).not.toBe(true);
		expect(toolPayload(updated)).toMatchObject({
			status: "success",
			steps: [{ summary: { variantValues: {} } }],
		});

		const persisted = await fixture.designFileService.readDesignFile(
			fixture.designFileService.getFileForUuid(trickroomMcpTestDesignUuid),
		);
		const board = persisted.design.boards[0];
		const updatedRoot = Array.isArray(board.children)
			? board.children.find((child) => child.id === rootElementId)
			: null;
		expect(updatedRoot?.props.className).toBe("card");
		expect(
			getSystemComponentStructuralMetadata(updatedRoot?.props ?? {})
				?.variantValues,
		).toEqual({});
	});

	it("reports no stale system component usages when attached instances are current", async () => {
		await addBadgeInstance();

		const result = await session.client.callTool({
			name: "component_read",
			arguments: { view: "stale", systemName: "Core" },
		});

		expect(result.isError).not.toBe(true);
		expect(toolPayload(result)).toMatchObject({
			systemId,
			systemName: "Core",
			staleCount: 0,
			statusCounts: expect.objectContaining({ current: 1, stale: 0 }),
			usages: [],
		});
	});

	it("extracts complete attached roots with fresh instance ids and strips partial component markers", async () => {
		const added = await addBadgeInstance();
		const rootElementId = String(toolPayload(added).created[0].id);

		const persistedSource = await fixture.designFileService.readDesignFile(
			fixture.designFileService.getFileForUuid(trickroomMcpTestDesignUuid),
		);
		const sourceRoot = (
			persistedSource.design.boards[0].children as Array<{
				id: string;
				props: Record<string, unknown>;
				children?: Array<{ id: string; props: Record<string, unknown> }>;
			}>
		).find((child) => child.id === rootElementId);
		const sourceInstanceId = String(
			sourceRoot?.props[systemComponentInstanceProp],
		);
		const sourceLabelId = sourceRoot?.children?.[0]?.id;
		expect(sourceLabelId).toBeDefined();

		const rootTargetId = "10000000-0000-4000-8000-000000000201";
		const extractedRoot = await session.client.callTool({
			name: "design_create",
			arguments: {
				designFileId: rootTargetId,
				from: {
					designFileId: trickroomMcpTestDesignUuid,
					elementId: rootElementId,
				},
			},
		});
		expect(extractedRoot.isError).not.toBe(true);
		const extractedBoardId = toolPayload(extractedRoot).boards[0].id;
		const extractedRootDesign = await fixture.designFileService.readDesignFile(
			fixture.designFileService.getFileForUuid(rootTargetId),
		);
		const clonedRoot = extractedRootDesign.design.boards[0];
		expect(clonedRoot.props[systemComponentIdProp]).toBe(componentId);
		expect(clonedRoot.props[systemComponentRootProp]).toBe("true");
		expect(clonedRoot.props[systemComponentInstanceProp]).not.toBe(
			sourceInstanceId,
		);
		expect(
			(clonedRoot.children as Array<{ props: Record<string, unknown> }>)[0]
				.props[systemComponentInstanceProp],
		).toBe(clonedRoot.props[systemComponentInstanceProp]);
		expect(extractedBoardId).toBe(clonedRoot.id);
		expect(clonedRoot.id).not.toBe(rootElementId);

		const partialTargetId = "10000000-0000-4000-8000-000000000202";
		const extractedPartial = await session.client.callTool({
			name: "design_create",
			arguments: {
				designFileId: partialTargetId,
				from: {
					designFileId: trickroomMcpTestDesignUuid,
					elementId: sourceLabelId,
				},
			},
		});
		expect(extractedPartial.isError).not.toBe(true);
		const partialDesign = await fixture.designFileService.readDesignFile(
			fixture.designFileService.getFileForUuid(partialTargetId),
		);
		expectNoSystemComponentMarkers(partialDesign.design.boards[0]);
	});

	it("rejects copySubtree when preserving a complete attached root into an unlinked target design", async () => {
		const added = await addBadgeInstance();
		const rootElementId = String(toolPayload(added).created[0].id);

		await fixture.writeDesign(unlinkedDesignUuid, {
			name: "Unlinked Design",
			boards: [
				{
					id: "board",
					props: {
						"data-trickroom-name": "Board",
						"data-trickroom-library": "trickroom",
						"data-trickroom-component": "container",
					},
					children: [],
				},
			],
		});

		const sourceRevision = await getDesignRevision();
		const targetRevision = await getDesignRevision(session, unlinkedDesignUuid);
		const result = await applyOperation(session.client, "copySubtree", {
			sourceDesignFileId: trickroomMcpTestDesignUuid,
			sourceElementId: rootElementId,
			sourceExpectedRevision: sourceRevision,
			designFileId: unlinkedDesignUuid,
			expectedRevision: targetRevision,
			parentId: "board",
			index: 0,
		});

		expect(result.isError).toBe(true);
		expect(toolPayload(result)).toMatchObject({
			status: "INVALID_OPERATION",
			code: "DESIGN_NOT_LINKED_TO_SYSTEM",
		});
	});

	it("rejects extractSubtree when preserving a complete attached root into an unlinked design", async () => {
		const added = await addBadgeInstance();
		const rootElementId = String(toolPayload(added).created[0].id);
		const targetDesignId = "10000000-0000-4000-8000-000000000203";

		const result = await session.client.callTool({
			name: "design_create",
			arguments: {
				designFileId: targetDesignId,
				systemName: null,
				from: {
					designFileId: trickroomMcpTestDesignUuid,
					elementId: rootElementId,
				},
			},
		});

		expect(result.isError).toBe(true);
		expect(toolPayload(result)).toMatchObject({
			status: "INVALID_OPERATION",
			code: "DESIGN_NOT_LINKED_TO_SYSTEM",
		});
	});

	it("rejects addSystemComponent when the design is not linked to the target system", async () => {
		await fixture.writeDesign(unlinkedDesignUuid, {
			name: "Unlinked Design",
			boards: [
				{
					id: "board",
					props: {
						"data-trickroom-name": "Board",
						"data-trickroom-library": "trickroom",
						"data-trickroom-component": "container",
					},
					children: [],
				},
			],
		});

		const revision = await getDesignRevision(session, unlinkedDesignUuid);
		const result = await applyOperation(session.client, "addSystemComponent", {
			designFileId: unlinkedDesignUuid,
			expectedRevision: revision,
			parentId: "board",
			index: 0,
			systemId,
			componentId,
		});

		expect(result.isError).toBe(true);
		expect(toolPayload(result)).toMatchObject({
			status: "INVALID_OPERATION",
			code: "DESIGN_NOT_LINKED_TO_SYSTEM",
		});
	});

	it("reports stale system component usages without writing designs", async () => {
		const added = await addBadgeInstance();
		const revisionAfterAdd = String(toolPayload(added)?.newRevision);
		await publishBadgeVersion("Badge v2");

		const result = await session.client.callTool({
			name: "component_read",
			arguments: { view: "stale", systemName: "Core", componentId },
		});

		expect(result.isError).not.toBe(true);
		expect(toolPayload(result)).toMatchObject({
			systemId,
			componentId,
			staleCount: 1,
			statusCounts: expect.objectContaining({ stale: 1 }),
			components: [
				{
					componentId,
					currentVersion: "2",
					staleCount: 1,
					fromVersions: { "1": 1 },
					designCount: 1,
				},
			],
			designs: [{ designFileId: trickroomMcpTestDesignUuid, staleCount: 1 }],
			usages: [
				{
					designFileId: trickroomMcpTestDesignUuid,
					nodeId: expect.any(String),
					componentId,
					instanceId: expect.any(String),
					attachedVersion: "1",
					currentVersion: "2",
				},
			],
		});
		// STALE_VERSION diagnostics restate the usage rows and are dropped.
		expect(toolPayload(result)).not.toHaveProperty("diagnostics");

		const persisted = await fixture.designFileService.readDesignFile(
			fixture.designFileService.getFileForUuid(trickroomMcpTestDesignUuid),
		);
		expect(persisted.revision).toBe(revisionAfterAdd);
	});

	it("ignores malformed disallowed design files during allowlisted stale scans", async () => {
		const malformedDesignUuid = "00000000-0000-4000-8000-000000000099";
		await writeFile(
			path.join(
				fixture.projectRoot,
				".trickroom",
				"designs",
				`${malformedDesignUuid}.json`,
			),
			"{ not-a-valid-design-payload",
			"utf8",
		);
		await addBadgeInstance(trickroomMcpTestDesignUuid);
		await publishBadgeVersion("Badge v2");
		await session.close();
		await fixture.writeConfig({
			...fixture.config,
			mcp: {
				...fixture.config.mcp,
				enabled: true,
				allowedDesignFileIds: [trickroomMcpTestDesignUuid],
			},
		});
		session = await createTrickroomMcpTestClient(
			await fixture.readMcpContext(),
		);

		const result = await session.client.callTool({
			name: "component_read",
			arguments: { view: "stale", systemName: "Core" },
		});

		expect(result.isError).not.toBe(true);
		expect(toolPayload(result)).toMatchObject({
			staleCount: 1,
			scannedDesignCount: 1,
			usages: [
				expect.objectContaining({
					designFileId: trickroomMcpTestDesignUuid,
				}),
			],
		});
		expect(
			(
				toolPayload(result) as {
					diagnostics?: Array<{ designFileId?: string }>;
				}
			).diagnostics ?? [],
		).not.toEqual(
			expect.arrayContaining([
				expect.objectContaining({ designFileId: malformedDesignUuid }),
			]),
		);
	});

	it("respects allowedDesignFileIds when scanning stale system component usages", async () => {
		await fixture.writeDesign(secondDesignUuid, {
			name: "Second Harness Design",
			systemName: "Core",
			boards: [
				{
					id: "board",
					props: {
						"data-trickroom-name": "Board",
						"data-trickroom-library": "trickroom",
						"data-trickroom-component": "container",
					},
					children: [],
				},
			],
		});
		await addBadgeInstance(trickroomMcpTestDesignUuid);
		await addBadgeInstance(secondDesignUuid);
		await publishBadgeVersion("Badge v2");
		await session.close();
		await fixture.writeConfig({
			...fixture.config,
			mcp: {
				...fixture.config.mcp,
				enabled: true,
				allowedDesignFileIds: [trickroomMcpTestDesignUuid],
			},
		});
		session = await createTrickroomMcpTestClient(
			await fixture.readMcpContext(),
		);

		const result = await session.client.callTool({
			name: "component_read",
			arguments: { view: "stale", systemName: "Core" },
		});

		expect(result.isError).not.toBe(true);
		expect(toolPayload(result)).toMatchObject({
			staleCount: 1,
			scannedDesignCount: 1,
			usages: [
				expect.objectContaining({
					designFileId: trickroomMcpTestDesignUuid,
				}),
			],
		});
		expect(
			(toolPayload(result) as { usages: Array<{ designFileId: string }> })
				.usages,
		).not.toEqual(
			expect.arrayContaining([
				expect.objectContaining({ designFileId: secondDesignUuid }),
			]),
		);
	});

	it("preserves system metadata for empty allowedDesignFileIds stale usage scans", async () => {
		await addBadgeInstance();
		await publishBadgeVersion("Badge v2");
		await session.close();
		await fixture.writeConfig({
			...fixture.config,
			mcp: {
				...fixture.config.mcp,
				enabled: true,
				mode: "read-only",
				allowedDesignFileIds: [],
			},
		});
		session = await createTrickroomMcpTestClient(
			await fixture.readMcpContext(),
		);

		const result = await session.client.callTool({
			name: "component_read",
			arguments: { view: "stale", systemName: "Core" },
		});

		expect(result.isError).not.toBe(true);
		expect(toolPayload(result)).toMatchObject({
			systemId,
			systemName: "Core",
			staleCount: 0,
			scannedDesignCount: 0,
			statusCounts: expect.objectContaining({
				current: 0,
				stale: 0,
			}),
			components: [],
			designs: [],
			usages: [],
		});
	});

	it("rejects stale usage scans for disallowed designFileId filters", async () => {
		await session.close();
		await fixture.writeConfig({
			...fixture.config,
			mcp: {
				...fixture.config.mcp,
				enabled: true,
				allowedDesignFileIds: [trickroomMcpTestDesignUuid],
			},
		});
		session = await createTrickroomMcpTestClient(
			await fixture.readMcpContext(),
		);

		const result = await session.client.callTool({
			name: "component_read",
			arguments: {
				view: "stale",
				systemName: "Core",
				designFileId: secondDesignUuid,
			},
		});

		expect(result.isError).toBe(true);
		expect(toolPayload(result)).toMatchObject({
			status: "POLICY_DENIED",
			code: "MCP_DESIGN_FILE_NOT_ALLOWED",
		});
	});

	it("rejects stale design revisions and unsafe marker prop edits", async () => {
		const revision = await getDesignRevision();
		const added = await applyOperation(session.client, "addSystemComponent", {
			designFileId: trickroomMcpTestDesignUuid,
			expectedRevision: revision,
			parentId: "board",
			index: 0,
			systemId,
			componentId,
		});
		const rootElementId = String(toolPayload(added).created[0].id);

		const stale = await applyOperation(
			session.client,
			"updateSystemComponentInstance",
			{
				designFileId: trickroomMcpTestDesignUuid,
				expectedRevision: revision,
				rootElementId,
				variantValues: { tone: "brand" },
			},
		);
		expect(stale.isError).toBe(true);
		expect(toolPayload(stale)).toMatchObject({
			status: "REVISION_MISMATCH",
		});

		const markerEdit = await applyOperation(
			session.client,
			"updateElementProps",
			{
				designFileId: trickroomMcpTestDesignUuid,
				expectedRevision: String(toolPayload(added)?.newRevision),
				elementId: rootElementId,
				props: getSystemComponentMarkerProps({
					systemId,
					componentId,
					instanceId: "manual-instance",
					version: "1",
					path: "root",
					isRoot: true,
				}) as Record<string, string>,
			},
		);
		expect(markerEdit.isError).toBe(true);
		expect(toolPayload(markerEdit)).toMatchObject({
			status: "INVALID_OPERATION",
			code: "INVALID_PROP_KEY",
		});

		const structuralEdit = await applyOperation(
			session.client,
			"updateElementProps",
			{
				designFileId: trickroomMcpTestDesignUuid,
				expectedRevision: String(toolPayload(added)?.newRevision),
				elementId: rootElementId,
				className: "manual-class",
			},
		);
		expect(structuralEdit.isError).toBe(true);
		expect(toolPayload(structuralEdit)).toMatchObject({
			status: "INVALID_OPERATION",
			code: "COMPONENT_STRUCTURAL_NODE_LOCKED",
		});
	});

	it("denies addSystemComponent when expanded registry components are not allowed", async () => {
		const restrictedFixture = await createTrickroomMcpProjectFixture({
			config: {
				mcp: {
					enabled: true,
					allowedComponents: ["trickroom/container"],
				},
			},
		});
		const restrictedSession = await createTrickroomMcpTestClient(
			await restrictedFixture.readMcpContext(),
		);
		try {
			await publishBadgeComponent(restrictedSession);
			const revision = await getDesignRevision(restrictedSession);
			const result = await applyOperation(
				restrictedSession.client,
				"addSystemComponent",
				{
					designFileId: trickroomMcpTestDesignUuid,
					expectedRevision: revision,
					parentId: "board",
					index: 0,
					systemId,
					componentId,
				},
			);
			expect(result.isError).toBe(true);
			expect(toolPayload(result)).toMatchObject({
				status: "POLICY_DENIED",
				code: "MCP_COMPONENT_NOT_ALLOWED",
			});
		} finally {
			await restrictedSession.close();
			await restrictedFixture.cleanup();
		}
	});

	it("returns INVALID_SYSTEM_COMPONENT_INSTANCE_STATE for invalid variant updates", async () => {
		const revision = await getDesignRevision();
		const added = await applyOperation(session.client, "addSystemComponent", {
			designFileId: trickroomMcpTestDesignUuid,
			expectedRevision: revision,
			parentId: "board",
			index: 0,
			systemId,
			componentId,
		});
		const rootElementId = String(toolPayload(added).created[0].id);

		const invalidUpdate = await applyOperation(
			session.client,
			"updateSystemComponentInstance",
			{
				designFileId: trickroomMcpTestDesignUuid,
				expectedRevision: String(toolPayload(added)?.newRevision),
				rootElementId,
				variantValues: { tone: "missing" },
			},
		);
		expect(invalidUpdate.isError).toBe(true);
		expect(toolPayload(invalidUpdate)).toMatchObject({
			status: "INVALID_OPERATION",
			code: "INVALID_SYSTEM_COMPONENT_INSTANCE_STATE",
		});
	});

	it("includes system/component identity in update responses", async () => {
		const revision = await getDesignRevision();
		const added = await applyOperation(session.client, "addSystemComponent", {
			designFileId: trickroomMcpTestDesignUuid,
			expectedRevision: revision,
			parentId: "board",
			index: 0,
			systemId,
			componentId,
		});
		const rootElementId = String(toolPayload(added).created[0].id);

		const updated = await applyOperation(
			session.client,
			"updateSystemComponentInstance",
			{
				designFileId: trickroomMcpTestDesignUuid,
				expectedRevision: String(toolPayload(added)?.newRevision),
				rootElementId,
				variantValues: { tone: "brand" },
				response: "full",
			},
		);
		expect(updated.isError).not.toBe(true);
		expect(toolPayload(updated)).toMatchObject({
			status: "success",
			steps: [
				{
					summary: { systemComponent: { systemId, componentId, version: "1" } },
				},
			],
		});
	});

	it("chains addSystemComponent and updateSystemComponentInstance in operation plans", async () => {
		const revision = await getDesignRevision();
		const result = await session.client.callTool({
			name: "design_validate",
			arguments: {
				designFileId: trickroomMcpTestDesignUuid,
				expectedRevision: revision,
				operations: [
					{
						operation: "addSystemComponent",
						parameters: {
							parentId: "board",
							index: 0,
							systemId,
							componentId,
							variantValues: { tone: "brand" },
						},
					},
					{
						operation: "updateSystemComponentInstance",
						parameters: {
							rootElementId: "$step:0:rootElementId",
							variantValues: { tone: "neutral" },
						},
					},
				],
				response: "full",
			},
		});
		expect(result.isError).not.toBe(true);
		expect(toolPayload(result)).toMatchObject({
			status: "success",
			valid: true,
			steps: [
				expect.objectContaining({ operation: "addSystemComponent" }),
				expect.objectContaining({
					operation: "updateSystemComponentInstance",
					summary: expect.objectContaining({
						variantValues: { tone: "neutral" },
					}),
				}),
			],
		});
	});

	it("dry-runs addSystemComponent through design_validate without writing", async () => {
		const revision = await getDesignRevision();
		const result = await session.client.callTool({
			name: "design_validate",
			arguments: {
				designFileId: trickroomMcpTestDesignUuid,
				expectedRevision: revision,
				operations: [
					{
						operation: "addSystemComponent",
						parameters: {
							parentId: "board",
							index: 0,
							systemId,
							componentId,
							variantValues: { tone: "brand" },
						},
					},
				],
			},
		});
		expect(result.isError).not.toBe(true);
		expect(toolPayload(result)).toMatchObject({
			status: "success",
			valid: true,
			predicted: [
				{
					parentId: "board",
					index: 0,
					systemComponent: {
						systemId,
						componentId,
						version: "1",
						variantValues: { tone: "brand" },
					},
					nodeCount: expect.any(Number),
				},
			],
		});

		const persisted = await fixture.designFileService.readDesignFile(
			fixture.designFileService.getFileForUuid(trickroomMcpTestDesignUuid),
		);
		expect(persisted.revision).toBe(revision);
	});

	it("denies addSystemComponent through design_validate when expanded components are policy-blocked", async () => {
		const restrictedFixture = await createTrickroomMcpProjectFixture({
			config: {
				mcp: {
					enabled: true,
					allowedComponents: ["trickroom/container"],
				},
			},
		});
		const restrictedSession = await createTrickroomMcpTestClient(
			await restrictedFixture.readMcpContext(),
		);
		try {
			await publishBadgeComponent(restrictedSession);
			const revision = await getDesignRevision(restrictedSession);
			const result = await restrictedSession.client.callTool({
				name: "design_validate",
				arguments: {
					designFileId: trickroomMcpTestDesignUuid,
					expectedRevision: revision,
					operations: [
						{
							operation: "addSystemComponent",
							parameters: {
								parentId: "board",
								index: 0,
								systemId,
								componentId,
							},
						},
					],
				},
			});
			expect(result.isError).toBe(true);
			expect(toolPayload(result)).toMatchObject({
				status: "POLICY_DENIED",
				code: "MCP_COMPONENT_NOT_ALLOWED",
			});

			const persisted =
				await restrictedFixture.designFileService.readDesignFile(
					restrictedFixture.designFileService.getFileForUuid(
						trickroomMcpTestDesignUuid,
					),
				);
			expect(persisted.revision).toBe(revision);
		} finally {
			await restrictedSession.close();
			await restrictedFixture.cleanup();
		}
	});

	it("returns INVALID_SYSTEM_COMPONENT_INSTANCE_STATE through design_validate for invalid variant updates", async () => {
		const revision = await getDesignRevision();
		const added = await applyOperation(session.client, "addSystemComponent", {
			designFileId: trickroomMcpTestDesignUuid,
			expectedRevision: revision,
			parentId: "board",
			index: 0,
			systemId,
			componentId,
		});
		const rootElementId = String(toolPayload(added).created[0].id);
		const afterAddRevision = String(toolPayload(added)?.newRevision);

		const result = await session.client.callTool({
			name: "design_validate",
			arguments: {
				designFileId: trickroomMcpTestDesignUuid,
				expectedRevision: afterAddRevision,
				operations: [
					{
						operation: "updateSystemComponentInstance",
						parameters: {
							rootElementId,
							variantValues: { tone: "missing" },
						},
					},
				],
			},
		});
		expect(result.isError).not.toBe(true);
		expect(toolPayload(result)).toMatchObject({
			status: "INVALID_OPERATION",
			valid: false,
			issues: [
				expect.objectContaining({
					code: "INVALID_SYSTEM_COMPONENT_INSTANCE_STATE",
				}),
			],
		});

		const persisted = await fixture.designFileService.readDesignFile(
			fixture.designFileService.getFileForUuid(trickroomMcpTestDesignUuid),
		);
		expect(persisted.revision).toBe(afterAddRevision);
	});

	it("denies addSystemComponent through design_validate when expanded components are policy-blocked", async () => {
		const restrictedFixture = await createTrickroomMcpProjectFixture({
			config: {
				mcp: {
					enabled: true,
					allowedComponents: ["trickroom/container"],
				},
			},
		});
		const restrictedSession = await createTrickroomMcpTestClient(
			await restrictedFixture.readMcpContext(),
		);
		try {
			await publishBadgeComponent(restrictedSession);
			const revision = await getDesignRevision(restrictedSession);
			const result = await restrictedSession.client.callTool({
				name: "design_validate",
				arguments: {
					designFileId: trickroomMcpTestDesignUuid,
					expectedRevision: revision,
					operations: [
						{
							operation: "addSystemComponent",
							parameters: {
								parentId: "board",
								index: 0,
								systemId,
								componentId,
							},
						},
					],
				},
			});
			expect(result.isError).toBe(true);
			expect(toolPayload(result)).toMatchObject({
				status: "POLICY_DENIED",
				code: "MCP_COMPONENT_NOT_ALLOWED",
			});
		} finally {
			await restrictedSession.close();
			await restrictedFixture.cleanup();
		}
	});

	it("returns failedStepIndex for invalid updateSystemComponentInstance plan steps", async () => {
		const revision = await getDesignRevision();
		const result = await session.client.callTool({
			name: "design_validate",
			arguments: {
				designFileId: trickroomMcpTestDesignUuid,
				expectedRevision: revision,
				operations: [
					{
						operation: "addSystemComponent",
						parameters: {
							parentId: "board",
							index: 0,
							systemId,
							componentId,
						},
					},
					{
						operation: "updateSystemComponentInstance",
						parameters: {
							rootElementId: "$step:0:rootElementId",
							variantValues: { tone: "missing" },
						},
					},
				],
			},
		});
		expect(result.isError).not.toBe(true);
		expect(toolPayload(result)).toMatchObject({
			status: "INVALID_OPERATION",
			valid: false,
			failedStepIndex: 1,
			failedOperation: "updateSystemComponentInstance",
		});

		const persisted = await fixture.designFileService.readDesignFile(
			fixture.designFileService.getFileForUuid(trickroomMcpTestDesignUuid),
		);
		expect(persisted.revision).toBe(revision);
	});

	it("commits addSystemComponent and updateSystemComponentInstance through applyDesignOperations", async () => {
		const revision = await getDesignRevision();
		const result = await session.client.callTool({
			name: "design_apply",
			arguments: {
				designFileId: trickroomMcpTestDesignUuid,
				expectedRevision: revision,
				operations: [
					{
						operation: "addSystemComponent",
						parameters: {
							parentId: "board",
							index: 0,
							systemId,
							componentId,
							variantValues: { tone: "brand" },
						},
					},
					{
						operation: "updateSystemComponentInstance",
						parameters: {
							rootElementId: "$step:0:rootElementId",
							variantValues: { tone: "neutral" },
						},
					},
				],
				response: "full",
			},
		});
		expect(result.isError).not.toBe(true);
		expect(toolPayload(result)).toMatchObject({
			status: "success",
			valid: true,
			operationCount: 2,
			steps: [
				expect.objectContaining({ operation: "addSystemComponent" }),
				expect.objectContaining({
					operation: "updateSystemComponentInstance",
					summary: expect.objectContaining({
						variantValues: { tone: "neutral" },
					}),
				}),
			],
		});
		expect(toolPayload(result)?.newRevision).not.toBe(revision);

		const persisted = await fixture.designFileService.readDesignFile(
			fixture.designFileService.getFileForUuid(trickroomMcpTestDesignUuid),
		);
		expect(persisted.revision).toBe(toolPayload(result)?.newRevision);
	});

	it("denies addSystemComponent through applyDesignOperations when expanded components are policy-blocked", async () => {
		const restrictedFixture = await createTrickroomMcpProjectFixture({
			config: {
				mcp: {
					enabled: true,
					allowedComponents: ["trickroom/container"],
				},
			},
		});
		const restrictedSession = await createTrickroomMcpTestClient(
			await restrictedFixture.readMcpContext(),
		);
		try {
			await publishBadgeComponent(restrictedSession);
			const revision = await getDesignRevision(restrictedSession);
			const result = await restrictedSession.client.callTool({
				name: "design_apply",
				arguments: {
					designFileId: trickroomMcpTestDesignUuid,
					expectedRevision: revision,
					operations: [
						{
							operation: "addSystemComponent",
							parameters: {
								parentId: "board",
								index: 0,
								systemId,
								componentId,
							},
						},
					],
				},
			});
			expect(result.isError).toBe(true);
			expect(toolPayload(result)).toMatchObject({
				status: "POLICY_DENIED",
				code: "MCP_COMPONENT_NOT_ALLOWED",
			});

			const persisted =
				await restrictedFixture.designFileService.readDesignFile(
					restrictedFixture.designFileService.getFileForUuid(
						trickroomMcpTestDesignUuid,
					),
				);
			expect(persisted.revision).toBe(revision);
		} finally {
			await restrictedSession.close();
			await restrictedFixture.cleanup();
		}
	});

	it("returns invalid without writing when applyDesignOperations plan has invalid variant update", async () => {
		const revision = await getDesignRevision();
		const result = await session.client.callTool({
			name: "design_apply",
			arguments: {
				designFileId: trickroomMcpTestDesignUuid,
				expectedRevision: revision,
				operations: [
					{
						operation: "addSystemComponent",
						parameters: {
							parentId: "board",
							index: 0,
							systemId,
							componentId,
						},
					},
					{
						operation: "updateSystemComponentInstance",
						parameters: {
							rootElementId: "$step:0:rootElementId",
							variantValues: { tone: "missing" },
						},
					},
				],
			},
		});
		expect(result.isError).toBe(true);
		expect(toolPayload(result)).toMatchObject({
			status: "INVALID_OPERATION",
			valid: false,
			failedStepIndex: 1,
			failedOperation: "updateSystemComponentInstance",
			code: "INVALID_SYSTEM_COMPONENT_INSTANCE_STATE",
		});

		const persisted = await fixture.designFileService.readDesignFile(
			fixture.designFileService.getFileForUuid(trickroomMcpTestDesignUuid),
		);
		expect(persisted.revision).toBe(revision);
	});

	it("dry-runs detachSystemComponent through design_validate without writing", async () => {
		const revision = await getDesignRevision();
		const added = await applyOperation(session.client, "addSystemComponent", {
			designFileId: trickroomMcpTestDesignUuid,
			expectedRevision: revision,
			parentId: "board",
			index: 0,
			systemId,
			componentId,
		});
		const rootElementId = String(toolPayload(added).created[0].id);
		const afterAddRevision = String(toolPayload(added)?.newRevision);

		const result = await session.client.callTool({
			name: "design_validate",
			arguments: {
				designFileId: trickroomMcpTestDesignUuid,
				expectedRevision: afterAddRevision,
				operations: [
					{
						operation: "detachSystemComponent",
						parameters: {
							elementId: rootElementId,
						},
					},
				],
			},
		});
		expect(result.isError).not.toBe(true);
		expect(toolPayload(result)).toMatchObject({
			status: "success",
			valid: true,
			predicted: [
				{
					elementId: rootElementId,
					systemComponent: {
						systemId,
						componentId,
						rootElementId,
					},
					changedElementId: rootElementId,
					detachedElementIds: expect.arrayContaining([rootElementId]),
				},
			],
		});

		const persisted = await fixture.designFileService.readDesignFile(
			fixture.designFileService.getFileForUuid(trickroomMcpTestDesignUuid),
		);
		expect(persisted.revision).toBe(afterAddRevision);
		const board = persisted.design.boards[0];
		const attachedRoot = Array.isArray(board.children)
			? board.children.find((child) => child.id === rootElementId)
			: null;
		expect(attachedRoot?.props[systemComponentRootProp]).toBeDefined();
	});

	it("rejects detachSystemComponent dry-run parameters that do not match the write schema", async () => {
		const revision = await getDesignRevision();
		const result = await session.client.callTool({
			name: "design_validate",
			arguments: {
				designFileId: trickroomMcpTestDesignUuid,
				expectedRevision: revision,
				operations: [
					{
						operation: "detachSystemComponent",
						parameters: {
							elementId: "",
						},
					},
				],
			},
		});
		expect(result.isError).not.toBe(true);
		expect(toolPayload(result)).toMatchObject({
			status: "INVALID_OPERATION",
			valid: false,
			issues: [
				expect.objectContaining({ code: "INVALID_OPERATION_PARAMETERS" }),
			],
		});

		const persisted = await fixture.designFileService.readDesignFile(
			fixture.designFileService.getFileForUuid(trickroomMcpTestDesignUuid),
		);
		expect(persisted.revision).toBe(revision);
	});

	it("returns SYSTEM_COMPONENT_INSTANCE_NOT_FOUND through design_validate for non-instance elements", async () => {
		const revision = await getDesignRevision();
		const result = await session.client.callTool({
			name: "design_validate",
			arguments: {
				designFileId: trickroomMcpTestDesignUuid,
				expectedRevision: revision,
				operations: [
					{
						operation: "detachSystemComponent",
						parameters: {
							elementId: "board",
						},
					},
				],
			},
		});
		expect(result.isError).not.toBe(true);
		expect(toolPayload(result)).toMatchObject({
			status: "INVALID_OPERATION",
			valid: false,
			issues: [
				expect.objectContaining({
					code: "SYSTEM_COMPONENT_INSTANCE_NOT_FOUND",
				}),
			],
		});

		const persisted = await fixture.designFileService.readDesignFile(
			fixture.designFileService.getFileForUuid(trickroomMcpTestDesignUuid),
		);
		expect(persisted.revision).toBe(revision);
	});

	it("chains addSystemComponent and detachSystemComponent in operation plans", async () => {
		const revision = await getDesignRevision();
		const result = await session.client.callTool({
			name: "design_validate",
			arguments: {
				designFileId: trickroomMcpTestDesignUuid,
				expectedRevision: revision,
				operations: [
					{
						operation: "addSystemComponent",
						parameters: {
							parentId: "board",
							index: 0,
							systemId,
							componentId,
							variantValues: { tone: "brand" },
						},
					},
					{
						operation: "detachSystemComponent",
						parameters: {
							elementId: "$step:0:rootElementId",
						},
					},
				],
				response: "full",
			},
		});
		expect(result.isError).not.toBe(true);
		expect(toolPayload(result)).toMatchObject({
			status: "success",
			valid: true,
		});
		const steps = (
			toolPayload(result) as {
				steps: Array<{
					operation: string;
					rootElementId?: string;
					changedElementId?: string;
					summary: {
						elementId?: string;
						systemComponent?: { systemId: string; componentId: string };
						detachedElementIds?: string[];
					};
				}>;
			}
		).steps;
		expect(steps).toHaveLength(2);
		expect(steps[0]).toMatchObject({ operation: "addSystemComponent" });
		const rootElementId = steps[0].rootElementId ?? steps[0].changedElementId;
		expect(steps[1]).toMatchObject({ operation: "detachSystemComponent" });
		expect(steps[1].summary).toMatchObject({
			elementId: rootElementId,
			systemComponent: { systemId, componentId },
		});
		expect(steps[1].summary.detachedElementIds).toContain(rootElementId);

		const persisted = await fixture.designFileService.readDesignFile(
			fixture.designFileService.getFileForUuid(trickroomMcpTestDesignUuid),
		);
		expect(persisted.revision).toBe(revision);
	});

	it("commits detachSystemComponent through applyDesignOperations", async () => {
		const revision = await getDesignRevision();
		const result = await session.client.callTool({
			name: "design_apply",
			arguments: {
				designFileId: trickroomMcpTestDesignUuid,
				expectedRevision: revision,
				operations: [
					{
						operation: "addSystemComponent",
						parameters: {
							parentId: "board",
							index: 0,
							systemId,
							componentId,
							variantValues: { tone: "brand" },
						},
					},
					{
						operation: "detachSystemComponent",
						parameters: {
							elementId: "$step:0:rootElementId",
						},
					},
				],
				response: "full",
			},
		});
		expect(result.isError).not.toBe(true);
		expect(toolPayload(result)).toMatchObject({
			status: "success",
			valid: true,
			operationCount: 2,
		});
		const steps = (
			toolPayload(result) as {
				steps: Array<{
					operation: string;
					rootElementId?: string;
					changedElementId?: string;
					summary: {
						systemComponent?: { systemId: string; componentId: string };
						detachedElementIds?: string[];
					};
				}>;
				newRevision: string;
			}
		).steps;
		const rootElementId = String(
			steps[0].rootElementId ?? steps[0].changedElementId,
		);
		expect(steps[0]).toMatchObject({ operation: "addSystemComponent" });
		expect(steps[1]).toMatchObject({ operation: "detachSystemComponent" });
		expect(steps[1].summary.systemComponent).toMatchObject({
			systemId,
			componentId,
		});
		expect(steps[1].summary.detachedElementIds).toContain(rootElementId);
		expect(toolPayload(result)?.newRevision).not.toBe(revision);

		const persisted = await fixture.designFileService.readDesignFile(
			fixture.designFileService.getFileForUuid(trickroomMcpTestDesignUuid),
		);
		expect(persisted.revision).toBe(toolPayload(result)?.newRevision);
		const board = persisted.design.boards[0];
		const detachedRoot = Array.isArray(board.children)
			? board.children.find((child) => child.id === rootElementId)
			: null;
		expect(detachedRoot?.props[systemComponentRootProp]).toBeUndefined();
		expect(detachedRoot?.props[systemComponentInstanceProp]).toBeUndefined();
	});

	it("returns invalid without writing when applyDesignOperations plan detaches a non-instance element", async () => {
		const revision = await getDesignRevision();
		const result = await session.client.callTool({
			name: "design_apply",
			arguments: {
				designFileId: trickroomMcpTestDesignUuid,
				expectedRevision: revision,
				operations: [
					{
						operation: "addSystemComponent",
						parameters: {
							parentId: "board",
							index: 0,
							systemId,
							componentId,
						},
					},
					{
						operation: "detachSystemComponent",
						parameters: {
							elementId: "board",
						},
					},
				],
			},
		});
		expect(result.isError).toBe(true);
		expect(toolPayload(result)).toMatchObject({
			status: "INVALID_OPERATION",
			valid: false,
			failedStepIndex: 1,
			failedOperation: "detachSystemComponent",
		});

		const persisted = await fixture.designFileService.readDesignFile(
			fixture.designFileService.getFileForUuid(trickroomMcpTestDesignUuid),
		);
		expect(persisted.revision).toBe(revision);
	});

	it("migrates a stale system component instance when migration is safe", async () => {
		const added = await addBadgeInstance();
		const revisionAfterAdd = String(toolPayload(added)?.newRevision);
		const rootElementId = String(toolPayload(added).created[0].id);
		await publishBadgeVersion("Badge v2");

		const result = await session.client.callTool({
			name: "component_migrate",
			arguments: {
				designFileId: trickroomMcpTestDesignUuid,
				expectedRevision: revisionAfterAdd,
				rootElementId,
			},
		});

		expect(result.isError).not.toBe(true);
		expect(toolPayload(result)).toMatchObject({
			status: "success",
			applied: true,
			outcome: "migrated",
			systemComponent: {
				systemId,
				componentId,
				rootElementId,
				fromVersion: "1",
				toVersion: "2",
			},
			componentMigration: expect.objectContaining({
				fromVersion: "1",
				toVersion: "2",
			}),
		});

		const persisted = await fixture.designFileService.readDesignFile(
			fixture.designFileService.getFileForUuid(trickroomMcpTestDesignUuid),
		);
		expect(persisted.revision).not.toBe(revisionAfterAdd);
		const board = persisted.design.boards[0];
		const migratedRoot = Array.isArray(board.children)
			? board.children.find((child) => child.id === rootElementId)
			: null;
		expect(migratedRoot?.props["data-trickroom-system-component-version"]).toBe(
			"2",
		);
	});

	it("reports review-required without writing when onlySafe is true", async () => {
		const revision = await getDesignRevision();
		const added = await applyOperation(session.client, "addSystemComponent", {
			designFileId: trickroomMcpTestDesignUuid,
			expectedRevision: revision,
			parentId: "board",
			index: 0,
			systemId,
			componentId,
			overrides: { rootTarget: { className: "rounded-md" } },
		});
		const revisionAfterAdd = String(toolPayload(added)?.newRevision);
		const rootElementId = String(toolPayload(added).created[0].id);

		const listed = await session.client.callTool({
			name: "component_read",
			arguments: { systemName: "Core" },
		});
		const updated = await session.client.callTool({
			name: "component_draft_update",
			arguments: {
				systemName: "Core",
				componentId,
				expectedRevision: toolPayload(listed)?.revision,
				root: {
					path: "root",
					library: "trickroom",
					component: "container",
					className: "card",
					children: [
						{
							path: "label",
							library: "trickroom",
							component: "text",
							text: "Badge v2",
							className: "label",
						},
					],
				},
				overrideTargets: {},
			},
		});
		await session.client.callTool({
			name: "component_publish",
			arguments: {
				systemName: "Core",
				componentId,
				expectedRevision: toolPayload(updated)?.revision,
			},
		});

		const result = await session.client.callTool({
			name: "component_migrate",
			arguments: {
				designFileId: trickroomMcpTestDesignUuid,
				expectedRevision: revisionAfterAdd,
				rootElementId,
				onlySafe: true,
			},
		});

		expect(result.isError).not.toBe(true);
		expect(toolPayload(result)).toMatchObject({
			status: "REVIEW_REQUIRED",
			applied: false,
			outcome: "review-required",
			systemComponent: {
				fromVersion: "1",
				toVersion: "2",
			},
			preview: {
				classification: expect.objectContaining({
					safety: "requires-review",
				}),
			},
		});

		const persisted = await fixture.designFileService.readDesignFile(
			fixture.designFileService.getFileForUuid(trickroomMcpTestDesignUuid),
		);
		expect(persisted.revision).toBe(revisionAfterAdd);
		const board = persisted.design.boards[0];
		const staleRoot = Array.isArray(board.children)
			? board.children.find((child) => child.id === rootElementId)
			: null;
		expect(staleRoot?.props["data-trickroom-system-component-version"]).toBe(
			"1",
		);
	});

	it("returns revision mismatch for migrateSystemComponentInstance without writing", async () => {
		const added = await addBadgeInstance();
		const rootElementId = String(toolPayload(added).created[0].id);
		await publishBadgeVersion("Badge v2");

		const result = await session.client.callTool({
			name: "component_migrate",
			arguments: {
				designFileId: trickroomMcpTestDesignUuid,
				expectedRevision: "sha256:stale-revision",
				rootElementId,
			},
		});

		expect(result.isError).toBe(true);
		expect(toolPayload(result)).toMatchObject({
			status: "REVISION_MISMATCH",
		});
	});

	it("allows migrateSystemComponentInstance dry runs in read-only mode", async () => {
		const added = await addBadgeInstance();
		const revisionAfterAdd = String(toolPayload(added)?.newRevision);
		const rootElementId = String(toolPayload(added).created[0].id);
		await publishBadgeVersion("Badge v2");
		await session.close();
		await fixture.writeConfig({
			...fixture.config,
			mcp: {
				...fixture.config.mcp,
				enabled: true,
				mode: "read-only",
			},
		});
		session = await createTrickroomMcpTestClient(
			await fixture.readMcpContext(),
		);

		const result = await session.client.callTool({
			name: "component_migrate",
			arguments: {
				designFileId: trickroomMcpTestDesignUuid,
				expectedRevision: revisionAfterAdd,
				rootElementId,
				dryRun: true,
			},
		});

		expect(result.isError).not.toBe(true);
		expect(toolPayload(result)).toMatchObject({
			status: "DRY_RUN",
			applied: false,
			outcome: "dry-run-preview",
		});

		const persisted = await fixture.designFileService.readDesignFile(
			fixture.designFileService.getFileForUuid(trickroomMcpTestDesignUuid),
		);
		expect(persisted.revision).toBe(revisionAfterAdd);
	});

	it("denies migrateSystemComponentInstance writes in read-only mode", async () => {
		const added = await addBadgeInstance();
		const revisionAfterAdd = String(toolPayload(added)?.newRevision);
		const rootElementId = String(toolPayload(added).created[0].id);
		await publishBadgeVersion("Badge v2");
		await session.close();
		await fixture.writeConfig({
			...fixture.config,
			mcp: {
				...fixture.config.mcp,
				enabled: true,
				mode: "read-only",
			},
		});
		session = await createTrickroomMcpTestClient(
			await fixture.readMcpContext(),
		);

		const result = await session.client.callTool({
			name: "component_migrate",
			arguments: {
				designFileId: trickroomMcpTestDesignUuid,
				expectedRevision: revisionAfterAdd,
				rootElementId,
			},
		});

		expect(result.isError).toBe(true);
		expect(toolPayload(result)).toMatchObject({
			status: "POLICY_DENIED",
			code: "MCP_READ_ONLY",
		});

		const persisted = await fixture.designFileService.readDesignFile(
			fixture.designFileService.getFileForUuid(trickroomMcpTestDesignUuid),
		);
		expect(persisted.revision).toBe(revisionAfterAdd);
	});

	it("bulk migrates safe stale instances", async () => {
		const added = await addBadgeInstance();
		const rootElementId = String(toolPayload(added).created[0].id);
		await publishBadgeVersion("Badge v2");

		const result = await session.client.callTool({
			name: "component_migrate",
			arguments: { systemName: "Core", onlySafe: true, includeInstances: true },
		});

		expect(result.isError).not.toBe(true);
		expect(toolPayload(result)).toMatchObject({
			changedCount: 1,
			reviewRequiredCount: 0,
			designs: [
				{
					designFileId: trickroomMcpTestDesignUuid,
					changed: 1,
					persisted: true,
					newRevision: expect.any(String),
				},
			],
			changed: [
				expect.objectContaining({
					designFileId: trickroomMcpTestDesignUuid,
					elementId: rootElementId,
					fromVersion: "1",
					toVersion: "2",
				}),
			],
		});

		const persisted = await fixture.designFileService.readDesignFile(
			fixture.designFileService.getFileForUuid(trickroomMcpTestDesignUuid),
		);
		const migratedRoot = Array.isArray(persisted.design.boards[0].children)
			? persisted.design.boards[0].children.find(
					(child) => child.id === rootElementId,
				)
			: null;
		expect(migratedRoot?.props["data-trickroom-system-component-version"]).toBe(
			"2",
		);
	});

	it("bulk reports review-required stale instances without writing when onlySafe is true", async () => {
		const revision = await getDesignRevision();
		const added = await applyOperation(session.client, "addSystemComponent", {
			designFileId: trickroomMcpTestDesignUuid,
			expectedRevision: revision,
			parentId: "board",
			index: 0,
			systemId,
			componentId,
			overrides: { rootTarget: { className: "rounded-md" } },
		});
		const rootElementId = String(toolPayload(added).created[0].id);
		const revisionAfterAdd = String(toolPayload(added)?.newRevision);

		const listed = await session.client.callTool({
			name: "component_read",
			arguments: { systemName: "Core" },
		});
		const updated = await session.client.callTool({
			name: "component_draft_update",
			arguments: {
				systemName: "Core",
				componentId,
				expectedRevision: toolPayload(listed)?.revision,
				root: {
					path: "root",
					library: "trickroom",
					component: "container",
					className: "card",
					children: [
						{
							path: "label",
							library: "trickroom",
							component: "text",
							text: "Badge v2",
							className: "label",
						},
					],
				},
				overrideTargets: {},
			},
		});
		await session.client.callTool({
			name: "component_publish",
			arguments: {
				systemName: "Core",
				componentId,
				expectedRevision: toolPayload(updated)?.revision,
			},
		});

		const result = await session.client.callTool({
			name: "component_migrate",
			arguments: { systemName: "Core", onlySafe: true },
		});

		expect(result.isError).not.toBe(true);
		expect(toolPayload(result)).toMatchObject({
			changedCount: 0,
			reviewRequiredCount: 1,
			reviewRequired: [
				expect.objectContaining({
					designFileId: trickroomMcpTestDesignUuid,
					elementId: rootElementId,
					fromVersion: "1",
					toVersion: "2",
				}),
			],
		});
		const reviewRows = (
			toolPayload(result) as { reviewRequired: Array<object> }
		).reviewRequired;
		expect(reviewRows[0]).not.toHaveProperty("preview");

		const detailed = await session.client.callTool({
			name: "component_migrate",
			arguments: { systemName: "Core", dryRun: true, includeInstances: true },
		});
		expect(toolPayload(detailed)).toMatchObject({
			reviewRequired: [
				expect.objectContaining({
					preview: expect.objectContaining({
						classification: expect.objectContaining({
							safety: "requires-review",
						}),
					}),
				}),
			],
		});

		const persisted = await fixture.designFileService.readDesignFile(
			fixture.designFileService.getFileForUuid(trickroomMcpTestDesignUuid),
		);
		expect(persisted.revision).toBe(revisionAfterAdd);
		const staleRoot = Array.isArray(persisted.design.boards[0].children)
			? persisted.design.boards[0].children.find(
					(child) => child.id === rootElementId,
				)
			: null;
		expect(staleRoot?.props["data-trickroom-system-component-version"]).toBe(
			"1",
		);
	});

	it("respects allowedDesignFileIds when bulk migrating system component usages", async () => {
		await fixture.writeDesign(secondDesignUuid, {
			name: "Second Harness Design",
			systemName: "Core",
			boards: [
				{
					id: "board-2",
					props: {
						"data-trickroom-name": "Board",
						"data-trickroom-library": "trickroom",
						"data-trickroom-component": "container",
					},
					children: [],
				},
			],
		});
		await addBadgeInstance(trickroomMcpTestDesignUuid);
		await addBadgeInstance(secondDesignUuid);
		await publishBadgeVersion("Badge v2");
		await session.close();
		await fixture.writeConfig({
			...fixture.config,
			mcp: {
				...fixture.config.mcp,
				enabled: true,
				allowedDesignFileIds: [trickroomMcpTestDesignUuid],
			},
		});
		session = await createTrickroomMcpTestClient(
			await fixture.readMcpContext(),
		);

		const result = await session.client.callTool({
			name: "component_migrate",
			arguments: { systemName: "Core" },
		});

		expect(result.isError).not.toBe(true);
		expect(toolPayload(result)).toMatchObject({
			changedCount: 1,
			scannedDesignCount: 1,
			designs: [
				expect.objectContaining({
					designFileId: trickroomMcpTestDesignUuid,
					changed: 1,
				}),
			],
		});
		expect(
			(toolPayload(result) as { changed: Array<{ designFileId: string }> })
				.changed,
		).not.toEqual(
			expect.arrayContaining([
				expect.objectContaining({ designFileId: secondDesignUuid }),
			]),
		);
	});

	it("denies migrateSystemComponentInstance dry runs when target subtree uses disallowed components", async () => {
		const added = await addBadgeInstance();
		const revisionAfterAdd = String(toolPayload(added)?.newRevision);
		const rootElementId = String(toolPayload(added).created[0].id);
		await publishBadgeVersion("Badge v2");
		await session.close();
		await fixture.writeConfig({
			...fixture.config,
			mcp: {
				...fixture.config.mcp,
				enabled: true,
				allowedComponents: ["trickroom/container"],
			},
		});
		session = await createTrickroomMcpTestClient(
			await fixture.readMcpContext(),
		);

		const result = await session.client.callTool({
			name: "component_migrate",
			arguments: {
				designFileId: trickroomMcpTestDesignUuid,
				expectedRevision: revisionAfterAdd,
				rootElementId,
				dryRun: true,
			},
		});

		expect(result.isError).toBe(true);
		expect(toolPayload(result)).toMatchObject({
			status: "POLICY_DENIED",
			code: "MCP_COMPONENT_NOT_ALLOWED",
		});

		const persisted = await fixture.designFileService.readDesignFile(
			fixture.designFileService.getFileForUuid(trickroomMcpTestDesignUuid),
		);
		expect(persisted.revision).toBe(revisionAfterAdd);
	});

	it("denies migrateSystemComponentInstance when instance subtree uses disallowed components", async () => {
		const added = await addBadgeInstance();
		const revisionAfterAdd = String(toolPayload(added)?.newRevision);
		const rootElementId = String(toolPayload(added).created[0].id);
		await publishBadgeVersion("Badge v2");
		await session.close();
		await fixture.writeConfig({
			...fixture.config,
			mcp: {
				...fixture.config.mcp,
				enabled: true,
				allowedComponents: ["trickroom/container"],
			},
		});
		session = await createTrickroomMcpTestClient(
			await fixture.readMcpContext(),
		);

		const result = await session.client.callTool({
			name: "component_migrate",
			arguments: {
				designFileId: trickroomMcpTestDesignUuid,
				expectedRevision: revisionAfterAdd,
				rootElementId,
			},
		});

		expect(result.isError).toBe(true);
		expect(toolPayload(result)).toMatchObject({
			status: "POLICY_DENIED",
			code: "MCP_COMPONENT_NOT_ALLOWED",
		});

		const persisted = await fixture.designFileService.readDesignFile(
			fixture.designFileService.getFileForUuid(trickroomMcpTestDesignUuid),
		);
		expect(persisted.revision).toBe(revisionAfterAdd);
	});

	it("reports component-not-allowed without writing during bulk migration when policy blocks subtree components", async () => {
		const added = await addBadgeInstance();
		const revisionAfterAdd = String(toolPayload(added)?.newRevision);
		const rootElementId = String(toolPayload(added).created[0].id);
		await publishBadgeVersion("Badge v2");
		await session.close();
		await fixture.writeConfig({
			...fixture.config,
			mcp: {
				...fixture.config.mcp,
				enabled: true,
				allowedComponents: ["trickroom/container"],
			},
		});
		session = await createTrickroomMcpTestClient(
			await fixture.readMcpContext(),
		);

		const result = await session.client.callTool({
			name: "component_migrate",
			arguments: { systemName: "Core" },
		});

		expect(result.isError).not.toBe(true);
		expect(toolPayload(result)).toMatchObject({
			changedCount: 0,
			skippedCount: 1,
			skippedReasons: { "component-not-allowed": 1 },
		});

		const persisted = await fixture.designFileService.readDesignFile(
			fixture.designFileService.getFileForUuid(trickroomMcpTestDesignUuid),
		);
		expect(persisted.revision).toBe(revisionAfterAdd);
		const staleRoot = Array.isArray(persisted.design.boards[0].children)
			? persisted.design.boards[0].children.find(
					(child) => child.id === rootElementId,
				)
			: null;
		expect(staleRoot?.props["data-trickroom-system-component-version"]).toBe(
			"1",
		);
	});

	it("ignores malformed disallowed design files during allowlisted bulk migration", async () => {
		const malformedDesignUuid = "00000000-0000-4000-8000-000000000099";
		await writeFile(
			path.join(
				fixture.projectRoot,
				".trickroom",
				"designs",
				`${malformedDesignUuid}.json`,
			),
			"{ not-a-valid-design-payload",
			"utf8",
		);
		await addBadgeInstance();
		await publishBadgeVersion("Badge v2");
		await session.close();
		await fixture.writeConfig({
			...fixture.config,
			mcp: {
				...fixture.config.mcp,
				enabled: true,
				allowedDesignFileIds: [trickroomMcpTestDesignUuid],
			},
		});
		session = await createTrickroomMcpTestClient(
			await fixture.readMcpContext(),
		);

		const result = await session.client.callTool({
			name: "component_migrate",
			arguments: { systemName: "Core" },
		});

		expect(result.isError).not.toBe(true);
		expect(toolPayload(result)).toMatchObject({
			changedCount: 1,
			scannedDesignCount: 1,
			designs: [
				expect.objectContaining({
					designFileId: trickroomMcpTestDesignUuid,
					changed: 1,
				}),
			],
		});
		expect(
			(
				toolPayload(result) as {
					failures?: Array<{ designFileId?: string }>;
				}
			).failures ?? [],
		).not.toEqual(
			expect.arrayContaining([
				expect.objectContaining({ designFileId: malformedDesignUuid }),
			]),
		);
		expect(
			(
				toolPayload(result) as {
					designs?: Array<{ designFileId: string }>;
				}
			).designs ?? [],
		).not.toEqual(
			expect.arrayContaining([
				expect.objectContaining({ designFileId: malformedDesignUuid }),
			]),
		);
	});

	it("does not persist design files when bulkMigrateSystemComponentUsages uses dryRun", async () => {
		const added = await addBadgeInstance();
		const revisionAfterAdd = String(toolPayload(added)?.newRevision);
		const rootElementId = String(toolPayload(added).created[0].id);
		await publishBadgeVersion("Badge v2");

		const result = await session.client.callTool({
			name: "component_migrate",
			arguments: { systemName: "Core", dryRun: true },
		});

		expect(result.isError).not.toBe(true);
		expect(toolPayload(result)).toMatchObject({
			dryRun: true,
			changedCount: 1,
			designs: [
				expect.objectContaining({
					designFileId: trickroomMcpTestDesignUuid,
					changed: 1,
				}),
			],
		});

		const persisted = await fixture.designFileService.readDesignFile(
			fixture.designFileService.getFileForUuid(trickroomMcpTestDesignUuid),
		);
		expect(persisted.revision).toBe(revisionAfterAdd);
		const staleRoot = Array.isArray(persisted.design.boards[0].children)
			? persisted.design.boards[0].children.find(
					(child) => child.id === rootElementId,
				)
			: null;
		expect(staleRoot?.props["data-trickroom-system-component-version"]).toBe(
			"1",
		);
	});

	it("denies project-wide bulk migration writes in read-only mode", async () => {
		const added = await addBadgeInstance();
		const revisionAfterAdd = String(toolPayload(added)?.newRevision);
		await publishBadgeVersion("Badge v2");
		await session.close();
		await fixture.writeConfig({
			...fixture.config,
			mcp: {
				...fixture.config.mcp,
				enabled: true,
				mode: "read-only",
			},
		});
		session = await createTrickroomMcpTestClient(
			await fixture.readMcpContext(),
		);

		const result = await session.client.callTool({
			name: "component_migrate",
			arguments: { systemName: "Core", onlySafe: true },
		});

		expect(result.isError).toBe(true);
		expect(toolPayload(result)).toMatchObject({
			status: "POLICY_DENIED",
			code: "MCP_READ_ONLY",
		});

		const persisted = await fixture.designFileService.readDesignFile(
			fixture.designFileService.getFileForUuid(trickroomMcpTestDesignUuid),
		);
		expect(persisted.revision).toBe(revisionAfterAdd);
	});

	it("allows project-wide bulk migration dry runs in read-only mode", async () => {
		const added = await addBadgeInstance();
		const revisionAfterAdd = String(toolPayload(added)?.newRevision);
		await publishBadgeVersion("Badge v2");
		await session.close();
		await fixture.writeConfig({
			...fixture.config,
			mcp: {
				...fixture.config.mcp,
				enabled: true,
				mode: "read-only",
			},
		});
		session = await createTrickroomMcpTestClient(
			await fixture.readMcpContext(),
		);

		const result = await session.client.callTool({
			name: "component_migrate",
			arguments: { systemName: "Core", dryRun: true },
		});

		expect(result.isError).not.toBe(true);
		expect(toolPayload(result)).toMatchObject({
			dryRun: true,
			changedCount: 1,
			designs: [
				expect.objectContaining({
					designFileId: trickroomMcpTestDesignUuid,
					changed: 1,
				}),
			],
		});

		const persisted = await fixture.designFileService.readDesignFile(
			fixture.designFileService.getFileForUuid(trickroomMcpTestDesignUuid),
		);
		expect(persisted.revision).toBe(revisionAfterAdd);
	});

	it("allows design-scoped bulk migration dry runs in read-only mode", async () => {
		const added = await addBadgeInstance();
		const revisionAfterAdd = String(toolPayload(added)?.newRevision);
		await publishBadgeVersion("Badge v2");
		await session.close();
		await fixture.writeConfig({
			...fixture.config,
			mcp: {
				...fixture.config.mcp,
				enabled: true,
				mode: "read-only",
			},
		});
		session = await createTrickroomMcpTestClient(
			await fixture.readMcpContext(),
		);

		const result = await session.client.callTool({
			name: "component_migrate",
			arguments: {
				systemName: "Core",
				designFileId: trickroomMcpTestDesignUuid,
				dryRun: true,
			},
		});

		expect(result.isError).not.toBe(true);
		expect(toolPayload(result)).toMatchObject({
			dryRun: true,
			designFileId: trickroomMcpTestDesignUuid,
			changedCount: 1,
			designs: [
				expect.objectContaining({
					designFileId: trickroomMcpTestDesignUuid,
					changed: 1,
				}),
			],
		});

		const persisted = await fixture.designFileService.readDesignFile(
			fixture.designFileService.getFileForUuid(trickroomMcpTestDesignUuid),
		);
		expect(persisted.revision).toBe(revisionAfterAdd);
	});

	it("preserves dryRun for empty allowedDesignFileIds bulk migration", async () => {
		const added = await addBadgeInstance();
		const revisionAfterAdd = String(toolPayload(added)?.newRevision);
		await publishBadgeVersion("Badge v2");
		await session.close();
		await fixture.writeConfig({
			...fixture.config,
			mcp: {
				...fixture.config.mcp,
				enabled: true,
				mode: "read-only",
				allowedDesignFileIds: [],
			},
		});
		session = await createTrickroomMcpTestClient(
			await fixture.readMcpContext(),
		);

		const result = await session.client.callTool({
			name: "component_migrate",
			arguments: { systemName: "Core", dryRun: true },
		});

		expect(result.isError).not.toBe(true);
		expect(toolPayload(result)).toMatchObject({
			dryRun: true,
			systemId,
			systemName: "Core",
			changedCount: 0,
			scannedDesignCount: 0,
			designs: [],
		});

		const persisted = await fixture.designFileService.readDesignFile(
			fixture.designFileService.getFileForUuid(trickroomMcpTestDesignUuid),
		);
		expect(persisted.revision).toBe(revisionAfterAdd);
	});

	it("allows allowlisted bulk migration dry runs in read-only mode", async () => {
		const added = await addBadgeInstance();
		const revisionAfterAdd = String(toolPayload(added)?.newRevision);
		await publishBadgeVersion("Badge v2");
		await session.close();
		await fixture.writeConfig({
			...fixture.config,
			mcp: {
				...fixture.config.mcp,
				enabled: true,
				mode: "read-only",
				allowedDesignFileIds: [trickroomMcpTestDesignUuid],
			},
		});
		session = await createTrickroomMcpTestClient(
			await fixture.readMcpContext(),
		);

		const result = await session.client.callTool({
			name: "component_migrate",
			arguments: { systemName: "Core", dryRun: true },
		});

		expect(result.isError).not.toBe(true);
		expect(toolPayload(result)).toMatchObject({
			dryRun: true,
			changedCount: 1,
			scannedDesignCount: 1,
			designs: [
				expect.objectContaining({
					designFileId: trickroomMcpTestDesignUuid,
					changed: 1,
				}),
			],
		});

		const persisted = await fixture.designFileService.readDesignFile(
			fixture.designFileService.getFileForUuid(trickroomMcpTestDesignUuid),
		);
		expect(persisted.revision).toBe(revisionAfterAdd);
	});

	it("rejects bulk migration for disallowed designFileId filters", async () => {
		await session.close();
		await fixture.writeConfig({
			...fixture.config,
			mcp: {
				...fixture.config.mcp,
				enabled: true,
				allowedDesignFileIds: [trickroomMcpTestDesignUuid],
			},
		});
		session = await createTrickroomMcpTestClient(
			await fixture.readMcpContext(),
		);

		const result = await session.client.callTool({
			name: "component_migrate",
			arguments: { systemName: "Core", designFileId: secondDesignUuid },
		});

		expect(result.isError).toBe(true);
		expect(toolPayload(result)).toMatchObject({
			status: "POLICY_DENIED",
			code: "MCP_DESIGN_FILE_NOT_ALLOWED",
		});
	});
});
