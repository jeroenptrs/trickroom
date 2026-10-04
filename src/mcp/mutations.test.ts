import { readFile } from "node:fs/promises";
import path from "node:path";
import { ResourceListChangedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, describe, expect, it } from "vitest";
import { expandRegistryRecipe } from "../recipes/expansion";
import { installAvatarLegacyPreviousTemplate } from "../recipes/legacy-avatar-template";
import {
	getRecipeMarkerProps,
	recipeInstanceProp,
	recipePathProp,
} from "../recipes/markers";
import type { Node, TrickroomDesign } from "../types";
import { assetIdProp } from "../utils/resource-props";
import { splitIntroducedErrors } from "./payloads/design-validation";
import {
	addSubtreeOptionsSchema,
	addSubtreePayloadSchema,
	proposedRecipeNodeSchema,
	validateSubtreePayload,
	validateSubtreePayloadSchema,
} from "./server";
import {
	applyOperation,
	createTrickroomMcpProjectFixture,
	createTrickroomMcpTestClient,
	readElementPayload,
	toolPayload,
	trickroomMcpTestDesign,
	trickroomMcpTestDesignUuid,
} from "./test-support";

describe("MCP mutation tools", () => {
	const fixtures: Array<{ cleanup: () => Promise<void> }> = [];

	afterEach(async () => {
		await Promise.all(fixtures.splice(0).map((f) => f.cleanup()));
	});

	const setup = async (designs?: Record<string, TrickroomDesign>) => {
		const fixture = await createTrickroomMcpProjectFixture({
			designs: designs ?? {
				[trickroomMcpTestDesignUuid]: trickroomMcpTestDesign,
			},
		});
		fixtures.push(fixture);
		const context = await fixture.readMcpContext();
		const session = await createTrickroomMcpTestClient(context);
		return { fixture, context, session };
	};

	const setupWithNotificationClient = async (
		designs?: Record<string, TrickroomDesign>,
	) => {
		const fixture = await createTrickroomMcpProjectFixture({
			designs: designs ?? {
				[trickroomMcpTestDesignUuid]: trickroomMcpTestDesign,
			},
		});
		fixtures.push(fixture);
		const context = await fixture.readMcpContext();
		const session = await createTrickroomMcpTestClient(context, {
			clientCapabilities: { resources: { listChanged: true } },
		});
		const notifications: string[] = [];
		session.client.setNotificationHandler(
			ResourceListChangedNotificationSchema,
			() => {
				notifications.push("resource-list-changed");
			},
		);
		return { fixture, context, session, notifications };
	};

	const getRevision = async (
		session: Awaited<ReturnType<typeof setup>>["session"],
		designFileId: string,
	): Promise<string> => {
		const result = await session.client.callTool({
			name: "design_read",
			arguments: { designFileId },
		});
		const content = toolPayload(result) as {
			designFile: { revision: string };
		};
		return content.designFile.revision;
	};

	const avatarRecipeMcpDesign = (): TrickroomDesign => ({
		name: "Recipe Harness Design",
		systemName: "Core",
		boards: [
			{
				id: "avatar-root",
				props: {
					"data-trickroom-name": "Avatar Root",
					"data-trickroom-library": "base-ui",
					"data-trickroom-component": "avatar.root",
					"data-trickroom-role": "branch",
					...getRecipeMarkerProps({
						recipeId: "base-ui/avatar.default",
						instanceId: "recipe-instance-1",
						path: "root",
						isRoot: true,
					}),
				},
				children: [
					{
						id: "avatar-image",
						props: {
							"data-trickroom-name": "Avatar Image",
							"data-trickroom-library": "base-ui",
							"data-trickroom-component": "avatar.image",
							"data-trickroom-role": "leaf",
							[assetIdProp]: "",
							alt: "",
							...getRecipeMarkerProps({
								recipeId: "base-ui/avatar.default",
								instanceId: "recipe-instance-1",
								path: "image",
							}),
						},
						children: [],
					},
					{
						id: "avatar-fallback",
						props: {
							"data-trickroom-name": "Avatar Fallback",
							"data-trickroom-library": "base-ui",
							"data-trickroom-component": "avatar.fallback",
							"data-trickroom-role": "branch",
							...getRecipeMarkerProps({
								recipeId: "base-ui/avatar.default",
								instanceId: "recipe-instance-1",
								path: "fallback",
								slotName: "fallback",
							}),
						},
						children: [
							{
								id: "slot-child",
								props: {
									"data-trickroom-name": "Slot Child",
									"data-trickroom-library": "trickroom",
									"data-trickroom-component": "container",
									"data-trickroom-role": "branch",
								},
								children: [],
							},
						],
					},
				],
			},
		],
	});

	const staleAvatarRecipeMcpDesign = (): TrickroomDesign => {
		const design = avatarRecipeMcpDesign();
		const root = design.boards[0];
		const fallback = (root.children as Node[])[1];
		fallback.props = {
			...fallback.props,
			...getRecipeMarkerProps({
				recipeId: "base-ui/avatar.default",
				instanceId: "recipe-instance-1",
				path: "legacy-fallback",
				slotName: "fallback",
			}),
		};
		root.children = [fallback];
		return design;
	};

	const withAvatarLegacyPreviousTemplate = async <T>(
		fn: () => Promise<T> | T,
	) => {
		const restoreAvatarLegacyPreviousTemplate =
			installAvatarLegacyPreviousTemplate();
		try {
			return await fn();
		} finally {
			restoreAvatarLegacyPreviousTemplate();
		}
	};

	describe("tool annotations", () => {
		it("validateSubtree uses read-only closed-world annotations", async () => {
			const { session } = await setup();
			try {
				const listResult = await session.client.listTools();
				const toolsByName = new Map(
					listResult.tools.map((tool) => [tool.name, tool]),
				);

				for (const name of ["validateSubtree", "validateCopySubtree"]) {
					const tool = toolsByName.get(name);
					expect(tool, `tool ${name} should exist`).toBeDefined();
					expect(tool?.annotations?.readOnlyHint).toBe(true);
					expect(tool?.annotations?.openWorldHint).toBe(false);
				}
			} finally {
				await session.close();
			}
		});

		it("mutation tools have non-read-only closed-world annotations", async () => {
			const { session } = await setup();
			try {
				const listResult = await session.client.listTools();
				const toolsByName = new Map(
					listResult.tools.map((tool) => [tool.name, tool]),
				);

				for (const name of [
					"addSystemIconFolder",
					"removeSystemIconFolder",
					"addSystemAsset",
					"removeSystemAsset",
					"refreshSystemAssetMetadata",
					"createDesignFile",
					"extractSubtree",
					"design_apply",
					"migrateSystemComponentInstance",
					"bulkMigrateSystemComponentUsages",
				]) {
					const tool = toolsByName.get(name);
					expect(tool, `tool ${name} should exist`).toBeDefined();
					expect(tool?.annotations?.readOnlyHint).toBe(false);
					expect(tool?.annotations?.openWorldHint).toBe(false);
				}

				expect(
					toolsByName.get("createDesignFile")?.annotations?.destructiveHint,
				).toBe(false);
				expect(
					toolsByName.get("extractSubtree")?.annotations?.destructiveHint,
				).toBe(false);
				// One write tool covers deletes and detaches, so it is destructive.
				expect(toolsByName.get("design_apply")?.annotations).toMatchObject({
					destructiveHint: true,
					idempotentHint: false,
				});
			} finally {
				await session.close();
			}
		});
	});

	describe("subtree validation foundation", () => {
		it("returns valid:false for resource and design diagnostics via MCP tool", async () => {
			const { session } = await setup();
			try {
				const revision = await getRevision(session, trickroomMcpTestDesignUuid);
				const result = await session.client.callTool({
					name: "validateSubtree",
					arguments: {
						designFileId: trickroomMcpTestDesignUuid,
						expectedRevision: revision,
						parentId: "board",
						index: 1,
						subtree: {
							library: "trickroom",
							component: "asset",
							props: {
								[assetIdProp]: "missing-asset",
							},
						},
					},
				});

				expect(result.isError).toBeFalsy();
				const content = toolPayload(result) as {
					status: string;
					valid: boolean;
					issues: Array<{ code: string }>;
				};
				expect(content.status).toBe("success");
				expect(content.valid).toBe(false);
				expect(content.issues).toContainEqual(
					expect.objectContaining({ code: "UNKNOWN_ASSET_ID" }),
				);

				expect(await getRevision(session, trickroomMcpTestDesignUuid)).toBe(
					revision,
				);
			} finally {
				await session.close();
			}
		});

		it("keeps proposed subtree schemas closed", () => {
			expect(
				validateSubtreePayloadSchema.safeParse({
					designFileId: trickroomMcpTestDesignUuid,
					expectedRevision: "sha256:test",
					parentId: null,
					index: 0,
					subtree: {
						id: "client-controlled-id",
						library: "trickroom",
						component: "container",
					},
				}).success,
			).toBe(false);

			expect(
				validateSubtreePayloadSchema.safeParse({
					designFileId: trickroomMcpTestDesignUuid,
					expectedRevision: "sha256:test",
					parentId: null,
					index: 0,
					subtree: {
						library: "trickroom",
						component: "container",
						unknown: true,
					},
				}).success,
			).toBe(false);

			expect(
				proposedRecipeNodeSchema.safeParse({
					kind: "recipe",
					library: "base-ui",
					recipe: "avatar.default",
					children: [],
				}).success,
			).toBe(false);
		});

		it("keeps addSubtree options limited to mutation-supported fields", () => {
			expect(
				addSubtreeOptionsSchema.safeParse({
					maxNodes: 10,
					maxDepth: 4,
					allowRecipes: true,
				}).success,
			).toBe(true);

			expect(
				addSubtreePayloadSchema.safeParse({
					designFileId: trickroomMcpTestDesignUuid,
					expectedRevision: "sha256:test",
					parentId: null,
					index: 0,
					subtree: {
						library: "trickroom",
						component: "container",
					},
					options: {
						includeNormalizedTree: true,
					},
				}).success,
			).toBe(false);
		});

		it("validates resource and design diagnostics against an in-memory candidate", async () => {
			const { context, session } = await setup();
			try {
				const revision = await getRevision(session, trickroomMcpTestDesignUuid);
				const result = await validateSubtreePayload(context, {
					designFileId: trickroomMcpTestDesignUuid,
					expectedRevision: revision,
					parentId: "board",
					index: 1,
					subtree: {
						library: "trickroom",
						component: "asset",
						props: {
							[assetIdProp]: "missing-asset",
						},
					},
				});

				expect(result.status).toBe("success");
				expect(result.valid).toBe(false);
				expect(result.issues).toContainEqual(
					expect.objectContaining({
						severity: "error",
						code: "UNKNOWN_ASSET_ID",
					}),
				);
				expect(await getRevision(session, trickroomMcpTestDesignUuid)).toBe(
					revision,
				);
			} finally {
				await session.close();
			}
		});
	});

	describe("addSubtree", () => {
		it("adds a validated subtree and returns rich insertion metadata", async () => {
			const { session } = await setup();
			try {
				const revision = await getRevision(session, trickroomMcpTestDesignUuid);

				const result = await applyOperation(session.client, "addSubtree", {
					designFileId: trickroomMcpTestDesignUuid,
					expectedRevision: revision,
					parentId: "board",
					index: 1,
					subtree: {
						tempId: "inserted-container",
						kind: "element",
						library: "trickroom",
						component: "container",
						props: {
							"data-trickroom-name": "Inserted Container",
						},
						children: [
							{
								tempId: "inserted-title",
								kind: "element",
								library: "trickroom",
								component: "text",
								props: {
									"data-trickroom-name": "Inserted Title",
								},
								text: "Inserted text",
							},
						],
					},
				});

				expect(result.isError).toBeFalsy();
				const content = toolPayload(result);
				expect(content.status).toBe("success");
				expect(content.newRevision).toEqual(expect.any(String));
				expect(content.newRevision).not.toBe(revision);
				// The inserted root and the tempId map, nothing else.
				expect(content.created).toEqual([
					{
						step: 0,
						id: expect.any(String),
						idMap: {
							"inserted-container": expect.any(String),
							"inserted-title": expect.any(String),
						},
					},
				]);
				const [created] = content.created;
				expect(created.idMap["inserted-container"]).toBe(created.id);
				// Minimal-default contract: writes echo error-severity issues only,
				// never warnings, unless escalated.
				expect(Array.isArray(content.issues)).toBe(true);
				expect(content).not.toHaveProperty("warnings");
				const inserted = await readElementPayload(
					session.client,
					trickroomMcpTestDesignUuid,
					created.id,
				);
				expect(inserted.context).toMatchObject({ parentId: "board", index: 1 });
				expect(inserted.subtree.childIds).toEqual([
					created.idMap["inserted-title"],
				]);

				const boardResult = await session.client.callTool({
					name: "design_read",
					arguments: {
						depth: 0,
						designFileId: trickroomMcpTestDesignUuid,
						elementId: "board",
					},
				});
				const boardContent = toolPayload(boardResult) as {
					subtree: { childIds: string[] };
				};
				expect(boardContent.subtree.childIds[1]).toBe(created.id);

				expect(await getRevision(session, trickroomMcpTestDesignUuid)).toBe(
					content.newRevision,
				);
			} finally {
				await session.close();
			}
		});

		it("returns REVISION_MISMATCH on stale revision", async () => {
			const { fixture, session } = await setup();
			try {
				const original = await fixture.designFileService.readDesignFile(
					fixture.designFileService.getFileForUuid(trickroomMcpTestDesignUuid),
				);
				const staleRevision =
					"sha256:0000000000000000000000000000000000000000000000000000000000000000";

				const result = await applyOperation(session.client, "addSubtree", {
					designFileId: trickroomMcpTestDesignUuid,
					expectedRevision: staleRevision,
					parentId: "board",
					index: 1,
					subtree: {
						library: "trickroom",
						component: "container",
					},
				});

				expect(result.isError).toBe(true);
				const content = toolPayload(result) as { status: string };
				expect(content.status).toBe("REVISION_MISMATCH");
				const persisted = await fixture.designFileService.readDesignFile(
					fixture.designFileService.getFileForUuid(trickroomMcpTestDesignUuid),
				);
				expect(persisted.revision).toBe(original.revision);
				expect(persisted.design).toEqual(original.design);
			} finally {
				await session.close();
			}
		});

		it("enforces target design and every proposed component allowlist", async () => {
			const deniedDesignFixture = await createTrickroomMcpProjectFixture({
				config: {
					mcp: {
						enabled: true,
						allowedDesignFileIds: ["10000000-0000-4000-8000-000000000099"],
					},
				},
			});
			fixtures.push(deniedDesignFixture);
			const deniedDesignSession = await createTrickroomMcpTestClient(
				await deniedDesignFixture.readMcpContext(),
			);
			try {
				const read = await deniedDesignFixture.designFileService.readDesignFile(
					deniedDesignFixture.designFileService.getFileForUuid(
						trickroomMcpTestDesignUuid,
					),
				);
				const result = await applyOperation(
					deniedDesignSession.client,
					"addSubtree",
					{
						designFileId: trickroomMcpTestDesignUuid,
						expectedRevision: read.revision,
						parentId: "board",
						index: 1,
						subtree: {
							library: "trickroom",
							component: "container",
						},
					},
				);
				expect(result.isError).toBe(true);
				expect(toolPayload(result)).toMatchObject({
					status: "POLICY_DENIED",
					code: "MCP_DESIGN_FILE_NOT_ALLOWED",
				});
			} finally {
				await deniedDesignSession.close();
			}

			const componentFixture = await createTrickroomMcpProjectFixture({
				config: {
					mcp: {
						enabled: true,
						allowedComponents: ["trickroom/container"],
					},
				},
			});
			fixtures.push(componentFixture);
			const componentSession = await createTrickroomMcpTestClient(
				await componentFixture.readMcpContext(),
			);
			try {
				const revision = await getRevision(
					componentSession,
					trickroomMcpTestDesignUuid,
				);
				const result = await applyOperation(
					componentSession.client,
					"addSubtree",
					{
						designFileId: trickroomMcpTestDesignUuid,
						expectedRevision: revision,
						parentId: "board",
						index: 1,
						subtree: {
							library: "trickroom",
							component: "container",
							children: [
								{
									library: "trickroom",
									component: "text",
									text: "Denied child",
								},
							],
						},
					},
				);
				expect(result.isError).toBe(true);
				expect(toolPayload(result)).toMatchObject({
					status: "POLICY_DENIED",
					code: "MCP_COMPONENT_NOT_ALLOWED",
				});
			} finally {
				await componentSession.close();
			}
		});

		it("writes audit log entries for addSubtree attempts", async () => {
			const fixture = await createTrickroomMcpProjectFixture({
				config: {
					mcp: {
						enabled: true,
						auditLog: true,
					},
				},
			});
			fixtures.push(fixture);
			const session = await createTrickroomMcpTestClient(
				await fixture.readMcpContext(),
			);
			try {
				const revision = await getRevision(session, trickroomMcpTestDesignUuid);

				const result = await applyOperation(session.client, "addSubtree", {
					designFileId: trickroomMcpTestDesignUuid,
					expectedRevision: revision,
					parentId: "board",
					index: 1,
					subtree: {
						library: "trickroom",
						component: "text",
						text: "Logged add",
					},
				});
				expect(result.isError).toBeFalsy();

				const content = toolPayload(result) as { newRevision: string };
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
						toolName: "design_apply",
						operation: "addSubtree",
						designFileId: trickroomMcpTestDesignUuid,
						expectedRevision: revision,
						success: true,
						status: "success",
						resultingRevision: content.newRevision,
						details: { operationCount: 1, operations: ["addSubtree"] },
					}),
				);

				const latestRevision = await getRevision(
					session,
					trickroomMcpTestDesignUuid,
				);
				const failed = await applyOperation(session.client, "addSubtree", {
					designFileId: trickroomMcpTestDesignUuid,
					expectedRevision: latestRevision,
					parentId: "missing-parent",
					index: 0,
					subtree: {
						library: "trickroom",
						component: "text",
						text: "Failed add",
					},
				});
				expect(failed.isError).toBe(true);

				const updatedAuditLog = await readFile(
					path.join(fixture.projectRoot, ".trickroom", "audit-log.jsonl"),
					"utf8",
				);
				const updatedEntries = updatedAuditLog
					.trim()
					.split("\n")
					.map((line) => JSON.parse(line) as Record<string, unknown>);
				expect(updatedEntries).toContainEqual(
					expect.objectContaining({
						toolName: "design_apply",
						operation: "addSubtree",
						designFileId: trickroomMcpTestDesignUuid,
						expectedRevision: latestRevision,
						success: false,
						status: "INVALID_OPERATION",
						code: "PARENT_NOT_FOUND",
					}),
				);
			} finally {
				await session.close();
			}
		});
	});

	describe("copySubtree", () => {
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

		it("validates same-file copies without writing or predicting stale target revisions", async () => {
			const { session } = await setup();
			try {
				const revision = await getRevision(session, trickroomMcpTestDesignUuid);
				const result = await session.client.callTool({
					name: "validateCopySubtree",
					arguments: {
						sourceDesignFileId: trickroomMcpTestDesignUuid,
						sourceElementId: "title",
						targetDesignFileId: trickroomMcpTestDesignUuid,
						expectedRevision: revision,
						parentId: "board",
						index: 1,
					},
				});

				expect(result.isError).toBeFalsy();
				expect(toolPayload(result)).toMatchObject({
					status: "success",
					valid: true,
					designFileId: trickroomMcpTestDesignUuid,
					sameDesign: true,
					stats: { nodeCount: 1, maxDepth: 1 },
				});
				expect(toolPayload(result)).not.toHaveProperty("idMap");
				expect(toolPayload(result)).not.toHaveProperty("inserted");
				expect(toolPayload(result)).not.toHaveProperty("changedElement");
				expect(toolPayload(result)).not.toHaveProperty("context");
				expect(await getRevision(session, trickroomMcpTestDesignUuid)).toBe(
					revision,
				);
			} finally {
				await session.close();
			}
		});

		it("copies same-file subtrees with generated ids and returns insertion context", async () => {
			const { session } = await setup();
			try {
				const revision = await getRevision(session, trickroomMcpTestDesignUuid);
				const result = await applyOperation(session.client, "copySubtree", {
					sourceDesignFileId: trickroomMcpTestDesignUuid,
					sourceElementId: "title",
					designFileId: trickroomMcpTestDesignUuid,
					expectedRevision: revision,
					parentId: "board",
					index: 1,
				});

				expect(result.isError).toBeFalsy();
				const content = toolPayload(result);
				expect(content.newRevision).toEqual(expect.any(String));
				// Defaults to root id and count; the id map is opt-in.
				expect(content.created).toEqual([
					{ step: 0, id: expect.any(String), nodeCount: 1 },
				]);
				const copyId = content.created[0].id;
				expect(copyId).not.toBe("title");

				const withMap = await applyOperation(session.client, "copySubtree", {
					designFileId: trickroomMcpTestDesignUuid,
					expectedRevision: content.newRevision,
					sourceElementId: "title",
					parentId: "board",
					index: 2,
					includeIdMap: true,
				});
				const [mapped] = toolPayload(withMap).created;
				expect(mapped.idMap).toEqual({ title: mapped.id });

				const copied = await session.client.callTool({
					name: "design_read",
					arguments: {
						depth: 0,
						detail: "full",
						designFileId: trickroomMcpTestDesignUuid,
						elementId: copyId,
					},
				});
				expect(toolPayload(copied)).toMatchObject({
					subtree: {
						id: copyId,
						props: {
							"data-trickroom-name": "Title Copy",
						},
						text: "Harness fixture",
					},
				});
			} finally {
				await session.close();
			}
		});

		it("requires sourceExpectedRevision for cross-file validation", async () => {
			const { session } = await setup({
				[trickroomMcpTestDesignUuid]: trickroomMcpTestDesign,
				[targetDesignFileId]: targetDesign,
			});
			try {
				const targetRevision = await getRevision(session, targetDesignFileId);
				const result = await session.client.callTool({
					name: "validateCopySubtree",
					arguments: {
						sourceDesignFileId: trickroomMcpTestDesignUuid,
						sourceElementId: "title",
						targetDesignFileId,
						expectedRevision: targetRevision,
						parentId: "target-root",
						index: 0,
					},
				});

				expect(result.isError).toBeFalsy();
				expect(toolPayload(result)).toMatchObject({
					status: "INVALID_OPERATION",
					valid: false,
					failedStepIndex: 0,
					failedOperation: "copySubtree",
					issues: [
						expect.objectContaining({
							code: "SOURCE_REVISION_REQUIRED",
						}),
					],
				});
			} finally {
				await session.close();
			}
		});

		it("copies across files when both revisions match", async () => {
			const { session } = await setup({
				[trickroomMcpTestDesignUuid]: trickroomMcpTestDesign,
				[targetDesignFileId]: targetDesign,
			});
			try {
				const sourceRevision = await getRevision(
					session,
					trickroomMcpTestDesignUuid,
				);
				const targetRevision = await getRevision(session, targetDesignFileId);
				const result = await applyOperation(session.client, "copySubtree", {
					sourceDesignFileId: trickroomMcpTestDesignUuid,
					sourceElementId: "title",
					sourceExpectedRevision: sourceRevision,
					designFileId: targetDesignFileId,
					expectedRevision: targetRevision,
					parentId: "target-root",
					index: 0,
				});

				expect(result.isError).toBeFalsy();
				expect(toolPayload(result)).toMatchObject({
					status: "success",
					designFileId: targetDesignFileId,
					created: [{ step: 0, id: expect.any(String), nodeCount: 1 }],
				});
				expect(toolPayload(result)).not.toHaveProperty("sourceDesignFile");
			} finally {
				await session.close();
			}
		});

		it("reports cross-file source revision mismatches", async () => {
			const { session } = await setup({
				[trickroomMcpTestDesignUuid]: trickroomMcpTestDesign,
				[targetDesignFileId]: targetDesign,
			});
			try {
				const targetRevision = await getRevision(session, targetDesignFileId);
				const staleSourceRevision =
					"sha256:0000000000000000000000000000000000000000000000000000000000000000";
				const result = await applyOperation(session.client, "copySubtree", {
					sourceDesignFileId: trickroomMcpTestDesignUuid,
					sourceElementId: "title",
					sourceExpectedRevision: staleSourceRevision,
					designFileId: targetDesignFileId,
					expectedRevision: targetRevision,
					parentId: "target-root",
					index: 0,
				});

				expect(result.isError).toBe(true);
				expect(toolPayload(result)).toMatchObject({
					status: "INVALID_OPERATION",
					code: "SOURCE_REVISION_MISMATCH",
					currentSourceRevision: expect.any(String),
					sourceExpectedRevision: staleSourceRevision,
				});
				expect(await getRevision(session, targetDesignFileId)).toBe(
					targetRevision,
				);
			} finally {
				await session.close();
			}
		});

		it("validates cross-file stale target revisions as REVISION_MISMATCH without generated IDs", async () => {
			const { session } = await setup({
				[trickroomMcpTestDesignUuid]: trickroomMcpTestDesign,
				[targetDesignFileId]: targetDesign,
			});
			try {
				const sourceRevision = await getRevision(
					session,
					trickroomMcpTestDesignUuid,
				);
				const staleTargetRevision =
					"sha256:0000000000000000000000000000000000000000000000000000000000000000";
				const result = await session.client.callTool({
					name: "validateCopySubtree",
					arguments: {
						sourceDesignFileId: trickroomMcpTestDesignUuid,
						sourceElementId: "title",
						sourceExpectedRevision: sourceRevision,
						targetDesignFileId,
						expectedRevision: staleTargetRevision,
						parentId: "target-root",
						index: 0,
					},
				});

				expect(result.isError).toBeFalsy();
				expect(toolPayload(result)).toMatchObject({
					status: "REVISION_MISMATCH",
					valid: false,
					currentRevision: expect.any(String),
					expectedRevision: staleTargetRevision,
				});
				expect(toolPayload(result)).not.toHaveProperty("idMap");
				expect(toolPayload(result)).not.toHaveProperty("inserted");
				expect(toolPayload(result)).not.toHaveProperty("changedElement");
				expect(toolPayload(result)).not.toHaveProperty("context");
			} finally {
				await session.close();
			}
		});

		it("returns existing target REVISION_MISMATCH behavior for cross-file stale target revisions", async () => {
			const { fixture, session } = await setup({
				[trickroomMcpTestDesignUuid]: trickroomMcpTestDesign,
				[targetDesignFileId]: targetDesign,
			});
			try {
				const sourceRevision = await getRevision(
					session,
					trickroomMcpTestDesignUuid,
				);
				const originalTarget = await fixture.designFileService.readDesignFile(
					fixture.designFileService.getFileForUuid(targetDesignFileId),
				);
				const staleTargetRevision =
					"sha256:0000000000000000000000000000000000000000000000000000000000000000";
				const result = await applyOperation(session.client, "copySubtree", {
					sourceDesignFileId: trickroomMcpTestDesignUuid,
					sourceElementId: "title",
					sourceExpectedRevision: sourceRevision,
					designFileId: targetDesignFileId,
					expectedRevision: staleTargetRevision,
					parentId: "target-root",
					index: 0,
				});

				expect(result.isError).toBe(true);
				expect(toolPayload(result)).toMatchObject({
					status: "REVISION_MISMATCH",
					currentRevision: expect.any(String),
					expectedRevision: staleTargetRevision,
				});
				const persistedTarget = await fixture.designFileService.readDesignFile(
					fixture.designFileService.getFileForUuid(targetDesignFileId),
				);
				expect(persistedTarget.revision).toBe(originalTarget.revision);
				expect(persistedTarget.design).toEqual(originalTarget.design);
			} finally {
				await session.close();
			}
		});

		it("enforces source design, target design, and copied component allowlists", async () => {
			const designs = {
				[trickroomMcpTestDesignUuid]: trickroomMcpTestDesign,
				[targetDesignFileId]: targetDesign,
			};

			const sourceDeniedFixture = await createTrickroomMcpProjectFixture({
				designs,
				config: {
					mcp: {
						enabled: true,
						allowedDesignFileIds: [targetDesignFileId],
					},
				},
			});
			fixtures.push(sourceDeniedFixture);
			const sourceDeniedSession = await createTrickroomMcpTestClient(
				await sourceDeniedFixture.readMcpContext(),
			);
			try {
				const sourceRead =
					await sourceDeniedFixture.designFileService.readDesignFile(
						sourceDeniedFixture.designFileService.getFileForUuid(
							trickroomMcpTestDesignUuid,
						),
					);
				const targetRead =
					await sourceDeniedFixture.designFileService.readDesignFile(
						sourceDeniedFixture.designFileService.getFileForUuid(
							targetDesignFileId,
						),
					);
				const result = await applyOperation(
					sourceDeniedSession.client,
					"copySubtree",
					{
						sourceDesignFileId: trickroomMcpTestDesignUuid,
						sourceElementId: "title",
						sourceExpectedRevision: sourceRead.revision,
						designFileId: targetDesignFileId,
						expectedRevision: targetRead.revision,
						parentId: "target-root",
						index: 0,
					},
				);
				expect(result.isError).toBe(true);
				expect(toolPayload(result)).toMatchObject({
					status: "POLICY_DENIED",
					code: "MCP_DESIGN_FILE_NOT_ALLOWED",
				});
			} finally {
				await sourceDeniedSession.close();
			}

			const targetDeniedFixture = await createTrickroomMcpProjectFixture({
				designs,
				config: {
					mcp: {
						enabled: true,
						allowedDesignFileIds: [trickroomMcpTestDesignUuid],
					},
				},
			});
			fixtures.push(targetDeniedFixture);
			const targetDeniedSession = await createTrickroomMcpTestClient(
				await targetDeniedFixture.readMcpContext(),
			);
			try {
				const sourceRead =
					await targetDeniedFixture.designFileService.readDesignFile(
						targetDeniedFixture.designFileService.getFileForUuid(
							trickroomMcpTestDesignUuid,
						),
					);
				const targetRead =
					await targetDeniedFixture.designFileService.readDesignFile(
						targetDeniedFixture.designFileService.getFileForUuid(
							targetDesignFileId,
						),
					);
				const result = await applyOperation(
					targetDeniedSession.client,
					"copySubtree",
					{
						sourceDesignFileId: trickroomMcpTestDesignUuid,
						sourceElementId: "title",
						sourceExpectedRevision: sourceRead.revision,
						designFileId: targetDesignFileId,
						expectedRevision: targetRead.revision,
						parentId: "target-root",
						index: 0,
					},
				);
				expect(result.isError).toBe(true);
				expect(toolPayload(result)).toMatchObject({
					status: "POLICY_DENIED",
					code: "MCP_DESIGN_FILE_NOT_ALLOWED",
				});
			} finally {
				await targetDeniedSession.close();
			}

			const componentDeniedFixture = await createTrickroomMcpProjectFixture({
				designs,
				config: {
					mcp: {
						enabled: true,
						allowedComponents: ["trickroom/container"],
					},
				},
			});
			fixtures.push(componentDeniedFixture);
			const componentDeniedSession = await createTrickroomMcpTestClient(
				await componentDeniedFixture.readMcpContext(),
			);
			try {
				const sourceRevision = await getRevision(
					componentDeniedSession,
					trickroomMcpTestDesignUuid,
				);
				const targetRevision = await getRevision(
					componentDeniedSession,
					targetDesignFileId,
				);
				const result = await applyOperation(
					componentDeniedSession.client,
					"copySubtree",
					{
						sourceDesignFileId: trickroomMcpTestDesignUuid,
						sourceElementId: "title",
						sourceExpectedRevision: sourceRevision,
						designFileId: targetDesignFileId,
						expectedRevision: targetRevision,
						parentId: "target-root",
						index: 0,
					},
				);
				expect(result.isError).toBe(true);
				expect(toolPayload(result)).toMatchObject({
					status: "POLICY_DENIED",
					code: "MCP_COMPONENT_NOT_ALLOWED",
				});
			} finally {
				await componentDeniedSession.close();
			}
		});

		it("rejects copied asset references invalid for the target system and leaves target unchanged", async () => {
			const sourceDesign: TrickroomDesign = {
				name: "Asset Source",
				systemName: "Core",
				boards: [
					{
						id: "asset-source-root",
						props: {
							"data-trickroom-name": "Asset Source Root",
							"data-trickroom-library": "trickroom",
							"data-trickroom-component": "container",
							"data-trickroom-role": "branch",
						},
						children: [
							{
								id: "source-asset",
								props: {
									"data-trickroom-name": "Source Asset",
									"data-trickroom-library": "trickroom",
									"data-trickroom-component": "asset",
									"data-trickroom-role": "leaf",
									[assetIdProp]: "asset_profile",
								},
								children: [],
							},
						],
					},
				],
			};
			const targetWithDifferentSystem: TrickroomDesign = {
				...targetDesign,
				systemName: "Other",
			};
			const fixture = await createTrickroomMcpProjectFixture({
				config: {
					systems: {
						Core: "src/index.css",
						Other: "src/other.css",
					},
				},
				designs: {
					[trickroomMcpTestDesignUuid]: sourceDesign,
					[targetDesignFileId]: targetWithDifferentSystem,
				},
			});
			fixtures.push(fixture);
			const session = await createTrickroomMcpTestClient(
				await fixture.readMcpContext(),
			);
			try {
				const sourceRevision = await getRevision(
					session,
					trickroomMcpTestDesignUuid,
				);
				const originalTarget = await fixture.designFileService.readDesignFile(
					fixture.designFileService.getFileForUuid(targetDesignFileId),
				);
				const result = await applyOperation(session.client, "copySubtree", {
					sourceDesignFileId: trickroomMcpTestDesignUuid,
					sourceElementId: "source-asset",
					sourceExpectedRevision: sourceRevision,
					designFileId: targetDesignFileId,
					expectedRevision: originalTarget.revision,
					parentId: "target-root",
					index: 0,
				});

				expect(result.isError).toBe(true);
				expect(toolPayload(result)).toMatchObject({
					status: "INVALID_OPERATION",
					code: "UNKNOWN_ASSET_ID",
				});
				const persistedTarget = await fixture.designFileService.readDesignFile(
					fixture.designFileService.getFileForUuid(targetDesignFileId),
				);
				expect(persistedTarget.revision).toBe(originalTarget.revision);
				expect(persistedTarget.design).toEqual(originalTarget.design);
			} finally {
				await session.close();
			}
		});

		it("writes audit log entries for copy attempts", async () => {
			const fixture = await createTrickroomMcpProjectFixture({
				config: {
					mcp: {
						enabled: true,
						auditLog: true,
					},
				},
			});
			fixtures.push(fixture);
			const session = await createTrickroomMcpTestClient(
				await fixture.readMcpContext(),
			);
			try {
				const revision = await getRevision(session, trickroomMcpTestDesignUuid);
				const result = await applyOperation(session.client, "copySubtree", {
					sourceDesignFileId: trickroomMcpTestDesignUuid,
					sourceElementId: "title",
					designFileId: trickroomMcpTestDesignUuid,
					expectedRevision: revision,
					parentId: "board",
					index: 1,
				});
				expect(result.isError).toBeFalsy();
				const content = toolPayload(result) as { newRevision: string };

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
						toolName: "design_apply",
						operation: "copySubtree",
						designFileId: trickroomMcpTestDesignUuid,
						expectedRevision: revision,
						success: true,
						status: "success",
						resultingRevision: content.newRevision,
						details: { operationCount: 1, operations: ["copySubtree"] },
					}),
				);

				const latestRevision = await getRevision(
					session,
					trickroomMcpTestDesignUuid,
				);
				const failed = await applyOperation(session.client, "copySubtree", {
					sourceDesignFileId: trickroomMcpTestDesignUuid,
					sourceElementId: "missing-source",
					designFileId: trickroomMcpTestDesignUuid,
					expectedRevision: latestRevision,
					parentId: "board",
					index: 1,
				});
				expect(failed.isError).toBe(true);

				const updatedAuditLog = await readFile(
					path.join(fixture.projectRoot, ".trickroom", "audit-log.jsonl"),
					"utf8",
				);
				const updatedEntries = updatedAuditLog
					.trim()
					.split("\n")
					.map((line) => JSON.parse(line) as Record<string, unknown>);
				expect(updatedEntries).toContainEqual(
					expect.objectContaining({
						toolName: "design_apply",
						operation: "copySubtree",
						designFileId: trickroomMcpTestDesignUuid,
						expectedRevision: latestRevision,
						success: false,
						status: "INVALID_OPERATION",
						code: "ELEMENT_NOT_FOUND",
					}),
				);
			} finally {
				await session.close();
			}
		});
	});

	describe("createDesignFile", () => {
		const createdDesignFileId = "10000000-0000-4000-8000-000000000002";
		const secondCreatedDesignFileId = "10000000-0000-4000-8000-000000000003";

		it("creates a blank design file and returns its revision", async () => {
			const { fixture, session } = await setup();
			try {
				const result = await session.client.callTool({
					name: "createDesignFile",
					arguments: {
						designFileId: createdDesignFileId,
						name: "Exploration",
						systemName: "Core",
					},
				});

				expect(result.isError).toBeFalsy();
				const content = toolPayload(result) as {
					status: string;
					newRevision: string;
					designFile: {
						id: string;
						file: string;
						name: string;
						systemId: string | null;
						systemName: string | null;
						revision: string;
					};
					rootElementIds: string[];
					elementTree: Array<{ component: string; role: string }>;
				};
				expect(content.status).toBe("success");
				expect(content.newRevision).toEqual(expect.any(String));
				expect(content.designFile).toMatchObject({
					id: createdDesignFileId,
					file: `${createdDesignFileId}.json`,
					name: "Exploration",
					systemId: expect.stringMatching(/^sys_/),
					systemName: "Core",
					revision: content.newRevision,
				});
				expect(content.rootElementIds).toHaveLength(0);
				expect(content.elementTree).toEqual([]);

				const persisted = await fixture.designFileService.readDesignFile(
					fixture.designFileService.getFileForUuid(createdDesignFileId),
				);
				expect(persisted.design).toMatchObject({
					name: "Exploration",
					systemId: expect.stringMatching(/^sys_/),
					boards: [],
				});
				expect(persisted.design).not.toHaveProperty("systemName");

				const listResult = await session.client.callTool({
					name: "design_list",
					arguments: {},
				});
				const listContent = toolPayload(listResult) as {
					designFiles: Array<{ id: string; revision: string }>;
				};
				expect(listContent.designFiles).toContainEqual(
					expect.objectContaining({
						id: createdDesignFileId,
						revision: content.newRevision,
					}),
				);
			} finally {
				await session.close();
			}
		});

		it("does not overwrite an existing design file id", async () => {
			const { fixture, session } = await setup();
			try {
				const result = await session.client.callTool({
					name: "createDesignFile",
					arguments: {
						designFileId: trickroomMcpTestDesignUuid,
						name: "Overwrite Attempt",
					},
				});

				expect(result.isError).toBe(true);
				expect(toolPayload(result)).toMatchObject({
					status: "INVALID_OPERATION",
					code: "DESIGN_FILE_ALREADY_EXISTS",
				});

				const persisted = await fixture.designFileService.readDesignFile(
					fixture.designFileService.getFileForUuid(trickroomMcpTestDesignUuid),
				);
				expect(persisted.design.name).toBe("Harness Design");
			} finally {
				await session.close();
			}
		});

		it("denies creation in read-only mode", async () => {
			const fixture = await createTrickroomMcpProjectFixture({
				config: {
					mcp: {
						enabled: true,
						mode: "read-only",
						auditLog: true,
					},
				},
			});
			fixtures.push(fixture);
			const session = await createTrickroomMcpTestClient(
				await fixture.readMcpContext(),
			);
			try {
				const result = await session.client.callTool({
					name: "createDesignFile",
					arguments: {
						designFileId: createdDesignFileId,
						name: "Read Only Denied",
						systemName: "Missing",
					},
				});

				expect(result.isError).toBe(true);
				expect(toolPayload(result)).toMatchObject({
					status: "POLICY_DENIED",
					code: "MCP_READ_ONLY",
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
						toolName: "createDesignFile",
						operation: "createDesignFile",
						designFileId: createdDesignFileId,
						expectedRevision: null,
						success: false,
						status: "POLICY_DENIED",
						code: "MCP_READ_ONLY",
					}),
				);
			} finally {
				await session.close();
			}
		});

		it("enforces design file and component allowlists", async () => {
			const fixture = await createTrickroomMcpProjectFixture({
				config: {
					mcp: {
						enabled: true,
						allowedDesignFileIds: [createdDesignFileId],
						allowedComponents: ["trickroom/container"],
					},
				},
			});
			fixtures.push(fixture);
			const context = await fixture.readMcpContext();
			const session = await createTrickroomMcpTestClient(context);
			try {
				const generatedDenied = await session.client.callTool({
					name: "createDesignFile",
					arguments: {
						name: "Generated Denied",
						systemName: "Missing",
					},
				});
				expect(generatedDenied.isError).toBe(true);
				expect(toolPayload(generatedDenied)).toMatchObject({
					status: "POLICY_DENIED",
					code: "MCP_DESIGN_FILE_NOT_ALLOWED",
				});

				const created = await session.client.callTool({
					name: "createDesignFile",
					arguments: {
						designFileId: createdDesignFileId,
						name: "Allowed Exploration",
					},
				});
				expect(created.isError).toBeFalsy();
				expect(toolPayload(created)).toMatchObject({
					status: "success",
					designFile: {
						id: createdDesignFileId,
						name: "Allowed Exploration",
					},
				});
			} finally {
				await session.close();
			}

			const componentFixture = await createTrickroomMcpProjectFixture({
				config: {
					mcp: {
						enabled: true,
						allowedComponents: ["trickroom/text"],
					},
				},
			});
			fixtures.push(componentFixture);
			const componentSession = await createTrickroomMcpTestClient(
				await componentFixture.readMcpContext(),
			);
			try {
				// Empty creation uses no components, so component allowlists do not
				// gate createDesignFile itself — only subsequent inserts.
				const created = await componentSession.client.callTool({
					name: "createDesignFile",
					arguments: {
						designFileId: secondCreatedDesignFileId,
						name: "Component Allowlist Ignored",
					},
				});
				expect(created.isError).toBeFalsy();
				expect(toolPayload(created)).toMatchObject({
					status: "success",
					rootElementIds: [],
				});
			} finally {
				await componentSession.close();
			}
		});

		it("writes audit log entries for create attempts", async () => {
			const fixture = await createTrickroomMcpProjectFixture({
				config: {
					mcp: {
						enabled: true,
						auditLog: true,
					},
				},
			});
			fixtures.push(fixture);
			const session = await createTrickroomMcpTestClient(
				await fixture.readMcpContext(),
			);
			try {
				const result = await session.client.callTool({
					name: "createDesignFile",
					arguments: {
						designFileId: createdDesignFileId,
						name: "Audited Exploration",
					},
				});
				expect(result.isError).toBeFalsy();

				const duplicate = await session.client.callTool({
					name: "createDesignFile",
					arguments: {
						designFileId: createdDesignFileId,
						name: "Duplicate Audited Exploration",
					},
				});
				expect(duplicate.isError).toBe(true);

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
						toolName: "createDesignFile",
						operation: "createDesignFile",
						designFileId: createdDesignFileId,
						expectedRevision: null,
						success: true,
						status: "success",
						resultingRevision: expect.any(String),
					}),
				);
				expect(entries).toContainEqual(
					expect.objectContaining({
						toolName: "createDesignFile",
						operation: "createDesignFile",
						designFileId: createdDesignFileId,
						expectedRevision: null,
						success: false,
						status: "INVALID_OPERATION",
						code: "DESIGN_FILE_ALREADY_EXISTS",
					}),
				);
			} finally {
				await session.close();
			}
		});

		it("rejects unknown design systems", async () => {
			const { session } = await setup();
			try {
				const result = await session.client.callTool({
					name: "createDesignFile",
					arguments: {
						designFileId: createdDesignFileId,
						name: "Unknown System",
						systemName: "Missing",
					},
				});

				expect(result.isError).toBe(true);
				expect(toolPayload(result)).toMatchObject({
					status: "INVALID_OPERATION",
					code: "UNKNOWN_DESIGN_SYSTEM",
				});
			} finally {
				await session.close();
			}
		});

		it("rejects blank names and design system names", async () => {
			const { session } = await setup();
			try {
				const blankName = await session.client.callTool({
					name: "createDesignFile",
					arguments: {
						designFileId: createdDesignFileId,
						name: "   ",
					},
				});
				expect(blankName.isError).toBe(true);
				expect(toolPayload(blankName)).toMatchObject({
					status: "INVALID_OPERATION",
					code: "INVALID_OPERATION_PARAMETERS",
				});

				const blankSystem = await session.client.callTool({
					name: "createDesignFile",
					arguments: {
						designFileId: createdDesignFileId,
						name: "Blank System",
						systemName: "   ",
					},
				});
				expect(blankSystem.isError).toBe(true);
				expect(toolPayload(blankSystem)).toMatchObject({
					status: "INVALID_OPERATION",
					code: "INVALID_OPERATION_PARAMETERS",
				});
			} finally {
				await session.close();
			}
		});

		it("emits resources/list_changed only after successful creates", async () => {
			const { session, notifications } = await setupWithNotificationClient();
			try {
				const result = await session.client.callTool({
					name: "createDesignFile",
					arguments: {
						designFileId: createdDesignFileId,
						name: "Notified Exploration",
						systemName: "Core",
					},
				});
				expect(result.isError).toBeFalsy();
				expect(notifications).toHaveLength(1);

				const duplicate = await session.client.callTool({
					name: "createDesignFile",
					arguments: {
						designFileId: createdDesignFileId,
						name: "Duplicate Notified Exploration",
					},
				});
				expect(duplicate.isError).toBe(true);
				expect(notifications).toHaveLength(1);
			} finally {
				await session.close();
			}
		});
	});

	describe("extractSubtree", () => {
		const extractedDesignFileId = "10000000-0000-4000-8000-000000000012";

		it("copies a source subtree to a new design file without mutating the source", async () => {
			const { fixture, session } = await setup();
			try {
				const result = await session.client.callTool({
					name: "extractSubtree",
					arguments: {
						designFileId: trickroomMcpTestDesignUuid,
						elementId: "board",
						newDesignFileId: extractedDesignFileId,
					},
				});

				expect(result.isError).toBeFalsy();
				const content = toolPayload(result) as {
					status: string;
					newRevision: string;
					designFile: {
						id: string;
						file: string;
						name: string;
						systemName: string | null;
						revision: string;
					};
					sourceDesignFile: { id: string; revision: string };
					rootElementIds: string[];
					idMap: Record<string, string>;
					elementTree: Array<{
						id: string;
						name: string;
						children: Array<{ id: string; textPreview: string }>;
					}>;
				};
				expect(content.status).toBe("success");
				expect(content.newRevision).toEqual(expect.any(String));
				expect(content.designFile).toMatchObject({
					id: extractedDesignFileId,
					file: `${extractedDesignFileId}.json`,
					name: "Board",
					systemName: "Core",
					revision: content.newRevision,
				});
				expect(content.sourceDesignFile.id).toBe(trickroomMcpTestDesignUuid);
				expect(content.idMap.board).toBe(content.rootElementIds[0]);
				expect(content.idMap.board).not.toBe("board");
				expect(content.idMap.title).not.toBe("title");
				expect(content.elementTree).toEqual([
					expect.objectContaining({
						id: content.idMap.board,
						name: "Board",
						children: [
							expect.objectContaining({
								id: content.idMap.title,
								textPreview: "Harness fixture",
							}),
						],
					}),
				]);

				const persistedTarget = await fixture.designFileService.readDesignFile(
					fixture.designFileService.getFileForUuid(extractedDesignFileId),
				);
				expect(persistedTarget.design).toMatchObject({
					name: "Board",
					systemId: expect.stringMatching(/^sys_/),
				});
				expect(persistedTarget.design).not.toHaveProperty("systemName");
				expect(persistedTarget.design.boards[0].id).toBe(content.idMap.board);
				expect(persistedTarget.design.boards[0].id).not.toBe("board");
				const persistedChildren = persistedTarget.design.boards[0]
					.children as TrickroomDesign["boards"];
				expect(persistedChildren[0].id).toBe(content.idMap.title);
				expect(persistedChildren[0].children).toBe("Harness fixture");

				const persistedSource = await fixture.designFileService.readDesignFile(
					fixture.designFileService.getFileForUuid(trickroomMcpTestDesignUuid),
				);
				expect(persistedSource.design).toEqual(trickroomMcpTestDesign);
			} finally {
				await session.close();
			}
		});

		it("honors explicit names and system overrides", async () => {
			const { fixture, session } = await setup();
			try {
				const result = await session.client.callTool({
					name: "extractSubtree",
					arguments: {
						designFileId: trickroomMcpTestDesignUuid,
						elementId: "title",
						name: "Extracted Heading",
						systemName: null,
						newDesignFileId: extractedDesignFileId,
					},
				});

				expect(result.isError).toBeFalsy();
				expect(toolPayload(result)).toMatchObject({
					status: "success",
					designFile: {
						id: extractedDesignFileId,
						name: "Extracted Heading",
						systemName: null,
					},
				});

				const persisted = await fixture.designFileService.readDesignFile(
					fixture.designFileService.getFileForUuid(extractedDesignFileId),
				);
				expect(persisted.design.name).toBe("Extracted Heading");
				expect(persisted.design.systemId).toBeNull();
				expect(persisted.design).not.toHaveProperty("systemName");
				expect(persisted.design.boards[0].children).toBe("Harness fixture");
			} finally {
				await session.close();
			}
		});

		it("does not overwrite an existing target design file id", async () => {
			const { session } = await setup();
			try {
				const result = await session.client.callTool({
					name: "extractSubtree",
					arguments: {
						designFileId: trickroomMcpTestDesignUuid,
						elementId: "title",
						newDesignFileId: trickroomMcpTestDesignUuid,
					},
				});

				expect(result.isError).toBe(true);
				expect(toolPayload(result)).toMatchObject({
					status: "INVALID_OPERATION",
					code: "DESIGN_FILE_ALREADY_EXISTS",
				});
			} finally {
				await session.close();
			}
		});

		it("rejects blank system overrides", async () => {
			const { session } = await setup();
			try {
				const result = await session.client.callTool({
					name: "extractSubtree",
					arguments: {
						designFileId: trickroomMcpTestDesignUuid,
						elementId: "title",
						systemName: " ",
						newDesignFileId: extractedDesignFileId,
					},
				});

				expect(result.isError).toBe(true);
				expect(toolPayload(result)).toMatchObject({
					status: "INVALID_OPERATION",
					code: "INVALID_OPERATION_PARAMETERS",
				});
			} finally {
				await session.close();
			}
		});

		it("enforces design file and component allowlists", async () => {
			const allowedTextTargetId = "10000000-0000-4000-8000-000000000013";
			const fixture = await createTrickroomMcpProjectFixture({
				config: {
					mcp: {
						enabled: true,
						allowedDesignFileIds: [
							trickroomMcpTestDesignUuid,
							allowedTextTargetId,
						],
						allowedComponents: ["trickroom/text"],
					},
				},
			});
			fixtures.push(fixture);
			const policySession = await createTrickroomMcpTestClient(
				await fixture.readMcpContext(),
			);
			try {
				const generatedDenied = await policySession.client.callTool({
					name: "extractSubtree",
					arguments: {
						designFileId: trickroomMcpTestDesignUuid,
						elementId: "title",
					},
				});
				expect(generatedDenied.isError).toBe(true);
				expect(toolPayload(generatedDenied)).toMatchObject({
					status: "POLICY_DENIED",
					code: "MCP_DESIGN_FILE_NOT_ALLOWED",
				});

				const componentDenied = await policySession.client.callTool({
					name: "extractSubtree",
					arguments: {
						designFileId: trickroomMcpTestDesignUuid,
						elementId: "board",
						newDesignFileId: allowedTextTargetId,
					},
				});
				expect(componentDenied.isError).toBe(true);
				expect(toolPayload(componentDenied)).toMatchObject({
					status: "POLICY_DENIED",
					code: "MCP_COMPONENT_NOT_ALLOWED",
				});

				const allowed = await policySession.client.callTool({
					name: "extractSubtree",
					arguments: {
						designFileId: trickroomMcpTestDesignUuid,
						elementId: "title",
						newDesignFileId: allowedTextTargetId,
					},
				});
				expect(allowed.isError).toBeFalsy();
				expect(toolPayload(allowed)).toMatchObject({
					status: "success",
					designFile: {
						id: allowedTextTargetId,
						name: "Title",
					},
				});
			} finally {
				await policySession.close();
			}
		});

		it("rejects subtrees with disallowed descendant components", async () => {
			const targetId = "10000000-0000-4000-8000-000000000014";
			const fixture = await createTrickroomMcpProjectFixture({
				config: {
					mcp: {
						enabled: true,
						allowedDesignFileIds: [trickroomMcpTestDesignUuid, targetId],
						allowedComponents: ["trickroom/container"],
					},
				},
			});
			fixtures.push(fixture);
			const policySession = await createTrickroomMcpTestClient(
				await fixture.readMcpContext(),
			);
			try {
				const result = await policySession.client.callTool({
					name: "extractSubtree",
					arguments: {
						designFileId: trickroomMcpTestDesignUuid,
						elementId: "board",
						newDesignFileId: targetId,
					},
				});

				expect(result.isError).toBe(true);
				expect(toolPayload(result)).toMatchObject({
					status: "POLICY_DENIED",
					code: "MCP_COMPONENT_NOT_ALLOWED",
				});
			} finally {
				await policySession.close();
			}
		});

		it("rejects duplicate element ids instead of extracting an unchecked duplicate", async () => {
			const targetId = "10000000-0000-4000-8000-000000000015";
			const duplicateDesign: TrickroomDesign = {
				name: "Duplicate IDs",
				systemName: "Core",
				boards: [
					{
						id: "duplicate",
						props: {
							"data-trickroom-name": "Allowed Duplicate",
							"data-trickroom-library": "trickroom",
							"data-trickroom-component": "container",
						},
						children: [],
					},
					{
						id: "duplicate",
						props: {
							"data-trickroom-name": "Unchecked Duplicate",
							"data-trickroom-library": "trickroom",
							"data-trickroom-component": "text",
							"data-trickroom-role": "text",
						},
						children: "Unchecked",
					},
				],
			};
			const fixture = await createTrickroomMcpProjectFixture({
				config: {
					mcp: {
						enabled: true,
						allowedDesignFileIds: [trickroomMcpTestDesignUuid, targetId],
						allowedComponents: ["trickroom/container"],
					},
				},
				designs: {
					[trickroomMcpTestDesignUuid]: duplicateDesign,
				},
			});
			fixtures.push(fixture);
			const policySession = await createTrickroomMcpTestClient(
				await fixture.readMcpContext(),
			);
			try {
				const result = await policySession.client.callTool({
					name: "extractSubtree",
					arguments: {
						designFileId: trickroomMcpTestDesignUuid,
						elementId: "duplicate",
						newDesignFileId: targetId,
					},
				});

				expect(result.isError).toBe(true);
				expect(toolPayload(result)).toMatchObject({
					status: "INVALID_OPERATION",
					code: "DUPLICATE_ELEMENT_ID",
				});
			} finally {
				await policySession.close();
			}
		});

		it("writes audit log entries for extract attempts", async () => {
			const fixture = await createTrickroomMcpProjectFixture({
				config: {
					mcp: {
						enabled: true,
						auditLog: true,
					},
				},
			});
			fixtures.push(fixture);
			const session = await createTrickroomMcpTestClient(
				await fixture.readMcpContext(),
			);
			try {
				const result = await session.client.callTool({
					name: "extractSubtree",
					arguments: {
						designFileId: trickroomMcpTestDesignUuid,
						elementId: "title",
						newDesignFileId: extractedDesignFileId,
					},
				});
				expect(result.isError).toBeFalsy();

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
						toolName: "extractSubtree",
						operation: "extractSubtree",
						designFileId: extractedDesignFileId,
						expectedRevision: null,
						success: true,
						status: "success",
						resultingRevision: expect.any(String),
						details: expect.objectContaining({
							sourceDesignFileId: trickroomMcpTestDesignUuid,
							sourceElementId: "title",
						}),
					}),
				);
			} finally {
				await session.close();
			}
		});
	});

	describe("renameDesignFile", () => {
		it("renames the design file and returns the new revision", async () => {
			const { fixture, session } = await setup();
			try {
				const revision = await getRevision(session, trickroomMcpTestDesignUuid);

				const result = await applyOperation(
					session.client,
					"renameDesignFile",
					{
						designFileId: trickroomMcpTestDesignUuid,
						expectedRevision: revision,
						name: "Renamed Design",
					},
				);

				expect(result.isError).toBeFalsy();
				const content = toolPayload(result);
				expect(content.status).toBe("success");
				expect(content.newRevision).toEqual(expect.any(String));
				expect(content.newRevision).not.toBe(revision);
				expect(content).not.toHaveProperty("created");

				const persisted = await fixture.designFileService.readDesignFile(
					fixture.designFileService.getFileForUuid(trickroomMcpTestDesignUuid),
				);
				expect(persisted.design.name).toBe("Renamed Design");
			} finally {
				await session.close();
			}
		});

		it("returns REVISION_MISMATCH on stale revision", async () => {
			const { session } = await setup();
			try {
				const staleRevision =
					"sha256:0000000000000000000000000000000000000000000000000000000000000000";

				const result = await applyOperation(
					session.client,
					"renameDesignFile",
					{
						designFileId: trickroomMcpTestDesignUuid,
						expectedRevision: staleRevision,
						name: "Stale Rename",
					},
				);

				expect(result.isError).toBe(true);
				const content = toolPayload(result) as {
					status: string;
					currentRevision: string;
					expectedRevision: string;
				};
				expect(content.status).toBe("REVISION_MISMATCH");
				expect(content.currentRevision).toEqual(expect.any(String));
				expect(content.expectedRevision).toBe(staleRevision);
			} finally {
				await session.close();
			}
		});

		it("renamed name is visible in subsequent reads", async () => {
			const { session } = await setup();
			try {
				const revision = await getRevision(session, trickroomMcpTestDesignUuid);

				await applyOperation(session.client, "renameDesignFile", {
					designFileId: trickroomMcpTestDesignUuid,
					expectedRevision: revision,
					name: "Read Back Name",
				});

				const readResult = await session.client.callTool({
					name: "design_read",
					arguments: {
						designFileId: trickroomMcpTestDesignUuid,
					},
				});
				const readContent = toolPayload(readResult) as {
					designFile: { name: string };
				};
				expect(readContent.designFile.name).toBe("Read Back Name");
			} finally {
				await session.close();
			}
		});

		it("emits resources/list_changed only after successful renames", async () => {
			const { session, notifications } = await setupWithNotificationClient();
			try {
				const revision = await getRevision(session, trickroomMcpTestDesignUuid);
				const success = await applyOperation(
					session.client,
					"renameDesignFile",
					{
						designFileId: trickroomMcpTestDesignUuid,
						expectedRevision: revision,
						name: "Renamed and Notified",
					},
				);
				expect(success.isError).toBeFalsy();
				expect(notifications).toHaveLength(1);

				const staleRevision =
					"sha256:0000000000000000000000000000000000000000000000000000000000000000";
				const failed = await applyOperation(
					session.client,
					"renameDesignFile",
					{
						designFileId: trickroomMcpTestDesignUuid,
						expectedRevision: staleRevision,
						name: "Notified Stale Rename",
					},
				);
				expect(failed.isError).toBe(true);
				expect(notifications).toHaveLength(1);
			} finally {
				await session.close();
			}
		});
	});

	describe("addElement", () => {
		it("adds a container element to the design root", async () => {
			const { session } = await setup();
			try {
				const revision = await getRevision(session, trickroomMcpTestDesignUuid);

				const result = await applyOperation(session.client, "addElement", {
					designFileId: trickroomMcpTestDesignUuid,
					expectedRevision: revision,
					parentId: null,
					index: 0,
					library: "trickroom",
					component: "container",
					name: "Hero",
				});

				expect(result.isError).toBeFalsy();
				const content = toolPayload(result);
				expect(content.status).toBe("success");
				expect(content.newRevision).toEqual(expect.any(String));
				expect(content.newRevision).not.toBe(revision);
				const added = await readElementPayload(
					session.client,
					trickroomMcpTestDesignUuid,
					content.created[0].id,
				);
				expect(added.subtree).toMatchObject({
					name: "Hero",
					component: "container",
				});
				expect(added.context).toMatchObject({ parentId: null, index: 0 });
			} finally {
				await session.close();
			}
		});

		it("adds a text element as a child", async () => {
			const { session } = await setup();
			try {
				const revision = await getRevision(session, trickroomMcpTestDesignUuid);

				const result = await applyOperation(session.client, "addElement", {
					designFileId: trickroomMcpTestDesignUuid,
					expectedRevision: revision,
					parentId: "board",
					index: 0,
					library: "trickroom",
					component: "text",
					name: "Subtitle",
					text: "A subtitle paragraph",
				});

				expect(result.isError).toBeFalsy();
				const content = toolPayload(result);
				expect(content.status).toBe("success");
				const added = await readElementPayload(
					session.client,
					trickroomMcpTestDesignUuid,
					content.created[0].id,
				);
				expect(added.subtree).toMatchObject({
					component: "text",
					text: "A subtitle paragraph",
				});
				expect(added.context.parentId).toBe("board");
			} finally {
				await session.close();
			}
		});

		it("returns REVISION_MISMATCH on stale revision", async () => {
			const { session } = await setup();
			try {
				const staleRevision =
					"sha256:0000000000000000000000000000000000000000000000000000000000000000";

				const result = await applyOperation(session.client, "addElement", {
					designFileId: trickroomMcpTestDesignUuid,
					expectedRevision: staleRevision,
					parentId: null,
					index: 0,
					library: "trickroom",
					component: "container",
				});

				expect(result.isError).toBe(true);
				const content = toolPayload(result) as {
					status: string;
					currentRevision: string;
					expectedRevision: string;
				};
				expect(content.status).toBe("REVISION_MISMATCH");
				expect(content.currentRevision).toEqual(expect.any(String));
				expect(content.expectedRevision).toBe(staleRevision);
			} finally {
				await session.close();
			}
		});

		it("returns INVALID_OPERATION for unknown library", async () => {
			const { session } = await setup();
			try {
				const revision = await getRevision(session, trickroomMcpTestDesignUuid);

				const result = await applyOperation(session.client, "addElement", {
					designFileId: trickroomMcpTestDesignUuid,
					expectedRevision: revision,
					parentId: null,
					index: 0,
					library: "nonexistent",
					component: "container",
				});

				expect(result.isError).toBe(true);
				const content = toolPayload(result) as {
					status: string;
					code: string;
				};
				expect(content.status).toBe("INVALID_OPERATION");
				expect(content.code).toBe("UNKNOWN_REGISTRY_LIBRARY");
			} finally {
				await session.close();
			}
		});

		it("returns INVALID_OPERATION when adding child to text element", async () => {
			const { session } = await setup();
			try {
				const revision = await getRevision(session, trickroomMcpTestDesignUuid);

				const result = await applyOperation(session.client, "addElement", {
					designFileId: trickroomMcpTestDesignUuid,
					expectedRevision: revision,
					parentId: "title",
					index: 0,
					library: "trickroom",
					component: "container",
				});

				expect(result.isError).toBe(true);
				const content = toolPayload(result) as {
					status: string;
					code: string;
				};
				expect(content.status).toBe("INVALID_OPERATION");
				expect(content.code).toBe("PARENT_CANNOT_HAVE_CHILDREN");
			} finally {
				await session.close();
			}
		});

		it("accepts valid props and sets name from props when shortcut absent", async () => {
			const { session } = await setup();
			try {
				const revision = await getRevision(session, trickroomMcpTestDesignUuid);

				const result = await applyOperation(session.client, "addElement", {
					designFileId: trickroomMcpTestDesignUuid,
					expectedRevision: revision,
					parentId: null,
					index: 0,
					library: "trickroom",
					component: "container",
					props: {
						"data-trickroom-name": "Via Props",
						className: "flex gap-2",
					},
				});

				expect(result.isError).toBeFalsy();
				expect(toolPayload(result).status).toBe("success");
				const changed = await readElementPayload(
					session.client,
					trickroomMcpTestDesignUuid,
					toolPayload(result).created[0].id,
				);
				expect(changed.subtree.name).toBe("Via Props");
			} finally {
				await session.close();
			}
		});

		it("adds Base UI Separator with a registry-backed orientation prop", async () => {
			const { session } = await setup();
			try {
				const revision = await getRevision(session, trickroomMcpTestDesignUuid);

				const result = await applyOperation(session.client, "addElement", {
					designFileId: trickroomMcpTestDesignUuid,
					expectedRevision: revision,
					parentId: "board",
					index: 1,
					library: "base-ui",
					component: "separator",
					props: { orientation: "vertical" },
				});

				expect(result.isError).toBeFalsy();
				const content = toolPayload(result);
				expect(content.status).toBe("success");

				const readResult = await session.client.callTool({
					name: "design_read",
					arguments: {
						depth: 0,
						detail: "full",
						designFileId: trickroomMcpTestDesignUuid,
						elementId: content.created[0].id,
					},
				});
				const readContent = toolPayload(readResult) as {
					subtree: { props: Record<string, unknown>; childIds: string[] };
				};
				expect(readContent.subtree.props["data-trickroom-component"]).toBe(
					"separator",
				);
				expect(readContent.subtree.props.orientation).toBe("vertical");
				expect(readContent.subtree.childIds).toEqual([]);
			} finally {
				await session.close();
			}
		});

		it("rejects invalid registry-backed control prop values", async () => {
			const { session } = await setup();
			try {
				const revision = await getRevision(session, trickroomMcpTestDesignUuid);

				const result = await applyOperation(session.client, "addElement", {
					designFileId: trickroomMcpTestDesignUuid,
					expectedRevision: revision,
					parentId: "board",
					index: 1,
					library: "base-ui",
					component: "separator",
					props: { orientation: "diagonal" },
				});

				expect(result.isError).toBe(true);
				const content = toolPayload(result) as {
					status: string;
					code: string;
				};
				expect(content.status).toBe("INVALID_OPERATION");
				expect(content.code).toBe("INVALID_PROP_VALUE");
			} finally {
				await session.close();
			}
		});

		it("returns INVALID_OPERATION when adding child to a leaf element", async () => {
			const { session } = await setup();
			try {
				const rev1 = await getRevision(session, trickroomMcpTestDesignUuid);
				const addLeaf = await applyOperation(session.client, "addElement", {
					designFileId: trickroomMcpTestDesignUuid,
					expectedRevision: rev1,
					parentId: "board",
					index: 1,
					library: "base-ui",
					component: "separator",
				});
				const leafContent = toolPayload(addLeaf) as {
					newRevision: string;
					created: Array<{ id: string }>;
				};

				const result = await applyOperation(session.client, "addElement", {
					designFileId: trickroomMcpTestDesignUuid,
					expectedRevision: leafContent.newRevision,
					parentId: leafContent.created[0].id,
					index: 0,
					library: "trickroom",
					component: "text",
				});

				expect(result.isError).toBe(true);
				const content = toolPayload(result) as {
					status: string;
					code: string;
				};
				expect(content.status).toBe("INVALID_OPERATION");
				expect(content.code).toBe("PARENT_CANNOT_HAVE_CHILDREN");
			} finally {
				await session.close();
			}
		});

		it("name shortcut takes precedence over props[data-trickroom-name]", async () => {
			const { session } = await setup();
			try {
				const revision = await getRevision(session, trickroomMcpTestDesignUuid);

				const result = await applyOperation(session.client, "addElement", {
					designFileId: trickroomMcpTestDesignUuid,
					expectedRevision: revision,
					parentId: null,
					index: 0,
					library: "trickroom",
					component: "container",
					name: "Shortcut Wins",
					props: { "data-trickroom-name": "Props Loses" },
				});

				expect(result.isError).toBeFalsy();
				expect(toolPayload(result).status).toBe("success");
				const changed = await readElementPayload(
					session.client,
					trickroomMcpTestDesignUuid,
					toolPayload(result).created[0].id,
				);
				expect(changed.subtree.name).toBe("Shortcut Wins");
			} finally {
				await session.close();
			}
		});

		it("returns INVALID_OPERATION with INVALID_PROP_KEY for registry-reference key in props", async () => {
			const { session } = await setup();
			try {
				const revision = await getRevision(session, trickroomMcpTestDesignUuid);

				const result = await applyOperation(session.client, "addElement", {
					designFileId: trickroomMcpTestDesignUuid,
					expectedRevision: revision,
					parentId: null,
					index: 0,
					library: "trickroom",
					component: "container",
					props: { "data-trickroom-library": "trickroom" },
				});

				expect(result.isError).toBe(true);
				const content = toolPayload(result) as {
					status: string;
					code: string;
				};
				expect(content.status).toBe("INVALID_OPERATION");
				expect(content.code).toBe("INVALID_PROP_KEY");
			} finally {
				await session.close();
			}
		});

		it("returns INVALID_OPERATION with INVALID_PROP_KEY for unknown prop key, and does not persist", async () => {
			const { session } = await setup();
			try {
				const revisionBefore = await getRevision(
					session,
					trickroomMcpTestDesignUuid,
				);

				const result = await applyOperation(session.client, "addElement", {
					designFileId: trickroomMcpTestDesignUuid,
					expectedRevision: revisionBefore,
					parentId: null,
					index: 0,
					library: "trickroom",
					component: "container",
					props: { "data-unknown": "bad" },
				});

				expect(result.isError).toBe(true);
				const content = toolPayload(result) as {
					status: string;
					code: string;
				};
				expect(content.status).toBe("INVALID_OPERATION");
				expect(content.code).toBe("INVALID_PROP_KEY");

				// Design must not have been modified.
				const revisionAfter = await getRevision(
					session,
					trickroomMcpTestDesignUuid,
				);
				expect(revisionAfter).toBe(revisionBefore);
			} finally {
				await session.close();
			}
		});

		it("new revision is different after successful add", async () => {
			const { session } = await setup();
			try {
				const revBefore = await getRevision(
					session,
					trickroomMcpTestDesignUuid,
				);

				await applyOperation(session.client, "addElement", {
					designFileId: trickroomMcpTestDesignUuid,
					expectedRevision: revBefore,
					parentId: null,
					index: 0,
					library: "trickroom",
					component: "container",
				});

				const revAfter = await getRevision(session, trickroomMcpTestDesignUuid);
				expect(revAfter).not.toBe(revBefore);
			} finally {
				await session.close();
			}
		});
	});

	describe("updateElementProps", () => {
		it("updates the name of an element", async () => {
			const { session } = await setup();
			try {
				const revision = await getRevision(session, trickroomMcpTestDesignUuid);

				const result = await applyOperation(
					session.client,
					"updateElementProps",
					{
						designFileId: trickroomMcpTestDesignUuid,
						expectedRevision: revision,
						elementId: "board",
						name: "Renamed Board",
					},
				);

				expect(result.isError).toBeFalsy();
				expect(toolPayload(result).status).toBe("success");
				const changed = await readElementPayload(
					session.client,
					trickroomMcpTestDesignUuid,
					"board",
				);
				expect(changed.subtree.name).toBe("Renamed Board");
			} finally {
				await session.close();
			}
		});

		it("updates multiple props including props[data-trickroom-name]", async () => {
			const { session } = await setup();
			try {
				const revision = await getRevision(session, trickroomMcpTestDesignUuid);

				const result = await applyOperation(
					session.client,
					"updateElementProps",
					{
						designFileId: trickroomMcpTestDesignUuid,
						expectedRevision: revision,
						elementId: "board",
						className: "grid grid-cols-2 gap-4",
						props: { "data-trickroom-name": "Props Renamed Board" },
					},
				);

				expect(result.isError).toBeFalsy();
				expect(toolPayload(result).status).toBe("success");
				const changed = await readElementPayload(
					session.client,
					trickroomMcpTestDesignUuid,
					"board",
				);
				expect(changed.subtree.name).toBe("Props Renamed Board");

				const readResult = await session.client.callTool({
					name: "design_read",
					arguments: {
						depth: 0,
						detail: "full",
						designFileId: trickroomMcpTestDesignUuid,
						elementId: "board",
					},
				});
				const readContent = toolPayload(readResult) as {
					subtree: { props: Record<string, unknown> };
				};
				expect(readContent.subtree.props["data-trickroom-name"]).toBe(
					"Props Renamed Board",
				);
				expect(readContent.subtree.props.className).toBe(
					"grid grid-cols-2 gap-4",
				);
			} finally {
				await session.close();
			}
		});

		it("updates the element name through propUpdates[data-trickroom-name]", async () => {
			const { session } = await setup();
			try {
				const revision = await getRevision(session, trickroomMcpTestDesignUuid);

				const result = await applyOperation(
					session.client,
					"updateElementProps",
					{
						designFileId: trickroomMcpTestDesignUuid,
						expectedRevision: revision,
						elementId: "board",
						propUpdates: [
							{
								name: "data-trickroom-name",
								value: "Raw Prop Renamed Board",
							},
						],
					},
				);

				expect(result.isError).toBeFalsy();
				expect(toolPayload(result).status).toBe("success");
				const changed = await readElementPayload(
					session.client,
					trickroomMcpTestDesignUuid,
					"board",
				);
				expect(changed.subtree.name).toBe("Raw Prop Renamed Board");
			} finally {
				await session.close();
			}
		});

		it("updates multiple props through propUpdates using model-facing aliases", async () => {
			const { session } = await setup();
			try {
				const revision = await getRevision(session, trickroomMcpTestDesignUuid);

				const result = await applyOperation(
					session.client,
					"updateElementProps",
					{
						designFileId: trickroomMcpTestDesignUuid,
						expectedRevision: revision,
						elementId: "board",
						propUpdates: [
							{ name: "name", value: "Alias Renamed Board" },
							{ name: "className", value: "flex flex-col gap-6" },
						],
					},
				);

				expect(result.isError).toBeFalsy();
				const content = toolPayload(result);
				expect(content.status).toBe("success");
				expect(content.newRevision).not.toBe(revision);

				const readResult = await session.client.callTool({
					name: "design_read",
					arguments: {
						depth: 0,
						detail: "full",
						designFileId: trickroomMcpTestDesignUuid,
						elementId: "board",
					},
				});
				const readContent = toolPayload(readResult) as {
					subtree: { props: Record<string, unknown> };
				};
				expect(readContent.subtree.props["data-trickroom-name"]).toBe(
					"Alias Renamed Board",
				);
				expect(readContent.subtree.props.className).toBe("flex flex-col gap-6");
			} finally {
				await session.close();
			}
		});

		it("updates className", async () => {
			const { session } = await setup();
			try {
				const revision = await getRevision(session, trickroomMcpTestDesignUuid);

				const result = await applyOperation(
					session.client,
					"updateElementProps",
					{
						designFileId: trickroomMcpTestDesignUuid,
						expectedRevision: revision,
						elementId: "board",
						className: "flex gap-4 p-8",
					},
				);

				expect(result.isError).toBeFalsy();
				const content = toolPayload(result) as { status: string };
				expect(content.status).toBe("success");
			} finally {
				await session.close();
			}
		});

		it("updates registry-backed control props", async () => {
			const { session } = await setup();
			try {
				const rev1 = await getRevision(session, trickroomMcpTestDesignUuid);
				const addResult = await applyOperation(session.client, "addElement", {
					designFileId: trickroomMcpTestDesignUuid,
					expectedRevision: rev1,
					parentId: "board",
					index: 1,
					library: "base-ui",
					component: "separator",
				});
				const addContent = toolPayload(addResult) as {
					newRevision: string;
					created: Array<{ id: string }>;
				};

				const result = await applyOperation(
					session.client,
					"updateElementProps",
					{
						designFileId: trickroomMcpTestDesignUuid,
						expectedRevision: addContent.newRevision,
						elementId: addContent.created[0].id,
						props: { orientation: "vertical" },
					},
				);

				expect(result.isError).toBeFalsy();
				const readResult = await session.client.callTool({
					name: "design_read",
					arguments: {
						depth: 0,
						designFileId: trickroomMcpTestDesignUuid,
						elementId: addContent.created[0].id,
					},
				});
				const readContent = toolPayload(readResult) as {
					subtree: { props: Record<string, unknown> };
				};
				expect(readContent.subtree.props.orientation).toBe("vertical");
			} finally {
				await session.close();
			}
		});

		it("returns INVALID_OPERATION when element not found", async () => {
			const { session } = await setup();
			try {
				const revision = await getRevision(session, trickroomMcpTestDesignUuid);

				const result = await applyOperation(
					session.client,
					"updateElementProps",
					{
						designFileId: trickroomMcpTestDesignUuid,
						expectedRevision: revision,
						elementId: "nonexistent",
						name: "x",
					},
				);

				expect(result.isError).toBe(true);
				const content = toolPayload(result) as {
					status: string;
					code: string;
				};
				expect(content.status).toBe("INVALID_OPERATION");
				expect(content.code).toBe("ELEMENT_NOT_FOUND");
			} finally {
				await session.close();
			}
		});

		it("returns REVISION_MISMATCH on stale revision", async () => {
			const { session } = await setup();
			try {
				const staleRevision =
					"sha256:0000000000000000000000000000000000000000000000000000000000000000";

				const result = await applyOperation(
					session.client,
					"updateElementProps",
					{
						designFileId: trickroomMcpTestDesignUuid,
						expectedRevision: staleRevision,
						elementId: "board",
						name: "x",
					},
				);

				expect(result.isError).toBe(true);
				const content = toolPayload(result) as { status: string };
				expect(content.status).toBe("REVISION_MISMATCH");
			} finally {
				await session.close();
			}
		});
	});

	describe("updateElementText", () => {
		it("updates text content of a text role element", async () => {
			const { session } = await setup();
			try {
				const revision = await getRevision(session, trickroomMcpTestDesignUuid);

				const result = await applyOperation(
					session.client,
					"updateElementText",
					{
						designFileId: trickroomMcpTestDesignUuid,
						expectedRevision: revision,
						elementId: "title",
						text: "Updated text content",
					},
				);

				expect(result.isError).toBeFalsy();
				expect(toolPayload(result).status).toBe("success");
				const changed = await readElementPayload(
					session.client,
					trickroomMcpTestDesignUuid,
					"title",
				);
				expect(changed.subtree.text).toBe("Updated text content");
			} finally {
				await session.close();
			}
		});

		it("returns INVALID_OPERATION for non-text elements", async () => {
			const { session } = await setup();
			try {
				const revision = await getRevision(session, trickroomMcpTestDesignUuid);

				const result = await applyOperation(
					session.client,
					"updateElementText",
					{
						designFileId: trickroomMcpTestDesignUuid,
						expectedRevision: revision,
						elementId: "board",
						text: "x",
					},
				);

				expect(result.isError).toBe(true);
				const content = toolPayload(result) as {
					status: string;
					code: string;
				};
				expect(content.status).toBe("INVALID_OPERATION");
				expect(content.code).toBe("INVALID_TEXT_UPDATE");
			} finally {
				await session.close();
			}
		});

		it("returns REVISION_MISMATCH on stale revision", async () => {
			const { session } = await setup();
			try {
				const staleRevision =
					"sha256:0000000000000000000000000000000000000000000000000000000000000000";

				const result = await applyOperation(
					session.client,
					"updateElementText",
					{
						designFileId: trickroomMcpTestDesignUuid,
						expectedRevision: staleRevision,
						elementId: "title",
						text: "x",
					},
				);

				expect(result.isError).toBe(true);
				const content = toolPayload(result) as { status: string };
				expect(content.status).toBe("REVISION_MISMATCH");
			} finally {
				await session.close();
			}
		});
	});

	describe("moveElement", () => {
		it("reorders element within same parent", async () => {
			const design: TrickroomDesign = {
				name: "D",
				boards: [
					{
						id: "root",
						props: {
							"data-trickroom-name": "Root",
							"data-trickroom-library": "trickroom",
							"data-trickroom-component": "container",
						},
						children: [
							{
								id: "a",
								props: {
									"data-trickroom-name": "A",
									"data-trickroom-library": "trickroom",
									"data-trickroom-component": "container",
								},
								children: [],
							},
							{
								id: "b",
								props: {
									"data-trickroom-name": "B",
									"data-trickroom-library": "trickroom",
									"data-trickroom-component": "container",
								},
								children: [],
							},
						],
					},
				],
			};
			const { session } = await setup({ [trickroomMcpTestDesignUuid]: design });
			try {
				const revision = await getRevision(session, trickroomMcpTestDesignUuid);

				const result = await applyOperation(session.client, "moveElement", {
					designFileId: trickroomMcpTestDesignUuid,
					expectedRevision: revision,
					elementId: "b",
					targetParentId: "root",
					index: 0,
				});

				expect(result.isError).toBeFalsy();
				const content = toolPayload(result) as { status: string };
				expect(content.status).toBe("success");

				const readResult = await session.client.callTool({
					name: "design_read",
					arguments: {
						depth: 0,
						designFileId: trickroomMcpTestDesignUuid,
						elementId: "root",
					},
				});
				const readContent = toolPayload(readResult) as {
					subtree: { childIds: string[] };
				};
				expect(readContent.subtree.childIds).toEqual(["b", "a"]);
			} finally {
				await session.close();
			}
		});

		it("returns INVALID_OPERATION for cycle detection", async () => {
			const { session } = await setup();
			try {
				const revision = await getRevision(session, trickroomMcpTestDesignUuid);

				const result = await applyOperation(session.client, "moveElement", {
					designFileId: trickroomMcpTestDesignUuid,
					expectedRevision: revision,
					elementId: "board",
					targetParentId: "board",
					index: 0,
				});

				expect(result.isError).toBe(true);
				const content = toolPayload(result) as {
					status: string;
					code: string;
				};
				expect(content.status).toBe("INVALID_OPERATION");
				expect(content.code).toBe("CYCLE_DETECTED");
			} finally {
				await session.close();
			}
		});

		it("returns INVALID_OPERATION when moving into text element", async () => {
			const design: TrickroomDesign = {
				name: "D",
				boards: [
					{
						id: "box",
						props: {
							"data-trickroom-name": "Box",
							"data-trickroom-library": "trickroom",
							"data-trickroom-component": "container",
						},
						children: [],
					},
					{
						id: "label",
						props: {
							"data-trickroom-name": "Label",
							"data-trickroom-library": "trickroom",
							"data-trickroom-component": "text",
							"data-trickroom-role": "text",
						},
						children: "Some text",
					},
				],
			};
			const { session } = await setup({ [trickroomMcpTestDesignUuid]: design });
			try {
				const revision = await getRevision(session, trickroomMcpTestDesignUuid);

				const result = await applyOperation(session.client, "moveElement", {
					designFileId: trickroomMcpTestDesignUuid,
					expectedRevision: revision,
					elementId: "box",
					targetParentId: "label",
					index: 0,
				});

				expect(result.isError).toBe(true);
				const content = toolPayload(result) as {
					status: string;
					code: string;
				};
				expect(content.status).toBe("INVALID_OPERATION");
				expect(content.code).toBe("PARENT_CANNOT_HAVE_CHILDREN");
			} finally {
				await session.close();
			}
		});

		it("returns INVALID_OPERATION when moving into leaf element", async () => {
			const design: TrickroomDesign = {
				name: "D",
				boards: [
					{
						id: "box",
						props: {
							"data-trickroom-name": "Box",
							"data-trickroom-library": "trickroom",
							"data-trickroom-component": "container",
						},
						children: [],
					},
					{
						id: "divider",
						props: {
							"data-trickroom-name": "Divider",
							"data-trickroom-library": "base-ui",
							"data-trickroom-component": "separator",
							"data-trickroom-role": "leaf",
							orientation: "horizontal",
						},
						children: [],
					},
				],
			};
			const { session } = await setup({ [trickroomMcpTestDesignUuid]: design });
			try {
				const revision = await getRevision(session, trickroomMcpTestDesignUuid);

				const result = await applyOperation(session.client, "moveElement", {
					designFileId: trickroomMcpTestDesignUuid,
					expectedRevision: revision,
					elementId: "box",
					targetParentId: "divider",
					index: 0,
				});

				expect(result.isError).toBe(true);
				const content = toolPayload(result) as {
					status: string;
					code: string;
				};
				expect(content.status).toBe("INVALID_OPERATION");
				expect(content.code).toBe("PARENT_CANNOT_HAVE_CHILDREN");
			} finally {
				await session.close();
			}
		});

		it("returns REVISION_MISMATCH on stale revision", async () => {
			const { session } = await setup();
			try {
				const staleRevision =
					"sha256:0000000000000000000000000000000000000000000000000000000000000000";

				const result = await applyOperation(session.client, "moveElement", {
					designFileId: trickroomMcpTestDesignUuid,
					expectedRevision: staleRevision,
					elementId: "board",
					targetParentId: null,
					index: 0,
				});

				expect(result.isError).toBe(true);
				const content = toolPayload(result) as { status: string };
				expect(content.status).toBe("REVISION_MISMATCH");
			} finally {
				await session.close();
			}
		});
	});

	describe("deleteElement", () => {
		it("deletes an element and returns deleted count", async () => {
			const { session } = await setup();
			try {
				const revision = await getRevision(session, trickroomMcpTestDesignUuid);

				const result = await applyOperation(session.client, "deleteElement", {
					designFileId: trickroomMcpTestDesignUuid,
					expectedRevision: revision,
					elementId: "title",
				});

				expect(result.isError).toBeFalsy();
				const content = toolPayload(result);
				expect(content.status).toBe("success");
				expect(content.deletedCount).toBe(1);
				expect(content.newRevision).toEqual(expect.any(String));
			} finally {
				await session.close();
			}
		});

		it("deletes a subtree and reports descendant count", async () => {
			const design: TrickroomDesign = {
				name: "D",
				boards: [
					{
						id: "root",
						props: {
							"data-trickroom-name": "Root",
							"data-trickroom-library": "trickroom",
							"data-trickroom-component": "container",
						},
						children: [
							{
								id: "parent",
								props: {
									"data-trickroom-name": "Parent",
									"data-trickroom-library": "trickroom",
									"data-trickroom-component": "container",
								},
								children: [
									{
										id: "child",
										props: {
											"data-trickroom-name": "Child",
											"data-trickroom-library": "trickroom",
											"data-trickroom-component": "text",
											"data-trickroom-role": "text",
										},
										children: "leaf text",
									},
								],
							},
						],
					},
				],
			};
			const { session } = await setup({ [trickroomMcpTestDesignUuid]: design });
			try {
				const revision = await getRevision(session, trickroomMcpTestDesignUuid);

				const result = await applyOperation(session.client, "deleteElement", {
					designFileId: trickroomMcpTestDesignUuid,
					expectedRevision: revision,
					elementId: "parent",
				});

				expect(result.isError).toBeFalsy();
				const content = toolPayload(result) as {
					status: string;
					deletedCount: number;
				};
				expect(content.status).toBe("success");
				expect(content.deletedCount).toBe(2);
			} finally {
				await session.close();
			}
		});

		it("returns INVALID_OPERATION when element not found", async () => {
			const { session } = await setup();
			try {
				const revision = await getRevision(session, trickroomMcpTestDesignUuid);

				const result = await applyOperation(session.client, "deleteElement", {
					designFileId: trickroomMcpTestDesignUuid,
					expectedRevision: revision,
					elementId: "nonexistent",
				});

				expect(result.isError).toBe(true);
				const content = toolPayload(result) as {
					status: string;
					code: string;
				};
				expect(content.status).toBe("INVALID_OPERATION");
				expect(content.code).toBe("ELEMENT_NOT_FOUND");
			} finally {
				await session.close();
			}
		});

		it("returns REVISION_MISMATCH on stale revision", async () => {
			const { session } = await setup();
			try {
				const staleRevision =
					"sha256:0000000000000000000000000000000000000000000000000000000000000000";

				const result = await applyOperation(session.client, "deleteElement", {
					designFileId: trickroomMcpTestDesignUuid,
					expectedRevision: staleRevision,
					elementId: "title",
				});

				expect(result.isError).toBe(true);
				const content = toolPayload(result) as { status: string };
				expect(content.status).toBe("REVISION_MISMATCH");
			} finally {
				await session.close();
			}
		});

		it("persisted change is visible in subsequent reads", async () => {
			const { session } = await setup();
			try {
				const revision = await getRevision(session, trickroomMcpTestDesignUuid);

				await applyOperation(session.client, "deleteElement", {
					designFileId: trickroomMcpTestDesignUuid,
					expectedRevision: revision,
					elementId: "title",
				});

				const readResult = await session.client.callTool({
					name: "design_read",
					arguments: {
						depth: 0,
						designFileId: trickroomMcpTestDesignUuid,
						elementId: "board",
					},
				});
				const readContent = toolPayload(readResult) as {
					subtree: { childIds: string[] };
				};
				expect(readContent.subtree.childIds).not.toContain("title");
			} finally {
				await session.close();
			}
		});
	});

	describe("recipe structural locks", () => {
		const expectRecipeLock = (
			result: { isError?: boolean; structuredContent?: unknown },
			code: "RECIPE_STRUCTURE_LOCKED" | "RECIPE_STRUCTURAL_NODE_LOCKED",
		) => {
			expect(result.isError).toBe(true);
			const content = toolPayload(result) as {
				status: string;
				code: string;
				message: string;
			};
			expect(content.status).toBe("INVALID_OPERATION");
			expect(content.code).toBe(code);
			expect(content.message).toContain("avatar-root");
			expect(content.message).toContain("detachRecipeInstance");
		};

		const expectInvalidOperationParameter = (
			result: { isError?: boolean; structuredContent?: unknown },
			parameterName: string,
		) => {
			expect(result.isError).toBeFalsy();
			const content = toolPayload(result) as {
				status: string;
				valid: boolean;
				issues: Array<{ code: string; message: string }>;
			};
			expect(content.status).toBe("INVALID_OPERATION");
			expect(content.valid).toBe(false);
			expect(content.issues[0]?.code).toBe("INVALID_OPERATION_PARAMETERS");
			expect(content.issues[0]?.message).toContain(parameterName);
		};

		it("adds an Avatar recipe and returns the attached recipe root", async () => {
			const { fixture, session } = await setup();
			try {
				const revision = await getRevision(session, trickroomMcpTestDesignUuid);

				const result = await applyOperation(session.client, "addRecipe", {
					designFileId: trickroomMcpTestDesignUuid,
					expectedRevision: revision,
					parentId: "board",
					index: 1,
					library: "base-ui",
					recipe: "avatar.default",
					response: "full",
				});

				expect(result.isError).toBeFalsy();
				const [step] = toolPayload(result).steps;
				const recipe = step.summary.recipe;
				const rootId = step.changedElementId;
				expect(recipe.id).toBe("base-ui/avatar.default");
				expect(recipe.elementIdsByPath).toMatchObject({ root: rootId });
				expect(step.recipes).toEqual([
					{
						recipeId: "base-ui/avatar.default",
						rootElementId: rootId,
						slots: { fallback: recipe.elementIdsByPath.fallback },
					},
				]);
				const added = await readElementPayload(
					session.client,
					trickroomMcpTestDesignUuid,
					rootId,
				);
				expect(added.subtree.component).toBe("base-ui/avatar.root");
				expect(added.context.parentId).toBe("board");

				const persisted = await fixture.designFileService.readDesignFile(
					fixture.designFileService.getFileForUuid(trickroomMcpTestDesignUuid),
				);
				const board = persisted.design.boards[0];
				expect(Array.isArray(board.children)).toBe(true);
				const avatarRoot = Array.isArray(board.children)
					? board.children.find((child) => child.id === rootId)
					: null;
				expect(avatarRoot?.props).toMatchObject(
					getRecipeMarkerProps({
						recipeId: "base-ui/avatar.default",
						instanceId: recipe.instanceId,
						path: "root",
						isRoot: true,
					}),
				);
			} finally {
				await session.close();
			}
		});

		it("dry-runs adding an Avatar recipe without writing", async () => {
			const { fixture, session } = await setup();
			try {
				const revision = await getRevision(session, trickroomMcpTestDesignUuid);

				const result = await session.client.callTool({
					name: "validateOperation",
					arguments: {
						designFileId: trickroomMcpTestDesignUuid,
						expectedRevision: revision,
						operation: "addRecipe",
						parameters: {
							parentId: "board",
							index: 1,
							library: "base-ui",
							recipe: "avatar.default",
						},
					},
				});

				expect(result.isError).toBeFalsy();
				expect(toolPayload(result)).toMatchObject({
					status: "success",
					valid: true,
					operation: "addRecipe",
					predicted: {
						parentId: "board",
						index: 1,
						recipeId: "base-ui/avatar.default",
						nodeCount: 3,
					},
				});
				// Dry-run ids are not the ids a write would create.
				expect(JSON.stringify(toolPayload(result))).not.toContain(
					"elementIdsByPath",
				);

				const persisted = await fixture.designFileService.readDesignFile(
					fixture.designFileService.getFileForUuid(trickroomMcpTestDesignUuid),
				);
				expect(persisted.revision).toBe(revision);
				expect(persisted.design).toEqual(trickroomMcpTestDesign);
			} finally {
				await session.close();
			}
		});

		it("delegates addSubtree validation through validateOperation without writing", async () => {
			const { fixture, session } = await setup();
			try {
				const revision = await getRevision(session, trickroomMcpTestDesignUuid);
				const result = await session.client.callTool({
					name: "validateOperation",
					arguments: {
						designFileId: trickroomMcpTestDesignUuid,
						expectedRevision: revision,
						operation: "addSubtree",
						parameters: {
							parentId: "board",
							index: 1,
							subtree: {
								tempId: "dry-run-container",
								library: "trickroom",
								component: "container",
								children: [
									{
										tempId: "dry-run-text",
										library: "trickroom",
										component: "text",
										text: "Dry run subtree",
									},
								],
							},
						},
					},
				});

				expect(result.isError).toBeFalsy();
				expect(toolPayload(result)).toMatchObject({
					status: "success",
					valid: true,
					operation: "addSubtree",
					predicted: {
						parentId: "board",
						index: 1,
						stats: { nodeCount: 2 },
						nodeCount: 2,
					},
					issues: [],
				});
				expect(
					(toolPayload(result) as { predicted: object }).predicted,
				).not.toHaveProperty("rootElementId");

				const persisted = await fixture.designFileService.readDesignFile(
					fixture.designFileService.getFileForUuid(trickroomMcpTestDesignUuid),
				);
				expect(persisted.revision).toBe(revision);
				expect(persisted.design).toEqual(trickroomMcpTestDesign);
			} finally {
				await session.close();
			}
		});

		it("delegates copySubtree validation through validateOperation without writing", async () => {
			const { fixture, session } = await setup();
			try {
				const revision = await getRevision(session, trickroomMcpTestDesignUuid);
				const result = await session.client.callTool({
					name: "validateOperation",
					arguments: {
						designFileId: trickroomMcpTestDesignUuid,
						expectedRevision: revision,
						operation: "copySubtree",
						parameters: {
							sourceDesignFileId: trickroomMcpTestDesignUuid,
							sourceElementId: "title",
							parentId: "board",
							index: 1,
						},
					},
				});

				expect(result.isError).toBeFalsy();
				expect(toolPayload(result)).toMatchObject({
					status: "success",
					valid: true,
					operation: "copySubtree",
					predicted: {
						sourceDesignFileId: trickroomMcpTestDesignUuid,
						sourceElementId: "title",
						parentId: "board",
						index: 1,
						sameDesign: true,
						stats: { nodeCount: 1, maxDepth: 1 },
					},
					issues: [],
				});
				const content = toolPayload(result) as {
					predicted: Record<string, unknown>;
				};
				expect(content.predicted).not.toHaveProperty("idMap");
				expect(content.predicted).not.toHaveProperty("inserted");
				expect(content.predicted).not.toHaveProperty("changedElement");
				expect(content.predicted).not.toHaveProperty("context");

				const persisted = await fixture.designFileService.readDesignFile(
					fixture.designFileService.getFileForUuid(trickroomMcpTestDesignUuid),
				);
				expect(persisted.revision).toBe(revision);
				expect(persisted.design).toEqual(trickroomMcpTestDesign);
			} finally {
				await session.close();
			}
		});

		it("rejects addRecipe dry-run parameters that do not match the write schema", async () => {
			const { session } = await setup();
			try {
				const revision = await getRevision(session, trickroomMcpTestDesignUuid);
				const invalidCases = [
					{
						parameterName: "index",
						parameters: {
							parentId: "board",
							index: -1,
							library: "base-ui",
							recipe: "avatar.default",
						},
					},
					{
						parameterName: "parentId",
						parameters: {
							parentId: "",
							index: 1,
							library: "base-ui",
							recipe: "avatar.default",
						},
					},
					{
						parameterName: "library",
						parameters: {
							parentId: "board",
							index: 1,
							library: "",
							recipe: "avatar.default",
						},
					},
					{
						parameterName: "recipe",
						parameters: {
							parentId: "board",
							index: 1,
							library: "base-ui",
							recipe: "",
						},
					},
				];

				for (const { parameterName, parameters } of invalidCases) {
					const result = await session.client.callTool({
						name: "validateOperation",
						arguments: {
							designFileId: trickroomMcpTestDesignUuid,
							expectedRevision: revision,
							operation: "addRecipe",
							parameters,
						},
					});

					expectInvalidOperationParameter(result, parameterName);
				}

				expect(await getRevision(session, trickroomMcpTestDesignUuid)).toBe(
					revision,
				);
			} finally {
				await session.close();
			}
		});

		it("rejects adding into recipe-owned non-slot structure but allows slot insertion", async () => {
			const { session } = await setup({
				[trickroomMcpTestDesignUuid]: avatarRecipeMcpDesign(),
			});
			try {
				const revision = await getRevision(session, trickroomMcpTestDesignUuid);

				const lockedResult = await applyOperation(
					session.client,
					"addElement",
					{
						designFileId: trickroomMcpTestDesignUuid,
						expectedRevision: revision,
						parentId: "avatar-root",
						index: 0,
						library: "trickroom",
						component: "container",
					},
				);
				expectRecipeLock(lockedResult, "RECIPE_STRUCTURE_LOCKED");
				expect(await getRevision(session, trickroomMcpTestDesignUuid)).toBe(
					revision,
				);

				const slotResult = await applyOperation(session.client, "addElement", {
					designFileId: trickroomMcpTestDesignUuid,
					expectedRevision: revision,
					parentId: "avatar-fallback",
					index: 0,
					library: "trickroom",
					component: "container",
				});
				expect(slotResult.isError).toBeFalsy();
				expect(toolPayload(slotResult)).toMatchObject({
					status: "success",
				});
				expect(await getRevision(session, trickroomMcpTestDesignUuid)).not.toBe(
					revision,
				);

				const textSlotResult = await applyOperation(
					session.client,
					"addElement",
					{
						designFileId: trickroomMcpTestDesignUuid,
						expectedRevision: await getRevision(
							session,
							trickroomMcpTestDesignUuid,
						),
						parentId: "avatar-fallback",
						index: 1,
						library: "trickroom",
						component: "text",
						text: "JP",
					},
				);
				expect(textSlotResult.isError).toBeFalsy();
				expect(toolPayload(textSlotResult).status).toBe("success");
				const slotText = await readElementPayload(
					session.client,
					trickroomMcpTestDesignUuid,
					toolPayload(textSlotResult).created[0].id,
				);
				expect(slotText.context.parentId).toBe("avatar-fallback");
			} finally {
				await session.close();
			}
		});

		it("allows declared structural controls while rejecting marker writes, move, and delete", async () => {
			const { session } = await setup({
				[trickroomMcpTestDesignUuid]: avatarRecipeMcpDesign(),
			});
			try {
				const revision = await getRevision(session, trickroomMcpTestDesignUuid);

				const moveResult = await applyOperation(session.client, "moveElement", {
					designFileId: trickroomMcpTestDesignUuid,
					expectedRevision: revision,
					elementId: "avatar-image",
					targetParentId: null,
					index: 0,
				});
				expectRecipeLock(moveResult, "RECIPE_STRUCTURAL_NODE_LOCKED");

				const deleteResult = await applyOperation(
					session.client,
					"deleteElement",
					{
						designFileId: trickroomMcpTestDesignUuid,
						expectedRevision: revision,
						elementId: "avatar-image",
					},
				);
				expectRecipeLock(deleteResult, "RECIPE_STRUCTURAL_NODE_LOCKED");

				const markerResult = await applyOperation(
					session.client,
					"updateElementProps",
					{
						designFileId: trickroomMcpTestDesignUuid,
						expectedRevision: revision,
						elementId: "avatar-image",
						props: { [recipeInstanceProp]: "other-instance" },
					},
				);
				expect(markerResult.isError).toBe(true);
				expect(toolPayload(markerResult)).toMatchObject({
					status: "INVALID_OPERATION",
					code: "INVALID_PROP_KEY",
				});

				const controlResult = await applyOperation(
					session.client,
					"updateElementProps",
					{
						designFileId: trickroomMcpTestDesignUuid,
						expectedRevision: revision,
						elementId: "avatar-image",
						props: {
							[assetIdProp]: "",
							alt: "Profile photo",
						},
					},
				);
				expect(controlResult.isError).toBeFalsy();
				expect(toolPayload(controlResult)).toMatchObject({
					status: "success",
				});

				const controlContent = toolPayload(controlResult) as {
					newRevision: string;
				};
				const renameResult = await applyOperation(
					session.client,
					"updateElementProps",
					{
						designFileId: trickroomMcpTestDesignUuid,
						expectedRevision: controlContent.newRevision,
						elementId: "avatar-fallback",
						name: "Initials Fallback",
						className: "grid place-items-center",
					},
				);
				expect(renameResult.isError).toBeFalsy();
				const renameContent = toolPayload(renameResult);
				const renamed = await readElementPayload(
					session.client,
					trickroomMcpTestDesignUuid,
					"avatar-fallback",
				);
				expect(renamed.subtree.name).toBe("Initials Fallback");

				const rootDeleteResult = await applyOperation(
					session.client,
					"deleteElement",
					{
						designFileId: trickroomMcpTestDesignUuid,
						expectedRevision: renameContent.newRevision,
						elementId: "avatar-root",
					},
				);
				expect(rootDeleteResult.isError).toBeFalsy();
				expect(toolPayload(rootDeleteResult)).toMatchObject({
					status: "success",
					deletedCount: 4,
				});
			} finally {
				await session.close();
			}
		});

		it("updates Menu recipe controls by instance path and keeps undeclared structural props rejected", async () => {
			let nextId = 0;
			const expansion = expandRegistryRecipe("base-ui", "menu.default", {
				createElementId: () => `menu-${nextId++}`,
				createRecipeInstanceId: () => "menu-instance-1",
			});
			const { session } = await setup({
				[trickroomMcpTestDesignUuid]: {
					name: "Menu Recipe",
					boards: [expansion.root],
				},
			});
			try {
				const revision = await getRevision(session, trickroomMcpTestDesignUuid);

				const modalResult = await applyOperation(
					session.client,
					"updateRecipeControl",
					{
						designFileId: trickroomMcpTestDesignUuid,
						expectedRevision: revision,
						instanceId: "menu-instance-1",
						path: "root",
						prop: "modal",
						value: false,
						response: "full",
					},
				);
				expect(modalResult.isError).toBeFalsy();
				expect(toolPayload(modalResult)).toMatchObject({
					status: "success",
					steps: [
						{
							operation: "updateRecipeControl",
							changedElementId: expansion.elementIdsByPath.root,
							summary: {
								instanceId: "menu-instance-1",
								path: "root",
								prop: "modal",
								value: false,
							},
						},
					],
				});

				const modalContent = toolPayload(modalResult) as {
					newRevision: string;
				};
				const alignResult = await applyOperation(
					session.client,
					"updateRecipeControl",
					{
						designFileId: trickroomMcpTestDesignUuid,
						expectedRevision: modalContent.newRevision,
						instanceId: "menu-instance-1",
						path: "positioner",
						prop: "align",
						value: "end",
					},
				);
				expect(alignResult.isError).toBeFalsy();

				const alignContent = toolPayload(alignResult) as {
					newRevision: string;
				};
				const sideResult = await applyOperation(
					session.client,
					"updateRecipeControl",
					{
						designFileId: trickroomMcpTestDesignUuid,
						expectedRevision: alignContent.newRevision,
						instanceId: "menu-instance-1",
						path: "positioner",
						prop: "side",
						value: "top",
					},
				);
				expect(sideResult.isError).toBeFalsy();

				const sideContent = toolPayload(sideResult) as {
					newRevision: string;
				};
				const sideOffsetResult = await applyOperation(
					session.client,
					"updateRecipeControl",
					{
						designFileId: trickroomMcpTestDesignUuid,
						expectedRevision: sideContent.newRevision,
						instanceId: "menu-instance-1",
						path: "positioner",
						prop: "sideOffset",
						value: 12,
					},
				);
				expect(sideOffsetResult.isError).toBeFalsy();

				const rootRead = await session.client.callTool({
					name: "design_read",
					arguments: {
						depth: 0,
						detail: "full",
						designFileId: trickroomMcpTestDesignUuid,
						elementId: expansion.elementIdsByPath.root,
					},
				});
				expect(toolPayload(rootRead)).toMatchObject({
					subtree: {
						props: {
							modal: false,
							[recipeInstanceProp]: "menu-instance-1",
						},
					},
				});

				const positionerRead = await session.client.callTool({
					name: "design_read",
					arguments: {
						depth: 0,
						detail: "full",
						designFileId: trickroomMcpTestDesignUuid,
						elementId: expansion.elementIdsByPath.positioner,
					},
				});
				expect(toolPayload(positionerRead)).toMatchObject({
					subtree: {
						props: {
							align: "end",
							side: "top",
							sideOffset: 12,
							[recipeInstanceProp]: "menu-instance-1",
						},
					},
				});

				const sideOffsetContent = toolPayload(sideOffsetResult) as {
					newRevision: string;
				};
				const undeclaredResult = await applyOperation(
					session.client,
					"updateRecipeControl",
					{
						designFileId: trickroomMcpTestDesignUuid,
						expectedRevision: sideOffsetContent.newRevision,
						instanceId: "menu-instance-1",
						path: "positioner",
						prop: "avoidCollisions",
						value: false,
					},
				);
				expect(undeclaredResult.isError).toBe(true);
				expect(toolPayload(undeclaredResult)).toMatchObject({
					status: "INVALID_OPERATION",
					code: "RECIPE_CONTROL_NOT_FOUND",
				});
			} finally {
				await session.close();
			}
		});

		it("updates a stale recipe instance and returns migration metadata", async () => {
			await withAvatarLegacyPreviousTemplate(async () => {
				const { fixture, session } = await setup({
					[trickroomMcpTestDesignUuid]: staleAvatarRecipeMcpDesign(),
				});
				try {
					const revision = await getRevision(
						session,
						trickroomMcpTestDesignUuid,
					);

					const result = await applyOperation(
						session.client,
						"updateRecipeInstance",
						{
							designFileId: trickroomMcpTestDesignUuid,
							expectedRevision: revision,
							elementId: "avatar-root",
							response: "full",
						},
					);

					expect(result.isError).toBeFalsy();
					const [step] = toolPayload(result).steps;
					expect(step.changedElementId).toBe("avatar-root");
					expect(step.summary).toMatchObject({
						recipeMigration: {
							recipeId: "base-ui/avatar.default",
							instanceId: "recipe-instance-1",
							fromVersion: "0.9",
							toVersion: "1",
							preservedSlots: [
								expect.objectContaining({
									slotName: "fallback",
									fromPath: "legacy-fallback",
									toPath: "fallback",
									preservedChildIds: ["slot-child"],
								}),
							],
							remappedPaths: [
								expect.objectContaining({
									fromPath: "legacy-fallback",
									toPath: "fallback",
									elementId: "avatar-fallback",
								}),
							],
							addedPaths: [
								expect.objectContaining({
									toPath: "image",
								}),
							],
						},
					});
					expect(step.summary.recipeMigration.fromTemplateHash).toMatch(
						/^trh1:/,
					);
					expect(step.summary.recipeMigration.toTemplateHash).toMatch(/^trh1:/);

					const persisted = await fixture.designFileService.readDesignFile(
						fixture.designFileService.getFileForUuid(
							trickroomMcpTestDesignUuid,
						),
					);
					const root = persisted.design.boards[0];
					const children = root.children as Node[];
					expect(children.map((child) => child.props[recipePathProp])).toEqual([
						"image",
						"fallback",
					]);
					expect((children[1].children as Node[])[0].id).toBe("slot-child");
				} finally {
					await session.close();
				}
			});
		});

		it("refuses updateRecipeInstance for invalid-known and unknown instances", async () => {
			const invalid = avatarRecipeMcpDesign();
			(invalid.boards[0].children as Node[]).pop();
			const { session } = await setup({
				[trickroomMcpTestDesignUuid]: invalid,
			});
			try {
				const revision = await getRevision(session, trickroomMcpTestDesignUuid);
				const invalidResult = await applyOperation(
					session.client,
					"updateRecipeInstance",
					{
						designFileId: trickroomMcpTestDesignUuid,
						expectedRevision: revision,
						elementId: "avatar-root",
					},
				);

				expect(invalidResult.isError).toBe(true);
				expect(toolPayload(invalidResult)).toMatchObject({
					status: "INVALID_OPERATION",
					code: "RECIPE_INSTANCE_NOT_STALE",
				});
			} finally {
				await session.close();
			}

			const unknown = avatarRecipeMcpDesign();
			for (const node of [
				unknown.boards[0],
				...(unknown.boards[0].children as Node[]),
			]) {
				node.props["data-trickroom-recipe-id"] = "base-ui/missing.recipe";
			}
			const unknownSetup = await setup({
				[trickroomMcpTestDesignUuid]: unknown,
			});
			try {
				const revision = await getRevision(
					unknownSetup.session,
					trickroomMcpTestDesignUuid,
				);
				const unknownResult = await applyOperation(
					unknownSetup.session.client,
					"updateRecipeInstance",
					{
						designFileId: trickroomMcpTestDesignUuid,
						expectedRevision: revision,
						elementId: "avatar-root",
					},
				);

				expect(unknownResult.isError).toBe(true);
				expect(toolPayload(unknownResult)).toMatchObject({
					status: "INVALID_OPERATION",
					code: "RECIPE_INSTANCE_NOT_STALE",
				});
			} finally {
				await unknownSetup.session.close();
			}
		});

		it("dry-runs updateRecipeInstance without writing", async () => {
			await withAvatarLegacyPreviousTemplate(async () => {
				const { fixture, session } = await setup({
					[trickroomMcpTestDesignUuid]: staleAvatarRecipeMcpDesign(),
				});
				try {
					const revision = await getRevision(
						session,
						trickroomMcpTestDesignUuid,
					);

					const result = await session.client.callTool({
						name: "validateOperation",
						arguments: {
							designFileId: trickroomMcpTestDesignUuid,
							expectedRevision: revision,
							operation: "updateRecipeInstance",
							parameters: {
								elementId: "avatar-root",
							},
						},
					});

					expect(result.isError).toBeFalsy();
					expect(toolPayload(result)).toMatchObject({
						status: "success",
						valid: true,
						operation: "updateRecipeInstance",
						predicted: {
							recipeMigration: {
								fromVersion: "0.9",
								toVersion: "1",
							},
						},
					});
					const persisted = await fixture.designFileService.readDesignFile(
						fixture.designFileService.getFileForUuid(
							trickroomMcpTestDesignUuid,
						),
					);
					expect(persisted.revision).toBe(revision);
					expect(JSON.stringify(persisted.design)).toContain("legacy-fallback");
				} finally {
					await session.close();
				}
			});
		});

		it("dry-runs updateRecipeControl without writing", async () => {
			let nextId = 0;
			const expansion = expandRegistryRecipe("base-ui", "menu.default", {
				createElementId: () => `menu-${nextId++}`,
				createRecipeInstanceId: () => "menu-instance-1",
			});
			const { fixture, session } = await setup({
				[trickroomMcpTestDesignUuid]: {
					name: "Menu Recipe",
					boards: [expansion.root],
				},
			});
			try {
				const revision = await getRevision(session, trickroomMcpTestDesignUuid);
				const before = await fixture.designFileService.readDesignFile(
					fixture.designFileService.getFileForUuid(trickroomMcpTestDesignUuid),
				);

				const result = await session.client.callTool({
					name: "validateOperation",
					arguments: {
						designFileId: trickroomMcpTestDesignUuid,
						expectedRevision: revision,
						operation: "updateRecipeControl",
						parameters: {
							instanceId: "menu-instance-1",
							path: "positioner",
							prop: "align",
							value: "end",
						},
					},
				});

				expect(result.isError).toBeFalsy();
				expect(toolPayload(result)).toMatchObject({
					status: "success",
					valid: true,
					operation: "updateRecipeControl",
					predicted: {
						instanceId: "menu-instance-1",
						path: "positioner",
						prop: "align",
						value: "end",
						changedElementId: expansion.elementIdsByPath.positioner,
					},
				});

				const after = await fixture.designFileService.readDesignFile(
					fixture.designFileService.getFileForUuid(trickroomMcpTestDesignUuid),
				);
				expect(after.revision).toBe(revision);
				expect(after.design).toEqual(before.design);
			} finally {
				await session.close();
			}
		});

		it("dry-runs detaching a recipe instance without writing", async () => {
			const { fixture, session } = await setup({
				[trickroomMcpTestDesignUuid]: avatarRecipeMcpDesign(),
			});
			try {
				const revision = await getRevision(session, trickroomMcpTestDesignUuid);

				const result = await session.client.callTool({
					name: "validateOperation",
					arguments: {
						designFileId: trickroomMcpTestDesignUuid,
						expectedRevision: revision,
						operation: "detachRecipeInstance",
						parameters: {
							elementId: "avatar-image",
						},
					},
				});

				expect(result.isError).toBeFalsy();
				expect(toolPayload(result)).toMatchObject({
					status: "success",
					valid: true,
					operation: "detachRecipeInstance",
					predicted: {
						elementId: "avatar-image",
						recipe: {
							id: "base-ui/avatar.default",
							instanceId: "recipe-instance-1",
							rootElementId: "avatar-root",
						},
						changedElementId: "avatar-image",
					},
				});
				const content = toolPayload(result) as {
					predicted: { detachedElementIds: string[] };
				};
				expect(content.predicted.detachedElementIds.sort()).toEqual([
					"avatar-fallback",
					"avatar-image",
					"avatar-root",
				]);

				const persisted = await fixture.designFileService.readDesignFile(
					fixture.designFileService.getFileForUuid(trickroomMcpTestDesignUuid),
				);
				expect(persisted.revision).toBe(revision);
				expect(JSON.stringify(persisted.design)).toContain(recipeInstanceProp);
			} finally {
				await session.close();
			}
		});

		it("rejects detachRecipeInstance dry-run parameters that do not match the write schema", async () => {
			const { session } = await setup({
				[trickroomMcpTestDesignUuid]: avatarRecipeMcpDesign(),
			});
			try {
				const revision = await getRevision(session, trickroomMcpTestDesignUuid);

				const result = await session.client.callTool({
					name: "validateOperation",
					arguments: {
						designFileId: trickroomMcpTestDesignUuid,
						expectedRevision: revision,
						operation: "detachRecipeInstance",
						parameters: {
							elementId: "",
						},
					},
				});

				expectInvalidOperationParameter(result, "elementId");
				expect(await getRevision(session, trickroomMcpTestDesignUuid)).toBe(
					revision,
				);
			} finally {
				await session.close();
			}
		});

		it("detaches a recipe by structural child and then allows normal mutation", async () => {
			const { fixture, session } = await setup({
				[trickroomMcpTestDesignUuid]: avatarRecipeMcpDesign(),
			});
			try {
				const revision = await getRevision(session, trickroomMcpTestDesignUuid);

				const detachResult = await applyOperation(
					session.client,
					"detachRecipeInstance",
					{
						designFileId: trickroomMcpTestDesignUuid,
						expectedRevision: revision,
						elementId: "avatar-image",
						response: "full",
					},
				);
				expect(detachResult.isError).toBeFalsy();
				const detachContent = toolPayload(detachResult);
				const [detachStep] = detachContent.steps;
				expect(detachStep.summary.recipe).toMatchObject({
					id: "base-ui/avatar.default",
					instanceId: "recipe-instance-1",
					rootElementId: "avatar-root",
				});
				expect(detachStep.summary.detachedElementIds.sort()).toEqual([
					"avatar-fallback",
					"avatar-image",
					"avatar-root",
				]);

				const updateResult = await applyOperation(
					session.client,
					"updateElementProps",
					{
						designFileId: trickroomMcpTestDesignUuid,
						expectedRevision: detachContent.newRevision,
						elementId: "avatar-image",
						props: { [assetIdProp]: "", alt: "Detached avatar" },
					},
				);
				expect(updateResult.isError).toBeFalsy();

				const moveRevision = (
					toolPayload(updateResult) as {
						newRevision: string;
					}
				).newRevision;
				const moveResult = await applyOperation(session.client, "moveElement", {
					designFileId: trickroomMcpTestDesignUuid,
					expectedRevision: moveRevision,
					elementId: "avatar-image",
					targetParentId: null,
					index: 0,
				});
				expect(moveResult.isError).toBeFalsy();

				const persisted = await fixture.designFileService.readDesignFile(
					fixture.designFileService.getFileForUuid(trickroomMcpTestDesignUuid),
				);
				const serialized = JSON.stringify(persisted.design);
				expect(serialized).not.toContain(recipeInstanceProp);
			} finally {
				await session.close();
			}
		});
	});

	describe("sequential mutations and revision chaining", () => {
		it("supports multiple mutations using chained revisions", async () => {
			const { session } = await setup();
			try {
				const rev1 = await getRevision(session, trickroomMcpTestDesignUuid);

				const addResult = await applyOperation(session.client, "addElement", {
					designFileId: trickroomMcpTestDesignUuid,
					expectedRevision: rev1,
					parentId: "board",
					index: 1,
					library: "trickroom",
					component: "text",
					name: "Footer",
					text: "Footer text",
				});

				expect(addResult.isError).toBeFalsy();
				const addContent = toolPayload(addResult) as {
					newRevision: string;
					created: Array<{ id: string }>;
				};
				const rev2 = addContent.newRevision;
				const newId = addContent.created[0].id;

				const updateResult = await applyOperation(
					session.client,
					"updateElementText",
					{
						designFileId: trickroomMcpTestDesignUuid,
						expectedRevision: rev2,
						elementId: newId,
						text: "Updated footer text",
					},
				);

				expect(updateResult.isError).toBeFalsy();
				const updateContent = toolPayload(updateResult) as {
					status: string;
				};
				expect(updateContent.status).toBe("success");

				expect(rev1).not.toBe(rev2);
			} finally {
				await session.close();
			}
		});

		it("second mutation fails with stale revision from before first mutation", async () => {
			const { session } = await setup();
			try {
				const staleRevision = await getRevision(
					session,
					trickroomMcpTestDesignUuid,
				);

				const addResult = await applyOperation(session.client, "addElement", {
					designFileId: trickroomMcpTestDesignUuid,
					expectedRevision: staleRevision,
					parentId: null,
					index: 0,
					library: "trickroom",
					component: "container",
				});
				expect(addResult.isError).toBeFalsy();

				const failResult = await applyOperation(
					session.client,
					"updateElementText",
					{
						designFileId: trickroomMcpTestDesignUuid,
						expectedRevision: staleRevision,
						elementId: "title",
						text: "Should fail",
					},
				);

				expect(failResult.isError).toBe(true);
				const failContent = toolPayload(failResult) as { status: string };
				expect(failContent.status).toBe("REVISION_MISMATCH");
			} finally {
				await session.close();
			}
		});
	});

	describe("operation plans", () => {
		it("validates a successful multi-step plan without writing", async () => {
			const { fixture, session } = await setup();
			try {
				const revision = await getRevision(session, trickroomMcpTestDesignUuid);
				const result = await session.client.callTool({
					name: "validateOperationPlan",
					arguments: {
						designFileId: trickroomMcpTestDesignUuid,
						expectedRevision: revision,
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
				});

				expect(result.isError).toBeFalsy();
				expect(toolPayload(result)).toMatchObject({
					status: "success",
					valid: true,
					operationCount: 2,
					summary: { errors: 0 },
					issues: [],
				});
				expect(toolPayload(result)).not.toHaveProperty("steps");

				const persisted = await fixture.designFileService.readDesignFile(
					fixture.designFileService.getFileForUuid(trickroomMcpTestDesignUuid),
				);
				expect(persisted.revision).toBe(revision);
				expect(persisted.design).toEqual(trickroomMcpTestDesign);
			} finally {
				await session.close();
			}
		});

		it("returns failedStepIndex for invalid middle steps without writing", async () => {
			const { fixture, session } = await setup();
			try {
				const revision = await getRevision(session, trickroomMcpTestDesignUuid);
				const result = await session.client.callTool({
					name: "validateOperationPlan",
					arguments: {
						designFileId: trickroomMcpTestDesignUuid,
						expectedRevision: revision,
						operations: [
							{
								operation: "addElement",
								parameters: {
									parentId: "board",
									index: 1,
									library: "trickroom",
									component: "text",
									text: "Footer",
								},
							},
							{
								operation: "moveElement",
								parameters: {
									elementId: "missing-element",
									targetParentId: "board",
									index: 0,
								},
							},
						],
					},
				});

				expect(result.isError).toBeFalsy();
				expect(toolPayload(result)).toMatchObject({
					status: "INVALID_OPERATION",
					valid: false,
					failedStepIndex: 1,
					failedOperation: "moveElement",
					issues: [expect.objectContaining({ code: "ELEMENT_NOT_FOUND" })],
				});

				const persisted = await fixture.designFileService.readDesignFile(
					fixture.designFileService.getFileForUuid(trickroomMcpTestDesignUuid),
				);
				expect(persisted.revision).toBe(revision);
			} finally {
				await session.close();
			}
		});

		it("returns a compact applyDesignOperations result with created ids", async () => {
			const { session } = await setup();
			try {
				const revision = await getRevision(session, trickroomMcpTestDesignUuid);
				const result = await session.client.callTool({
					name: "design_apply",
					arguments: {
						designFileId: trickroomMcpTestDesignUuid,
						expectedRevision: revision,
						operations: [
							{
								operation: "addSubtree",
								parameters: {
									parentId: "board",
									index: 1,
									subtree: {
										tempId: "card",
										library: "trickroom",
										component: "container",
										children: [
											{
												tempId: "label",
												library: "trickroom",
												component: "text",
												text: "Label",
											},
										],
									},
								},
							},
						],
					},
				});

				expect(result.isError).toBeFalsy();
				const content = toolPayload(result) as Record<string, unknown> & {
					created: Array<Record<string, unknown>>;
					project: Record<string, unknown>;
				};
				expect(content).toMatchObject({
					status: "success",
					designFileId: trickroomMcpTestDesignUuid,
					newRevision: expect.any(String),
					created: [
						{
							step: 0,
							id: expect.any(String),
							idMap: {
								card: expect.any(String),
								label: expect.any(String),
							},
						},
					],
				});
				expect(content.created[0].idMap).toMatchObject({
					card: content.created[0].id,
				});
				expect(content).not.toHaveProperty("steps");
				expect(content).not.toHaveProperty("insertedElementIds");
				expect(content).not.toHaveProperty("recipeExpansions");
				expect(content).not.toHaveProperty("designFile");
				expect(content.project).not.toHaveProperty("projectRoot");

				const text = (
					result.content as Array<{ type: string; text: string }>
				)[0].text;
				expect(text).not.toContain("\n");
				expect(JSON.parse(text)).toEqual(content);
			} finally {
				await session.close();
			}
		});

		it("reports only counts for updates and deletes and groups repeated warnings", async () => {
			const { session } = await setup();
			try {
				const revision = await getRevision(session, trickroomMcpTestDesignUuid);
				const result = await session.client.callTool({
					name: "design_apply",
					arguments: {
						designFileId: trickroomMcpTestDesignUuid,
						expectedRevision: revision,
						operations: [
							{
								operation: "addElement",
								parameters: {
									parentId: "board",
									index: 1,
									library: "trickroom",
									component: "text",
									text: "Footer",
									className: "flex-colum",
								},
							},
							{
								operation: "updateElementProps",
								parameters: { elementId: "board", className: "flex-colum" },
							},
							{
								operation: "updateElementText",
								parameters: { elementId: "$step:0", text: "Updated" },
							},
							{
								operation: "deleteElement",
								parameters: { elementId: "title" },
							},
						],
					},
				});

				expect(result.isError).toBeFalsy();
				const content = toolPayload(result) as {
					created: Array<{ step: number; id: string }>;
				};
				expect(content).toMatchObject({
					status: "success",
					operationCount: 4,
					created: [{ step: 0, id: expect.any(String) }],
					deletedCount: 1,
					issues: [],
					warningCount: 2,
					warnings: [
						{
							code: "UNKNOWN_TAILWIND_UTILITY",
							message: expect.stringContaining('"flex-colum"'),
							elementIds: ["board", content.created[0].id],
						},
					],
				});
			} finally {
				await session.close();
			}
		});

		it("reports unknown design ids on writes as DESIGN_NOT_FOUND", async () => {
			const { session } = await setup();
			try {
				const missingDesignFileId = "10000000-0000-4000-8000-0000000000ff";
				const result = await applyOperation(session.client, "deleteElement", {
					designFileId: missingDesignFileId,
					expectedRevision: "sha256:any",
					elementId: "title",
				});
				expect(result.isError).toBe(true);
				expect(toolPayload(result)).toMatchObject({
					status: "INVALID_OPERATION",
					code: "DESIGN_NOT_FOUND",
				});
			} finally {
				await session.close();
			}
		});

		it("adds truncated-id and layer-name hints to unknown element errors", async () => {
			const { session } = await setup();
			try {
				const revision = await getRevision(session, trickroomMcpTestDesignUuid);
				const batch = await session.client.callTool({
					name: "design_apply",
					arguments: {
						designFileId: trickroomMcpTestDesignUuid,
						expectedRevision: revision,
						operations: [
							{
								operation: "addElement",
								parameters: {
									parentId: "boar",
									index: 0,
									library: "trickroom",
									component: "text",
									text: "Hi",
								},
							},
						],
					},
				});
				expect(batch.isError).toBe(true);
				expect(toolPayload(batch)).toMatchObject({
					status: "INVALID_OPERATION",
					failedStepIndex: 0,
					code: "PARENT_NOT_FOUND",
					missingElementId: "boar",
					truncatedIdMatches: ["board"],
					message: expect.stringContaining("truncated id"),
				});

				const single = await applyOperation(
					session.client,
					"updateElementText",
					{
						designFileId: trickroomMcpTestDesignUuid,
						expectedRevision: revision,
						elementId: "Title",
						text: "Renamed",
					},
				);
				expect(single.isError).toBe(true);
				expect(toolPayload(single)).toMatchObject({
					code: "ELEMENT_NOT_FOUND",
					nameMatches: [{ id: "title", name: "Title" }],
					message: expect.stringContaining("layer name"),
				});

				const read = await session.client.callTool({
					name: "design_read",
					arguments: {
						depth: 0,
						designFileId: trickroomMcpTestDesignUuid,
						elementId: "titl",
					},
				});
				expect(read.isError).toBe(true);
				expect(toolPayload(read)).toMatchObject({
					code: "ELEMENT_NOT_FOUND",
					truncatedIdMatches: ["title"],
				});
			} finally {
				await session.close();
			}
		});

		it("suggests registry components for unknown component names", async () => {
			const { session } = await setup();
			try {
				const revision = await getRevision(session, trickroomMcpTestDesignUuid);
				const result = await applyOperation(session.client, "addElement", {
					designFileId: trickroomMcpTestDesignUuid,
					expectedRevision: revision,
					parentId: "board",
					index: 0,
					library: "trickroom",
					component: "contaner",
				});
				expect(result.isError).toBe(true);
				expect(toolPayload(result)).toMatchObject({
					code: "UNKNOWN_REGISTRY_COMPONENT",
					suggestions: ["container"],
					message: expect.stringContaining('Did you mean "container"?'),
				});
			} finally {
				await session.close();
			}
		});

		it("defaults same-file copySubtree sources and accepts parent id aliases", async () => {
			const { session } = await setup();
			try {
				const revision = await getRevision(session, trickroomMcpTestDesignUuid);
				const result = await session.client.callTool({
					name: "design_apply",
					arguments: {
						designFileId: trickroomMcpTestDesignUuid,
						expectedRevision: revision,
						operations: [
							{
								operation: "copySubtree",
								parameters: {
									sourceElementId: "title",
									targetParentId: "board",
									index: 1,
								},
							},
							{
								operation: "moveElement",
								parameters: {
									elementId: "$step:0",
									parentId: "board",
									index: 0,
								},
							},
						],
					},
				});
				expect(result.isError).toBeFalsy();
				expect(toolPayload(result)).toMatchObject({
					status: "success",
					created: [{ step: 0, id: expect.any(String), nodeCount: 1 }],
				});
			} finally {
				await session.close();
			}
		});

		it("returns the copySubtree id map when the step asks for it", async () => {
			const { session } = await setup();
			try {
				const revision = await getRevision(session, trickroomMcpTestDesignUuid);
				const result = await applyOperation(session.client, "copySubtree", {
					designFileId: trickroomMcpTestDesignUuid,
					expectedRevision: revision,
					sourceElementId: "title",
					parentId: "board",
					index: 1,
				});
				expect(result.isError).toBeFalsy();
				expect(toolPayload(result).created[0]).not.toHaveProperty("idMap");

				const withIdMap = await applyOperation(session.client, "copySubtree", {
					designFileId: trickroomMcpTestDesignUuid,
					expectedRevision: (toolPayload(result) as { newRevision: string })
						.newRevision,
					sourceElementId: "title",
					parentId: "board",
					index: 1,
					includeIdMap: true,
				});
				expect(toolPayload(withIdMap)).toMatchObject({
					status: "success",
					created: [{ step: 0, idMap: { title: expect.any(String) } }],
				});
			} finally {
				await session.close();
			}
		});

		it("shows the expected parameters when a step has invalid parameters", async () => {
			const { session } = await setup();
			try {
				const revision = await getRevision(session, trickroomMcpTestDesignUuid);
				const result = await session.client.callTool({
					name: "design_apply",
					arguments: {
						designFileId: trickroomMcpTestDesignUuid,
						expectedRevision: revision,
						operations: [
							{
								operation: "moveElement",
								parameters: { elementId: "title", index: 0 },
							},
						],
					},
				});
				expect(result.isError).toBe(true);
				expect(toolPayload(result)).toMatchObject({
					failedStepIndex: 0,
					code: "INVALID_OPERATION_PARAMETERS",
					message:
						'Operation "moveElement" parameters are invalid: "targetParentId" is required.',
					expectedParameters:
						"{ elementId: string, targetParentId: string | null, index: int }",
				});
			} finally {
				await session.close();
			}
		});

		it("lists per-operation parameter signatures in the batch input schema", async () => {
			const { session } = await setup();
			try {
				const { tools } = await session.client.listTools();
				const tool = tools.find((entry) => entry.name === "design_apply");
				const operations = (
					tool?.inputSchema.properties as Record<
						string,
						{ description?: string }
					>
				).operations;
				expect(operations.description).toContain(
					"addElement(parentId, index, library, component, …)",
				);
				expect(operations.description).toContain(
					"copySubtree(sourceElementId, parentId, index, …)",
				);
				expect(operations.description).toContain(
					'getDesignAuthoringContract({ topic: "operations" })',
				);
			} finally {
				await session.close();
			}
		});

		it("inserts a dialog recipe and fills its slot in one batch", async () => {
			const { fixture, session } = await setup();
			try {
				const revision = await getRevision(session, trickroomMcpTestDesignUuid);
				const result = await session.client.callTool({
					name: "design_apply",
					arguments: {
						designFileId: trickroomMcpTestDesignUuid,
						expectedRevision: revision,
						operations: [
							{
								operation: "addRecipe",
								parameters: {
									parentId: "board",
									index: 0,
									library: "base-ui",
									recipe: "dialog.default",
								},
							},
							{
								operation: "addSubtree",
								parameters: {
									parentId: "$step:0:slot:content",
									index: 0,
									subtree: {
										tempId: "body",
										library: "trickroom",
										component: "container",
										children: [
											{
												tempId: "heading",
												library: "trickroom",
												component: "text",
												text: "Delete project?",
											},
										],
									},
								},
							},
							{
								operation: "updateElementProps",
								parameters: {
									elementId: "$step:1:tempId:heading",
									className: "text-lg",
								},
							},
						],
					},
				});

				expect(result.isError).toBeFalsy();
				const content = toolPayload(result) as {
					created: Array<{
						step: number;
						id: string;
						idMap?: Record<string, string>;
						slots?: Record<string, string>;
					}>;
				};
				// Updates report nothing; only the two inserting steps are listed.
				expect(content.created.map((entry) => entry.step)).toEqual([0, 1]);
				const contentSlotId = content.created[0].slots?.content;
				expect(contentSlotId).toEqual(expect.any(String));

				const persisted = await fixture.designFileService.readDesignFile(
					fixture.designFileService.getFileForUuid(trickroomMcpTestDesignUuid),
				);
				const find = (
					nodes: TrickroomDesign["boards"],
					id: string,
				): TrickroomDesign["boards"][number] | undefined => {
					for (const node of nodes) {
						if (node.id === id) return node;
						if (Array.isArray(node.children)) {
							const found = find(node.children, id);
							if (found) return found;
						}
					}
					return undefined;
				};
				const slotHost = find(persisted.design.boards, contentSlotId as string);
				expect(
					Array.isArray(slotHost?.children) &&
						slotHost.children.some(
							(child) => child.id === content.created[1].id,
						),
				).toBe(true);
				const heading = find(
					persisted.design.boards,
					content.created[1].idMap?.heading as string,
				);
				expect(heading?.props.className).toBe("text-lg");
			} finally {
				await session.close();
			}
		});

		it("points bare tempIds at the step reference form", async () => {
			const { session } = await setup();
			try {
				const revision = await getRevision(session, trickroomMcpTestDesignUuid);
				const result = await session.client.callTool({
					name: "design_apply",
					arguments: {
						designFileId: trickroomMcpTestDesignUuid,
						expectedRevision: revision,
						operations: [
							{
								operation: "addSubtree",
								parameters: {
									parentId: "board",
									index: 0,
									subtree: {
										tempId: "card",
										library: "trickroom",
										component: "container",
									},
								},
							},
							{
								operation: "addElement",
								parameters: {
									parentId: "card",
									index: 0,
									library: "trickroom",
									component: "text",
									text: "Hi",
								},
							},
						],
					},
				});
				expect(result.isError).toBe(true);
				expect(toolPayload(result)).toMatchObject({
					failedStepIndex: 1,
					code: "PARENT_NOT_FOUND",
					suggestedStepReferences: ["$step:0:tempId:card"],
				});
			} finally {
				await session.close();
			}
		});

		it("commits a valid plan with one revision change", async () => {
			const { fixture, session } = await setup();
			try {
				const revision = await getRevision(session, trickroomMcpTestDesignUuid);
				const result = await session.client.callTool({
					name: "design_apply",
					arguments: {
						designFileId: trickroomMcpTestDesignUuid,
						expectedRevision: revision,
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
				});

				expect(result.isError).toBeFalsy();
				const content = toolPayload(result) as {
					status: string;
					newRevision: string;
					operationCount: number;
				};
				expect(content.status).toBe("success");
				expect(content.operationCount).toBe(2);
				expect(content.newRevision).not.toBe(revision);

				const persisted = await fixture.designFileService.readDesignFile(
					fixture.designFileService.getFileForUuid(trickroomMcpTestDesignUuid),
				);
				expect(persisted.revision).toBe(content.newRevision);
				const board = persisted.design.boards[0];
				expect(Array.isArray(board.children)).toBe(true);
				const footer = Array.isArray(board.children)
					? board.children.find(
							(child) =>
								child.props["data-trickroom-name"] === "Footer" &&
								child.children === "Updated footer",
						)
					: null;
				expect(footer).toBeTruthy();
			} finally {
				await session.close();
			}
		});

		it("returns REVISION_MISMATCH without writing when the starting revision is stale", async () => {
			const { fixture, session } = await setup();
			try {
				const staleRevision = await getRevision(
					session,
					trickroomMcpTestDesignUuid,
				);
				await applyOperation(session.client, "addElement", {
					designFileId: trickroomMcpTestDesignUuid,
					expectedRevision: staleRevision,
					parentId: "board",
					index: 1,
					library: "trickroom",
					component: "text",
					text: "Changed",
				});

				const result = await session.client.callTool({
					name: "design_apply",
					arguments: {
						designFileId: trickroomMcpTestDesignUuid,
						expectedRevision: staleRevision,
						operations: [
							{
								operation: "updateElementText",
								parameters: {
									elementId: "title",
									text: "Should not apply",
								},
							},
						],
					},
				});

				expect(result.isError).toBe(true);
				expect(toolPayload(result)).toMatchObject({
					status: "REVISION_MISMATCH",
					currentRevision: expect.any(String),
				});

				const persisted = await fixture.designFileService.readDesignFile(
					fixture.designFileService.getFileForUuid(trickroomMcpTestDesignUuid),
				);
				expect(persisted.revision).not.toBe(staleRevision);
			} finally {
				await session.close();
			}
		});

		it("denies disallowed components during plan validation", async () => {
			const fixture = await createTrickroomMcpProjectFixture({
				designs: {
					[trickroomMcpTestDesignUuid]: trickroomMcpTestDesign,
				},
				config: {
					mcp: {
						enabled: true,
						allowedComponents: ["trickroom/container"],
					},
				},
			});
			fixtures.push(fixture);
			const session = await createTrickroomMcpTestClient(
				await fixture.readMcpContext(),
			);
			try {
				const revision = await getRevision(session, trickroomMcpTestDesignUuid);
				const result = await session.client.callTool({
					name: "validateOperationPlan",
					arguments: {
						designFileId: trickroomMcpTestDesignUuid,
						expectedRevision: revision,
						operations: [
							{
								operation: "addElement",
								parameters: {
									parentId: "board",
									index: 1,
									library: "trickroom",
									component: "text",
									text: "Denied",
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
				await session.close();
			}
		});

		it("supports addSubtree in a plan", async () => {
			const { session } = await setup();
			try {
				const revision = await getRevision(session, trickroomMcpTestDesignUuid);
				const result = await session.client.callTool({
					name: "validateOperationPlan",
					arguments: {
						designFileId: trickroomMcpTestDesignUuid,
						expectedRevision: revision,
						operations: [
							{
								operation: "addSubtree",
								parameters: {
									parentId: "board",
									index: 1,
									subtree: {
										tempId: "plan-container",
										library: "trickroom",
										component: "container",
										children: [
											{
												tempId: "plan-text",
												library: "trickroom",
												component: "text",
												text: "Plan subtree",
											},
										],
									},
								},
							},
						],
					},
				});

				expect(result.isError).toBeFalsy();
				expect(toolPayload(result)).toMatchObject({
					status: "success",
					valid: true,
					operationCount: 1,
				});

				const full = await session.client.callTool({
					name: "validateOperationPlan",
					arguments: {
						designFileId: trickroomMcpTestDesignUuid,
						expectedRevision: revision,
						operations: [
							{
								operation: "addSubtree",
								parameters: {
									parentId: "board",
									index: 1,
									subtree: {
										library: "trickroom",
										component: "container",
									},
								},
							},
						],
						response: "full",
					},
				});
				expect(toolPayload(full)).toMatchObject({
					steps: [
						{
							stepIndex: 0,
							operation: "addSubtree",
							summary: { stats: { nodeCount: 1 } },
						},
					],
				});
			} finally {
				await session.close();
			}
		});

		it("preserves literal step-reference text in updateElementText", async () => {
			const { fixture, session } = await setup();
			try {
				const revision = await getRevision(session, trickroomMcpTestDesignUuid);
				const result = await session.client.callTool({
					name: "design_apply",
					arguments: {
						designFileId: trickroomMcpTestDesignUuid,
						expectedRevision: revision,
						operations: [
							{
								operation: "updateElementText",
								parameters: {
									elementId: "title",
									text: "$step:0",
								},
							},
						],
					},
				});

				expect(result.isError).toBeFalsy();
				const persisted = await fixture.designFileService.readDesignFile(
					fixture.designFileService.getFileForUuid(trickroomMcpTestDesignUuid),
				);
				const title = persisted.design.boards[0].children;
				expect(Array.isArray(title)).toBe(true);
				expect(
					Array.isArray(title)
						? title.find((child) => child.id === "title")?.children
						: null,
				).toBe("$step:0");
			} finally {
				await session.close();
			}
		});

		it("denies same-design copySubtree when source components are policy-blocked", async () => {
			const fixture = await createTrickroomMcpProjectFixture({
				designs: {
					[trickroomMcpTestDesignUuid]: trickroomMcpTestDesign,
				},
				config: {
					mcp: {
						enabled: true,
						allowedComponents: ["trickroom/container"],
					},
				},
			});
			fixtures.push(fixture);
			const session = await createTrickroomMcpTestClient(
				await fixture.readMcpContext(),
			);
			try {
				const revision = await getRevision(session, trickroomMcpTestDesignUuid);
				const result = await session.client.callTool({
					name: "validateOperationPlan",
					arguments: {
						designFileId: trickroomMcpTestDesignUuid,
						expectedRevision: revision,
						operations: [
							{
								operation: "copySubtree",
								parameters: {
									sourceDesignFileId: trickroomMcpTestDesignUuid,
									sourceElementId: "title",
									parentId: "board",
									index: 1,
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
				await session.close();
			}
		});

		it("supports same-design copySubtree in a plan", async () => {
			const { session } = await setup();
			try {
				const revision = await getRevision(session, trickroomMcpTestDesignUuid);
				const result = await session.client.callTool({
					name: "validateOperationPlan",
					arguments: {
						designFileId: trickroomMcpTestDesignUuid,
						expectedRevision: revision,
						operations: [
							{
								operation: "copySubtree",
								parameters: {
									sourceDesignFileId: trickroomMcpTestDesignUuid,
									sourceElementId: "title",
									parentId: "board",
									index: 1,
								},
							},
						],
					},
				});

				expect(result.isError).toBeFalsy();
				expect(toolPayload(result)).toMatchObject({
					status: "success",
					valid: true,
					operationCount: 1,
					issues: [],
				});
			} finally {
				await session.close();
			}
		});

		it("writes audit log entries for applyDesignOperations attempts", async () => {
			const fixture = await createTrickroomMcpProjectFixture({
				designs: {
					[trickroomMcpTestDesignUuid]: trickroomMcpTestDesign,
				},
				config: {
					mcp: {
						enabled: true,
						auditLog: true,
					},
				},
			});
			fixtures.push(fixture);
			const session = await createTrickroomMcpTestClient(
				await fixture.readMcpContext(),
			);
			try {
				const revision = await getRevision(session, trickroomMcpTestDesignUuid);
				const result = await session.client.callTool({
					name: "design_apply",
					arguments: {
						designFileId: trickroomMcpTestDesignUuid,
						expectedRevision: revision,
						operations: [
							{
								operation: "updateElementText",
								parameters: {
									elementId: "title",
									text: "Plan audit",
								},
							},
						],
					},
				});
				expect(result.isError).toBeFalsy();

				const auditLog = await readFile(
					path.join(fixture.projectRoot, ".trickroom", "audit-log.jsonl"),
					"utf8",
				);
				const entries = auditLog
					.trim()
					.split("\n")
					.map((line) => JSON.parse(line));
				expect(entries.at(-1)).toMatchObject({
					toolName: "design_apply",
					operation: "updateElementText",
					designFileId: trickroomMcpTestDesignUuid,
					success: true,
				});

				await session.client.callTool({
					name: "design_apply",
					arguments: {
						designFileId: trickroomMcpTestDesignUuid,
						expectedRevision: toolPayload(result).newRevision,
						operations: [
							{
								operation: "updateElementText",
								parameters: { elementId: "title", text: "One" },
							},
							{
								operation: "renameDesignFile",
								parameters: { name: "Audited" },
							},
						],
					},
				});
				const batchEntries = (
					await readFile(
						path.join(fixture.projectRoot, ".trickroom", "audit-log.jsonl"),
						"utf8",
					)
				)
					.trim()
					.split("\n")
					.map((line) => JSON.parse(line));
				expect(batchEntries.at(-1)).toMatchObject({
					toolName: "design_apply",
					operation: "batch",
					details: {
						operationCount: 2,
						operations: ["updateElementText", "renameDesignFile"],
					},
					success: true,
				});
			} finally {
				await session.close();
			}
		});

		it("does not let errors the design already had block a write", async () => {
			const brokenDesign: TrickroomDesign = {
				...trickroomMcpTestDesign,
				boards: [
					{
						id: "board",
						props: {
							"data-trickroom-name": "Board",
							"data-trickroom-library": "trickroom",
							"data-trickroom-component": "container",
						},
						children: [
							{
								id: "card",
								props: {
									"data-trickroom-name": "Card",
									"data-trickroom-library": "trickroom",
									"data-trickroom-component": "container",
								},
								children: [
									{
										id: "broken-asset",
										props: {
											"data-trickroom-name": "Broken",
											"data-trickroom-library": "trickroom",
											"data-trickroom-component": "asset",
											"data-trickroom-role": "leaf",
											[assetIdProp]: "missing-asset",
										},
										children: [],
									},
								],
							},
							{
								id: "title",
								props: {
									"data-trickroom-name": "Title",
									"data-trickroom-library": "trickroom",
									"data-trickroom-component": "text",
									"data-trickroom-role": "text",
								},
								children: "Title",
							},
						],
					},
				],
			};
			const { session } = await setup({
				[trickroomMcpTestDesignUuid]: brokenDesign,
			});
			try {
				const revision = await getRevision(session, trickroomMcpTestDesignUuid);
				// A one-operation edit elsewhere succeeds and counts the old error.
				const edit = await applyOperation(session.client, "updateElementText", {
					designFileId: trickroomMcpTestDesignUuid,
					expectedRevision: revision,
					elementId: "title",
					text: "Still writable",
				});
				expect(edit.isError).toBeFalsy();
				expect(toolPayload(edit)).toMatchObject({
					status: "success",
					issues: [],
					preExistingErrorCount: 1,
				});

				// Moving the broken element's parent keeps the same error: not new.
				const move = await applyOperation(session.client, "moveElement", {
					designFileId: trickroomMcpTestDesignUuid,
					expectedRevision: toolPayload(edit).newRevision,
					elementId: "card",
					targetParentId: "board",
					index: 1,
				});
				expect(move.isError).toBeFalsy();
				expect(toolPayload(move)).toMatchObject({
					status: "success",
					preExistingErrorCount: 1,
				});
			} finally {
				await session.close();
			}
		});

		it("counts an error as introduced only when the design did not have it", async () => {
			const error = (code: string, elementId?: string, path?: string) => ({
				severity: "error" as const,
				code,
				message: code,
				...(elementId ? { elementId } : {}),
				...(path ? { path } : {}),
			});
			const before = [
				error("UNKNOWN_ASSET_ID", "a", "boards[0].children[0]"),
				error("RECIPE_INVALID", undefined, "systemId"),
			];
			const split = await splitIntroducedErrors(
				[
					// Same element, shifted path: pre-existing.
					error("UNKNOWN_ASSET_ID", "a", "boards[0].children[3]"),
					// A second error of the same kind on another element: new.
					error("UNKNOWN_ASSET_ID", "b"),
					error("RECIPE_INVALID", undefined, "systemId"),
				],
				async () => before,
			);
			expect(split.preExistingCount).toBe(2);
			expect(split.introduced).toEqual([error("UNKNOWN_ASSET_ID", "b")]);

			let read = false;
			const clean = await splitIntroducedErrors([], async () => {
				read = true;
				return before;
			});
			expect(clean).toEqual({ introduced: [], preExistingCount: 0 });
			expect(read).toBe(false);
		});

		it("sets a recipe control by any element of the instance, path defaulting to it", async () => {
			let nextId = 0;
			const expansion = expandRegistryRecipe("base-ui", "menu.default", {
				createElementId: () => `menu-${nextId++}`,
				createRecipeInstanceId: () => "menu-instance-1",
			});
			const { session } = await setup({
				[trickroomMcpTestDesignUuid]: {
					name: "Menu Recipe",
					boards: [expansion.root],
				},
			});
			try {
				const revision = await getRevision(session, trickroomMcpTestDesignUuid);
				const result = await session.client.callTool({
					name: "design_apply",
					arguments: {
						designFileId: trickroomMcpTestDesignUuid,
						expectedRevision: revision,
						operations: [
							{
								operation: "updateRecipeControl",
								parameters: {
									instanceId: expansion.elementIdsByPath.root,
									prop: "modal",
									value: false,
								},
							},
							{
								operation: "updateRecipeControl",
								parameters: {
									elementId: expansion.elementIdsByPath.root,
									path: "positioner",
									prop: "align",
									value: "end",
								},
							},
						],
						response: "full",
					},
				});
				expect(result.isError).toBeFalsy();
				expect(
					toolPayload(result).steps.map(
						(step: { summary: unknown }) => step.summary,
					),
				).toEqual([
					{
						instanceId: "menu-instance-1",
						path: "root",
						prop: "modal",
						value: false,
					},
					{
						instanceId: "menu-instance-1",
						path: "positioner",
						prop: "align",
						value: "end",
					},
				]);

				const withoutPath = await applyOperation(
					session.client,
					"updateRecipeControl",
					{
						designFileId: trickroomMcpTestDesignUuid,
						expectedRevision: toolPayload(result).newRevision,
						instanceId: "menu-instance-1",
						prop: "modal",
						value: true,
					},
				);
				expect(toolPayload(withoutPath)).toMatchObject({
					code: "INVALID_OPERATION_PARAMETERS",
				});
			} finally {
				await session.close();
			}
		});
	});
});
