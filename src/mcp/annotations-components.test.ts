import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	createAnnotation,
	getAnnotation,
	moveAnnotationToBranch,
	replyToAnnotation,
} from "../services/annotation-service";
import { AnnotationStore } from "../services/annotation-store";
import type {
	AnnotationScope,
	AnnotationTarget,
} from "../services/annotations.types";
import {
	readComponentAnchor,
	resolveAnnotationSystemId,
} from "../services/component-annotations";
import { discardSystemComponentDraft } from "../utils/system-component-operations";
import {
	createTrickroomMcpProjectFixture,
	createTrickroomMcpTestClient,
	toolPayload,
	trickroomMcpTestDesignUuid,
} from "./test-support";
import { TOOL } from "./tool-names";

const branch = "feature/annotations";
const designId = trickroomMcpTestDesignUuid;
const systemName = "Core";

const node = (
	nodePath: string,
	component: string,
	extra: Record<string, unknown> = {},
) => ({ path: nodePath, library: "trickroom", component, ...extra });

const buttonRoot = (labelText = "Label", withIcon = true) =>
	node("root", "container", {
		children: [
			node("label", "text", { text: labelText }),
			...(withIcon ? [node("icon", "icon")] : []),
		],
	});

const toneVariants = {
	axes: {
		tone: {
			label: "Tone",
			defaultValue: "neutral",
			values: {
				brand: { classesByPath: { root: "text-blue-600" } },
				neutral: { classesByPath: { root: "text-zinc-700" } },
			},
		},
	},
};

describe("MCP annotations on system components", () => {
	const cleanups: Array<() => Promise<void>> = [];

	afterEach(async () => {
		for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
	});

	const open = async () => {
		const home = await mkdtemp(path.join(os.tmpdir(), "trickroom-ann-cmp-"));
		cleanups.push(() => rm(home, { recursive: true, force: true }));
		const fixture = await createTrickroomMcpProjectFixture();
		cleanups.push(() => fixture.cleanup());
		await mkdir(path.join(fixture.projectRoot, ".git"), { recursive: true });
		await writeFile(
			path.join(fixture.projectRoot, ".git", "HEAD"),
			`ref: refs/heads/${branch}\n`,
		);
		const scope: AnnotationScope = {
			branch,
			worktreePath: fixture.projectRoot,
		};
		const service = {
			store: new AnnotationStore({
				projectId: fixture.config.projectId as string,
				trickroomHome: home,
			}),
		};
		const session = await createTrickroomMcpTestClient({
			...(await fixture.readMcpContext()),
			trickroomHome: home,
		});
		cleanups.push(() => session.close());

		const call = async (name: string, args: Record<string, unknown> = {}) => {
			const result = await session.client.callTool({ name, arguments: args });
			return { isError: result.isError === true, payload: toolPayload(result) };
		};
		const systemId = (await resolveAnnotationSystemId(
			fixture.projectRoot,
			systemName,
		)) as string;
		expect(systemId).toEqual(expect.any(String));

		/** The manifest revision, as writes pass it. */
		const revision = async () =>
			(await call(TOOL.componentRead, { systemName })).payload
				.revision as string;

		const createComponent = async (
			slug: string,
			draft: Record<string, unknown> = {
				root: buttonRoot(),
				variants: toneVariants,
			},
		) => {
			const created = await call(TOOL.componentDraftCreate, {
				systemName,
				expectedRevision: await revision(),
				slug,
				name: slug,
				draft,
			});
			expect(created.isError).toBe(false);
			return created.payload.componentId as string;
		};

		/** The designer's remark on a component node. */
		const annotate = async (
			componentId: string,
			nodePath: string,
			body = "Make this bolder",
			variants?: Record<string, string>,
			annotationScope: AnnotationScope = scope,
		) => {
			const anchor = await readComponentAnchor(
				fixture.projectRoot,
				systemId,
				componentId,
			);
			if (!anchor) throw new Error("component has no template");
			const target: AnnotationTarget = {
				kind: "componentNode",
				systemId,
				componentId,
				nodePath,
				...(variants ? { variants } : {}),
			};
			return (
				await createAnnotation(service, {
					target,
					body,
					by: { role: "human" },
					scope: annotationScope,
					component: { template: anchor.template, revision: anchor.revision },
				})
			).annotation;
		};
		const stored = (annotationId: string) =>
			getAnnotation(service, { annotationId });
		const update = (
			componentId: string,
			expectedRevision: string,
			extra: Record<string, unknown> = {},
		) =>
			call(TOOL.componentDraftUpdate, {
				systemName,
				componentId,
				expectedRevision,
				root: buttonRoot("Updated"),
				...extra,
			});
		const changeEntries = async (annotationId: string) =>
			(await stored(annotationId)).entries.filter(
				(entry) => entry.kind === "change",
			);

		return {
			home,
			fixture,
			service,
			scope,
			call,
			systemId,
			revision,
			createComponent,
			annotate,
			stored,
			update,
			changeEntries,
		};
	};

	describe("component_read surfacing", () => {
		it("shows a new annotation in full, acknowledges it, then only its id", async () => {
			const { call, createComponent, annotate, stored, systemId } =
				await open();
			const componentId = await createComponent("button");
			const plain = await annotate(componentId, "label", "Label is too small");
			const pinned = await annotate(
				componentId,
				"icon",
				"Icon is off in brand",
				{ tone: "brand" },
			);

			const first = (
				await call(TOOL.componentRead, { systemName, componentId })
			).payload;
			expect(first.annotations.new).toHaveLength(2);
			const byId = Object.fromEntries(
				first.annotations.new.map((entry: { annotationId: string }) => [
					entry.annotationId,
					entry,
				]),
			);
			expect(byId[plain.id]).toMatchObject({
				status: "acknowledged",
				target: {
					kind: "componentNode",
					systemId,
					componentId,
					nodePath: "label",
				},
				acknowledged: { by: "this session", active: true },
				entries: [{ kind: "remark", by: "human", text: "Label is too small" }],
			});
			expect(byId[plain.id].target).not.toHaveProperty("variants");
			expect(byId[pinned.id].target).toEqual({
				kind: "componentNode",
				systemId,
				componentId,
				nodePath: "icon",
				variants: { tone: "brand" },
			});
			expect(first.annotations.openIds.sort()).toEqual(
				[plain.id, pinned.id].sort(),
			);
			expect(first.annotations.counts).toEqual({
				agentWork: 2,
				humanWork: 0,
				byStatus: { acknowledged: 2 },
			});
			expect(first.annotations).not.toHaveProperty("more");
			expect(first.annotations.next).toContain(
				`${TOOL.componentDraftUpdate}({ systemName: "${systemId}", componentId: "${componentId}", expectedRevision, root, addresses: [`,
			);
			expect(first.annotations.next).toContain("target.nodePath");
			expect(first.annotations.next).toContain("target.variants");

			// Acknowledged on disk, by this session.
			const onDisk = await stored(plain.id);
			expect(onDisk.status).toBe("acknowledged");
			expect(onDisk.acknowledged?.sessionId).toEqual(expect.any(String));

			// The second read shows ids only.
			const second = (
				await call(TOOL.componentRead, { systemName, componentId })
			).payload;
			expect(second.annotations.new).toEqual([]);
			expect(second.annotations.openIds.sort()).toEqual(
				[plain.id, pinned.id].sort(),
			);
			expect(second.annotations.next).toContain("already shown to you");
			expect(second.annotations.next).toContain(
				`${TOOL.annotationList}({ systemId: "${systemId}", componentId: "${componentId}" })`,
			);
		});

		it("adds no block when the component has no annotations", async () => {
			const { call, createComponent } = await open();
			const componentId = await createComponent("button");
			const { payload } = await call(TOOL.componentRead, {
				systemName,
				componentId,
			});
			expect(payload).not.toHaveProperty("annotations");
		});

		it("adds no block when no annotation is agent work", async () => {
			const { call, createComponent, annotate, service } = await open();
			const componentId = await createComponent("button");
			const annotation = await annotate(componentId, "label");
			await replyToAnnotation(service, {
				annotationId: annotation.id,
				by: { role: "agent", sessionId: "someone" },
				question: "Bolder how?",
			});
			const { payload } = await call(TOOL.componentRead, {
				systemName,
				componentId,
			});
			expect(payload).not.toHaveProperty("annotations");
		});

		it("leaves annotations of another branch out", async () => {
			const { call, createComponent, annotate, fixture } = await open();
			const componentId = await createComponent("button");
			await annotate(componentId, "label", "Elsewhere", undefined, {
				branch: "main",
				worktreePath: fixture.projectRoot,
			});
			const { payload } = await call(TOOL.componentRead, {
				systemName,
				componentId,
			});
			expect(payload).not.toHaveProperty("annotations");
		});

		it("surfaces for the draft source too", async () => {
			const { call, createComponent, annotate } = await open();
			const componentId = await createComponent("button");
			const annotation = await annotate(componentId, "label");
			const { payload } = await call(TOOL.componentRead, {
				systemName,
				componentId,
				source: "draft",
			});
			expect(payload.annotations.new[0].annotationId).toBe(annotation.id);
		});
	});

	describe("component_read index", () => {
		it("counts annotations on annotated components only", async () => {
			const { call, createComponent, annotate, service } = await open();
			const annotated = await createComponent("annotated");
			const asked = await createComponent("asked");
			await createComponent("plain");
			await annotate(annotated, "label");
			await annotate(annotated, "icon");
			const waiting = await annotate(asked, "label");
			await replyToAnnotation(service, {
				annotationId: waiting.id,
				by: { role: "agent", sessionId: "someone" },
				question: "Which weight?",
			});

			const { payload } = await call(TOOL.componentRead, { systemName });
			const rows = Object.fromEntries(
				payload.components.map(
					(row: { slug: string; annotations?: unknown }) => [row.slug, row],
				),
			);
			expect(rows.annotated.annotations).toEqual({
				agentWork: 2,
				humanWork: 0,
			});
			expect(rows.asked.annotations).toEqual({ agentWork: 0, humanWork: 1 });
			expect(rows.plain).not.toHaveProperty("annotations");
		});

		it("does not acknowledge anything", async () => {
			const { call, createComponent, annotate, stored } = await open();
			const componentId = await createComponent("button");
			const annotation = await annotate(componentId, "label");
			await call(TOOL.componentRead, { systemName });
			expect((await stored(annotation.id)).status).toBe("open");
		});
	});

	describe("component_draft_update addresses", () => {
		it("records a change with revert state and the changed paths", async () => {
			const { call, createComponent, annotate, stored, revision, update } =
				await open();
			const componentId = await createComponent("button");
			const annotation = await annotate(componentId, "label");
			await call(TOOL.componentRead, { systemName, componentId });
			const before = await revision();

			const { isError, payload } = await update(componentId, before, {
				addresses: [
					{ annotationId: annotation.id, reply: "Updated the label." },
				],
			});
			expect(isError).toBe(false);
			expect(payload.addressed).toEqual([
				{
					annotationId: annotation.id,
					status: "addressed",
					entryId: expect.any(String),
				},
			]);
			const after = await revision();
			expect(after).not.toBe(before);

			const record = await stored(annotation.id);
			expect(record.status).toBe("addressed");
			const change = record.entries.find((entry) => entry.kind === "change");
			if (change?.kind !== "change") throw new Error("expected a change entry");
			expect(change.id).toBe(payload.addressed[0].entryId);
			expect(change.body).toBe("Updated the label.");
			expect(change.change.revisionBefore).toBe(before);
			expect(change.change.revisionAfter).toBe(after);
			expect(change.change.layerIds).toEqual(["label"]);
			expect(change.change.operations).toEqual([
				{ operation: TOOL.componentDraftUpdate, summary: "Updated root" },
			]);
			expect(change.change.draftBefore).toMatchObject({
				root: buttonRoot("Label"),
				variants: toneVariants,
			});
			expect(change.change.draftAfter).toEqual({
				templateHash: expect.stringMatching(/^sha256:/),
				variantSchemaHash: expect.stringMatching(/^sha256:/),
			});
		});

		it("lists every changed path, including a removed node's parent", async () => {
			const { createComponent, annotate, revision, update, changeEntries } =
				await open();
			const componentId = await createComponent("button");
			const annotation = await annotate(componentId, "icon");
			const { isError } = await update(componentId, await revision(), {
				root: buttonRoot("Label", false),
				addresses: [
					{ annotationId: annotation.id, reply: "Dropped the icon." },
				],
			});
			expect(isError).toBe(false);
			const [change] = await changeEntries(annotation.id);
			if (change?.kind !== "change") throw new Error("expected a change entry");
			expect(change.change.layerIds).toEqual(["root"]);
		});

		it("carries the annotations block in the result", async () => {
			const { call, createComponent, annotate, revision, update } =
				await open();
			const componentId = await createComponent("button");
			const addressedOne = await annotate(componentId, "label");
			const other = await annotate(componentId, "icon", "Icon too");
			await call(TOOL.componentRead, { systemName, componentId });
			const { payload } = await update(componentId, await revision(), {
				addresses: [{ annotationId: addressedOne.id, reply: "Done." }],
			});
			// The other one is still agent work, already seen.
			expect(payload.annotations.new).toEqual([]);
			expect(payload.annotations.openIds).toEqual([other.id]);
			expect(payload.annotations.counts).toMatchObject({
				agentWork: 1,
				humanWork: 1,
				byStatus: { acknowledged: 1, addressed: 1 },
			});
		});

		it("answers a name-only update without a draft change", async () => {
			const { call, createComponent, annotate, revision, changeEntries } =
				await open();
			const componentId = await createComponent("button");
			const annotation = await annotate(componentId, "label");
			const { isError, payload } = await call(TOOL.componentDraftUpdate, {
				systemName,
				componentId,
				expectedRevision: await revision(),
				name: "Renamed",
				addresses: [{ annotationId: annotation.id, reply: "Renamed it." }],
			});
			expect(isError).toBe(false);
			expect(payload.addressed[0]).toMatchObject({
				annotationId: annotation.id,
				status: "addressed",
			});
			const [change] = await changeEntries(annotation.id);
			if (change?.kind !== "change") throw new Error("expected a change entry");
			expect(change.change.layerIds).toEqual([]);
			expect(change.change).not.toHaveProperty("draftBefore");
		});

		describe("refusals", () => {
			const expectRefused = async (
				ctx: Awaited<ReturnType<typeof open>>,
				componentId: string,
				addresses: Array<{ annotationId: string; reply: string }>,
				code: string,
				watched: string[],
			) => {
				const before = await ctx.revision();
				const { isError, payload } = await ctx.update(componentId, before, {
					addresses,
				});
				expect(isError).toBe(true);
				expect(payload.code).toBe(code);
				expect(await ctx.revision()).toBe(before);
				for (const id of watched) {
					expect(await ctx.changeEntries(id)).toEqual([]);
					expect((await ctx.stored(id)).status).not.toBe("addressed");
				}
				return payload;
			};

			it("refuses a duplicate address", async () => {
				const ctx = await open();
				const componentId = await ctx.createComponent("button");
				const annotation = await ctx.annotate(componentId, "label");
				await expectRefused(
					ctx,
					componentId,
					[
						{ annotationId: annotation.id, reply: "One." },
						{ annotationId: annotation.id, reply: "Two." },
					],
					"INVALID_OPERATION_PARAMETERS",
					[annotation.id],
				);
			});

			it("refuses an unknown annotation, even next to a valid one", async () => {
				const ctx = await open();
				const componentId = await ctx.createComponent("button");
				const annotation = await ctx.annotate(componentId, "label");
				const payload = await expectRefused(
					ctx,
					componentId,
					[
						{ annotationId: annotation.id, reply: "Done." },
						{ annotationId: "no-such-annotation", reply: "Done." },
					],
					"ANNOTATION_NOT_FOUND",
					[annotation.id],
				);
				expect(payload.addressProblems).toEqual([
					expect.objectContaining({
						annotationId: "no-such-annotation",
						code: "ANNOTATION_NOT_FOUND",
					}),
				]);
				expect(payload.message).toContain("Nothing was written");
			});

			it("refuses an annotation of another component", async () => {
				const ctx = await open();
				const componentId = await ctx.createComponent("button");
				const otherId = await ctx.createComponent("badge");
				const foreign = await ctx.annotate(otherId, "label");
				const payload = await expectRefused(
					ctx,
					componentId,
					[{ annotationId: foreign.id, reply: "Done." }],
					"WRONG_COMPONENT",
					[foreign.id],
				);
				expect(payload).toMatchObject({
					systemId: ctx.systemId,
					componentId,
				});
			});

			it("refuses an annotation of a design", async () => {
				const ctx = await open();
				const componentId = await ctx.createComponent("button");
				const read =
					await ctx.fixture.designFileService.readDesignFile(designId);
				const design = (
					await createAnnotation(ctx.service, {
						target: { kind: "design", designId },
						body: "Whole design",
						by: { role: "human" },
						scope: ctx.scope,
						design: { design: read.design, revision: read.revision },
					})
				).annotation;
				await expectRefused(
					ctx,
					componentId,
					[{ annotationId: design.id, reply: "Done." }],
					"WRONG_COMPONENT",
					[design.id],
				);
			});

			it("refuses a resolved or dismissed annotation", async () => {
				const ctx = await open();
				const componentId = await ctx.createComponent("button");
				const dismissed = await ctx.annotate(componentId, "label");
				const resolved = await ctx.annotate(componentId, "icon");
				await replyToAnnotation(ctx.service, {
					annotationId: dismissed.id,
					by: { role: "human" },
					dismiss: { reason: "never mind" },
				});
				await replyToAnnotation(ctx.service, {
					annotationId: resolved.id,
					by: { role: "human" },
					resolve: { summary: "fine" },
				});
				for (const annotation of [dismissed, resolved]) {
					await expectRefused(
						ctx,
						componentId,
						[{ annotationId: annotation.id, reply: "Done." }],
						"ANNOTATION_CLOSED",
						[],
					);
					expect(await ctx.changeEntries(annotation.id)).toEqual([]);
				}
				expect((await ctx.stored(dismissed.id)).status).toBe("dismissed");
				expect((await ctx.stored(resolved.id)).status).toBe("resolved");
			});

			it("refuses an annotation on another branch", async () => {
				const ctx = await open();
				const componentId = await ctx.createComponent("button");
				const annotation = await ctx.annotate(componentId, "label");
				await moveAnnotationToBranch(ctx.service, {
					annotationId: annotation.id,
					by: { role: "human" },
					scope: { branch: "main", worktreePath: "/main" },
				});
				const payload = await expectRefused(
					ctx,
					componentId,
					[{ annotationId: annotation.id, reply: "Done." }],
					"WRONG_BRANCH",
					[annotation.id],
				);
				expect(payload.message).toContain('branch: "all"');
				expect(payload.addressProblems[0]).toMatchObject({ branch: "main" });
			});
		});

		it("records nothing when the write itself is refused", async () => {
			const { call, createComponent, annotate, revision, update, ...ctx } =
				await open();
			const componentId = await createComponent("button");
			const annotation = await annotate(componentId, "label");
			await call(TOOL.componentRead, { systemName, componentId });
			const stale = await revision();
			// Someone else writes first.
			expect(
				(
					await call(TOOL.componentDraftUpdate, {
						systemName,
						componentId,
						expectedRevision: stale,
						name: "Moved on",
					})
				).isError,
			).toBe(false);
			const current = await revision();

			const { isError, payload } = await update(componentId, stale, {
				addresses: [{ annotationId: annotation.id, reply: "Done." }],
			});
			expect(isError).toBe(true);
			expect(payload).not.toHaveProperty("addressed");
			expect(await revision()).toBe(current);
			expect(await ctx.changeEntries(annotation.id)).toEqual([]);
			expect((await ctx.stored(annotation.id)).status).toBe("acknowledged");
		});

		it("keeps a designer remark sent after the agent saw it as open work", async () => {
			const { call, createComponent, annotate, revision, update, ...ctx } =
				await open();
			const componentId = await createComponent("button");
			const annotation = await annotate(componentId, "label");
			await call(TOOL.componentRead, { systemName, componentId });
			const before = await revision();
			// The designer adds to it after the agent read it, before its write.
			const added = await replyToAnnotation(ctx.service, {
				annotationId: annotation.id,
				by: { role: "human" },
				body: "Also make it red",
			});
			const remarkId = added.annotation.entries.at(-1)?.id;

			const { isError, payload } = await update(componentId, before, {
				addresses: [{ annotationId: annotation.id, reply: "Updated." }],
			});
			expect(isError).toBe(false);
			expect(payload.addressed).toEqual([
				expect.objectContaining({
					annotationId: annotation.id,
					status: "acknowledged",
					unseenRemarkIds: [remarkId],
				}),
			]);
			expect(await revision()).not.toBe(before);
			expect(payload.annotations.new).toHaveLength(1);
			expect(
				payload.annotations.new[0].entries.map(
					(entry: { kind: string; text?: string }) => entry.text ?? entry.kind,
				),
			).toEqual(["Make this bolder", "Also make it red", "Updated."]);
			expect(payload.annotations.openIds).toEqual([annotation.id]);

			const after = await ctx.stored(annotation.id);
			expect(after.status).toBe("acknowledged");
			expect(after.entries.map((entry) => entry.kind)).toEqual([
				"remark",
				"remark",
				"change",
			]);
			// Shown once.
			const next = (await call(TOOL.componentRead, { systemName, componentId }))
				.payload.annotations;
			expect(next.new).toEqual([]);
			expect(next.openIds).toEqual([annotation.id]);
		});
	});

	describe("component_publish addresses", () => {
		it("records the change without revert state", async () => {
			const {
				call,
				createComponent,
				annotate,
				revision,
				stored,
				changeEntries,
			} = await open();
			const componentId = await createComponent("button");
			const annotation = await annotate(componentId, "label");
			await call(TOOL.componentRead, { systemName, componentId });
			const before = await revision();

			const { isError, payload } = await call(TOOL.componentPublish, {
				systemName,
				componentId,
				expectedRevision: before,
				addresses: [{ annotationId: annotation.id, reply: "Shipped." }],
			});
			expect(isError).toBe(false);
			expect(payload.addressed).toEqual([
				{
					annotationId: annotation.id,
					status: "addressed",
					entryId: expect.any(String),
				},
			]);
			expect((await stored(annotation.id)).status).toBe("addressed");
			const [change] = await changeEntries(annotation.id);
			if (change?.kind !== "change") throw new Error("expected a change entry");
			expect(change.body).toBe("Shipped.");
			expect(change.change.revisionBefore).toBe(before);
			expect(change.change.revisionAfter).toBe(await revision());
			expect(change.change.summary).toMatch(/^Published version /);
			expect(change.change).not.toHaveProperty("draftBefore");
			expect(change.change).not.toHaveProperty("draftAfter");
			// Addressed: nothing waits on the agent, so no block.
			expect(payload).not.toHaveProperty("annotations");
		});

		it("refuses like the draft update does, writing nothing", async () => {
			const { call, createComponent, revision } = await open();
			const componentId = await createComponent("button");
			const before = await revision();
			const { isError, payload } = await call(TOOL.componentPublish, {
				systemName,
				componentId,
				expectedRevision: before,
				addresses: [{ annotationId: "no-such-annotation", reply: "Done." }],
			});
			expect(isError).toBe(true);
			expect(payload.code).toBe("ANNOTATION_NOT_FOUND");
			expect(await revision()).toBe(before);
			// Still unpublished.
			const read = await call(TOOL.componentRead, {
				view: "index",
				systemName,
			});
			expect(read.payload.components[0]).not.toHaveProperty("published");
		});
	});

	describe("annotation_list", () => {
		it("lists a component's annotations by system id and by system name", async () => {
			const { call, createComponent, annotate, systemId, revision } =
				await open();
			const componentId = await createComponent("button");
			const label = await annotate(componentId, "label", "Label");
			const icon = await annotate(componentId, "icon", "Icon", {
				tone: "brand",
			});
			const other = await createComponent("badge");
			await annotate(other, "label", "Not this component");

			for (const handle of [systemId, systemName]) {
				const { isError, payload } = await call(TOOL.annotationList, {
					systemId: handle,
					componentId,
				});
				expect(isError).toBe(false);
				expect(payload.component).toEqual({
					systemId,
					componentId,
					name: "button",
					revision: await revision(),
					anchoredTo: "draft",
				});
				expect(payload).not.toHaveProperty("designFileId");
				expect(payload.branch).toBe(branch);
				expect(payload.total).toBe(2);
				expect(
					payload.annotations
						.map((entry: { annotationId: string }) => entry.annotationId)
						.sort(),
				).toEqual([label.id, icon.id].sort());
				const pinned = payload.annotations.find(
					(entry: { annotationId: string }) => entry.annotationId === icon.id,
				);
				expect(pinned.target).toMatchObject({
					nodePath: "icon",
					variants: { tone: "brand" },
				});
				expect(payload.counts).toMatchObject({ agentWork: 2 });
				expect(payload.counts).not.toHaveProperty("detached");
			}
		});

		it("filters by nodePath", async () => {
			const { call, createComponent, annotate, systemId } = await open();
			const componentId = await createComponent("button");
			const label = await annotate(componentId, "label");
			await annotate(componentId, "icon");
			const { payload } = await call(TOOL.annotationList, {
				systemId,
				componentId,
				nodePath: "label",
			});
			expect(
				payload.annotations.map(
					(entry: { annotationId: string }) => entry.annotationId,
				),
			).toEqual([label.id]);
			expect(payload.total).toBe(1);
		});

		it("needs a component with the system", async () => {
			const { call, systemId } = await open();
			const { isError, payload } = await call(TOOL.annotationList, {
				systemId,
			});
			expect(isError).toBe(true);
			expect(payload.code).toBe("INVALID_OPERATION_PARAMETERS");
		});

		it("anchors to the draft after a publish, and to the published version without one", async () => {
			const { call, fixture, createComponent, annotate, systemId, revision } =
				await open();
			const componentId = await createComponent("button");
			const label = await annotate(componentId, "label");
			const icon = await annotate(componentId, "icon");
			expect(
				(
					await call(TOOL.componentPublish, {
						systemName,
						componentId,
						expectedRevision: await revision(),
					})
				).isError,
			).toBe(false);
			const listed = async () =>
				(await call(TOOL.annotationList, { systemId, componentId })).payload;
			// A publish keeps the draft: it is still what annotations anchor to.
			const withDraft = await listed();
			expect(withDraft.component.anchoredTo).toBe("draft");
			expect(withDraft.annotations).toHaveLength(2);

			await discardSystemComponentDraft(
				fixture.projectRoot,
				systemId,
				componentId,
				{ expectedRevision: await revision() },
			);
			const published = await listed();
			expect(published.component.anchoredTo).toBe("published");
			expect(
				published.annotations
					.map((entry: { annotationId: string }) => entry.annotationId)
					.sort(),
			).toEqual([label.id, icon.id].sort());
			for (const entry of published.annotations) {
				expect(entry).not.toHaveProperty("detached");
			}
		});

		it("marks annotations detached once their node leaves the draft, and names reanchor", async () => {
			const { call, createComponent, annotate, systemId, revision, update } =
				await open();
			const componentId = await createComponent("button");
			const label = await annotate(componentId, "label");
			const icon = await annotate(componentId, "icon");
			await call(TOOL.componentRead, { systemName, componentId });

			expect(
				(
					await update(componentId, await revision(), {
						root: buttonRoot("Label", false),
					})
				).isError,
			).toBe(false);

			const list = (await call(TOOL.annotationList, { systemId, componentId }))
				.payload;
			const byId = Object.fromEntries(
				list.annotations.map((entry: { annotationId: string }) => [
					entry.annotationId,
					entry,
				]),
			);
			expect(byId[icon.id].detached).toBe(true);
			expect(byId[label.id]).not.toHaveProperty("detached");
			expect(list.counts.detached).toBe(1);

			// The next component_read names the detached one with a reanchor call.
			const read = (await call(TOOL.componentRead, { systemName, componentId }))
				.payload;
			expect(read.annotations.counts.detached).toBe(1);
			expect(read.annotations.next).toContain("Detached");
			expect(read.annotations.next).toContain(icon.id);
			expect(read.annotations.next).not.toContain(label.id);
			expect(read.annotations.next).toContain(
				`${TOOL.annotationReply}({ annotationId: "${icon.id}", reanchor: { nodePath: "<template path>" } })`,
			);
		});

		it("reattaches when the node returns", async () => {
			const { call, createComponent, annotate, systemId, revision, update } =
				await open();
			const componentId = await createComponent("button");
			const icon = await annotate(componentId, "icon");
			await update(componentId, await revision(), {
				root: buttonRoot("Label", false),
			});
			expect(
				(await call(TOOL.annotationList, { systemId, componentId })).payload
					.annotations[0].detached,
			).toBe(true);
			await update(componentId, await revision());
			const { payload } = await call(TOOL.annotationList, {
				systemId,
				componentId,
			});
			expect(payload.annotations[0].annotationId).toBe(icon.id);
			expect(payload.annotations[0]).not.toHaveProperty("detached");
		});

		it("marks a pinned annotation detached when its variant value is gone", async () => {
			const { call, createComponent, annotate, systemId, revision } =
				await open();
			const componentId = await createComponent("button");
			const pinned = await annotate(componentId, "label", "Brand only", {
				tone: "brand",
			});
			expect(
				(
					await call(TOOL.componentDraftUpdate, {
						systemName,
						componentId,
						expectedRevision: await revision(),
						variants: {
							axes: {
								tone: {
									label: "Tone",
									defaultValue: "neutral",
									values: {
										neutral: { classesByPath: { root: "text-zinc-700" } },
									},
								},
							},
						},
					})
				).isError,
			).toBe(false);
			const { payload } = await call(TOOL.annotationList, {
				systemId,
				componentId,
			});
			expect(payload.annotations[0]).toMatchObject({
				annotationId: pinned.id,
				detached: true,
			});
		});
	});

	describe("annotation_reply reanchor", () => {
		it("moves a component annotation to another node, keeping its pin and status", async () => {
			const {
				call,
				createComponent,
				annotate,
				stored,
				systemId,
				revision,
				update,
			} = await open();
			const componentId = await createComponent("button");
			const annotation = await annotate(componentId, "icon", "Icon off", {
				tone: "brand",
			});
			await call(TOOL.componentRead, { systemName, componentId });
			await update(componentId, await revision(), {
				root: buttonRoot("Label", false),
			});
			const detachedList = (
				await call(TOOL.annotationList, { systemId, componentId })
			).payload;
			expect(detachedList.annotations[0].detached).toBe(true);
			const statusBefore = (await stored(annotation.id)).status;

			const { isError, payload } = await call(TOOL.annotationReply, {
				annotationId: annotation.id,
				reanchor: { nodePath: "label" },
				body: "Moved to the label.",
			});
			expect(isError).toBe(false);
			expect(payload.written).toBe(true);
			expect(payload.reanchored.target).toEqual({
				kind: "componentNode",
				systemId,
				componentId,
				nodePath: "label",
				variants: { tone: "brand" },
			});
			expect(payload.reanchored.snapshot).toMatchObject({
				name: "text",
				component: "trickroom/text",
			});
			expect(payload.annotation.target).toMatchObject({
				nodePath: "label",
				variants: { tone: "brand" },
			});
			expect(payload.annotation).not.toHaveProperty("detached");

			const after = await stored(annotation.id);
			expect(after.status).toBe(statusBefore);
			expect(after.target).toEqual({
				kind: "componentNode",
				systemId,
				componentId,
				nodePath: "label",
				variants: { tone: "brand" },
			});
			expect(after.entries.map((entry) => entry.kind)).toEqual([
				"remark",
				"reanchor",
				"reply",
			]);
			const reanchor = after.entries.find((entry) => entry.kind === "reanchor");
			if (reanchor?.kind !== "reanchor") throw new Error("no reanchor entry");
			expect(reanchor.from).toMatchObject({ nodePath: "icon" });
			expect(reanchor.to).toMatchObject({ nodePath: "label" });

			const list = (await call(TOOL.annotationList, { systemId, componentId }))
				.payload;
			expect(list.annotations[0]).not.toHaveProperty("detached");
			expect(list.counts).not.toHaveProperty("detached");
		});

		it("refuses a node the component does not have", async () => {
			const { call, createComponent, annotate, stored } = await open();
			const componentId = await createComponent("button");
			const annotation = await annotate(componentId, "label");
			const { isError, payload } = await call(TOOL.annotationReply, {
				annotationId: annotation.id,
				reanchor: { nodePath: "no-such-node" },
			});
			expect(isError).toBe(true);
			expect(payload.code).toBe("TARGET_NOT_FOUND");
			expect((await stored(annotation.id)).target).toMatchObject({
				nodePath: "label",
			});
		});

		it("refuses nodePath on a design annotation", async () => {
			const { call, fixture, service, scope, stored } = await open();
			const read = await fixture.designFileService.readDesignFile(designId);
			const annotation = (
				await createAnnotation(service, {
					target: {
						kind: "layer",
						designId,
						boardId: "board",
						elementId: "title",
					},
					body: "Title",
					by: { role: "human" },
					scope,
					design: { design: read.design, revision: read.revision },
				})
			).annotation;
			const { isError, payload } = await call(TOOL.annotationReply, {
				annotationId: annotation.id,
				reanchor: { nodePath: "label" },
			});
			expect(isError).toBe(true);
			expect(payload.code).toBe("INVALID_INPUT");
			expect((await stored(annotation.id)).target.kind).toBe("layer");
		});

		it("refuses elementId on a component annotation", async () => {
			const { call, createComponent, annotate, stored } = await open();
			const componentId = await createComponent("button");
			const annotation = await annotate(componentId, "label");
			const { isError, payload } = await call(TOOL.annotationReply, {
				annotationId: annotation.id,
				reanchor: { elementId: "title" },
			});
			expect(isError).toBe(true);
			expect(payload.code).toBe("INVALID_INPUT");
			expect((await stored(annotation.id)).target).toMatchObject({
				kind: "componentNode",
				nodePath: "label",
			});
		});

		it("refuses boardId on a component annotation", async () => {
			const { call, createComponent, annotate } = await open();
			const componentId = await createComponent("button");
			const annotation = await annotate(componentId, "label");
			const { isError, payload } = await call(TOOL.annotationReply, {
				annotationId: annotation.id,
				reanchor: { boardId: "board" },
			});
			expect(isError).toBe(true);
			expect(payload.code).toBe("INVALID_INPUT");
		});

		it("refuses when the component no longer exists", async () => {
			const { call, createComponent, annotate, revision } = await open();
			const componentId = await createComponent("button");
			const annotation = await annotate(componentId, "label");
			await call(TOOL.componentDelete, {
				systemName,
				componentId,
				expectedRevision: await revision(),
			});
			const { isError, payload } = await call(TOOL.annotationReply, {
				annotationId: annotation.id,
				reanchor: { nodePath: "root" },
			});
			expect(isError).toBe(true);
			expect(payload.code).toBe("COMPONENT_NOT_FOUND");
		});
	});

	describe("attribution", () => {
		it("writes every entry and transition made through MCP as this agent session", async () => {
			const { call, createComponent, annotate, stored, revision, update } =
				await open();
			const componentId = await createComponent("button");
			const addressedOne = await annotate(componentId, "label", "First");
			const asked = await annotate(componentId, "icon", "Second");
			const moved = await annotate(componentId, "root", "Third");
			const published = await annotate(componentId, "label", "Fourth");

			// Acknowledge (read), address (update), ask, reanchor, publish.
			await call(TOOL.componentRead, { systemName, componentId });
			const sessionId = (await stored(addressedOne.id)).acknowledged
				?.sessionId as string;
			expect(sessionId).toEqual(expect.any(String));

			expect(
				(
					await update(componentId, await revision(), {
						addresses: [{ annotationId: addressedOne.id, reply: "Done." }],
					})
				).isError,
			).toBe(false);
			expect(
				(
					await call(TOOL.annotationReply, {
						annotationId: asked.id,
						question: "Which icon?",
					})
				).isError,
			).toBe(false);
			expect(
				(
					await call(TOOL.annotationReply, {
						annotationId: moved.id,
						reanchor: { nodePath: "label" },
						body: "Closer to the label.",
					})
				).isError,
			).toBe(false);
			expect(
				(
					await call(TOOL.componentPublish, {
						systemName,
						componentId,
						expectedRevision: await revision(),
						addresses: [{ annotationId: published.id, reply: "Shipped." }],
					})
				).isError,
			).toBe(false);

			const agent = { role: "agent", sessionId };
			for (const [annotation, kinds] of [
				[addressedOne, ["change"]],
				[asked, ["question"]],
				[moved, ["reanchor", "reply"]],
				[published, ["change"]],
			] as const) {
				const record = await stored(annotation.id);
				const agentEntries = record.entries.filter(
					(entry) => entry.by.role === "agent",
				);
				expect(agentEntries.map((entry) => entry.kind).sort()).toEqual(
					[...kinds].sort(),
				);
				for (const entry of record.entries) {
					expect(entry.by).toEqual(
						entry.kind === "remark" ? { role: "human" } : agent,
					);
				}
				for (const transition of record.transitions) {
					expect(transition.by).toEqual(
						transition.from === null ? { role: "human" } : agent,
					);
				}
				expect(record.acknowledged?.sessionId).toBe(sessionId);
			}
			expect((await stored(asked.id)).status).toBe("needs_input");
			expect((await stored(addressedOne.id)).status).toBe("addressed");
		});
	});
});
