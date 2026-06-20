import { describe, expect, it } from "vitest";
import {
	executeOperationPlanDryRun,
	resolveStepReferencesInParameters,
} from "./operation-plan";
import {
	createTrickroomMcpProjectFixture,
	trickroomMcpTestDesign,
	trickroomMcpTestDesignUuid,
} from "./test-support";
import { getMcpPolicy } from "./governance";
import type { TrickroomDesign } from "../types";

const targetDesignFileId = "10000000-0000-4000-8000-000000000021";
const targetDesign: TrickroomDesign = {
	name: "Copy Target",
	systemName: "Core",
	boards: [
		{
			id: "target-root",
			props: {
				"data-trickroom-name": "Target Root",
				"data-trickroom-library": "trickroom",
				"data-trickroom-component": "container",
				"data-trickroom-role": "branch",
			},
			children: [],
		},
	],
};

const createPlanDeps = async (
	fixture: Awaited<ReturnType<typeof createTrickroomMcpProjectFixture>>,
) => {
	const context = await fixture.readMcpContext();
	const policy = getMcpPolicy(context.config);
	const { createOperationPlanDependencies } = await import("./operation-plan");
	return createOperationPlanDependencies(context, policy, {
		readDesignFileForTool: async (designFileId) => {
			const file = fixture.designFileService.getFileForUuid(designFileId);
			return fixture.designFileService.readDesignFile(file);
		},
		getProjectReference: () => ({
			projectId: context.config.projectId ?? null,
			locationId: context.locationId ?? null,
			projectRoot: context.projectRoot,
			name: context.config.name,
		}),
		getDesignMetadata: (designFileId, designRead) => ({
			id: designFileId,
			file: designRead.file,
			name: designRead.design.name,
			revision: designRead.revision,
		}),
		getDesignDiagnostics: async () => ({ issues: [], tokenSnapshot: null }),
		assertResourceReferencesExist: async () => {},
		assertCanUseSubtreeComponents: () => {},
		canonicalizeDesignForStorage: async (design) => design,
	});
};

describe("resolveStepReferencesInParameters", () => {
	it("preserves literal text values that look like step references", () => {
		const resolved = resolveStepReferencesInParameters(
			{
				elementId: "title",
				text: "$step:0",
			},
			[
				{
					stepIndex: 0,
					operation: "addElement",
					summary: {},
					changedElementId: "generated-id",
				},
			],
		);

		expect(resolved).toEqual({
			elementId: "title",
			text: "$step:0",
		});
	});
});

describe("executeOperationPlanDryRun", () => {
	it("validates add + update chains with step references", async () => {
		const fixture = await createTrickroomMcpProjectFixture({
			designs: {
				[trickroomMcpTestDesignUuid]: trickroomMcpTestDesign,
			},
		});
		const read = await fixture.designFileService.readDesignFile(
			fixture.designFileService.getFileForUuid(trickroomMcpTestDesignUuid),
		);
		const deps = await createPlanDeps(fixture);

		const result = await executeOperationPlanDryRun(deps, {
			designFileId: trickroomMcpTestDesignUuid,
			expectedRevision: read.revision,
			operations: [
				{
					operation: "addElement",
					parameters: {
						parentId: "board",
						index: 1,
						library: "trickroom",
						component: "text",
						name: "Footer",
						text: "Footer text",
					},
				},
				{
					operation: "updateElementText",
					parameters: {
						elementId: "$step:0",
						text: "Updated footer",
					},
				},
			],
		});

		expect(result).toMatchObject({
			status: "success",
			valid: true,
			operationCount: 2,
		});

		await fixture.cleanup();
	});

	it("requires sourceExpectedRevision on every cross-file copySubtree step", async () => {
		const fixture = await createTrickroomMcpProjectFixture({
			designs: {
				[trickroomMcpTestDesignUuid]: trickroomMcpTestDesign,
				[targetDesignFileId]: targetDesign,
			},
		});
		const sourceRead = await fixture.designFileService.readDesignFile(
			fixture.designFileService.getFileForUuid(trickroomMcpTestDesignUuid),
		);
		const targetRead = await fixture.designFileService.readDesignFile(
			fixture.designFileService.getFileForUuid(targetDesignFileId),
		);
		const deps = await createPlanDeps(fixture);

		const firstCopy = await executeOperationPlanDryRun(deps, {
			designFileId: targetDesignFileId,
			expectedRevision: targetRead.revision,
			operations: [
				{
					operation: "copySubtree",
					parameters: {
						sourceDesignFileId: trickroomMcpTestDesignUuid,
						sourceElementId: "title",
						sourceExpectedRevision: sourceRead.revision,
						parentId: "target-root",
						index: 0,
					},
				},
			],
		});
		expect(firstCopy.status).toBe("success");

		const missingRevision = await executeOperationPlanDryRun(deps, {
			designFileId: targetDesignFileId,
			expectedRevision: targetRead.revision,
			operations: [
				{
					operation: "copySubtree",
					parameters: {
						sourceDesignFileId: trickroomMcpTestDesignUuid,
						sourceElementId: "title",
						sourceExpectedRevision: sourceRead.revision,
						parentId: "target-root",
						index: 0,
					},
				},
				{
					operation: "copySubtree",
					parameters: {
						sourceDesignFileId: trickroomMcpTestDesignUuid,
						sourceElementId: "title",
						parentId: "target-root",
						index: 1,
					},
				},
			],
		});
		expect(missingRevision).toMatchObject({
			status: "invalid",
			failedStepIndex: 1,
			failedOperation: "copySubtree",
			issues: [{ code: "SOURCE_REVISION_REQUIRED" }],
		});

		const staleRevision = await executeOperationPlanDryRun(deps, {
			designFileId: targetDesignFileId,
			expectedRevision: targetRead.revision,
			operations: [
				{
					operation: "copySubtree",
					parameters: {
						sourceDesignFileId: trickroomMcpTestDesignUuid,
						sourceElementId: "title",
						sourceExpectedRevision: sourceRead.revision,
						parentId: "target-root",
						index: 0,
					},
				},
				{
					operation: "copySubtree",
					parameters: {
						sourceDesignFileId: trickroomMcpTestDesignUuid,
						sourceElementId: "title",
						sourceExpectedRevision: "sha256:deadbeef",
						parentId: "target-root",
						index: 1,
					},
				},
			],
		});
		expect(staleRevision).toMatchObject({
			status: "SOURCE_REVISION_MISMATCH",
			failedStepIndex: 1,
			failedOperation: "copySubtree",
		});

		await fixture.cleanup();
	});
});
