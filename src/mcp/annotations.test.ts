import {
	mkdir,
	mkdtemp,
	readFile,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	acknowledgeAnnotation,
	createAnnotation,
	getAnnotation,
	moveAnnotationToBranch,
	recordSessionCall,
	replyToAnnotation,
	transitionAnnotation,
} from "../services/annotation-service";
import { AnnotationStore } from "../services/annotation-store";
import type {
	AnnotationScope,
	AnnotationTarget,
} from "../services/annotations.types";
import type { EditorClientContext } from "../services/editor-channel.types";
import type { TrickroomConfig, TrickroomDesign } from "../types";
import {
	createMcpAnnotationSession,
	MAX_SURFACED_ANNOTATIONS,
} from "./annotation-session";
import {
	createTrickroomMcpProjectFixture,
	createTrickroomMcpTestClient,
	type TrickroomMcpClientSession,
	type TrickroomMcpProjectFixture,
	toolPayload,
	trickroomMcpTestDesign,
	trickroomMcpTestDesignUuid,
} from "./test-support";
import { getMcpToolGroupId } from "./tool-groups";
import { TOOL } from "./tool-names";

const designId = trickroomMcpTestDesignUuid;
const otherDesignId = "00000000-0000-4000-8000-000000000002";
const branch = "feature/annotations";

const otherDesign = {
	name: "Other Design",
	systemName: "Core",
	boards: [
		{
			id: "other-board",
			props: {
				"data-trickroom-name": "Other",
				"data-trickroom-library": "trickroom",
				"data-trickroom-component": "container",
			},
			children: [],
		},
	],
} satisfies TrickroomDesign;

const layer: AnnotationTarget = {
	kind: "layer",
	designId,
	boardId: "board",
	elementId: "title",
};
const board: AnnotationTarget = { kind: "board", designId, boardId: "board" };

describe("MCP annotations", () => {
	const cleanups: Array<() => Promise<void>> = [];

	afterEach(async () => {
		for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
	});

	const open = async (
		options: {
			config?: Partial<TrickroomConfig>;
			editorTab?: Partial<EditorClientContext>;
		} = {},
	) => {
		const home = await mkdtemp(path.join(os.tmpdir(), "trickroom-ann-mcp-"));
		cleanups.push(() => rm(home, { recursive: true, force: true }));
		const fixture: TrickroomMcpProjectFixture =
			await createTrickroomMcpProjectFixture({
				...(options.config ? { config: options.config } : {}),
				designs: {
					[designId]: trickroomMcpTestDesign,
					[otherDesignId]: otherDesign,
				},
			});
		cleanups.push(() => fixture.cleanup());
		// The fixture is its own checkout on a named branch.
		await mkdir(path.join(fixture.projectRoot, ".git"), { recursive: true });
		await writeFile(
			path.join(fixture.projectRoot, ".git", "HEAD"),
			`ref: refs/heads/${branch}\n`,
		);
		const scope: AnnotationScope = {
			branch,
			worktreePath: fixture.projectRoot,
		};
		const projectId = fixture.config.projectId as string;
		const service = {
			store: new AnnotationStore({ projectId, trickroomHome: home }),
		};
		const session: TrickroomMcpClientSession =
			await createTrickroomMcpTestClient(
				{ ...(await fixture.readMcpContext()), trickroomHome: home },
				options.editorTab
					? {
							serverOptions: {
								editorChannel: {
									getEditorContext: async () => {
										const tab: EditorClientContext = {
											clientId: "tab",
											projectId,
											designFileId: designId,
											activeBoardId: "board",
											selectedId: "title",
											stageMode: "canvas",
											responsiveWidth: null,
											visible: true,
											focusedAt: null,
											reportedAt: "2026-10-14T10:00:00.000Z",
											ageMs: 10,
											...options.editorTab,
										};
										return {
											status: "ok",
											server: {
												pid: 1,
												url: "http://127.0.0.1:1/",
												projectId,
												projectRoot: fixture.projectRoot,
												startedAt: "2026-10-14T00:00:00.000Z",
											},
											clients: [tab],
											focused: tab,
										};
									},
									requestEditorFocus: async () => ({
										status: "no_server",
										message: "none",
										server: null,
										clientId: null,
										outcome: null,
									}),
								},
							},
						}
					: undefined,
			);
		cleanups.push(() => session.close());

		const call = async (name: string, args: Record<string, unknown> = {}) => {
			const result = await session.client.callTool({ name, arguments: args });
			return {
				isError: result.isError === true,
				payload: toolPayload(result),
				result,
			};
		};
		const readDesign = (id = designId) =>
			fixture.designFileService.readDesignFile(id);
		const annotate = async (
			target: AnnotationTarget = layer,
			body = "Make the title larger",
			annotationScope: AnnotationScope = scope,
			snapshot?: { stageMode?: string; responsiveWidth?: number },
		) => {
			const id = target.kind === "componentNode" ? designId : target.designId;
			const read = await readDesign(id);
			return (
				await createAnnotation(service, {
					target,
					body,
					by: { role: "human" },
					scope: annotationScope,
					design: { design: read.design, revision: read.revision },
					...(snapshot ? { snapshot } : {}),
				})
			).annotation;
		};
		/** Another agent session on the same project and home. */
		const openOtherSession = async () => {
			const other = await createTrickroomMcpTestClient({
				...(await fixture.readMcpContext()),
				trickroomHome: home,
			});
			cleanups.push(() => other.close());
			return async (name: string, args: Record<string, unknown> = {}) =>
				toolPayload(await other.client.callTool({ name, arguments: args }));
		};
		const stored = (annotationId: string) =>
			getAnnotation(service, { annotationId });
		return {
			home,
			fixture,
			session,
			openOtherSession,
			projectId,
			service,
			scope,
			call,
			readDesign,
			annotate,
			stored,
		};
	};

	it("puts the annotation tools in their own tool group", () => {
		expect(getMcpToolGroupId(TOOL.annotationList)).toBe("annotations");
		expect(getMcpToolGroupId(TOOL.annotationReply)).toBe("annotations");
		expect(getMcpToolGroupId(TOOL.annotationWatch)).toBe("annotations");
	});

	describe("surfacing", () => {
		it("adds nothing to results when the design has no annotations", async () => {
			const { call } = await open();
			const { payload } = await call(TOOL.designRead, {
				designFileId: designId,
			});
			expect(payload).not.toHaveProperty("annotations");
		});

		it("shows a new annotation in full once, acknowledges it, then only its id", async () => {
			const { call, annotate, stored, home, projectId } = await open();
			const annotation = await annotate();

			const first = (await call(TOOL.designRead, { designFileId: designId }))
				.payload.annotations;
			expect(first.new).toHaveLength(1);
			expect(first.new[0]).toMatchObject({
				annotationId: annotation.id,
				status: "acknowledged",
				target: { kind: "layer", boardId: "board", elementId: "title" },
				snapshot: {
					name: "Title",
					path: ["Board"],
					component: "trickroom/text",
					designRevision: expect.any(String),
				},
				acknowledged: { by: "this session", active: true },
				entries: [
					{ kind: "remark", by: "human", text: "Make the title larger" },
				],
			});
			expect(first.openIds).toEqual([annotation.id]);
			expect(first.counts).toEqual({
				agentWork: 1,
				humanWork: 0,
				byStatus: { acknowledged: 1 },
			});
			expect(first.next).toContain(
				`${TOOL.designApply}({ designFileId: "${designId}"`,
			);
			expect(first.next).toContain(`annotationId: "${annotation.id}"`);
			expect(first.next).toContain('board "Board"');

			const acknowledged = await stored(annotation.id);
			expect(acknowledged.status).toBe("acknowledged");
			expect(acknowledged.acknowledged?.sessionId).toEqual(expect.any(String));
			expect(acknowledged.transitions.at(-1)).toMatchObject({
				from: "open",
				to: "acknowledged",
				by: { role: "agent", sessionId: acknowledged.acknowledged?.sessionId },
			});
			// The session clock backs acknowledgement expiry.
			await expect(
				stat(
					path.join(
						home,
						"annotations",
						projectId,
						"sessions",
						`${acknowledged.acknowledged?.sessionId}.json`,
					),
				),
			).resolves.toBeTruthy();

			for (const tool of [TOOL.designRead, TOOL.designValidate]) {
				const again = (await call(tool, { designFileId: designId })).payload
					.annotations;
				expect(again.new, tool).toEqual([]);
				expect(again.openIds, tool).toEqual([annotation.id]);
				expect(again.next, tool).toContain(
					`${TOOL.annotationList}({ designFileId: "${designId}" })`,
				);
			}
		});

		it("shows an annotation again when the designer adds to it", async () => {
			const { call, annotate, service } = await open();
			const annotation = await annotate();
			await call(TOOL.designRead, { designFileId: designId });
			await replyToAnnotation(service, {
				annotationId: annotation.id,
				by: { role: "human" },
				body: "And bold",
			});
			const { annotations } = (
				await call(TOOL.designRead, {
					designFileId: designId,
					boardId: "board",
				})
			).payload;
			expect(annotations.new).toHaveLength(1);
			expect(
				annotations.new[0].entries.map((entry: { text: string }) => entry.text),
			).toEqual(["Make the title larger", "And bold"]);
		});

		it("bounds the bodies per result and names the follow-up call", async () => {
			const { call, annotate } = await open();
			for (let index = 0; index < MAX_SURFACED_ANNOTATIONS + 2; index += 1) {
				await annotate(layer, `Remark ${index}`);
			}
			const first = (
				await call(TOOL.designRead, { designFileId: designId, view: "outline" })
			).payload.annotations;
			expect(first.new).toHaveLength(MAX_SURFACED_ANNOTATIONS);
			expect(first.more).toBe(2);
			expect(first.next).toContain(
				`2 more: ${TOOL.annotationList}({ designFileId: "${designId}" })`,
			);
			const second = (
				await call(TOOL.designRead, {
					designFileId: designId,
					elementId: "title",
				})
			).payload.annotations;
			expect(second.new).toHaveLength(2);
			expect(second).not.toHaveProperty("more");
		});

		it("leaves another session's active acknowledgement alone", async () => {
			const { call, annotate, service, stored } = await open();
			const annotation = await annotate();
			await acknowledgeAnnotation(service, {
				annotationId: annotation.id,
				sessionId: "other-session",
			});
			await recordSessionCall(service, "other-session");
			const { annotations } = (
				await call(TOOL.designRead, { designFileId: designId })
			).payload;
			expect(annotations.new[0].acknowledged).toMatchObject({
				by: "another session",
				active: true,
			});
			expect((await stored(annotation.id)).acknowledged?.sessionId).toBe(
				"other-session",
			);
		});

		it("surfaces only the checkout's branch, and lists others on request", async () => {
			const { call, annotate } = await open();
			const elsewhere = await annotate(layer, "On main", {
				branch: "main",
				worktreePath: "/elsewhere",
			});
			const read = await call(TOOL.designRead, { designFileId: designId });
			expect(read.payload).not.toHaveProperty("annotations");

			const current = await call(TOOL.annotationList, {
				designFileId: designId,
			});
			expect(current.payload.annotations).toEqual([]);
			const all = await call(TOOL.annotationList, {
				designFileId: designId,
				branch: "all",
			});
			expect(all.payload.annotations).toEqual([
				expect.objectContaining({
					annotationId: elsewhere.id,
					branch: "main",
					// Another branch's work is not acknowledged by this checkout.
					status: "open",
				}),
			]);
		});

		it("counts annotations in design_list and project_list", async () => {
			const { call, annotate, service } = await open();
			await annotate();
			const addressed = await annotate(board, "Tighten the spacing");
			await replyToAnnotation(service, {
				annotationId: addressed.id,
				by: { role: "agent", sessionId: "earlier" },
				question: "How tight?",
			});

			const list = await call(TOOL.designList);
			const entry = list.payload.designFiles.find(
				(designFile: { id: string }) => designFile.id === designId,
			);
			expect(entry.annotations).toEqual({ agentWork: 1, humanWork: 1 });
			const other = list.payload.designFiles.find(
				(designFile: { id: string }) => designFile.id === otherDesignId,
			);
			expect(other).not.toHaveProperty("annotations");

			const projects = await call(TOOL.projectList);
			expect(projects.payload.annotations).toMatchObject({
				agentWork: 1,
				humanWork: 1,
				designs: 1,
			});
		});

		it("gives editor_context the open design's counts and the selected layer's", async () => {
			const { call, annotate } = await open({ editorTab: {} });
			const onTitle = await annotate();
			await annotate(board, "Whole board");
			const { payload } = await call(TOOL.editorContext);
			expect(payload.status).toBe("ok");
			expect(payload.annotations.counts.agentWork).toBe(2);
			expect(payload.annotations.selectedLayer).toEqual({
				elementId: "title",
				agentWork: 1,
				humanWork: 0,
				byStatus: { acknowledged: 1 },
				annotationIds: [onTitle.id],
			});
			// Board annotations sort before the layers on it? Same board: oldest first.
			expect(payload.annotations.new).toHaveLength(2);
		});

		it("appends the block to screenshot results as a text block", async () => {
			const fixtureCapture = async () => ({
				boardId: "board",
				captures: [
					{
						mimeType: "image/png" as const,
						base64: "cG5n",
						bytes: 3,
						width: 720,
						height: 900,
						viewport: { width: 1440, height: 900 },
						theme: "light" as const,
						scale: 0.5,
					},
				],
			});
			const home = await mkdtemp(path.join(os.tmpdir(), "trickroom-ann-mcp-"));
			cleanups.push(() => rm(home, { recursive: true, force: true }));
			const fixture = await createTrickroomMcpProjectFixture();
			cleanups.push(() => fixture.cleanup());
			const projectId = fixture.config.projectId as string;
			const read = await fixture.designFileService.readDesignFile(designId);
			const scope = {
				branch: "*",
				worktreePath: fixture.projectRoot,
			};
			// No .git of its own: the repository this runs in decides the scope.
			const { readCheckoutScope } = await import("../services/checkout-scope");
			Object.assign(scope, await readCheckoutScope(fixture.projectRoot));
			const annotation = (
				await createAnnotation(
					{ store: new AnnotationStore({ projectId, trickroomHome: home }) },
					{
						target: layer,
						body: "Check this",
						by: { role: "human" },
						scope,
						design: { design: read.design, revision: read.revision },
					},
				)
			).annotation;
			const session = await createTrickroomMcpTestClient(
				{ ...(await fixture.readMcpContext()), trickroomHome: home },
				{ serverOptions: { screenshotCapture: fixtureCapture } },
			);
			cleanups.push(() => session.close());
			const result = await session.client.callTool({
				name: TOOL.designScreenshot,
				arguments: { designFileId: designId, boardId: "board" },
			});
			const content = result.content as Array<{ type: string; text?: string }>;
			expect(content.map((block) => block.type)).toEqual([
				"text",
				"text",
				"image",
			]);
			expect(content[1]?.text).toMatch(/^annotations: /u);
			const block = JSON.parse(
				(content[1]?.text ?? "").slice("annotations: ".length),
			);
			expect(block.new[0].annotationId).toBe(annotation.id);
		});
	});

	describe("review round 1 regressions", () => {
		it("keeps a designer remark sent while the agent worked as open work", async () => {
			const { call, annotate, service, stored } = await open();
			const annotation = await annotate();
			const { revision } = (
				await call(TOOL.designRead, { designFileId: designId })
			).payload.designFile;
			// The designer adds to it after the agent read it, before its write.
			const added = await replyToAnnotation(service, {
				annotationId: annotation.id,
				by: { role: "human" },
				body: "Also make it red",
			});
			const remarkId = added.annotation.entries.at(-1)?.id;

			const { isError, payload } = await call(TOOL.designApply, {
				designFileId: designId,
				expectedRevision: revision,
				operations: [
					{
						operation: "updateElementProps",
						parameters: { elementId: "title", className: "text-2xl" },
					},
				],
				addresses: [{ annotationId: annotation.id, reply: "Larger now." }],
			});
			expect(isError).toBe(false);
			expect(payload.addressed).toEqual([
				expect.objectContaining({
					annotationId: annotation.id,
					status: "acknowledged",
					unseenRemarkIds: [remarkId],
				}),
			]);
			// The new remark is news in the same result.
			expect(payload.annotations.new).toHaveLength(1);
			expect(
				payload.annotations.new[0].entries.map(
					(entry: { kind: string; text?: string }) => entry.text ?? entry.kind,
				),
			).toEqual(["Make the title larger", "Also make it red", "Larger now."]);

			const after = await stored(annotation.id);
			expect(after.status).toBe("acknowledged");
			expect(after.entries.map((entry) => entry.kind)).toEqual([
				"remark",
				"remark",
				"change",
			]);
			// Shown once; the next read lists it as open work by id.
			const next = (await call(TOOL.designRead, { designFileId: designId }))
				.payload.annotations;
			expect(next.new).toEqual([]);
			expect(next.openIds).toEqual([annotation.id]);
		});

		it("addresses normally when the agent saw every remark", async () => {
			const { call, annotate, readDesign, service, stored } = await open();
			const annotation = await annotate();
			await call(TOOL.designRead, { designFileId: designId });
			await replyToAnnotation(service, {
				annotationId: annotation.id,
				by: { role: "human" },
				body: "Also make it red",
			});
			// Seen in full again before the write.
			await call(TOOL.annotationList, { designFileId: designId });
			const { payload } = await call(TOOL.designApply, {
				designFileId: designId,
				expectedRevision: (await readDesign()).revision,
				operations: [
					{
						operation: "updateElementProps",
						parameters: { elementId: "title", className: "text-red-500" },
					},
				],
				addresses: [{ annotationId: annotation.id, reply: "Red and larger." }],
			});
			expect(payload.addressed[0]).not.toHaveProperty("unseenRemarkIds");
			expect((await stored(annotation.id)).status).toBe("addressed");
		});

		it("leaves another session's active acknowledgement in place", async () => {
			const { call, annotate, openOtherSession, stored } = await open();
			const annotation = await annotate();
			await call(TOOL.designRead, { designFileId: designId });
			const first = (await stored(annotation.id)).acknowledged;
			const other = await openOtherSession();
			const seenByOther = await other(TOOL.designRead, {
				designFileId: designId,
			});
			expect(seenByOther.annotations.new[0].acknowledged).toMatchObject({
				by: "another session",
				active: true,
			});
			expect((await stored(annotation.id)).acknowledged).toEqual(first);
		});

		it("does not surface or acknowledge an annotation moved to another branch meanwhile", async () => {
			const { annotate, service, stored, fixture, home } = await open();
			const annotation = await annotate();
			const session = createMcpAnnotationSession({
				sessionId: "racing-session",
				defaultHome: home,
			});
			const context = {
				...(await fixture.readMcpContext()),
				trickroomHome: home,
			};
			const project = await session.openProject(context);
			if (!project) throw new Error("no project");
			const { annotations: listed } = await session.listLive(
				project,
				designId,
				null,
			);
			expect(listed.map((view) => view.id)).toEqual([annotation.id]);
			// The designer moves it to main between the listing and the
			// acknowledgement.
			await moveAnnotationToBranch(service, {
				annotationId: annotation.id,
				by: { role: "human" },
				scope: { branch: "main", worktreePath: "/main" },
			});
			const { shown, fresh } = await session.acknowledgeShown(
				project,
				listed,
				session.isCurrentWork(project),
			);
			expect(shown).toEqual([]);
			expect(fresh.get(annotation.id)?.branch).toBe("main");
			const after = await stored(annotation.id);
			expect(after.status).toBe("open");
			expect(after.branch).toBe("main");
		});

		it("shows the stage mode, responsive width and design revision it was made on", async () => {
			const { call, annotate, readDesign } = await open();
			const { revision } = await readDesign();
			await annotate(layer, "This wraps badly", undefined, {
				stageMode: "responsive",
				responsiveWidth: 375,
			});
			const { annotations } = (
				await call(TOOL.designRead, { designFileId: designId })
			).payload;
			expect(annotations.new[0].snapshot).toEqual({
				name: "Title",
				path: ["Board"],
				component: "trickroom/text",
				designRevision: revision,
				stageMode: "responsive",
				responsiveWidth: 375,
			});
		});

		it("watches the board an annotated layer moved to", async () => {
			const { call, annotate, readDesign, fixture } = await open();
			const annotation = await annotate();
			// Another writer adds a board and moves the layer onto it.
			const { design } = await readDesign();
			const moved = structuredClone(design);
			const [first] = moved.boards;
			const title = Array.isArray(first?.children)
				? first.children.splice(0, 1)
				: [];
			moved.boards.push({
				id: "board-2",
				props: {
					"data-trickroom-name": "Second",
					"data-trickroom-library": "trickroom",
					"data-trickroom-component": "container",
				},
				children: title,
			});
			await fixture.designFileService.writeDesignFile(designId, moved);

			const onOld = await call(TOOL.annotationWatch, {
				designFileId: designId,
				boardId: "board",
				timeoutMs: 1000,
			});
			expect(onOld.payload.status).toBe("timeout");
			const onNew = await call(TOOL.annotationWatch, {
				designFileId: designId,
				boardId: "board-2",
				timeoutMs: 5000,
			});
			expect(onNew.payload.status).toBe("success");
			expect(onNew.payload.annotations[0].annotationId).toBe(annotation.id);
		});

		it("refuses writes to another branch's annotations", async () => {
			const { call, annotate, readDesign, stored } = await open();
			const onMain = await annotate(layer, "On main", {
				branch: "main",
				worktreePath: "/main",
			});
			for (const args of [
				{ body: "On it" },
				{ resolve: {} },
				{ reanchor: { boardId: "board" } },
			]) {
				const reply = await call(TOOL.annotationReply, {
					annotationId: onMain.id,
					...args,
				});
				expect(reply.isError).toBe(true);
				expect(reply.payload).toMatchObject({
					code: "WRONG_BRANCH",
					branch: "main",
					currentBranch: branch,
				});
			}
			const { revision } = await readDesign();
			const write = await call(TOOL.designApply, {
				designFileId: designId,
				expectedRevision: revision,
				operations: [
					{
						operation: "updateElementProps",
						parameters: { elementId: "title", className: "text-2xl" },
					},
				],
				addresses: [{ annotationId: onMain.id, reply: "Done" }],
			});
			expect(write.isError).toBe(true);
			expect(write.payload.code).toBe("WRONG_BRANCH");
			expect((await readDesign()).revision).toBe(revision);
			const after = await stored(onMain.id);
			expect(after.entries).toHaveLength(1);
			expect(after.target).toEqual(onMain.target);
		});

		it("keeps the unscoped bucket writable from a detached checkout", async () => {
			const { call, annotate, fixture, stored } = await open();
			await writeFile(
				path.join(fixture.projectRoot, ".git", "HEAD"),
				"0123456789abcdef0123456789abcdef01234567\n",
			);
			const unscoped = await annotate(layer, "Detached remark", {
				branch: "*",
				worktreePath: fixture.projectRoot,
			});
			const reply = await call(TOOL.annotationReply, {
				annotationId: unscoped.id,
				question: "Which title?",
			});
			expect(reply.isError).toBe(false);
			expect((await stored(unscoped.id)).status).toBe("needs_input");
		});

		it("writes nothing when part of a re-anchor call is invalid", async () => {
			const { call, annotate, stored } = await open();
			const annotation = await annotate(board, "Whole board");
			const { isError, payload } = await call(TOOL.annotationReply, {
				annotationId: annotation.id,
				reanchor: { elementId: "title" },
				body: " ",
			});
			expect(isError).toBe(true);
			expect(payload.code).toBe("INVALID_INPUT");
			const after = await stored(annotation.id);
			expect(after.target).toEqual(annotation.target);
			expect(after.entries).toHaveLength(1);
		});
	});

	describe("annotation_list", () => {
		it("lists live annotations with ids and anchors, agent work first", async () => {
			const { call, annotate, service } = await open();
			const asked = await annotate(board, "Spacing?");
			await replyToAnnotation(service, {
				annotationId: asked.id,
				by: { role: "agent", sessionId: "earlier" },
				question: "Which spacing?",
			});
			const open1 = await annotate();
			const resolved = await annotate(layer, "Old");
			await transitionAnnotation(service, {
				annotationId: resolved.id,
				by: { role: "human" },
				to: "resolved",
			});

			const { payload } = await call(TOOL.annotationList, {
				designFileId: designId,
			});
			expect(payload.branch).toBe(branch);
			expect(
				payload.annotations.map(
					(entry: { annotationId: string }) => entry.annotationId,
				),
			).toEqual([open1.id, asked.id]);
			expect(payload.annotations[1]).toMatchObject({
				status: "needs_input",
				target: { kind: "board", boardId: "board" },
				entries: [
					{ kind: "remark", by: "human" },
					{ kind: "question", by: "agent", text: "Which spacing?" },
				],
			});
			expect(payload.counts).toMatchObject({ agentWork: 1, humanWork: 1 });

			const all = await call(TOOL.annotationList, {
				designFileId: designId,
				status: "all",
				elementId: "title",
			});
			expect(
				all.payload.annotations.map(
					(entry: { annotationId: string }) => entry.annotationId,
				),
			).toEqual([open1.id, resolved.id]);
		});

		it("reports a wrong design id when nothing is stored for it", async () => {
			const { call } = await open();
			const { isError, payload } = await call(TOOL.annotationList, {
				designFileId: "00000000-0000-4000-8000-00000000dead",
			});
			expect(isError).toBe(true);
			expect(payload.code).toBe("DESIGN_NOT_FOUND");
		});

		it("needs designFileId or systemId with componentId", async () => {
			const { call } = await open();
			const { isError, payload } = await call(TOOL.annotationList, {
				systemId: "core",
			});
			expect(isError).toBe(true);
			expect(payload.code).toBe("INVALID_OPERATION_PARAMETERS");
		});
	});

	describe("annotation_reply", () => {
		it("asks, replies, dismisses and resolves as this session's agent", async () => {
			const { call, annotate, stored } = await open();
			const first = await annotate();
			const asked = await call(TOOL.annotationReply, {
				annotationId: first.id,
				question: "Larger than the subtitle?",
			});
			expect(asked.isError).toBe(false);
			expect(asked.payload.annotation).toMatchObject({
				annotationId: first.id,
				status: "needs_input",
				entries: [
					{ kind: "remark", by: "human" },
					{ kind: "question", by: "this session" },
				],
			});
			const questioned = await stored(first.id);
			expect(questioned.entries.at(-1)?.by).toEqual({
				role: "agent",
				sessionId: expect.any(String),
			});

			const second = await annotate(board, "Make it dark");
			const dismissed = await call(TOOL.annotationReply, {
				annotationId: second.id,
				dismiss: { reason: "Dark mode is a theme, not a board change." },
			});
			expect(dismissed.payload.annotation.status).toBe("dismissed");

			const third = await annotate(layer, "Fine as it is?");
			const resolved = await call(TOOL.annotationReply, {
				annotationId: third.id,
				body: "Agreed",
				resolve: { summary: "No change needed" },
			});
			expect(resolved.payload.annotation.status).toBe("resolved");
			expect((await stored(third.id)).resolvedBy).toEqual({
				role: "agent",
				sessionId: expect.any(String),
			});

			// Its own write is not news to the session.
			const read = await call(TOOL.designRead, { designFileId: designId });
			expect(read.payload).not.toHaveProperty("annotations");
		});

		it("re-anchors to another layer or board of the same design", async () => {
			const { call, annotate, stored, readDesign, fixture } = await open({
				config: { mcp: { enabled: true, auditLog: true } },
			});
			const annotation = await annotate(board, "Whole board");
			// A copy replaced the annotated content: anchor to the new layer.
			const { revision } = await readDesign();
			const copied = await call(TOOL.designApply, {
				designFileId: designId,
				expectedRevision: revision,
				operations: [
					{
						operation: "copySubtree",
						parameters: {
							sourceElementId: "title",
							parentId: "board",
							index: 1,
						},
					},
				],
			});
			const copyId = copied.payload.created[0].id as string;

			const moved = await call(TOOL.annotationReply, {
				annotationId: annotation.id,
				reanchor: { elementId: copyId },
				body: "Moved to the copy.",
			});
			expect(moved.isError).toBe(false);
			expect(moved.payload.reanchored).toEqual({
				target: {
					kind: "layer",
					designId,
					boardId: "board",
					elementId: copyId,
				},
				snapshot: {
					name: "Title Copy",
					path: ["Board"],
					component: "trickroom/text",
					designRevision: copied.payload.newRevision,
				},
			});
			expect(moved.payload.annotation).toMatchObject({
				status: "acknowledged",
				target: { kind: "layer", elementId: copyId },
			});
			const after = await stored(annotation.id);
			expect(after.target).toMatchObject({ kind: "layer", elementId: copyId });
			expect(after.entries.map((entry) => entry.kind)).toEqual([
				"remark",
				"reanchor",
				"reply",
			]);
			expect(after.entries[1]?.by).toEqual({
				role: "agent",
				sessionId: expect.any(String),
			});

			const back = await call(TOOL.annotationReply, {
				annotationId: annotation.id,
				reanchor: { boardId: "board" },
			});
			expect(back.payload.reanchored.target).toEqual({
				kind: "board",
				designId,
				boardId: "board",
			});

			const audit = (
				await readFile(
					path.join(fixture.projectRoot, ".trickroom", "audit-log.jsonl"),
					"utf8",
				)
			)
				.trim()
				.split("\n")
				.map((line) => JSON.parse(line));
			expect(audit.at(-1)).toMatchObject({
				toolName: TOOL.annotationReply,
				operation: "reanchor",
				success: true,
				details: {
					annotationId: annotation.id,
					reanchor: { boardId: "board" },
				},
			});
		});

		it("refuses re-anchoring outside the annotation's design", async () => {
			const { call, annotate, stored } = await open();
			const annotation = await annotate();
			const otherDesignBoard = await call(TOOL.annotationReply, {
				annotationId: annotation.id,
				reanchor: { boardId: "other-board" },
			});
			expect(otherDesignBoard.isError).toBe(true);
			expect(otherDesignBoard.payload.code).toBe("BOARD_NOT_FOUND");
			expect(otherDesignBoard.payload.message).toContain(
				"re-anchoring stays within it",
			);

			const unknown = await call(TOOL.annotationReply, {
				annotationId: annotation.id,
				reanchor: { elementId: "missing-element" },
			});
			expect(unknown.isError).toBe(true);
			expect(unknown.payload.code).toBe("ELEMENT_NOT_FOUND");

			const both = await call(TOOL.annotationReply, {
				annotationId: annotation.id,
				reanchor: { boardId: "board" },
				resolve: {},
			});
			expect(both.payload.code).toBe("INVALID_INPUT");
			const after = await stored(annotation.id);
			expect(after.target).toMatchObject({ kind: "layer", elementId: "title" });
			expect(after.entries).toHaveLength(1);
		});

		it("names detached annotations in next with the re-anchor call", async () => {
			const { call, annotate, readDesign } = await open();
			const annotation = await annotate();
			await call(TOOL.designApply, {
				designFileId: designId,
				expectedRevision: (await readDesign()).revision,
				operations: [
					{ operation: "deleteElement", parameters: { elementId: "title" } },
				],
			});
			const { annotations } = (
				await call(TOOL.designRead, { designFileId: designId })
			).payload;
			expect(annotations.next).toContain(
				`Detached (their element no longer exists): ${annotation.id}`,
			);
			expect(annotations.next).toContain(
				`${TOOL.annotationReply}({ annotationId: "${annotation.id}", reanchor: { elementId: "<new element id>" } })`,
			);
		});

		it("refuses unknown annotations and invalid combinations", async () => {
			const { call, annotate } = await open();
			const missing = await call(TOOL.annotationReply, {
				annotationId: "nope",
				body: "Hello",
			});
			expect(missing.isError).toBe(true);
			expect(missing.payload.code).toBe("ANNOTATION_NOT_FOUND");

			const annotation = await annotate();
			const both = await call(TOOL.annotationReply, {
				annotationId: annotation.id,
				question: "?",
				resolve: {},
			});
			expect(both.isError).toBe(true);
			expect(both.payload.code).toBe("INVALID_INPUT");
		});

		it("needs read-write mode; reads work in read-only mode", async () => {
			const { call, annotate, stored } = await open({
				config: { mcp: { enabled: true, mode: "read-only" } },
			});
			const annotation = await annotate();
			for (const args of [
				{ body: "On it" },
				{ reanchor: { boardId: "board" } },
			]) {
				const reply = await call(TOOL.annotationReply, {
					annotationId: annotation.id,
					...args,
				});
				expect(reply.isError).toBe(true);
				expect(reply.payload).toMatchObject({
					status: "POLICY_DENIED",
					code: "MCP_READ_ONLY",
				});
			}
			expect((await stored(annotation.id)).target.kind).toBe("layer");
			const list = await call(TOOL.annotationList, { designFileId: designId });
			expect(list.isError).toBe(false);
			expect(list.payload.annotations).toHaveLength(1);
			const read = await call(TOOL.designRead, { designFileId: designId });
			expect(read.payload.annotations.openIds).toEqual([annotation.id]);
		});

		it("audits replies that resolve or dismiss", async () => {
			const { call, annotate, fixture } = await open({
				config: { mcp: { enabled: true, auditLog: true } },
			});
			const annotation = await annotate();
			await call(TOOL.annotationReply, {
				annotationId: annotation.id,
				resolve: { summary: "Done" },
			});
			const entries = (
				await readFile(
					path.join(fixture.projectRoot, ".trickroom", "audit-log.jsonl"),
					"utf8",
				)
			)
				.trim()
				.split("\n")
				.map((line) => JSON.parse(line));
			expect(entries.at(-1)).toMatchObject({
				toolName: TOOL.annotationReply,
				operation: "resolve",
				designFileId: designId,
				success: true,
				details: { annotationId: annotation.id },
			});
		});
	});

	describe("design_apply addresses", () => {
		const retitle = (expectedRevision: string, className = "text-2xl") => ({
			designFileId: designId,
			expectedRevision,
			operations: [
				{
					operation: "updateElementProps",
					parameters: { elementId: "title", className },
				},
			],
		});

		it("records the change on each addressed annotation", async () => {
			const { call, annotate, readDesign, stored, fixture } = await open({
				config: { mcp: { enabled: true, auditLog: true } },
			});
			const annotation = await annotate();
			const { revision } = await readDesign();
			const { isError, payload } = await call(TOOL.designApply, {
				...retitle(revision),
				addresses: [{ annotationId: annotation.id, reply: "Now text-2xl." }],
			});
			expect(isError).toBe(false);
			expect(payload.addressed).toEqual([
				{
					annotationId: annotation.id,
					status: "addressed",
					entryId: expect.any(String),
				},
			]);
			// Nothing left for an agent to do.
			expect(payload).not.toHaveProperty("annotations");

			const after = await stored(annotation.id);
			expect(after.status).toBe("addressed");
			const change = after.entries.at(-1);
			expect(change).toMatchObject({
				kind: "change",
				body: "Now text-2xl.",
				by: { role: "agent", sessionId: expect.any(String) },
				change: {
					revisionBefore: revision,
					revisionAfter: payload.newRevision,
					layerIds: expect.arrayContaining(["title"]),
					operations: [
						{
							operation: "updateElementProps",
							summary: "updateElementProps title",
						},
					],
					summary: "1 operation: updateElementProps",
				},
			});

			const audit = (
				await readFile(
					path.join(fixture.projectRoot, ".trickroom", "audit-log.jsonl"),
					"utf8",
				)
			)
				.trim()
				.split("\n")
				.map((line) => JSON.parse(line));
			expect(audit.at(-1)).toMatchObject({
				toolName: TOOL.designApply,
				success: true,
				details: { addresses: [annotation.id] },
			});
		});

		it("refuses the write for unknown, other-design and closed annotations", async () => {
			const { call, annotate, readDesign, service } = await open();
			const onOther = await annotate(
				{ kind: "board", designId: otherDesignId, boardId: "other-board" },
				"Elsewhere",
			);
			const closed = await annotate();
			await transitionAnnotation(service, {
				annotationId: closed.id,
				by: { role: "human" },
				to: "dismissed",
				reason: "Never mind",
			});
			const { revision } = await readDesign();
			for (const [annotationId, code] of [
				["missing-annotation", "ANNOTATION_NOT_FOUND"],
				[onOther.id, "WRONG_DESIGN"],
				[closed.id, "ANNOTATION_CLOSED"],
			] as const) {
				const { isError, payload } = await call(TOOL.designApply, {
					...retitle(revision),
					addresses: [{ annotationId, reply: "Done" }],
				});
				expect(isError, code).toBe(true);
				expect(payload.code, code).toBe(code);
				expect(payload.addressProblems, code).toEqual([
					expect.objectContaining({ annotationId, code }),
				]);
				expect(payload.message, code).toContain("Nothing was written");
			}
			expect((await readDesign()).revision).toBe(revision);
		});

		it("refuses an annotation named twice", async () => {
			const { call, annotate, readDesign } = await open();
			const annotation = await annotate();
			const { revision } = await readDesign();
			const { isError, payload } = await call(TOOL.designApply, {
				...retitle(revision),
				addresses: [
					{ annotationId: annotation.id, reply: "One" },
					{ annotationId: annotation.id, reply: "Two" },
				],
			});
			expect(isError).toBe(true);
			expect(payload.code).toBe("INVALID_OPERATION_PARAMETERS");
			expect((await readDesign()).revision).toBe(revision);
		});

		it("records nothing when the write is refused", async () => {
			const { call, annotate, readDesign, stored, fixture } = await open();
			const annotation = await annotate();
			const { revision, design } = await readDesign();
			// Another writer changes the same board.
			const changed = structuredClone(design);
			const title = changed.boards[0]?.children;
			if (Array.isArray(title) && title[0]) {
				title[0].props.className = "text-sm";
			}
			await fixture.designFileService.writeDesignFile(designId, changed);

			const mismatch = await call(TOOL.designApply, {
				...retitle(revision),
				addresses: [{ annotationId: annotation.id, reply: "Done" }],
			});
			expect(mismatch.isError).toBe(true);
			expect(mismatch.payload.status).toBe("REVISION_MISMATCH");

			const failing = await call(TOOL.designApply, {
				designFileId: designId,
				expectedRevision: (await readDesign()).revision,
				operations: [
					{ operation: "deleteElement", parameters: { elementId: "missing" } },
				],
				addresses: [{ annotationId: annotation.id, reply: "Done" }],
			});
			expect(failing.isError).toBe(true);

			const after = await stored(annotation.id);
			expect(after.status).toBe("open");
			expect(after.entries.map((entry) => entry.kind)).toEqual(["remark"]);
		});

		it("needs read-write mode", async () => {
			const { call, annotate, readDesign, stored } = await open({
				config: { mcp: { enabled: true, mode: "read-only" } },
			});
			const annotation = await annotate();
			const { payload } = await call(TOOL.designApply, {
				...retitle((await readDesign()).revision),
				addresses: [{ annotationId: annotation.id, reply: "Done" }],
			});
			expect(payload.code).toBe("MCP_READ_ONLY");
			expect((await stored(annotation.id)).status).toBe("open");
		});
	});

	describe("delete warnings", () => {
		it("names the annotations a deleteElement step detaches", async () => {
			const { call, annotate, readDesign } = await open();
			const annotation = await annotate();
			const { revision } = await readDesign();
			const operations = [
				{ operation: "deleteElement", parameters: { elementId: "title" } },
			];

			const dryRun = await call(TOOL.designValidate, {
				designFileId: designId,
				expectedRevision: revision,
				operations,
			});
			expect(dryRun.payload.summary.codes).toMatchObject({
				ANNOTATION_TARGET_DELETED: 1,
			});
			expect(dryRun.payload.warnings).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						code: "ANNOTATION_TARGET_DELETED",
						elementIds: ["title"],
						message: expect.stringContaining(annotation.id),
					}),
				]),
			);

			const applied = await call(TOOL.designApply, {
				designFileId: designId,
				expectedRevision: revision,
				operations,
			});
			expect(applied.isError).toBe(false);
			expect(applied.payload.warnings).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						code: "ANNOTATION_TARGET_DELETED",
						elementIds: ["title"],
						annotationIds: [annotation.id],
					}),
				]),
			);
			expect(applied.payload.warningCount).toBeGreaterThanOrEqual(1);

			// The annotation stays, detached; this session saw it in the
			// dry-run, so it is not new.
			const list = await call(TOOL.annotationList, { designFileId: designId });
			expect(list.payload.annotations[0]).toMatchObject({
				annotationId: annotation.id,
				detached: true,
			});
			expect(list.payload.counts.detached).toBe(1);
		});
	});

	describe("annotation_watch", () => {
		it("times out with the call that keeps waiting", async () => {
			const { call } = await open();
			const started = Date.now();
			const { isError, payload } = await call(TOOL.annotationWatch, {
				designFileId: designId,
				timeoutMs: 1000,
			});
			expect(isError).toBe(false);
			expect(Date.now() - started).toBeGreaterThanOrEqual(900);
			expect(payload).toMatchObject({
				status: "timeout",
				designFileId: designId,
			});
			expect(payload.next).toContain(
				`${TOOL.annotationWatch}({ designFileId: "${designId}" })`,
			);
		});

		it("returns new annotations once they arrive, batched", async () => {
			const { call, annotate, stored } = await open();
			const watching = call(TOOL.annotationWatch, {
				designFileId: designId,
				timeoutMs: 20_000,
			});
			await new Promise((resolve) => setTimeout(resolve, 300));
			const first = await annotate(layer, "First");
			await new Promise((resolve) => setTimeout(resolve, 200));
			const second = await annotate(board, "Second");
			const { payload } = await watching;
			expect(payload.status).toBe("success");
			expect(
				payload.annotations
					.map((entry: { annotationId: string }) => entry.annotationId)
					.sort(),
			).toEqual([first.id, second.id].sort());
			expect(payload.next).toContain(TOOL.designApply);
			expect((await stored(first.id)).status).toBe("acknowledged");
		});

		it("returns unseen work at once, and nothing it already returned", async () => {
			const { call, annotate } = await open();
			const annotation = await annotate();
			const started = Date.now();
			const first = await call(TOOL.annotationWatch, {
				designFileId: designId,
			});
			expect(Date.now() - started).toBeLessThan(5_000);
			expect(first.payload.annotations[0].annotationId).toBe(annotation.id);
			const second = await call(TOOL.annotationWatch, {
				designFileId: designId,
				timeoutMs: 1000,
			});
			expect(second.payload.status).toBe("timeout");
			expect(second.payload.counts.agentWork).toBe(1);
		});

		it("stops waiting when the request is cancelled", async () => {
			const { call, session } = await open();
			const controller = new AbortController();
			const started = Date.now();
			const watching = session.client.callTool(
				{
					name: TOOL.annotationWatch,
					arguments: { designFileId: designId, timeoutMs: 60_000 },
				},
				undefined,
				{ signal: controller.signal },
			);
			setTimeout(() => controller.abort(), 200);
			await expect(watching).rejects.toThrow();
			expect(Date.now() - started).toBeLessThan(5_000);
			// The session still answers.
			const next = await call(TOOL.designRead, { designFileId: designId });
			expect(next.isError).toBe(false);
		});

		it("fails before waiting for an unknown design", async () => {
			const { call } = await open();
			const { isError, payload } = await call(TOOL.annotationWatch, {
				designFileId: "00000000-0000-4000-8000-00000000dead",
			});
			expect(isError).toBe(true);
			expect(payload.code).toBe("DESIGN_NOT_FOUND");
		});
	});
});
