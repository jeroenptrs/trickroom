import { describe, expect, it } from "vitest";
import type { TrickroomDesign } from "../types";
import { getMcpPolicy } from "./governance";
import {
	describeCreatedElements,
	executeOperationPlan,
	type OperationPlanDependencies,
	resolveStepReferencesInParameters,
} from "./operation-plan";
import {
	createTrickroomMcpProjectFixture,
	trickroomMcpTestDesign,
	trickroomMcpTestDesignUuid,
} from "./test-support";

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
): Promise<OperationPlanDependencies> => {
	const context = await fixture.readMcpContext();
	return {
		policy: getMcpPolicy(context.config),
		projectRoot: context.projectRoot,
		readDesignFile: async (designFileId) =>
			fixture.designFileService.readDesignFile(designFileId),
		assertResourceReferencesExist: async () => {},
		assertCanUseSubtreeComponents: () => {},
	};
};

const readDesign = (
	fixture: Awaited<ReturnType<typeof createTrickroomMcpProjectFixture>>,
	designFileId: string,
) => fixture.designFileService.readDesignFile(designFileId);

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

describe("step references", () => {
	const steps = [
		{
			stepIndex: 0,
			operation: "addSubtree" as const,
			summary: {},
			changedElementId: "card-id",
			rootElementId: "card-id",
			idMap: { card: "card-id", first: "first-root", second: "second-root" },
			recipes: [
				{
					tempId: "first",
					recipeId: "base-ui/dialog.default",
					rootElementId: "first-root",
					slots: { content: "first-content", trigger: "first-trigger" },
				},
				{
					tempId: "second",
					recipeId: "base-ui/dialog.default",
					rootElementId: "second-root",
					slots: { content: "second-content", trigger: "second-trigger" },
				},
			],
		},
		{
			stepIndex: 1,
			operation: "addRecipe" as const,
			summary: {},
			changedElementId: "menu-root",
			recipes: [
				{
					recipeId: "base-ui/menu.default",
					rootElementId: "menu-root",
					slots: { items: "menu-items" },
				},
			],
		},
	];

	it("resolves tempIds, slots, and tempId-qualified slots", () => {
		expect(
			resolveStepReferencesInParameters(
				{
					elementId: "$step:0:tempId:card",
					parentId: "$step:1:slot:items",
					targetParentId: "$step:0:tempId:second:slot:content",
				},
				steps,
			),
		).toEqual({
			elementId: "card-id",
			parentId: "menu-items",
			targetParentId: "second-content",
		});
	});

	it("rejects ambiguous slots with the qualified form", () => {
		expect(() =>
			resolveStepReferencesInParameters(
				{ parentId: "$step:0:slot:content" },
				steps,
			),
		).toThrow(/\$step:0:tempId:<recipeTempId>:slot:content/u);
	});

	it("lists available tempIds and slots for unresolvable references", () => {
		expect(() =>
			resolveStepReferencesInParameters(
				{ parentId: "$step:0:tempId:missing" },
				steps,
			),
		).toThrow(/Available tempIds: card, first, second/u);
		expect(() =>
			resolveStepReferencesInParameters(
				{ parentId: "$step:1:slot:content" },
				steps,
			),
		).toThrow(/Available slots: items/u);
		expect(() =>
			resolveStepReferencesInParameters({ parentId: "$step:x" }, steps),
		).toThrow(/malformed/u);
	});
});

describe("executeOperationPlan", () => {
	it("runs add + update chains with step references", async () => {
		const fixture = await createTrickroomMcpProjectFixture({
			designs: {
				[trickroomMcpTestDesignUuid]: trickroomMcpTestDesign,
			},
		});
		const read = await readDesign(fixture, trickroomMcpTestDesignUuid);
		const deps = await createPlanDeps(fixture);

		const result = await executeOperationPlan(
			deps,
			{
				designFileId: trickroomMcpTestDesignUuid,
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
			},
			read.design,
		);

		expect(result.status).toBe("success");
		if (result.status !== "success") throw new Error("plan failed");
		const footerId = result.steps[0].changedElementId;
		expect(result.affectedElementIds).toEqual([footerId]);
		expect(describeCreatedElements(result.steps[0])).toEqual({
			step: 0,
			id: footerId,
		});
		expect(describeCreatedElements(result.steps[1])).toBeNull();

		await fixture.cleanup();
	});

	it("reports every invalid and unknown parameter of the failing step", async () => {
		const fixture = await createTrickroomMcpProjectFixture({
			designs: {
				[trickroomMcpTestDesignUuid]: trickroomMcpTestDesign,
			},
		});
		const read = await readDesign(fixture, trickroomMcpTestDesignUuid);
		const deps = await createPlanDeps(fixture);

		const result = await executeOperationPlan(
			deps,
			{
				designFileId: trickroomMcpTestDesignUuid,
				operations: [
					{
						operation: "addSubtree",
						parameters: { parentId: "board", position: 0 },
					},
				],
			},
			read.design,
		);

		expect(result).toMatchObject({
			status: "failed",
			failedStepIndex: 0,
			failedOperation: "addSubtree",
		});
		if (result.status !== "failed") throw new Error("plan passed");
		expect(result.error.code).toBe("INVALID_OPERATION_PARAMETERS");
		expect(result.error.message).toBe(
			'Operation "addSubtree" parameters are invalid: "index" is required; "subtree" is required. Unknown parameters: position.',
		);
		expect(result.error.details).toMatchObject({
			unknownParameters: ["position"],
			expectedParameters: expect.stringContaining("index: int"),
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
		const sourceRead = await readDesign(fixture, trickroomMcpTestDesignUuid);
		const targetRead = await readDesign(fixture, targetDesignFileId);
		const deps = await createPlanDeps(fixture);
		const copyStep = (index: number, sourceExpectedRevision?: string) => ({
			operation: "copySubtree" as const,
			parameters: {
				sourceDesignFileId: trickroomMcpTestDesignUuid,
				sourceElementId: "title",
				...(sourceExpectedRevision ? { sourceExpectedRevision } : {}),
				parentId: "target-root",
				index,
			},
		});

		const firstCopy = await executeOperationPlan(
			deps,
			{
				designFileId: targetDesignFileId,
				operations: [copyStep(0, sourceRead.revision)],
			},
			targetRead.design,
		);
		expect(firstCopy.status).toBe("success");
		if (firstCopy.status !== "success") throw new Error("copy failed");
		expect(describeCreatedElements(firstCopy.steps[0])).toEqual({
			step: 0,
			id: firstCopy.steps[0].rootElementId,
			nodeCount: 1,
		});
		expect(describeCreatedElements(firstCopy.steps[0], "full")).toMatchObject({
			idMap: { title: firstCopy.steps[0].rootElementId },
		});

		const missingRevision = await executeOperationPlan(
			deps,
			{
				designFileId: targetDesignFileId,
				operations: [copyStep(0, sourceRead.revision), copyStep(1)],
			},
			targetRead.design,
		);
		expect(missingRevision).toMatchObject({
			status: "failed",
			failedStepIndex: 1,
			failedOperation: "copySubtree",
			error: { code: "SOURCE_REVISION_REQUIRED" },
		});

		const staleRevision = await executeOperationPlan(
			deps,
			{
				designFileId: targetDesignFileId,
				operations: [
					copyStep(0, sourceRead.revision),
					copyStep(1, "sha256:deadbeef"),
				],
			},
			targetRead.design,
		);
		expect(staleRevision).toMatchObject({
			status: "failed",
			failedStepIndex: 1,
			failedOperation: "copySubtree",
			error: {
				code: "SOURCE_REVISION_MISMATCH",
				details: {
					currentSourceRevision: sourceRead.revision,
					sourceExpectedRevision: "sha256:deadbeef",
				},
			},
		});

		await fixture.cleanup();
	});
});
