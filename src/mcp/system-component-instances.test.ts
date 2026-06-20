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
	createTrickroomMcpProjectFixture,
	createTrickroomMcpTestClient,
	type TrickroomMcpClientSession,
	type TrickroomMcpProjectFixture,
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
			name: "listSystemComponents",
			arguments: { systemName: "Core" },
		});
		systemId = String(listed.structuredContent?.systemId);

		const created = await targetSession.client.callTool({
			name: "createSystemComponentDraft",
			arguments: {
				systemName: "Core",
				expectedRevision: listed.structuredContent?.revision,
				slug: "badge",
				name: "Badge",
				draft: { root: textRoot() },
			},
		});
		componentId = String(created.structuredContent?.componentId);

		const updated = await targetSession.client.callTool({
			name: "updateSystemComponentDraft",
			arguments: {
				systemName: "Core",
				componentId,
				expectedRevision: created.structuredContent?.revision,
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
			name: "publishSystemComponent",
			arguments: {
				systemName: "Core",
				componentId,
				expectedRevision: updated.structuredContent?.revision,
			},
		});
	};

	const getDesignRevision = async (
		targetSession: TrickroomMcpClientSession = session,
		designFileId = trickroomMcpTestDesignUuid,
	) => {
		const read = await targetSession.client.callTool({
			name: "readDesignFile",
			arguments: { designFileId },
		});
		return String(
			(read.structuredContent as { designFile: { revision: string } })
				.designFile.revision,
		);
	};

	const addBadgeInstance = async (
		designFileId = trickroomMcpTestDesignUuid,
		targetSession: TrickroomMcpClientSession = session,
	) => {
		const revision = await getDesignRevision(targetSession, designFileId);
		return targetSession.client.callTool({
			name: "addSystemComponent",
			arguments: {
				designFileId,
				expectedRevision: revision,
				parentId: "board",
				index: 0,
				systemId,
				componentId,
			},
		});
	};

	const publishBadgeVersion = async (
		text: string,
		targetSession: TrickroomMcpClientSession = session,
	) => {
		const listed = await targetSession.client.callTool({
			name: "listSystemComponents",
			arguments: { systemName: "Core" },
		});
		const updated = await targetSession.client.callTool({
			name: "updateSystemComponentDraft",
			arguments: {
				systemName: "Core",
				componentId,
				expectedRevision: listed.structuredContent?.revision,
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
			name: "publishSystemComponent",
			arguments: {
				systemName: "Core",
				componentId,
				expectedRevision: updated.structuredContent?.revision,
			},
		});
	};

	const publishOptionalToneComponent = async () => {
		const listed = await session.client.callTool({
			name: "listSystemComponents",
			arguments: { systemName: "Core" },
		});
		const created = await session.client.callTool({
			name: "createSystemComponentDraft",
			arguments: {
				systemName: "Core",
				expectedRevision: listed.structuredContent?.revision,
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
		const optionalComponentId = String(created.structuredContent?.componentId);
		await session.client.callTool({
			name: "publishSystemComponent",
			arguments: {
				systemName: "Core",
				componentId: optionalComponentId,
				expectedRevision: created.structuredContent?.revision,
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

	it("adds, updates, and detaches a published system component instance", async () => {
		const revision = await getDesignRevision();

		const added = await session.client.callTool({
			name: "addSystemComponent",
			arguments: {
				designFileId: trickroomMcpTestDesignUuid,
				expectedRevision: revision,
				parentId: "board",
				index: 1,
				systemId,
				componentId,
				variantValues: { tone: "brand" },
				overrides: { rootTarget: { className: "rounded-md" } },
			},
		});
		expect(added.isError).not.toBe(true);
		const rootElementId = String(
			(added.structuredContent as { changedElement: { id: string } })
				.changedElement.id,
		);
		expect(added.structuredContent).toMatchObject({
			status: "success",
			systemComponent: {
				systemId,
				componentId,
				version: "1",
				variantValues: { tone: "brand" },
				overrides: { rootTarget: { className: "rounded-md" } },
			},
		});

		const afterAddRevision = String(added.structuredContent?.newRevision);
		const updated = await session.client.callTool({
			name: "updateSystemComponentInstance",
			arguments: {
				designFileId: trickroomMcpTestDesignUuid,
				expectedRevision: afterAddRevision,
				rootElementId,
				variantValues: { tone: "neutral" },
				overrides: { rootTarget: { className: "shadow-sm" } },
			},
		});
		expect(updated.isError).not.toBe(true);
		expect(updated.structuredContent).toMatchObject({
			status: "success",
			systemComponent: {
				variantValues: { tone: "neutral" },
				overrides: { rootTarget: { className: "shadow-sm" } },
			},
		});

		const afterUpdateRevision = String(updated.structuredContent?.newRevision);
		const detached = await session.client.callTool({
			name: "detachSystemComponent",
			arguments: {
				designFileId: trickroomMcpTestDesignUuid,
				expectedRevision: afterUpdateRevision,
				elementId: rootElementId,
			},
		});
		expect(detached.isError).not.toBe(true);
		expect(detached.structuredContent).toMatchObject({
			status: "success",
			systemComponent: {
				systemId,
				componentId,
			},
			detachedElementIds: expect.arrayContaining([rootElementId]),
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
		const added = await session.client.callTool({
			name: "addSystemComponent",
			arguments: {
				designFileId: trickroomMcpTestDesignUuid,
				expectedRevision: revision,
				parentId: "board",
				index: 0,
				systemId,
				componentId: optionalComponentId,
				variantValues: { tone: "brand" },
			},
		});
		expect(added.isError).not.toBe(true);
		const rootElementId = String(
			(added.structuredContent as { changedElement: { id: string } })
				.changedElement.id,
		);

		const updated = await session.client.callTool({
			name: "updateSystemComponentInstance",
			arguments: {
				designFileId: trickroomMcpTestDesignUuid,
				expectedRevision: String(added.structuredContent?.newRevision),
				rootElementId,
				unsetVariantAxes: ["tone"],
			},
		});
		expect(updated.isError).not.toBe(true);
		expect(updated.structuredContent).toMatchObject({
			status: "success",
			systemComponent: {
				variantValues: {},
			},
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
			name: "listStaleSystemComponentUsages",
			arguments: { systemName: "Core" },
		});

		expect(result.isError).not.toBe(true);
		expect(result.structuredContent).toMatchObject({
			systemId,
			systemName: "Core",
			staleCount: 0,
			statusCounts: expect.objectContaining({ current: 1, stale: 0 }),
			usages: [],
		});
	});

	it("extracts complete attached roots with fresh instance ids and strips partial component markers", async () => {
		const added = await addBadgeInstance();
		const rootElementId = String(
			(added.structuredContent as { changedElement: { id: string } })
				.changedElement.id,
		);

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
			name: "extractSubtree",
			arguments: {
				designFileId: trickroomMcpTestDesignUuid,
				elementId: rootElementId,
				newDesignFileId: rootTargetId,
			},
		});
		expect(extractedRoot.isError).not.toBe(true);
		const rootIdMap = extractedRoot.structuredContent?.idMap as Record<
			string,
			string
		>;
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
		expect(rootIdMap[rootElementId]).toBe(clonedRoot.id);

		const partialTargetId = "10000000-0000-4000-8000-000000000202";
		const extractedPartial = await session.client.callTool({
			name: "extractSubtree",
			arguments: {
				designFileId: trickroomMcpTestDesignUuid,
				elementId: sourceLabelId,
				newDesignFileId: partialTargetId,
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
		const rootElementId = String(
			(added.structuredContent as { changedElement: { id: string } })
				.changedElement.id,
		);

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
		const result = await session.client.callTool({
			name: "copySubtree",
			arguments: {
				sourceDesignFileId: trickroomMcpTestDesignUuid,
				sourceElementId: rootElementId,
				sourceExpectedRevision: sourceRevision,
				targetDesignFileId: unlinkedDesignUuid,
				expectedRevision: targetRevision,
				parentId: "board",
				index: 0,
			},
		});

		expect(result.isError).toBe(true);
		expect(result.structuredContent).toMatchObject({
			status: "INVALID_OPERATION",
			code: "DESIGN_NOT_LINKED_TO_SYSTEM",
		});
	});

	it("rejects extractSubtree when preserving a complete attached root into an unlinked design", async () => {
		const added = await addBadgeInstance();
		const rootElementId = String(
			(added.structuredContent as { changedElement: { id: string } })
				.changedElement.id,
		);
		const targetDesignId = "10000000-0000-4000-8000-000000000203";

		const result = await session.client.callTool({
			name: "extractSubtree",
			arguments: {
				designFileId: trickroomMcpTestDesignUuid,
				elementId: rootElementId,
				newDesignFileId: targetDesignId,
				systemName: null,
			},
		});

		expect(result.isError).toBe(true);
		expect(result.structuredContent).toMatchObject({
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
		const result = await session.client.callTool({
			name: "addSystemComponent",
			arguments: {
				designFileId: unlinkedDesignUuid,
				expectedRevision: revision,
				parentId: "board",
				index: 0,
				systemId,
				componentId,
			},
		});

		expect(result.isError).toBe(true);
		expect(result.structuredContent).toMatchObject({
			status: "INVALID_OPERATION",
			code: "DESIGN_NOT_LINKED_TO_SYSTEM",
		});
	});

	it("reports stale system component usages without writing designs", async () => {
		const added = await addBadgeInstance();
		const revisionAfterAdd = String(added.structuredContent?.newRevision);
		await publishBadgeVersion("Badge v2");

		const result = await session.client.callTool({
			name: "listStaleSystemComponentUsages",
			arguments: { systemName: "Core", componentId },
		});

		expect(result.isError).not.toBe(true);
		expect(result.structuredContent).toMatchObject({
			systemId,
			componentId,
			staleCount: 1,
			statusCounts: expect.objectContaining({ stale: 1 }),
			usages: [
				expect.objectContaining({
					designFileId: trickroomMcpTestDesignUuid,
					designFile: expect.stringContaining(trickroomMcpTestDesignUuid),
					nodeId: expect.any(String),
					componentId,
					currentVersion: "2",
					publishedVersion: "1",
					referencedVersion: "1",
					attachedVersion: "1",
					diagnostics: [
						expect.objectContaining({
							code: "STALE_VERSION",
							componentId,
							version: "1",
						}),
					],
				}),
			],
		});

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
			name: "listStaleSystemComponentUsages",
			arguments: { systemName: "Core" },
		});

		expect(result.isError).not.toBe(true);
		expect(result.structuredContent).toMatchObject({
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
				result.structuredContent as {
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
			name: "listStaleSystemComponentUsages",
			arguments: { systemName: "Core" },
		});

		expect(result.isError).not.toBe(true);
		expect(result.structuredContent).toMatchObject({
			staleCount: 1,
			scannedDesignCount: 1,
			usages: [
				expect.objectContaining({
					designFileId: trickroomMcpTestDesignUuid,
				}),
			],
		});
		expect(
			(result.structuredContent as { usages: Array<{ designFileId: string }> })
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
			name: "listStaleSystemComponentUsages",
			arguments: { systemName: "Core" },
		});

		expect(result.isError).not.toBe(true);
		expect(result.structuredContent).toMatchObject({
			systemId,
			systemName: "Core",
			staleCount: 0,
			scannedDesignCount: 0,
			statusCounts: expect.objectContaining({
				current: 0,
				stale: 0,
			}),
			usages: [],
			diagnostics: [],
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
			name: "listStaleSystemComponentUsages",
			arguments: { systemName: "Core", designFileId: secondDesignUuid },
		});

		expect(result.isError).toBe(true);
		expect(result.structuredContent).toMatchObject({
			status: "POLICY_DENIED",
			code: "MCP_DESIGN_FILE_NOT_ALLOWED",
		});
	});

	it("rejects stale design revisions and unsafe marker prop edits", async () => {
		const revision = await getDesignRevision();
		const added = await session.client.callTool({
			name: "addSystemComponent",
			arguments: {
				designFileId: trickroomMcpTestDesignUuid,
				expectedRevision: revision,
				parentId: "board",
				index: 0,
				systemId,
				componentId,
			},
		});
		const rootElementId = String(
			(added.structuredContent as { changedElement: { id: string } })
				.changedElement.id,
		);

		const stale = await session.client.callTool({
			name: "updateSystemComponentInstance",
			arguments: {
				designFileId: trickroomMcpTestDesignUuid,
				expectedRevision: revision,
				rootElementId,
				variantValues: { tone: "brand" },
			},
		});
		expect(stale.isError).toBe(true);
		expect(stale.structuredContent).toMatchObject({
			status: "REVISION_MISMATCH",
		});

		const markerEdit = await session.client.callTool({
			name: "updateElementProps",
			arguments: {
				designFileId: trickroomMcpTestDesignUuid,
				expectedRevision: String(added.structuredContent?.newRevision),
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
		});
		expect(markerEdit.isError).toBe(true);
		expect(markerEdit.structuredContent).toMatchObject({
			status: "INVALID_OPERATION",
			code: "INVALID_PROP_KEY",
		});

		const structuralEdit = await session.client.callTool({
			name: "updateElementProps",
			arguments: {
				designFileId: trickroomMcpTestDesignUuid,
				expectedRevision: String(added.structuredContent?.newRevision),
				elementId: rootElementId,
				className: "manual-class",
			},
		});
		expect(structuralEdit.isError).toBe(true);
		expect(structuralEdit.structuredContent).toMatchObject({
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
			const result = await restrictedSession.client.callTool({
				name: "addSystemComponent",
				arguments: {
					designFileId: trickroomMcpTestDesignUuid,
					expectedRevision: revision,
					parentId: "board",
					index: 0,
					systemId,
					componentId,
				},
			});
			expect(result.isError).toBe(true);
			expect(result.structuredContent).toMatchObject({
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
		const added = await session.client.callTool({
			name: "addSystemComponent",
			arguments: {
				designFileId: trickroomMcpTestDesignUuid,
				expectedRevision: revision,
				parentId: "board",
				index: 0,
				systemId,
				componentId,
			},
		});
		const rootElementId = String(
			(added.structuredContent as { changedElement: { id: string } })
				.changedElement.id,
		);

		const invalidUpdate = await session.client.callTool({
			name: "updateSystemComponentInstance",
			arguments: {
				designFileId: trickroomMcpTestDesignUuid,
				expectedRevision: String(added.structuredContent?.newRevision),
				rootElementId,
				variantValues: { tone: "missing" },
			},
		});
		expect(invalidUpdate.isError).toBe(true);
		expect(invalidUpdate.structuredContent).toMatchObject({
			status: "INVALID_OPERATION",
			code: "INVALID_SYSTEM_COMPONENT_INSTANCE_STATE",
		});
	});

	it("includes system/component identity in update responses", async () => {
		const revision = await getDesignRevision();
		const added = await session.client.callTool({
			name: "addSystemComponent",
			arguments: {
				designFileId: trickroomMcpTestDesignUuid,
				expectedRevision: revision,
				parentId: "board",
				index: 0,
				systemId,
				componentId,
			},
		});
		const rootElementId = String(
			(added.structuredContent as { changedElement: { id: string } })
				.changedElement.id,
		);

		const updated = await session.client.callTool({
			name: "updateSystemComponentInstance",
			arguments: {
				designFileId: trickroomMcpTestDesignUuid,
				expectedRevision: String(added.structuredContent?.newRevision),
				rootElementId,
				variantValues: { tone: "brand" },
			},
		});
		expect(updated.isError).not.toBe(true);
		expect(updated.structuredContent).toMatchObject({
			status: "success",
			systemComponent: {
				systemId,
				componentId,
				version: "1",
			},
		});
	});

	it("chains addSystemComponent and updateSystemComponentInstance in operation plans", async () => {
		const revision = await getDesignRevision();
		const result = await session.client.callTool({
			name: "validateOperationPlan",
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
			},
		});
		expect(result.isError).not.toBe(true);
		expect(result.structuredContent).toMatchObject({
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

	it("dry-runs addSystemComponent through validateOperation without writing", async () => {
		const revision = await getDesignRevision();
		const result = await session.client.callTool({
			name: "validateOperation",
			arguments: {
				designFileId: trickroomMcpTestDesignUuid,
				expectedRevision: revision,
				operation: "addSystemComponent",
				parameters: {
					parentId: "board",
					index: 0,
					systemId,
					componentId,
					variantValues: { tone: "brand" },
				},
			},
		});
		expect(result.isError).not.toBe(true);
		expect(result.structuredContent).toMatchObject({
			status: "success",
			valid: true,
			operation: "addSystemComponent",
			predicted: {
				parentId: "board",
				index: 0,
				systemComponent: {
					systemId,
					componentId,
					version: "1",
					variantValues: { tone: "brand" },
				},
				changedElement: expect.objectContaining({
					library: "trickroom",
					component: "container",
				}),
			},
		});

		const persisted = await fixture.designFileService.readDesignFile(
			fixture.designFileService.getFileForUuid(trickroomMcpTestDesignUuid),
		);
		expect(persisted.revision).toBe(revision);
	});

	it("denies addSystemComponent through validateOperation when expanded components are policy-blocked", async () => {
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
				name: "validateOperation",
				arguments: {
					designFileId: trickroomMcpTestDesignUuid,
					expectedRevision: revision,
					operation: "addSystemComponent",
					parameters: {
						parentId: "board",
						index: 0,
						systemId,
						componentId,
					},
				},
			});
			expect(result.isError).toBe(true);
			expect(result.structuredContent).toMatchObject({
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

	it("returns INVALID_SYSTEM_COMPONENT_INSTANCE_STATE through validateOperation for invalid variant updates", async () => {
		const revision = await getDesignRevision();
		const added = await session.client.callTool({
			name: "addSystemComponent",
			arguments: {
				designFileId: trickroomMcpTestDesignUuid,
				expectedRevision: revision,
				parentId: "board",
				index: 0,
				systemId,
				componentId,
			},
		});
		const rootElementId = String(
			(added.structuredContent as { changedElement: { id: string } })
				.changedElement.id,
		);
		const afterAddRevision = String(added.structuredContent?.newRevision);

		const result = await session.client.callTool({
			name: "validateOperation",
			arguments: {
				designFileId: trickroomMcpTestDesignUuid,
				expectedRevision: afterAddRevision,
				operation: "updateSystemComponentInstance",
				parameters: {
					rootElementId,
					variantValues: { tone: "missing" },
				},
			},
		});
		expect(result.isError).toBe(true);
		expect(result.structuredContent).toMatchObject({
			status: "INVALID_OPERATION",
			code: "INVALID_SYSTEM_COMPONENT_INSTANCE_STATE",
		});

		const persisted = await fixture.designFileService.readDesignFile(
			fixture.designFileService.getFileForUuid(trickroomMcpTestDesignUuid),
		);
		expect(persisted.revision).toBe(afterAddRevision);
	});

	it("denies addSystemComponent through validateOperationPlan when expanded components are policy-blocked", async () => {
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
				name: "validateOperationPlan",
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
			expect(result.structuredContent).toMatchObject({
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
			name: "validateOperationPlan",
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
		expect(result.structuredContent).toMatchObject({
			status: "invalid",
			valid: false,
			failedStepIndex: 1,
			failedOperation: "updateSystemComponentInstance",
			steps: [{ stepIndex: 0, operation: "addSystemComponent" }],
		});

		const persisted = await fixture.designFileService.readDesignFile(
			fixture.designFileService.getFileForUuid(trickroomMcpTestDesignUuid),
		);
		expect(persisted.revision).toBe(revision);
	});

	it("commits addSystemComponent and updateSystemComponentInstance through applyDesignOperations", async () => {
		const revision = await getDesignRevision();
		const result = await session.client.callTool({
			name: "applyDesignOperations",
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
			},
		});
		expect(result.isError).not.toBe(true);
		expect(result.structuredContent).toMatchObject({
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
		expect(result.structuredContent?.newRevision).not.toBe(revision);

		const persisted = await fixture.designFileService.readDesignFile(
			fixture.designFileService.getFileForUuid(trickroomMcpTestDesignUuid),
		);
		expect(persisted.revision).toBe(result.structuredContent?.newRevision);
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
				name: "applyDesignOperations",
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
			expect(result.structuredContent).toMatchObject({
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
			name: "applyDesignOperations",
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
		expect(result.structuredContent).toMatchObject({
			status: "invalid",
			valid: false,
			failedStepIndex: 1,
			failedOperation: "updateSystemComponentInstance",
		});

		const persisted = await fixture.designFileService.readDesignFile(
			fixture.designFileService.getFileForUuid(trickroomMcpTestDesignUuid),
		);
		expect(persisted.revision).toBe(revision);
	});

	it("dry-runs detachSystemComponent through validateOperation without writing", async () => {
		const revision = await getDesignRevision();
		const added = await session.client.callTool({
			name: "addSystemComponent",
			arguments: {
				designFileId: trickroomMcpTestDesignUuid,
				expectedRevision: revision,
				parentId: "board",
				index: 0,
				systemId,
				componentId,
			},
		});
		const rootElementId = String(
			(added.structuredContent as { changedElement: { id: string } })
				.changedElement.id,
		);
		const afterAddRevision = String(added.structuredContent?.newRevision);

		const result = await session.client.callTool({
			name: "validateOperation",
			arguments: {
				designFileId: trickroomMcpTestDesignUuid,
				expectedRevision: afterAddRevision,
				operation: "detachSystemComponent",
				parameters: {
					elementId: rootElementId,
				},
			},
		});
		expect(result.isError).not.toBe(true);
		expect(result.structuredContent).toMatchObject({
			status: "success",
			valid: true,
			operation: "detachSystemComponent",
			predicted: {
				elementId: rootElementId,
				systemComponent: {
					systemId,
					componentId,
					rootElementId,
				},
				changedElement: expect.objectContaining({
					id: rootElementId,
				}),
				detachedElementIds: expect.arrayContaining([rootElementId]),
			},
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
			name: "validateOperation",
			arguments: {
				designFileId: trickroomMcpTestDesignUuid,
				expectedRevision: revision,
				operation: "detachSystemComponent",
				parameters: {
					elementId: "",
				},
			},
		});
		expect(result.isError).toBe(true);
		expect(result.structuredContent).toMatchObject({
			status: "INVALID_OPERATION",
		});

		const persisted = await fixture.designFileService.readDesignFile(
			fixture.designFileService.getFileForUuid(trickroomMcpTestDesignUuid),
		);
		expect(persisted.revision).toBe(revision);
	});

	it("returns SYSTEM_COMPONENT_INSTANCE_NOT_FOUND through validateOperation for non-instance elements", async () => {
		const revision = await getDesignRevision();
		const result = await session.client.callTool({
			name: "validateOperation",
			arguments: {
				designFileId: trickroomMcpTestDesignUuid,
				expectedRevision: revision,
				operation: "detachSystemComponent",
				parameters: {
					elementId: "board",
				},
			},
		});
		expect(result.isError).toBe(true);
		expect(result.structuredContent).toMatchObject({
			status: "INVALID_OPERATION",
			code: "SYSTEM_COMPONENT_INSTANCE_NOT_FOUND",
		});

		const persisted = await fixture.designFileService.readDesignFile(
			fixture.designFileService.getFileForUuid(trickroomMcpTestDesignUuid),
		);
		expect(persisted.revision).toBe(revision);
	});

	it("chains addSystemComponent and detachSystemComponent in operation plans", async () => {
		const revision = await getDesignRevision();
		const result = await session.client.callTool({
			name: "validateOperationPlan",
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
			},
		});
		expect(result.isError).not.toBe(true);
		expect(result.structuredContent).toMatchObject({
			status: "success",
			valid: true,
		});
		const steps = (
			result.structuredContent as {
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
			name: "applyDesignOperations",
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
			},
		});
		expect(result.isError).not.toBe(true);
		expect(result.structuredContent).toMatchObject({
			status: "success",
			valid: true,
			operationCount: 2,
		});
		const steps = (
			result.structuredContent as {
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
		expect(result.structuredContent?.newRevision).not.toBe(revision);

		const persisted = await fixture.designFileService.readDesignFile(
			fixture.designFileService.getFileForUuid(trickroomMcpTestDesignUuid),
		);
		expect(persisted.revision).toBe(result.structuredContent?.newRevision);
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
			name: "applyDesignOperations",
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
		expect(result.structuredContent).toMatchObject({
			status: "invalid",
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
		const revisionAfterAdd = String(added.structuredContent?.newRevision);
		const rootElementId = String(
			(added.structuredContent as { changedElement: { id: string } })
				.changedElement.id,
		);
		await publishBadgeVersion("Badge v2");

		const result = await session.client.callTool({
			name: "migrateSystemComponentInstance",
			arguments: {
				designFileId: trickroomMcpTestDesignUuid,
				expectedRevision: revisionAfterAdd,
				rootElementId,
			},
		});

		expect(result.isError).not.toBe(true);
		expect(result.structuredContent).toMatchObject({
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
		const added = await session.client.callTool({
			name: "addSystemComponent",
			arguments: {
				designFileId: trickroomMcpTestDesignUuid,
				expectedRevision: revision,
				parentId: "board",
				index: 0,
				systemId,
				componentId,
				overrides: { rootTarget: { className: "rounded-md" } },
			},
		});
		const revisionAfterAdd = String(added.structuredContent?.newRevision);
		const rootElementId = String(
			(added.structuredContent as { changedElement: { id: string } })
				.changedElement.id,
		);

		const listed = await session.client.callTool({
			name: "listSystemComponents",
			arguments: { systemName: "Core" },
		});
		const updated = await session.client.callTool({
			name: "updateSystemComponentDraft",
			arguments: {
				systemName: "Core",
				componentId,
				expectedRevision: listed.structuredContent?.revision,
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
			name: "publishSystemComponent",
			arguments: {
				systemName: "Core",
				componentId,
				expectedRevision: updated.structuredContent?.revision,
			},
		});

		const result = await session.client.callTool({
			name: "migrateSystemComponentInstance",
			arguments: {
				designFileId: trickroomMcpTestDesignUuid,
				expectedRevision: revisionAfterAdd,
				rootElementId,
				onlySafe: true,
			},
		});

		expect(result.isError).not.toBe(true);
		expect(result.structuredContent).toMatchObject({
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
		const rootElementId = String(
			(added.structuredContent as { changedElement: { id: string } })
				.changedElement.id,
		);
		await publishBadgeVersion("Badge v2");

		const result = await session.client.callTool({
			name: "migrateSystemComponentInstance",
			arguments: {
				designFileId: trickroomMcpTestDesignUuid,
				expectedRevision: "sha256:stale-revision",
				rootElementId,
			},
		});

		expect(result.isError).toBe(true);
		expect(result.structuredContent).toMatchObject({
			status: "REVISION_MISMATCH",
		});
	});

	it("allows migrateSystemComponentInstance dry runs in read-only mode", async () => {
		const added = await addBadgeInstance();
		const revisionAfterAdd = String(added.structuredContent?.newRevision);
		const rootElementId = String(
			(added.structuredContent as { changedElement: { id: string } })
				.changedElement.id,
		);
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
			name: "migrateSystemComponentInstance",
			arguments: {
				designFileId: trickroomMcpTestDesignUuid,
				expectedRevision: revisionAfterAdd,
				rootElementId,
				dryRun: true,
			},
		});

		expect(result.isError).not.toBe(true);
		expect(result.structuredContent).toMatchObject({
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
		const revisionAfterAdd = String(added.structuredContent?.newRevision);
		const rootElementId = String(
			(added.structuredContent as { changedElement: { id: string } })
				.changedElement.id,
		);
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
			name: "migrateSystemComponentInstance",
			arguments: {
				designFileId: trickroomMcpTestDesignUuid,
				expectedRevision: revisionAfterAdd,
				rootElementId,
			},
		});

		expect(result.isError).toBe(true);
		expect(result.structuredContent).toMatchObject({
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
		const rootElementId = String(
			(added.structuredContent as { changedElement: { id: string } })
				.changedElement.id,
		);
		await publishBadgeVersion("Badge v2");

		const result = await session.client.callTool({
			name: "bulkMigrateSystemComponentUsages",
			arguments: {
				systemName: "Core",
				onlySafe: true,
			},
		});

		expect(result.isError).not.toBe(true);
		expect(result.structuredContent).toMatchObject({
			changedCount: 1,
			reviewRequiredCount: 0,
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
		const added = await session.client.callTool({
			name: "addSystemComponent",
			arguments: {
				designFileId: trickroomMcpTestDesignUuid,
				expectedRevision: revision,
				parentId: "board",
				index: 0,
				systemId,
				componentId,
				overrides: { rootTarget: { className: "rounded-md" } },
			},
		});
		const rootElementId = String(
			(added.structuredContent as { changedElement: { id: string } })
				.changedElement.id,
		);
		const revisionAfterAdd = String(added.structuredContent?.newRevision);

		const listed = await session.client.callTool({
			name: "listSystemComponents",
			arguments: { systemName: "Core" },
		});
		const updated = await session.client.callTool({
			name: "updateSystemComponentDraft",
			arguments: {
				systemName: "Core",
				componentId,
				expectedRevision: listed.structuredContent?.revision,
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
			name: "publishSystemComponent",
			arguments: {
				systemName: "Core",
				componentId,
				expectedRevision: updated.structuredContent?.revision,
			},
		});

		const result = await session.client.callTool({
			name: "bulkMigrateSystemComponentUsages",
			arguments: {
				systemName: "Core",
				onlySafe: true,
			},
		});

		expect(result.isError).not.toBe(true);
		expect(result.structuredContent).toMatchObject({
			changedCount: 0,
			reviewRequiredCount: 1,
			reviewRequired: [
				expect.objectContaining({
					designFileId: trickroomMcpTestDesignUuid,
					elementId: rootElementId,
					fromVersion: "1",
					toVersion: "2",
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
			name: "bulkMigrateSystemComponentUsages",
			arguments: { systemName: "Core" },
		});

		expect(result.isError).not.toBe(true);
		expect(result.structuredContent).toMatchObject({
			changedCount: 1,
			scannedDesignCount: 1,
			changed: [
				expect.objectContaining({
					designFileId: trickroomMcpTestDesignUuid,
				}),
			],
		});
		expect(
			(result.structuredContent as { changed: Array<{ designFileId: string }> })
				.changed,
		).not.toEqual(
			expect.arrayContaining([
				expect.objectContaining({ designFileId: secondDesignUuid }),
			]),
		);
	});

	it("denies migrateSystemComponentInstance dry runs when target subtree uses disallowed components", async () => {
		const added = await addBadgeInstance();
		const revisionAfterAdd = String(added.structuredContent?.newRevision);
		const rootElementId = String(
			(added.structuredContent as { changedElement: { id: string } })
				.changedElement.id,
		);
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
			name: "migrateSystemComponentInstance",
			arguments: {
				designFileId: trickroomMcpTestDesignUuid,
				expectedRevision: revisionAfterAdd,
				rootElementId,
				dryRun: true,
			},
		});

		expect(result.isError).toBe(true);
		expect(result.structuredContent).toMatchObject({
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
		const revisionAfterAdd = String(added.structuredContent?.newRevision);
		const rootElementId = String(
			(added.structuredContent as { changedElement: { id: string } })
				.changedElement.id,
		);
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
			name: "migrateSystemComponentInstance",
			arguments: {
				designFileId: trickroomMcpTestDesignUuid,
				expectedRevision: revisionAfterAdd,
				rootElementId,
			},
		});

		expect(result.isError).toBe(true);
		expect(result.structuredContent).toMatchObject({
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
		const revisionAfterAdd = String(added.structuredContent?.newRevision);
		const rootElementId = String(
			(added.structuredContent as { changedElement: { id: string } })
				.changedElement.id,
		);
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
			name: "bulkMigrateSystemComponentUsages",
			arguments: { systemName: "Core" },
		});

		expect(result.isError).not.toBe(true);
		expect(result.structuredContent).toMatchObject({
			changedCount: 0,
			skippedCount: 1,
			skipped: [
				expect.objectContaining({
					designFileId: trickroomMcpTestDesignUuid,
					elementId: rootElementId,
					reason: "component-not-allowed",
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
		const added = await addBadgeInstance();
		const rootElementId = String(
			(added.structuredContent as { changedElement: { id: string } })
				.changedElement.id,
		);
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
			name: "bulkMigrateSystemComponentUsages",
			arguments: { systemName: "Core" },
		});

		expect(result.isError).not.toBe(true);
		expect(result.structuredContent).toMatchObject({
			changedCount: 1,
			scannedDesignCount: 1,
			changed: [
				expect.objectContaining({
					designFileId: trickroomMcpTestDesignUuid,
					elementId: rootElementId,
				}),
			],
		});
		expect(
			(
				result.structuredContent as {
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
				result.structuredContent as {
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
		const revisionAfterAdd = String(added.structuredContent?.newRevision);
		const rootElementId = String(
			(added.structuredContent as { changedElement: { id: string } })
				.changedElement.id,
		);
		await publishBadgeVersion("Badge v2");

		const result = await session.client.callTool({
			name: "bulkMigrateSystemComponentUsages",
			arguments: {
				systemName: "Core",
				dryRun: true,
			},
		});

		expect(result.isError).not.toBe(true);
		expect(result.structuredContent).toMatchObject({
			dryRun: true,
			changedCount: 1,
			changed: [
				expect.objectContaining({
					designFileId: trickroomMcpTestDesignUuid,
					elementId: rootElementId,
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
		const revisionAfterAdd = String(added.structuredContent?.newRevision);
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
			name: "bulkMigrateSystemComponentUsages",
			arguments: {
				systemName: "Core",
				onlySafe: true,
			},
		});

		expect(result.isError).toBe(true);
		expect(result.structuredContent).toMatchObject({
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
		const revisionAfterAdd = String(added.structuredContent?.newRevision);
		const rootElementId = String(
			(added.structuredContent as { changedElement: { id: string } })
				.changedElement.id,
		);
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
			name: "bulkMigrateSystemComponentUsages",
			arguments: {
				systemName: "Core",
				dryRun: true,
			},
		});

		expect(result.isError).not.toBe(true);
		expect(result.structuredContent).toMatchObject({
			dryRun: true,
			changedCount: 1,
			changed: [
				expect.objectContaining({
					designFileId: trickroomMcpTestDesignUuid,
					elementId: rootElementId,
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
		const revisionAfterAdd = String(added.structuredContent?.newRevision);
		const rootElementId = String(
			(added.structuredContent as { changedElement: { id: string } })
				.changedElement.id,
		);
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
			name: "bulkMigrateSystemComponentUsages",
			arguments: {
				systemName: "Core",
				designFileId: trickroomMcpTestDesignUuid,
				dryRun: true,
			},
		});

		expect(result.isError).not.toBe(true);
		expect(result.structuredContent).toMatchObject({
			dryRun: true,
			designFileId: trickroomMcpTestDesignUuid,
			changedCount: 1,
			changed: [
				expect.objectContaining({
					designFileId: trickroomMcpTestDesignUuid,
					elementId: rootElementId,
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
		const revisionAfterAdd = String(added.structuredContent?.newRevision);
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
			name: "bulkMigrateSystemComponentUsages",
			arguments: {
				systemName: "Core",
				dryRun: true,
			},
		});

		expect(result.isError).not.toBe(true);
		expect(result.structuredContent).toMatchObject({
			dryRun: true,
			systemId,
			systemName: "Core",
			changedCount: 0,
			scannedDesignCount: 0,
			changed: [],
		});

		const persisted = await fixture.designFileService.readDesignFile(
			fixture.designFileService.getFileForUuid(trickroomMcpTestDesignUuid),
		);
		expect(persisted.revision).toBe(revisionAfterAdd);
	});

	it("allows allowlisted bulk migration dry runs in read-only mode", async () => {
		const added = await addBadgeInstance();
		const revisionAfterAdd = String(added.structuredContent?.newRevision);
		const rootElementId = String(
			(added.structuredContent as { changedElement: { id: string } })
				.changedElement.id,
		);
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
			name: "bulkMigrateSystemComponentUsages",
			arguments: {
				systemName: "Core",
				dryRun: true,
			},
		});

		expect(result.isError).not.toBe(true);
		expect(result.structuredContent).toMatchObject({
			dryRun: true,
			changedCount: 1,
			scannedDesignCount: 1,
			changed: [
				expect.objectContaining({
					designFileId: trickroomMcpTestDesignUuid,
					elementId: rootElementId,
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
			name: "bulkMigrateSystemComponentUsages",
			arguments: { systemName: "Core", designFileId: secondDesignUuid },
		});

		expect(result.isError).toBe(true);
		expect(result.structuredContent).toMatchObject({
			status: "POLICY_DENIED",
			code: "MCP_DESIGN_FILE_NOT_ALLOWED",
		});
	});
});
