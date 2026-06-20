import { afterEach, describe, expect, it } from "vitest";
import type { TrickroomDesign } from "../types";
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

	const setup = async (
		designs?: Record<string, TrickroomDesign>,
	) => {
		const fixture = await createTrickroomMcpProjectFixture({
			designs: designs ?? { [trickroomMcpTestDesignUuid]: trickroomMcpTestDesign },
		});
		fixtures.push(fixture);
		const context = await fixture.readMcpContext();
		const session = await createTrickroomMcpTestClient(context);
		return { fixture, context, session };
	};

	const getRevision = async (
		session: Awaited<ReturnType<typeof setup>>["session"],
		designFileId: string,
	): Promise<string> => {
		const result = await session.client.callTool({
			name: "readDesignFile",
			arguments: { designFileId },
		});
		const content = result.structuredContent as { designFile: { revision: string } };
		return content.designFile.revision;
	};

	describe("tool annotations", () => {
		it("mutation tools have non-read-only closed-world annotations", async () => {
			const { session } = await setup();
			try {
				const listResult = await session.client.listTools();
				const toolsByName = new Map(
					listResult.tools.map((tool) => [tool.name, tool]),
				);

				for (const name of [
					"renameDesignFile",
					"addElement",
					"updateElementProps",
					"updateElementText",
					"moveElement",
					"deleteElement",
				]) {
					const tool = toolsByName.get(name);
					expect(tool, `tool ${name} should exist`).toBeDefined();
					expect(tool?.annotations?.readOnlyHint).toBe(false);
					expect(tool?.annotations?.openWorldHint).toBe(false);
				}

				expect(toolsByName.get("addElement")?.annotations?.destructiveHint).toBe(false);

				for (const name of [
					"renameDesignFile",
					"updateElementProps",
					"updateElementText",
					"moveElement",
					"deleteElement",
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
				const staleRevision = "sha256:0000000000000000000000000000000000000000000000000000000000000000";

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
				const staleRevision = "sha256:0000000000000000000000000000000000000000000000000000000000000000";

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
				const content = result.structuredContent as { status: string; code: string };
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
				const content = result.structuredContent as { status: string; code: string };
				expect(content.status).toBe("INVALID_OPERATION");
				expect(content.code).toBe("TEXT_ROLE_PARENT");
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
				const content = result.structuredContent as { status: string; code: string };
				expect(content.status).toBe("INVALID_OPERATION");
				expect(content.code).toBe("INVALID_PROP_KEY");
			} finally {
				await session.close();
			}
		});

		it("returns INVALID_OPERATION with INVALID_PROP_KEY for unknown prop key, and does not persist", async () => {
			const { session } = await setup();
			try {
				const revisionBefore = await getRevision(session, trickroomMcpTestDesignUuid);

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
				const content = result.structuredContent as { status: string; code: string };
				expect(content.status).toBe("INVALID_OPERATION");
				expect(content.code).toBe("INVALID_PROP_KEY");

				// Design must not have been modified.
				const revisionAfter = await getRevision(session, trickroomMcpTestDesignUuid);
				expect(revisionAfter).toBe(revisionBefore);
			} finally {
				await session.close();
			}
		});

		it("new revision is different after successful add", async () => {
			const { session, fixture } = await setup();
			try {
				const revBefore = await getRevision(session, trickroomMcpTestDesignUuid);

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
				const content = result.structuredContent as { status: string; code: string };
				expect(content.status).toBe("INVALID_OPERATION");
				expect(content.code).toBe("ELEMENT_NOT_FOUND");
			} finally {
				await session.close();
			}
		});

		it("returns REVISION_MISMATCH on stale revision", async () => {
			const { session } = await setup();
			try {
				const staleRevision = "sha256:0000000000000000000000000000000000000000000000000000000000000000";

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
				const content = result.structuredContent as { status: string; code: string };
				expect(content.status).toBe("INVALID_OPERATION");
				expect(content.code).toBe("INVALID_TEXT_UPDATE");
			} finally {
				await session.close();
			}
		});

		it("returns REVISION_MISMATCH on stale revision", async () => {
			const { session } = await setup();
			try {
				const staleRevision = "sha256:0000000000000000000000000000000000000000000000000000000000000000";

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
				const content = result.structuredContent as { status: string; code: string };
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
				const content = result.structuredContent as { status: string; code: string };
				expect(content.status).toBe("INVALID_OPERATION");
				expect(content.code).toBe("TEXT_ROLE_PARENT");
			} finally {
				await session.close();
			}
		});

		it("returns REVISION_MISMATCH on stale revision", async () => {
			const { session } = await setup();
			try {
				const staleRevision = "sha256:0000000000000000000000000000000000000000000000000000000000000000";

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
				const content = result.structuredContent as { status: string; code: string };
				expect(content.status).toBe("INVALID_OPERATION");
				expect(content.code).toBe("ELEMENT_NOT_FOUND");
			} finally {
				await session.close();
			}
		});

		it("returns REVISION_MISMATCH on stale revision", async () => {
			const { session } = await setup();
			try {
				const staleRevision = "sha256:0000000000000000000000000000000000000000000000000000000000000000";

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
				const updateContent = updateResult.structuredContent as { status: string };
				expect(updateContent.status).toBe("success");

				expect(rev1).not.toBe(rev2);
			} finally {
				await session.close();
			}
		});

		it("second mutation fails with stale revision from before first mutation", async () => {
			const { session } = await setup();
			try {
				const staleRevision = await getRevision(session, trickroomMcpTestDesignUuid);

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
});
