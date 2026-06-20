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
import {
	addSubtreeOptionsSchema,
	addSubtreePayloadSchema,
	proposedRecipeNodeSchema,
	validateSubtreePayload,
	validateSubtreePayloadSchema,
} from "./server";
import {
	createTrickroomMcpProjectFixture,
	createTrickroomMcpTestClient,
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
			name: "readDesignFile",
			arguments: { designFileId },
		});
		const content = result.structuredContent as {
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
					"copySubtree",
					"renameDesignFile",
					"addElement",
					"addRecipe",
					"addSystemComponent",
					"updateSystemComponentInstance",
					"migrateSystemComponentInstance",
					"bulkMigrateSystemComponentUsages",
					"detachSystemComponent",
					"addSubtree",
					"updateRecipeControl",
					"updateRecipeInstance",
					"updateElementProps",
					"updateElementText",
					"moveElement",
					"deleteElement",
					"detachRecipeInstance",
				]) {
					const tool = toolsByName.get(name);
					expect(tool, `tool ${name} should exist`).toBeDefined();
					expect(tool?.annotations?.readOnlyHint).toBe(false);
					expect(tool?.annotations?.openWorldHint).toBe(false);
				}

				expect(
					toolsByName.get("addElement")?.annotations?.destructiveHint,
				).toBe(false);
				expect(toolsByName.get("addRecipe")?.annotations?.destructiveHint).toBe(
					false,
				);
				expect(
					toolsByName.get("addSystemComponent")?.annotations?.destructiveHint,
				).toBe(false);
				expect(
					toolsByName.get("updateSystemComponentInstance")?.annotations
						?.destructiveHint,
				).toBe(false);
				expect(
					toolsByName.get("createDesignFile")?.annotations?.destructiveHint,
				).toBe(false);
				expect(
					toolsByName.get("extractSubtree")?.annotations?.destructiveHint,
				).toBe(false);
				expect(
					toolsByName.get("copySubtree")?.annotations?.destructiveHint,
				).toBe(false);
				expect(
					toolsByName.get("addSubtree")?.annotations?.destructiveHint,
				).toBe(false);

				for (const name of [
					"renameDesignFile",
					"updateRecipeControl",
					"updateRecipeInstance",
					"updateElementProps",
					"updateElementText",
					"moveElement",
					"deleteElement",
					"detachRecipeInstance",
					"detachSystemComponent",
				]) {
					expect(
						toolsByName.get(name)?.annotations?.destructiveHint,
						`${name} should have destructiveHint true`,
					).toBe(true);
				}
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
				const content = result.structuredContent as {
					status: string;
					valid: boolean;
					diagnostics: Array<{ code: string }>;
				};
				expect(content.status).toBe("success");
				expect(content.valid).toBe(false);
				expect(content.diagnostics).toContainEqual(
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
				expect(result.diagnostics).toContainEqual(
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

				const result = await session.client.callTool({
					name: "addSubtree",
					arguments: {
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
					},
				});

				expect(result.isError).toBeFalsy();
				const content = result.structuredContent as {
					status: string;
					newRevision: string;
					rootElementId: string;
					idMap: Record<string, string>;
					inserted: {
						elementIds: string[];
						nodeCount: number;
						rootElementId: string;
					};
					recipeExpansions: Array<{ rootId: string }>;
					changedElement: { id: string };
					context: { elementId: string; parentId: string };
					warnings: unknown[];
				};
				expect(content.status).toBe("success");
				expect(content.newRevision).toMatch(/^sha256:/);
				expect(content.newRevision).not.toBe(revision);
				expect(content.rootElementId).toBe(content.inserted.rootElementId);
				expect(content.idMap).toMatchObject({
					"inserted-container": content.rootElementId,
				});
				expect(content.inserted).toEqual({
					nodeCount: 2,
					rootElementId: content.rootElementId,
					elementIds: [
						content.idMap["inserted-container"],
						content.idMap["inserted-title"],
					],
				});
				expect(content.recipeExpansions).toHaveLength(0);
				expect(content.changedElement.id).toBe(content.rootElementId);
				expect(content.context).toMatchObject({
					parentId: "board",
					index: 1,
				});
				expect(Array.isArray(content.warnings)).toBe(true);

				const boardResult = await session.client.callTool({
					name: "readElement",
					arguments: {
						designFileId: trickroomMcpTestDesignUuid,
						elementId: "board",
					},
				});
				const boardContent = boardResult.structuredContent as {
					element: { childIds: string[] };
				};
				expect(boardContent.element.childIds[1]).toBe(content.rootElementId);

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

				const result = await session.client.callTool({
					name: "addSubtree",
					arguments: {
						designFileId: trickroomMcpTestDesignUuid,
						expectedRevision: staleRevision,
						parentId: "board",
						index: 1,
						subtree: {
							library: "trickroom",
							component: "container",
						},
					},
				});

				expect(result.isError).toBe(true);
				const content = result.structuredContent as { status: string };
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
				const result = await deniedDesignSession.client.callTool({
					name: "addSubtree",
					arguments: {
						designFileId: trickroomMcpTestDesignUuid,
						expectedRevision: read.revision,
						parentId: "board",
						index: 1,
						subtree: {
							library: "trickroom",
							component: "container",
						},
					},
				});
				expect(result.isError).toBe(true);
				expect(result.structuredContent).toMatchObject({
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
				const result = await componentSession.client.callTool({
					name: "addSubtree",
					arguments: {
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
				});
				expect(result.isError).toBe(true);
				expect(result.structuredContent).toMatchObject({
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

				const result = await session.client.callTool({
					name: "addSubtree",
					arguments: {
						designFileId: trickroomMcpTestDesignUuid,
						expectedRevision: revision,
						parentId: "board",
						index: 1,
						subtree: {
							library: "trickroom",
							component: "text",
							text: "Logged add",
						},
					},
				});
				expect(result.isError).toBeFalsy();

				const content = result.structuredContent as { newRevision: string };
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
						toolName: "addSubtree",
						operation: "addSubtree",
						designFileId: trickroomMcpTestDesignUuid,
						expectedRevision: revision,
						success: true,
						status: "success",
						resultingRevision: content.newRevision,
						details: expect.objectContaining({
							parentId: "board",
							index: 1,
						}),
					}),
				);

				const latestRevision = await getRevision(
					session,
					trickroomMcpTestDesignUuid,
				);
				const failed = await session.client.callTool({
					name: "addSubtree",
					arguments: {
						designFileId: trickroomMcpTestDesignUuid,
						expectedRevision: latestRevision,
						parentId: "missing-parent",
						index: 0,
						subtree: {
							library: "trickroom",
							component: "text",
							text: "Failed add",
						},
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
						toolName: "addSubtree",
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
				expect(result.structuredContent).toMatchObject({
					status: "success",
					valid: true,
					sourceDesignFile: { id: trickroomMcpTestDesignUuid },
					targetDesignFile: { id: trickroomMcpTestDesignUuid },
					sourceElementId: "title",
					stats: { nodeCount: 1, maxDepth: 1 },
				});
				expect(result.structuredContent).not.toHaveProperty("idMap");
				expect(result.structuredContent).not.toHaveProperty("inserted");
				expect(result.structuredContent).not.toHaveProperty("changedElement");
				expect(result.structuredContent).not.toHaveProperty("context");
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
				const result = await session.client.callTool({
					name: "copySubtree",
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
				const content = result.structuredContent as {
					newRevision: string;
					rootElementId: string;
					idMap: Record<string, string>;
					inserted: { elementIds: string[] };
					changedElement: { name: string };
					context: { parentId: string; index: number };
				};
				expect(content.newRevision).toMatch(/^sha256:/);
				expect(content.rootElementId).toBe(content.idMap.title);
				expect(content.rootElementId).not.toBe("title");
				expect(content.inserted.elementIds).toEqual([content.rootElementId]);
				expect(content.changedElement.name).toBe("Title Copy");
				expect(content.context).toMatchObject({ parentId: "board", index: 1 });

				const copied = await session.client.callTool({
					name: "readElement",
					arguments: {
						designFileId: trickroomMcpTestDesignUuid,
						elementId: content.rootElementId,
					},
				});
				expect(copied.structuredContent).toMatchObject({
					element: {
						id: content.rootElementId,
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
				expect(result.structuredContent).toMatchObject({
					status: "success",
					valid: false,
					diagnostics: [
						expect.objectContaining({
							code: "SOURCE_REVISION_REQUIRED",
							path: "/sourceExpectedRevision",
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
				const result = await session.client.callTool({
					name: "copySubtree",
					arguments: {
						sourceDesignFileId: trickroomMcpTestDesignUuid,
						sourceElementId: "title",
						sourceExpectedRevision: sourceRevision,
						targetDesignFileId,
						expectedRevision: targetRevision,
						parentId: "target-root",
						index: 0,
					},
				});

				expect(result.isError).toBeFalsy();
				expect(result.structuredContent).toMatchObject({
					status: "success",
					sourceDesignFile: { id: trickroomMcpTestDesignUuid },
					targetDesignFile: { id: targetDesignFileId, name: "Copy Target" },
					changedElement: {
						name: "Title",
					},
				});
			} finally {
				await session.close();
			}
		});

		it("reports cross-file source revision mismatches without an MCP error", async () => {
			const { session } = await setup({
				[trickroomMcpTestDesignUuid]: trickroomMcpTestDesign,
				[targetDesignFileId]: targetDesign,
			});
			try {
				const targetRevision = await getRevision(session, targetDesignFileId);
				const staleSourceRevision =
					"sha256:0000000000000000000000000000000000000000000000000000000000000000";
				const result = await session.client.callTool({
					name: "copySubtree",
					arguments: {
						sourceDesignFileId: trickroomMcpTestDesignUuid,
						sourceElementId: "title",
						sourceExpectedRevision: staleSourceRevision,
						targetDesignFileId,
						expectedRevision: targetRevision,
						parentId: "target-root",
						index: 0,
					},
				});

				expect(result.isError).toBeFalsy();
				expect(result.structuredContent).toMatchObject({
					status: "SOURCE_REVISION_MISMATCH",
					currentSourceRevision: expect.stringMatching(/^sha256:/),
					sourceExpectedRevision: staleSourceRevision,
					expectedRevision: targetRevision,
				});
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
				expect(result.structuredContent).toMatchObject({
					status: "REVISION_MISMATCH",
					valid: false,
					currentRevision: expect.stringMatching(/^sha256:/),
					expectedRevision: staleTargetRevision,
				});
				expect(result.structuredContent).not.toHaveProperty("idMap");
				expect(result.structuredContent).not.toHaveProperty("inserted");
				expect(result.structuredContent).not.toHaveProperty("changedElement");
				expect(result.structuredContent).not.toHaveProperty("context");
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
				const result = await session.client.callTool({
					name: "copySubtree",
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

				expect(result.isError).toBe(true);
				expect(result.structuredContent).toMatchObject({
					status: "REVISION_MISMATCH",
					currentRevision: expect.stringMatching(/^sha256:/),
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
				const result = await sourceDeniedSession.client.callTool({
					name: "copySubtree",
					arguments: {
						sourceDesignFileId: trickroomMcpTestDesignUuid,
						sourceElementId: "title",
						sourceExpectedRevision: sourceRead.revision,
						targetDesignFileId,
						expectedRevision: targetRead.revision,
						parentId: "target-root",
						index: 0,
					},
				});
				expect(result.isError).toBe(true);
				expect(result.structuredContent).toMatchObject({
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
				const result = await targetDeniedSession.client.callTool({
					name: "copySubtree",
					arguments: {
						sourceDesignFileId: trickroomMcpTestDesignUuid,
						sourceElementId: "title",
						sourceExpectedRevision: sourceRead.revision,
						targetDesignFileId,
						expectedRevision: targetRead.revision,
						parentId: "target-root",
						index: 0,
					},
				});
				expect(result.isError).toBe(true);
				expect(result.structuredContent).toMatchObject({
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
				const result = await componentDeniedSession.client.callTool({
					name: "copySubtree",
					arguments: {
						sourceDesignFileId: trickroomMcpTestDesignUuid,
						sourceElementId: "title",
						sourceExpectedRevision: sourceRevision,
						targetDesignFileId,
						expectedRevision: targetRevision,
						parentId: "target-root",
						index: 0,
					},
				});
				expect(result.isError).toBe(true);
				expect(result.structuredContent).toMatchObject({
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
				const result = await session.client.callTool({
					name: "copySubtree",
					arguments: {
						sourceDesignFileId: trickroomMcpTestDesignUuid,
						sourceElementId: "source-asset",
						sourceExpectedRevision: sourceRevision,
						targetDesignFileId,
						expectedRevision: originalTarget.revision,
						parentId: "target-root",
						index: 0,
					},
				});

				expect(result.isError).toBe(true);
				expect(result.structuredContent).toMatchObject({
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
				const result = await session.client.callTool({
					name: "copySubtree",
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
				const content = result.structuredContent as { newRevision: string };

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
						toolName: "copySubtree",
						operation: "copySubtree",
						designFileId: trickroomMcpTestDesignUuid,
						expectedRevision: revision,
						success: true,
						status: "success",
						resultingRevision: content.newRevision,
						details: expect.objectContaining({
							sourceDesignFileId: trickroomMcpTestDesignUuid,
							sourceElementId: "title",
							parentId: "board",
							index: 1,
						}),
					}),
				);

				const latestRevision = await getRevision(
					session,
					trickroomMcpTestDesignUuid,
				);
				const failed = await session.client.callTool({
					name: "copySubtree",
					arguments: {
						sourceDesignFileId: trickroomMcpTestDesignUuid,
						sourceElementId: "missing-source",
						targetDesignFileId: trickroomMcpTestDesignUuid,
						expectedRevision: latestRevision,
						parentId: "board",
						index: 1,
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
						toolName: "copySubtree",
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
				const content = result.structuredContent as {
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
				expect(content.newRevision).toMatch(/^sha256:/);
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
					name: "listDesignFiles",
					arguments: {},
				});
				const listContent = listResult.structuredContent as {
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
				expect(result.structuredContent).toMatchObject({
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
				expect(result.structuredContent).toMatchObject({
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
				expect(generatedDenied.structuredContent).toMatchObject({
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
				expect(created.structuredContent).toMatchObject({
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
				expect(created.structuredContent).toMatchObject({
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
						resultingRevision: expect.stringMatching(/^sha256:/),
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
				expect(result.structuredContent).toMatchObject({
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
				expect(blankName.structuredContent).toMatchObject({
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
				expect(blankSystem.structuredContent).toMatchObject({
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
				const content = result.structuredContent as {
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
				expect(content.newRevision).toMatch(/^sha256:/);
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
				expect(result.structuredContent).toMatchObject({
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
				expect(result.structuredContent).toMatchObject({
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
				expect(result.structuredContent).toMatchObject({
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
				expect(generatedDenied.structuredContent).toMatchObject({
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
				expect(componentDenied.structuredContent).toMatchObject({
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
				expect(allowed.structuredContent).toMatchObject({
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
				expect(result.structuredContent).toMatchObject({
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
				expect(result.structuredContent).toMatchObject({
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
						resultingRevision: expect.stringMatching(/^sha256:/),
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

				const result = await session.client.callTool({
					name: "renameDesignFile",
					arguments: {
						designFileId: trickroomMcpTestDesignUuid,
						expectedRevision: revision,
						name: "Renamed Design",
					},
				});

				expect(result.isError).toBeFalsy();
				const content = result.structuredContent as {
					status: string;
					newRevision: string;
					designFile: { name: string; revision: string };
				};
				expect(content.status).toBe("success");
				expect(content.newRevision).toMatch(/^sha256:/);
				expect(content.newRevision).not.toBe(revision);
				expect(content.designFile.name).toBe("Renamed Design");
				expect(content.designFile.revision).toBe(content.newRevision);

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

				const result = await session.client.callTool({
					name: "renameDesignFile",
					arguments: {
						designFileId: trickroomMcpTestDesignUuid,
						expectedRevision: staleRevision,
						name: "Stale Rename",
					},
				});

				expect(result.isError).toBe(true);
				const content = result.structuredContent as {
					status: string;
					currentRevision: string;
					expectedRevision: string;
				};
				expect(content.status).toBe("REVISION_MISMATCH");
				expect(content.currentRevision).toMatch(/^sha256:/);
				expect(content.expectedRevision).toBe(staleRevision);
			} finally {
				await session.close();
			}
		});

		it("renamed name is visible in subsequent reads", async () => {
			const { session } = await setup();
			try {
				const revision = await getRevision(session, trickroomMcpTestDesignUuid);

				await session.client.callTool({
					name: "renameDesignFile",
					arguments: {
						designFileId: trickroomMcpTestDesignUuid,
						expectedRevision: revision,
						name: "Read Back Name",
					},
				});

				const readResult = await session.client.callTool({
					name: "readDesignFile",
					arguments: {
						designFileId: trickroomMcpTestDesignUuid,
					},
				});
				const readContent = readResult.structuredContent as {
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
				const success = await session.client.callTool({
					name: "renameDesignFile",
					arguments: {
						designFileId: trickroomMcpTestDesignUuid,
						expectedRevision: revision,
						name: "Renamed and Notified",
					},
				});
				expect(success.isError).toBeFalsy();
				expect(notifications).toHaveLength(1);

				const staleRevision =
					"sha256:0000000000000000000000000000000000000000000000000000000000000000";
				const failed = await session.client.callTool({
					name: "renameDesignFile",
					arguments: {
						designFileId: trickroomMcpTestDesignUuid,
						expectedRevision: staleRevision,
						name: "Notified Stale Rename",
					},
				});
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

				const result = await session.client.callTool({
					name: "addElement",
					arguments: {
						designFileId: trickroomMcpTestDesignUuid,
						expectedRevision: revision,
						parentId: null,
						index: 0,
						library: "trickroom",
						component: "container",
						name: "Hero",
					},
				});

				expect(result.isError).toBeFalsy();
				const content = result.structuredContent as {
					status: string;
					newRevision: string;
					changedElement: { id: string; name: string; component: string };
				};
				expect(content.status).toBe("success");
				expect(content.newRevision).toMatch(/^sha256:/);
				expect(content.newRevision).not.toBe(revision);
				expect(content.changedElement.name).toBe("Hero");
				expect(content.changedElement.component).toBe("container");
			} finally {
				await session.close();
			}
		});

		it("adds a text element as a child", async () => {
			const { session } = await setup();
			try {
				const revision = await getRevision(session, trickroomMcpTestDesignUuid);

				const result = await session.client.callTool({
					name: "addElement",
					arguments: {
						designFileId: trickroomMcpTestDesignUuid,
						expectedRevision: revision,
						parentId: "board",
						index: 0,
						library: "trickroom",
						component: "text",
						name: "Subtitle",
						text: "A subtitle paragraph",
					},
				});

				expect(result.isError).toBeFalsy();
				const content = result.structuredContent as {
					status: string;
					changedElement: {
						id: string;
						role: string;
						textPreview: string;
						component: string;
					};
					context: { parentId: string };
				};
				expect(content.status).toBe("success");
				expect(content.changedElement.role).toBe("text");
				expect(content.changedElement.textPreview).toBe("A subtitle paragraph");
				expect(content.context.parentId).toBe("board");
			} finally {
				await session.close();
			}
		});

		it("returns REVISION_MISMATCH on stale revision", async () => {
			const { session } = await setup();
			try {
				const staleRevision =
					"sha256:0000000000000000000000000000000000000000000000000000000000000000";

				const result = await session.client.callTool({
					name: "addElement",
					arguments: {
						designFileId: trickroomMcpTestDesignUuid,
						expectedRevision: staleRevision,
						parentId: null,
						index: 0,
						library: "trickroom",
						component: "container",
					},
				});

				expect(result.isError).toBe(true);
				const content = result.structuredContent as {
					status: string;
					currentRevision: string;
					expectedRevision: string;
				};
				expect(content.status).toBe("REVISION_MISMATCH");
				expect(content.currentRevision).toMatch(/^sha256:/);
				expect(content.expectedRevision).toBe(staleRevision);
			} finally {
				await session.close();
			}
		});

		it("returns INVALID_OPERATION for unknown library", async () => {
			const { session } = await setup();
			try {
				const revision = await getRevision(session, trickroomMcpTestDesignUuid);

				const result = await session.client.callTool({
					name: "addElement",
					arguments: {
						designFileId: trickroomMcpTestDesignUuid,
						expectedRevision: revision,
						parentId: null,
						index: 0,
						library: "nonexistent",
						component: "container",
					},
				});

				expect(result.isError).toBe(true);
				const content = result.structuredContent as {
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

				const result = await session.client.callTool({
					name: "addElement",
					arguments: {
						designFileId: trickroomMcpTestDesignUuid,
						expectedRevision: revision,
						parentId: "title",
						index: 0,
						library: "trickroom",
						component: "container",
					},
				});

				expect(result.isError).toBe(true);
				const content = result.structuredContent as {
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

				const result = await session.client.callTool({
					name: "addElement",
					arguments: {
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
					},
				});

				expect(result.isError).toBeFalsy();
				const content = result.structuredContent as {
					status: string;
					changedElement: { name: string };
				};
				expect(content.status).toBe("success");
				expect(content.changedElement.name).toBe("Via Props");
			} finally {
				await session.close();
			}
		});

		it("adds Base UI Separator with a registry-backed orientation prop", async () => {
			const { session } = await setup();
			try {
				const revision = await getRevision(session, trickroomMcpTestDesignUuid);

				const result = await session.client.callTool({
					name: "addElement",
					arguments: {
						designFileId: trickroomMcpTestDesignUuid,
						expectedRevision: revision,
						parentId: "board",
						index: 1,
						library: "base-ui",
						component: "separator",
						props: { orientation: "vertical" },
					},
				});

				expect(result.isError).toBeFalsy();
				const content = result.structuredContent as {
					status: string;
					changedElement: { id: string; role: string; component: string };
				};
				expect(content.status).toBe("success");
				expect(content.changedElement.role).toBe("leaf");
				expect(content.changedElement.component).toBe("separator");

				const readResult = await session.client.callTool({
					name: "readElement",
					arguments: {
						designFileId: trickroomMcpTestDesignUuid,
						elementId: content.changedElement.id,
					},
				});
				const readContent = readResult.structuredContent as {
					element: { props: Record<string, unknown>; childIds: string[] };
				};
				expect(readContent.element.props.orientation).toBe("vertical");
				expect(readContent.element.childIds).toEqual([]);
			} finally {
				await session.close();
			}
		});

		it("rejects invalid registry-backed control prop values", async () => {
			const { session } = await setup();
			try {
				const revision = await getRevision(session, trickroomMcpTestDesignUuid);

				const result = await session.client.callTool({
					name: "addElement",
					arguments: {
						designFileId: trickroomMcpTestDesignUuid,
						expectedRevision: revision,
						parentId: "board",
						index: 1,
						library: "base-ui",
						component: "separator",
						props: { orientation: "diagonal" },
					},
				});

				expect(result.isError).toBe(true);
				const content = result.structuredContent as {
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
				const addLeaf = await session.client.callTool({
					name: "addElement",
					arguments: {
						designFileId: trickroomMcpTestDesignUuid,
						expectedRevision: rev1,
						parentId: "board",
						index: 1,
						library: "base-ui",
						component: "separator",
					},
				});
				const leafContent = addLeaf.structuredContent as {
					newRevision: string;
					changedElement: { id: string };
				};

				const result = await session.client.callTool({
					name: "addElement",
					arguments: {
						designFileId: trickroomMcpTestDesignUuid,
						expectedRevision: leafContent.newRevision,
						parentId: leafContent.changedElement.id,
						index: 0,
						library: "trickroom",
						component: "text",
					},
				});

				expect(result.isError).toBe(true);
				const content = result.structuredContent as {
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

				const result = await session.client.callTool({
					name: "addElement",
					arguments: {
						designFileId: trickroomMcpTestDesignUuid,
						expectedRevision: revision,
						parentId: null,
						index: 0,
						library: "trickroom",
						component: "container",
						name: "Shortcut Wins",
						props: { "data-trickroom-name": "Props Loses" },
					},
				});

				expect(result.isError).toBeFalsy();
				const content = result.structuredContent as {
					status: string;
					changedElement: { name: string };
				};
				expect(content.status).toBe("success");
				expect(content.changedElement.name).toBe("Shortcut Wins");
			} finally {
				await session.close();
			}
		});

		it("returns INVALID_OPERATION with INVALID_PROP_KEY for registry-reference key in props", async () => {
			const { session } = await setup();
			try {
				const revision = await getRevision(session, trickroomMcpTestDesignUuid);

				const result = await session.client.callTool({
					name: "addElement",
					arguments: {
						designFileId: trickroomMcpTestDesignUuid,
						expectedRevision: revision,
						parentId: null,
						index: 0,
						library: "trickroom",
						component: "container",
						props: { "data-trickroom-library": "trickroom" },
					},
				});

				expect(result.isError).toBe(true);
				const content = result.structuredContent as {
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

				const result = await session.client.callTool({
					name: "addElement",
					arguments: {
						designFileId: trickroomMcpTestDesignUuid,
						expectedRevision: revisionBefore,
						parentId: null,
						index: 0,
						library: "trickroom",
						component: "container",
						props: { "data-unknown": "bad" },
					},
				});

				expect(result.isError).toBe(true);
				const content = result.structuredContent as {
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

				await session.client.callTool({
					name: "addElement",
					arguments: {
						designFileId: trickroomMcpTestDesignUuid,
						expectedRevision: revBefore,
						parentId: null,
						index: 0,
						library: "trickroom",
						component: "container",
					},
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

				const result = await session.client.callTool({
					name: "updateElementProps",
					arguments: {
						designFileId: trickroomMcpTestDesignUuid,
						expectedRevision: revision,
						elementId: "board",
						name: "Renamed Board",
					},
				});

				expect(result.isError).toBeFalsy();
				const content = result.structuredContent as {
					status: string;
					changedElement: { name: string };
				};
				expect(content.status).toBe("success");
				expect(content.changedElement.name).toBe("Renamed Board");
			} finally {
				await session.close();
			}
		});

		it("updates multiple props including props[data-trickroom-name]", async () => {
			const { session } = await setup();
			try {
				const revision = await getRevision(session, trickroomMcpTestDesignUuid);

				const result = await session.client.callTool({
					name: "updateElementProps",
					arguments: {
						designFileId: trickroomMcpTestDesignUuid,
						expectedRevision: revision,
						elementId: "board",
						className: "grid grid-cols-2 gap-4",
						props: { "data-trickroom-name": "Props Renamed Board" },
					},
				});

				expect(result.isError).toBeFalsy();
				const content = result.structuredContent as {
					status: string;
					changedElement: { name: string };
				};
				expect(content.status).toBe("success");
				expect(content.changedElement.name).toBe("Props Renamed Board");

				const readResult = await session.client.callTool({
					name: "readElement",
					arguments: {
						designFileId: trickroomMcpTestDesignUuid,
						elementId: "board",
					},
				});
				const readContent = readResult.structuredContent as {
					element: { props: Record<string, unknown> };
				};
				expect(readContent.element.props["data-trickroom-name"]).toBe(
					"Props Renamed Board",
				);
				expect(readContent.element.props.className).toBe(
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

				const result = await session.client.callTool({
					name: "updateElementProps",
					arguments: {
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
				});

				expect(result.isError).toBeFalsy();
				const content = result.structuredContent as {
					status: string;
					changedElement: { name: string };
				};
				expect(content.status).toBe("success");
				expect(content.changedElement.name).toBe("Raw Prop Renamed Board");
			} finally {
				await session.close();
			}
		});

		it("updates multiple props through propUpdates using model-facing aliases", async () => {
			const { session } = await setup();
			try {
				const revision = await getRevision(session, trickroomMcpTestDesignUuid);

				const result = await session.client.callTool({
					name: "updateElementProps",
					arguments: {
						designFileId: trickroomMcpTestDesignUuid,
						expectedRevision: revision,
						elementId: "board",
						propUpdates: [
							{ name: "name", value: "Alias Renamed Board" },
							{ name: "className", value: "flex flex-col gap-6" },
						],
					},
				});

				expect(result.isError).toBeFalsy();
				const content = result.structuredContent as {
					status: string;
					changedElement: { name: string };
					newRevision: string;
				};
				expect(content.status).toBe("success");
				expect(content.changedElement.name).toBe("Alias Renamed Board");
				expect(content.newRevision).not.toBe(revision);

				const readResult = await session.client.callTool({
					name: "readElement",
					arguments: {
						designFileId: trickroomMcpTestDesignUuid,
						elementId: "board",
					},
				});
				const readContent = readResult.structuredContent as {
					element: { props: Record<string, unknown> };
				};
				expect(readContent.element.props["data-trickroom-name"]).toBe(
					"Alias Renamed Board",
				);
				expect(readContent.element.props.className).toBe("flex flex-col gap-6");
			} finally {
				await session.close();
			}
		});

		it("updates className", async () => {
			const { session } = await setup();
			try {
				const revision = await getRevision(session, trickroomMcpTestDesignUuid);

				const result = await session.client.callTool({
					name: "updateElementProps",
					arguments: {
						designFileId: trickroomMcpTestDesignUuid,
						expectedRevision: revision,
						elementId: "board",
						className: "flex gap-4 p-8",
					},
				});

				expect(result.isError).toBeFalsy();
				const content = result.structuredContent as { status: string };
				expect(content.status).toBe("success");
			} finally {
				await session.close();
			}
		});

		it("updates registry-backed control props", async () => {
			const { session } = await setup();
			try {
				const rev1 = await getRevision(session, trickroomMcpTestDesignUuid);
				const addResult = await session.client.callTool({
					name: "addElement",
					arguments: {
						designFileId: trickroomMcpTestDesignUuid,
						expectedRevision: rev1,
						parentId: "board",
						index: 1,
						library: "base-ui",
						component: "separator",
					},
				});
				const addContent = addResult.structuredContent as {
					newRevision: string;
					changedElement: { id: string };
				};

				const result = await session.client.callTool({
					name: "updateElementProps",
					arguments: {
						designFileId: trickroomMcpTestDesignUuid,
						expectedRevision: addContent.newRevision,
						elementId: addContent.changedElement.id,
						props: { orientation: "vertical" },
					},
				});

				expect(result.isError).toBeFalsy();
				const readResult = await session.client.callTool({
					name: "readElement",
					arguments: {
						designFileId: trickroomMcpTestDesignUuid,
						elementId: addContent.changedElement.id,
					},
				});
				const readContent = readResult.structuredContent as {
					element: { props: Record<string, unknown> };
				};
				expect(readContent.element.props.orientation).toBe("vertical");
			} finally {
				await session.close();
			}
		});

		it("returns INVALID_OPERATION when element not found", async () => {
			const { session } = await setup();
			try {
				const revision = await getRevision(session, trickroomMcpTestDesignUuid);

				const result = await session.client.callTool({
					name: "updateElementProps",
					arguments: {
						designFileId: trickroomMcpTestDesignUuid,
						expectedRevision: revision,
						elementId: "nonexistent",
						name: "x",
					},
				});

				expect(result.isError).toBe(true);
				const content = result.structuredContent as {
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

				const result = await session.client.callTool({
					name: "updateElementProps",
					arguments: {
						designFileId: trickroomMcpTestDesignUuid,
						expectedRevision: staleRevision,
						elementId: "board",
						name: "x",
					},
				});

				expect(result.isError).toBe(true);
				const content = result.structuredContent as { status: string };
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

				const result = await session.client.callTool({
					name: "updateElementText",
					arguments: {
						designFileId: trickroomMcpTestDesignUuid,
						expectedRevision: revision,
						elementId: "title",
						text: "Updated text content",
					},
				});

				expect(result.isError).toBeFalsy();
				const content = result.structuredContent as {
					status: string;
					changedElement: { textPreview: string; role: string };
				};
				expect(content.status).toBe("success");
				expect(content.changedElement.role).toBe("text");
				expect(content.changedElement.textPreview).toBe("Updated text content");
			} finally {
				await session.close();
			}
		});

		it("returns INVALID_OPERATION for non-text elements", async () => {
			const { session } = await setup();
			try {
				const revision = await getRevision(session, trickroomMcpTestDesignUuid);

				const result = await session.client.callTool({
					name: "updateElementText",
					arguments: {
						designFileId: trickroomMcpTestDesignUuid,
						expectedRevision: revision,
						elementId: "board",
						text: "x",
					},
				});

				expect(result.isError).toBe(true);
				const content = result.structuredContent as {
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

				const result = await session.client.callTool({
					name: "updateElementText",
					arguments: {
						designFileId: trickroomMcpTestDesignUuid,
						expectedRevision: staleRevision,
						elementId: "title",
						text: "x",
					},
				});

				expect(result.isError).toBe(true);
				const content = result.structuredContent as { status: string };
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

				const result = await session.client.callTool({
					name: "moveElement",
					arguments: {
						designFileId: trickroomMcpTestDesignUuid,
						expectedRevision: revision,
						elementId: "b",
						targetParentId: "root",
						index: 0,
					},
				});

				expect(result.isError).toBeFalsy();
				const content = result.structuredContent as { status: string };
				expect(content.status).toBe("success");

				const readResult = await session.client.callTool({
					name: "readElement",
					arguments: {
						designFileId: trickroomMcpTestDesignUuid,
						elementId: "root",
					},
				});
				const readContent = readResult.structuredContent as {
					element: { childIds: string[] };
				};
				expect(readContent.element.childIds).toEqual(["b", "a"]);
			} finally {
				await session.close();
			}
		});

		it("returns INVALID_OPERATION for cycle detection", async () => {
			const { session } = await setup();
			try {
				const revision = await getRevision(session, trickroomMcpTestDesignUuid);

				const result = await session.client.callTool({
					name: "moveElement",
					arguments: {
						designFileId: trickroomMcpTestDesignUuid,
						expectedRevision: revision,
						elementId: "board",
						targetParentId: "board",
						index: 0,
					},
				});

				expect(result.isError).toBe(true);
				const content = result.structuredContent as {
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

				const result = await session.client.callTool({
					name: "moveElement",
					arguments: {
						designFileId: trickroomMcpTestDesignUuid,
						expectedRevision: revision,
						elementId: "box",
						targetParentId: "label",
						index: 0,
					},
				});

				expect(result.isError).toBe(true);
				const content = result.structuredContent as {
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

				const result = await session.client.callTool({
					name: "moveElement",
					arguments: {
						designFileId: trickroomMcpTestDesignUuid,
						expectedRevision: revision,
						elementId: "box",
						targetParentId: "divider",
						index: 0,
					},
				});

				expect(result.isError).toBe(true);
				const content = result.structuredContent as {
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

				const result = await session.client.callTool({
					name: "moveElement",
					arguments: {
						designFileId: trickroomMcpTestDesignUuid,
						expectedRevision: staleRevision,
						elementId: "board",
						targetParentId: null,
						index: 0,
					},
				});

				expect(result.isError).toBe(true);
				const content = result.structuredContent as { status: string };
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

				const result = await session.client.callTool({
					name: "deleteElement",
					arguments: {
						designFileId: trickroomMcpTestDesignUuid,
						expectedRevision: revision,
						elementId: "title",
					},
				});

				expect(result.isError).toBeFalsy();
				const content = result.structuredContent as {
					status: string;
					deletedElementId: string;
					deletedCount: number;
					newRevision: string;
				};
				expect(content.status).toBe("success");
				expect(content.deletedElementId).toBe("title");
				expect(content.deletedCount).toBe(1);
				expect(content.newRevision).toMatch(/^sha256:/);
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

				const result = await session.client.callTool({
					name: "deleteElement",
					arguments: {
						designFileId: trickroomMcpTestDesignUuid,
						expectedRevision: revision,
						elementId: "parent",
					},
				});

				expect(result.isError).toBeFalsy();
				const content = result.structuredContent as {
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

				const result = await session.client.callTool({
					name: "deleteElement",
					arguments: {
						designFileId: trickroomMcpTestDesignUuid,
						expectedRevision: revision,
						elementId: "nonexistent",
					},
				});

				expect(result.isError).toBe(true);
				const content = result.structuredContent as {
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

				const result = await session.client.callTool({
					name: "deleteElement",
					arguments: {
						designFileId: trickroomMcpTestDesignUuid,
						expectedRevision: staleRevision,
						elementId: "title",
					},
				});

				expect(result.isError).toBe(true);
				const content = result.structuredContent as { status: string };
				expect(content.status).toBe("REVISION_MISMATCH");
			} finally {
				await session.close();
			}
		});

		it("persisted change is visible in subsequent reads", async () => {
			const { session } = await setup();
			try {
				const revision = await getRevision(session, trickroomMcpTestDesignUuid);

				await session.client.callTool({
					name: "deleteElement",
					arguments: {
						designFileId: trickroomMcpTestDesignUuid,
						expectedRevision: revision,
						elementId: "title",
					},
				});

				const readResult = await session.client.callTool({
					name: "readElement",
					arguments: {
						designFileId: trickroomMcpTestDesignUuid,
						elementId: "board",
					},
				});
				const readContent = readResult.structuredContent as {
					element: { childIds: string[] };
				};
				expect(readContent.element.childIds).not.toContain("title");
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
			const content = result.structuredContent as {
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
			expect(result.isError).toBe(true);
			const content = result.structuredContent as {
				status: string;
				code: string;
				message: string;
			};
			expect(content.status).toBe("INVALID_OPERATION");
			expect(content.code).toBe("INVALID_OPERATION_PARAMETERS");
			expect(content.message).toContain(parameterName);
		};

		it("adds an Avatar recipe and returns the attached recipe root", async () => {
			const { fixture, session } = await setup();
			try {
				const revision = await getRevision(session, trickroomMcpTestDesignUuid);

				const result = await session.client.callTool({
					name: "addRecipe",
					arguments: {
						designFileId: trickroomMcpTestDesignUuid,
						expectedRevision: revision,
						parentId: "board",
						index: 1,
						library: "base-ui",
						recipe: "avatar.default",
					},
				});

				expect(result.isError).toBeFalsy();
				const content = result.structuredContent as {
					newRevision: string;
					recipe: {
						id: string;
						instanceId: string;
						elementIdsByPath: Record<string, string>;
					};
					changedElement: { id: string; library: string; component: string };
					context: { parentId: string | null };
				};
				expect(content.recipe.id).toBe("base-ui/avatar.default");
				expect(content.recipe.elementIdsByPath).toMatchObject({
					root: content.changedElement.id,
				});
				expect(content.changedElement).toMatchObject({
					library: "base-ui",
					component: "avatar.root",
				});
				expect(content.context.parentId).toBe("board");

				const persisted = await fixture.designFileService.readDesignFile(
					fixture.designFileService.getFileForUuid(trickroomMcpTestDesignUuid),
				);
				const board = persisted.design.boards[0];
				expect(Array.isArray(board.children)).toBe(true);
				const avatarRoot = Array.isArray(board.children)
					? board.children.find(
							(child) => child.id === content.changedElement.id,
						)
					: null;
				expect(avatarRoot?.props).toMatchObject(
					getRecipeMarkerProps({
						recipeId: "base-ui/avatar.default",
						instanceId: content.recipe.instanceId,
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
				expect(result.structuredContent).toMatchObject({
					status: "success",
					valid: true,
					operation: "addRecipe",
					predicted: {
						parentId: "board",
						index: 1,
						recipe: {
							id: "base-ui/avatar.default",
							elementIdsByPath: {
								root: expect.any(String),
								image: expect.any(String),
								fallback: expect.any(String),
							},
						},
						changedElement: {
							library: "base-ui",
							component: "avatar.root",
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
				expect(result.structuredContent).toMatchObject({
					status: "success",
					valid: true,
					operation: "addSubtree",
					predicted: {
						parentId: "board",
						index: 1,
						stats: {
							nodeCount: 2,
							recipeCount: 0,
						},
					},
					issues: [],
				});

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
				expect(result.structuredContent).toMatchObject({
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
				const content = result.structuredContent as {
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

				const lockedResult = await session.client.callTool({
					name: "addElement",
					arguments: {
						designFileId: trickroomMcpTestDesignUuid,
						expectedRevision: revision,
						parentId: "avatar-root",
						index: 0,
						library: "trickroom",
						component: "container",
					},
				});
				expectRecipeLock(lockedResult, "RECIPE_STRUCTURE_LOCKED");
				expect(await getRevision(session, trickroomMcpTestDesignUuid)).toBe(
					revision,
				);

				const slotResult = await session.client.callTool({
					name: "addElement",
					arguments: {
						designFileId: trickroomMcpTestDesignUuid,
						expectedRevision: revision,
						parentId: "avatar-fallback",
						index: 0,
						library: "trickroom",
						component: "container",
					},
				});
				expect(slotResult.isError).toBeFalsy();
				expect(slotResult.structuredContent).toMatchObject({
					status: "success",
				});
				expect(await getRevision(session, trickroomMcpTestDesignUuid)).not.toBe(
					revision,
				);

				const textSlotResult = await session.client.callTool({
					name: "addElement",
					arguments: {
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
				});
				expect(textSlotResult.isError).toBeFalsy();
				expect(textSlotResult.structuredContent).toMatchObject({
					status: "success",
					context: {
						parentId: "avatar-fallback",
					},
				});
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

				const moveResult = await session.client.callTool({
					name: "moveElement",
					arguments: {
						designFileId: trickroomMcpTestDesignUuid,
						expectedRevision: revision,
						elementId: "avatar-image",
						targetParentId: null,
						index: 0,
					},
				});
				expectRecipeLock(moveResult, "RECIPE_STRUCTURAL_NODE_LOCKED");

				const deleteResult = await session.client.callTool({
					name: "deleteElement",
					arguments: {
						designFileId: trickroomMcpTestDesignUuid,
						expectedRevision: revision,
						elementId: "avatar-image",
					},
				});
				expectRecipeLock(deleteResult, "RECIPE_STRUCTURAL_NODE_LOCKED");

				const markerResult = await session.client.callTool({
					name: "updateElementProps",
					arguments: {
						designFileId: trickroomMcpTestDesignUuid,
						expectedRevision: revision,
						elementId: "avatar-image",
						props: { [recipeInstanceProp]: "other-instance" },
					},
				});
				expect(markerResult.isError).toBe(true);
				expect(markerResult.structuredContent).toMatchObject({
					status: "INVALID_OPERATION",
					code: "INVALID_PROP_KEY",
				});

				const controlResult = await session.client.callTool({
					name: "updateElementProps",
					arguments: {
						designFileId: trickroomMcpTestDesignUuid,
						expectedRevision: revision,
						elementId: "avatar-image",
						props: {
							[assetIdProp]: "",
							alt: "Profile photo",
						},
					},
				});
				expect(controlResult.isError).toBeFalsy();
				expect(controlResult.structuredContent).toMatchObject({
					status: "success",
					changedElement: {
						id: "avatar-image",
					},
				});

				const controlContent = controlResult.structuredContent as {
					newRevision: string;
				};
				const renameResult = await session.client.callTool({
					name: "updateElementProps",
					arguments: {
						designFileId: trickroomMcpTestDesignUuid,
						expectedRevision: controlContent.newRevision,
						elementId: "avatar-fallback",
						name: "Initials Fallback",
						className: "grid place-items-center",
					},
				});
				expect(renameResult.isError).toBeFalsy();
				const renameContent = renameResult.structuredContent as {
					newRevision: string;
					changedElement: { name: string };
				};
				expect(renameContent.changedElement.name).toBe("Initials Fallback");

				const rootDeleteResult = await session.client.callTool({
					name: "deleteElement",
					arguments: {
						designFileId: trickroomMcpTestDesignUuid,
						expectedRevision: renameContent.newRevision,
						elementId: "avatar-root",
					},
				});
				expect(rootDeleteResult.isError).toBeFalsy();
				expect(rootDeleteResult.structuredContent).toMatchObject({
					status: "success",
					deletedElementId: "avatar-root",
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

				const modalResult = await session.client.callTool({
					name: "updateRecipeControl",
					arguments: {
						designFileId: trickroomMcpTestDesignUuid,
						expectedRevision: revision,
						instanceId: "menu-instance-1",
						path: "root",
						prop: "modal",
						value: false,
					},
				});
				expect(modalResult.isError).toBeFalsy();
				expect(modalResult.structuredContent).toMatchObject({
					status: "success",
					recipeControl: {
						instanceId: "menu-instance-1",
						path: "root",
						prop: "modal",
						value: false,
					},
				});

				const modalContent = modalResult.structuredContent as {
					newRevision: string;
				};
				const alignResult = await session.client.callTool({
					name: "updateRecipeControl",
					arguments: {
						designFileId: trickroomMcpTestDesignUuid,
						expectedRevision: modalContent.newRevision,
						instanceId: "menu-instance-1",
						path: "positioner",
						prop: "align",
						value: "end",
					},
				});
				expect(alignResult.isError).toBeFalsy();

				const alignContent = alignResult.structuredContent as {
					newRevision: string;
				};
				const sideResult = await session.client.callTool({
					name: "updateRecipeControl",
					arguments: {
						designFileId: trickroomMcpTestDesignUuid,
						expectedRevision: alignContent.newRevision,
						instanceId: "menu-instance-1",
						path: "positioner",
						prop: "side",
						value: "top",
					},
				});
				expect(sideResult.isError).toBeFalsy();

				const sideContent = sideResult.structuredContent as {
					newRevision: string;
				};
				const sideOffsetResult = await session.client.callTool({
					name: "updateRecipeControl",
					arguments: {
						designFileId: trickroomMcpTestDesignUuid,
						expectedRevision: sideContent.newRevision,
						instanceId: "menu-instance-1",
						path: "positioner",
						prop: "sideOffset",
						value: 12,
					},
				});
				expect(sideOffsetResult.isError).toBeFalsy();

				const rootRead = await session.client.callTool({
					name: "readElement",
					arguments: {
						designFileId: trickroomMcpTestDesignUuid,
						elementId: expansion.elementIdsByPath.root,
					},
				});
				expect(rootRead.structuredContent).toMatchObject({
					element: {
						props: {
							modal: false,
							[recipeInstanceProp]: "menu-instance-1",
						},
					},
				});

				const positionerRead = await session.client.callTool({
					name: "readElement",
					arguments: {
						designFileId: trickroomMcpTestDesignUuid,
						elementId: expansion.elementIdsByPath.positioner,
					},
				});
				expect(positionerRead.structuredContent).toMatchObject({
					element: {
						props: {
							align: "end",
							side: "top",
							sideOffset: 12,
							[recipeInstanceProp]: "menu-instance-1",
						},
					},
				});

				const sideOffsetContent = sideOffsetResult.structuredContent as {
					newRevision: string;
				};
				const undeclaredResult = await session.client.callTool({
					name: "updateRecipeControl",
					arguments: {
						designFileId: trickroomMcpTestDesignUuid,
						expectedRevision: sideOffsetContent.newRevision,
						instanceId: "menu-instance-1",
						path: "positioner",
						prop: "avoidCollisions",
						value: false,
					},
				});
				expect(undeclaredResult.isError).toBe(true);
				expect(undeclaredResult.structuredContent).toMatchObject({
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

					const result = await session.client.callTool({
						name: "updateRecipeInstance",
						arguments: {
							designFileId: trickroomMcpTestDesignUuid,
							expectedRevision: revision,
							elementId: "avatar-root",
						},
					});

					expect(result.isError).toBeFalsy();
					expect(result.structuredContent).toMatchObject({
						status: "success",
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
						changedElement: {
							id: "avatar-root",
						},
					});
					const content = result.structuredContent as {
						recipeMigration: {
							fromTemplateHash: string;
							toTemplateHash: string;
						};
					};
					expect(content.recipeMigration.fromTemplateHash).toMatch(/^trh1:/);
					expect(content.recipeMigration.toTemplateHash).toMatch(/^trh1:/);

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
				const invalidResult = await session.client.callTool({
					name: "updateRecipeInstance",
					arguments: {
						designFileId: trickroomMcpTestDesignUuid,
						expectedRevision: revision,
						elementId: "avatar-root",
					},
				});

				expect(invalidResult.isError).toBe(true);
				expect(invalidResult.structuredContent).toMatchObject({
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
				const unknownResult = await unknownSetup.session.client.callTool({
					name: "updateRecipeInstance",
					arguments: {
						designFileId: trickroomMcpTestDesignUuid,
						expectedRevision: revision,
						elementId: "avatar-root",
					},
				});

				expect(unknownResult.isError).toBe(true);
				expect(unknownResult.structuredContent).toMatchObject({
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
					expect(result.structuredContent).toMatchObject({
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
				expect(result.structuredContent).toMatchObject({
					status: "success",
					valid: true,
					operation: "updateRecipeControl",
					predicted: {
						instanceId: "menu-instance-1",
						path: "positioner",
						prop: "align",
						value: "end",
						changedElement: {
							id: expansion.elementIdsByPath.positioner,
						},
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
				expect(result.structuredContent).toMatchObject({
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
						changedElement: {
							id: "avatar-image",
						},
					},
				});
				const content = result.structuredContent as {
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

				const detachResult = await session.client.callTool({
					name: "detachRecipeInstance",
					arguments: {
						designFileId: trickroomMcpTestDesignUuid,
						expectedRevision: revision,
						elementId: "avatar-image",
					},
				});
				expect(detachResult.isError).toBeFalsy();
				const detachContent = detachResult.structuredContent as {
					newRevision: string;
					recipe: {
						id: string;
						instanceId: string;
						rootElementId: string | null;
					};
					detachedElementIds: string[];
				};
				expect(detachContent.recipe).toMatchObject({
					id: "base-ui/avatar.default",
					instanceId: "recipe-instance-1",
					rootElementId: "avatar-root",
				});
				expect(detachContent.detachedElementIds.sort()).toEqual([
					"avatar-fallback",
					"avatar-image",
					"avatar-root",
				]);

				const updateResult = await session.client.callTool({
					name: "updateElementProps",
					arguments: {
						designFileId: trickroomMcpTestDesignUuid,
						expectedRevision: detachContent.newRevision,
						elementId: "avatar-image",
						props: { [assetIdProp]: "", alt: "Detached avatar" },
					},
				});
				expect(updateResult.isError).toBeFalsy();

				const moveRevision = (
					updateResult.structuredContent as {
						newRevision: string;
					}
				).newRevision;
				const moveResult = await session.client.callTool({
					name: "moveElement",
					arguments: {
						designFileId: trickroomMcpTestDesignUuid,
						expectedRevision: moveRevision,
						elementId: "avatar-image",
						targetParentId: null,
						index: 0,
					},
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

				const addResult = await session.client.callTool({
					name: "addElement",
					arguments: {
						designFileId: trickroomMcpTestDesignUuid,
						expectedRevision: rev1,
						parentId: "board",
						index: 1,
						library: "trickroom",
						component: "text",
						name: "Footer",
						text: "Footer text",
					},
				});

				expect(addResult.isError).toBeFalsy();
				const addContent = addResult.structuredContent as {
					newRevision: string;
					changedElement: { id: string };
				};
				const rev2 = addContent.newRevision;
				const newId = addContent.changedElement.id;

				const updateResult = await session.client.callTool({
					name: "updateElementText",
					arguments: {
						designFileId: trickroomMcpTestDesignUuid,
						expectedRevision: rev2,
						elementId: newId,
						text: "Updated footer text",
					},
				});

				expect(updateResult.isError).toBeFalsy();
				const updateContent = updateResult.structuredContent as {
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

				const addResult = await session.client.callTool({
					name: "addElement",
					arguments: {
						designFileId: trickroomMcpTestDesignUuid,
						expectedRevision: staleRevision,
						parentId: null,
						index: 0,
						library: "trickroom",
						component: "container",
					},
				});
				expect(addResult.isError).toBeFalsy();

				const failResult = await session.client.callTool({
					name: "updateElementText",
					arguments: {
						designFileId: trickroomMcpTestDesignUuid,
						expectedRevision: staleRevision,
						elementId: "title",
						text: "Should fail",
					},
				});

				expect(failResult.isError).toBe(true);
				const failContent = failResult.structuredContent as { status: string };
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
				expect(result.structuredContent).toMatchObject({
					status: "success",
					valid: true,
					operationCount: 2,
					steps: [
						{
							stepIndex: 0,
							operation: "addElement",
							changedElementId: expect.any(String),
						},
						{
							stepIndex: 1,
							operation: "updateElementText",
						},
					],
				});

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
				expect(result.structuredContent).toMatchObject({
					status: "invalid",
					valid: false,
					failedStepIndex: 1,
					failedOperation: "moveElement",
					steps: [{ stepIndex: 0, operation: "addElement" }],
				});

				const persisted = await fixture.designFileService.readDesignFile(
					fixture.designFileService.getFileForUuid(trickroomMcpTestDesignUuid),
				);
				expect(persisted.revision).toBe(revision);
			} finally {
				await session.close();
			}
		});

		it("commits a valid plan with one revision change", async () => {
			const { fixture, session } = await setup();
			try {
				const revision = await getRevision(session, trickroomMcpTestDesignUuid);
				const result = await session.client.callTool({
					name: "applyDesignOperations",
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
				const content = result.structuredContent as {
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
				await session.client.callTool({
					name: "addElement",
					arguments: {
						designFileId: trickroomMcpTestDesignUuid,
						expectedRevision: staleRevision,
						parentId: "board",
						index: 1,
						library: "trickroom",
						component: "text",
						text: "Changed",
					},
				});

				const result = await session.client.callTool({
					name: "applyDesignOperations",
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
				expect(result.structuredContent).toMatchObject({
					status: "REVISION_MISMATCH",
					valid: false,
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
				expect(result.structuredContent).toMatchObject({
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
				expect(result.structuredContent).toMatchObject({
					status: "success",
					valid: true,
					steps: [
						{
							stepIndex: 0,
							operation: "addSubtree",
							summary: {
								stats: { nodeCount: 2 },
							},
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
					name: "applyDesignOperations",
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
				expect(result.structuredContent).toMatchObject({
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
				expect(result.structuredContent).toMatchObject({
					status: "success",
					valid: true,
					steps: [
						{
							stepIndex: 0,
							operation: "copySubtree",
							summary: {
								sameDesign: true,
								stats: { nodeCount: 1, maxDepth: 1 },
							},
						},
					],
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
					name: "applyDesignOperations",
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
					toolName: "applyDesignOperations",
					operation: "applyDesignOperations",
					designFileId: trickroomMcpTestDesignUuid,
					success: true,
				});
			} finally {
				await session.close();
			}
		});
	});
});
