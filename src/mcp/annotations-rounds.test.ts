import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	closeRound,
	type SendDraft,
	sendAnnotations,
} from "../services/annotation-rounds";
import {
	createAnnotation,
	replyToAnnotation,
	transitionAnnotation,
} from "../services/annotation-service";
import { AnnotationStore } from "../services/annotation-store";
import type {
	AnnotationContainer,
	AnnotationScope,
} from "../services/annotations.types";
import {
	readComponentAnchor,
	resolveAnnotationSystemId,
} from "../services/component-annotations";
import type { Node, TrickroomDesign } from "../types";
import {
	createTrickroomMcpProjectFixture,
	createTrickroomMcpTestClient,
	toolPayload,
} from "./test-support";
import { TOOL } from "./tool-names";

const designId = "00000000-0000-4000-8000-0000000000b1";
const branch = "feature/rounds";

const text = (id: string, name: string): Node => ({
	id,
	props: {
		"data-trickroom-name": name,
		"data-trickroom-library": "trickroom",
		"data-trickroom-component": "text",
		"data-trickroom-role": "text",
	},
	children: name,
});

const design = {
	name: "Rounds Design",
	systemName: "Core",
	boards: [
		{
			id: "board",
			props: {
				"data-trickroom-name": "Board",
				"data-trickroom-library": "trickroom",
				"data-trickroom-component": "container",
			},
			children: [
				text("title", "Title"),
				text("price", "Price"),
				text("pay", "Pay"),
			],
		},
	],
} satisfies TrickroomDesign;

const container: AnnotationContainer = { kind: "design", designId };

describe("MCP annotation rounds", () => {
	const cleanups: Array<() => Promise<void>> = [];

	afterEach(async () => {
		for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
	});

	const open = async () => {
		const home = await mkdtemp(path.join(os.tmpdir(), "trickroom-rounds-mcp-"));
		cleanups.push(() => rm(home, { recursive: true, force: true }));
		const fixture = await createTrickroomMcpProjectFixture({
			designs: { [designId]: design },
		});
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
		const read = async () => {
			const current = await fixture.designFileService.readDesignFile(designId);
			return { design: current.design, revision: current.revision };
		};
		const draft = async (
			elementId: string,
			body: string,
		): Promise<SendDraft> => ({
			key: elementId,
			target: { kind: "layer", designId, boardId: "board", elementId },
			body,
			design: await read(),
		});
		/** The designer sends a round of remarks, one per layer. */
		const sendRound = async (remarks: Record<string, string>) => {
			const drafts = await Promise.all(
				Object.entries(remarks).map(([elementId, body]) =>
					draft(elementId, body),
				),
			);
			const result = await sendAnnotations(service, {
				container,
				scope,
				by: { role: "human" },
				drafts,
			});
			expect(result.failed).toEqual([]);
			return {
				roundId: result.round?.id as string,
				ids: Object.fromEntries(
					result.annotations.map(({ key, annotation }) => [key, annotation.id]),
				) as Record<string, string>,
			};
		};
		const close = (roundId: string) =>
			closeRound(service, {
				container,
				roundId,
				by: { role: "human" },
				scope,
			});
		const watch = (args: Record<string, unknown> = {}) =>
			call(TOOL.annotationWatch, {
				designFileId: designId,
				round: true,
				timeoutMs: 1_000,
				...args,
			});
		/** The agent's write that addresses one annotation. */
		const address = async (annotationId: string, elementId: string) => {
			const { revision } = await read();
			const result = await call(TOOL.designApply, {
				designFileId: designId,
				expectedRevision: revision,
				operations: [
					{
						operation: "updateElementProps",
						parameters: { elementId, className: "text-2xl" },
					},
				],
				addresses: [{ annotationId, reply: "Made it larger." }],
			});
			expect(result.isError).toBe(false);
			return result;
		};
		return {
			fixture,
			home,
			scope,
			service,
			call,
			sendRound,
			close,
			watch,
			address,
		};
	};

	it("returns idle at once when the designer has not sent a round", async () => {
		const { watch } = await open();
		const startedAt = Date.now();
		const { payload } = await watch({ timeoutMs: 20_000 });
		expect(Date.now() - startedAt).toBeLessThan(5_000);
		expect(payload).toMatchObject({ status: "idle", designFileId: designId });
		expect(payload.next).toContain("do not keep waiting");
	});

	it("runs the loop: work, verdict, timeout while open, closed, then idle", async () => {
		const { watch, sendRound, call, address, service, close } = await open();
		const { roundId, ids } = await sendRound({
			title: "Make the title larger",
			price: "Show the currency",
			pay: "Should this say Buy?",
		});

		const work = (await watch()).payload;
		expect(work.status).toBe("work");
		expect(work.round).toMatchObject({
			id: roundId,
			counts: { total: 3, closed: 0 },
		});
		expect(
			work.annotations
				.map((body: { annotationId: string }) => body.annotationId)
				.sort(),
		).toEqual([ids.title, ids.price, ids.pay].sort());
		expect(work.next).toContain("propose");
		expect(work.next).toContain(
			`${TOOL.annotationWatch}({ designFileId: "${designId}", round: true })`,
		);

		await address(ids.title as string, "title");
		const proposed = await call(TOOL.annotationReply, {
			annotationId: ids.price,
			propose: { summary: "The currency is already in the price text." },
		});
		expect(proposed.payload.annotation).toMatchObject({
			status: "proposed",
			entries: [
				{ kind: "remark" },
				{
					kind: "proposal",
					by: "this session",
					text: "The currency is already in the price text.",
				},
			],
		});
		await call(TOOL.annotationReply, {
			annotationId: ids.pay,
			question: "Buy or Pay now?",
		});

		// Nothing new for the agent while the designer reviews.
		const waiting = (await watch()).payload;
		expect(waiting).toMatchObject({
			status: "timeout",
			round: { id: roundId, counts: { total: 3, closed: 0, humanWork: 3 } },
		});
		expect(waiting.next).toContain("still open");
		expect(waiting.next).toContain("round: true");

		// The designer accepts both and answers the question.
		for (const annotationId of [ids.title, ids.price]) {
			await transitionAnnotation(service, {
				annotationId: annotationId as string,
				by: { role: "human" },
				to: "resolved",
			});
		}
		await replyToAnnotation(service, {
			annotationId: ids.pay as string,
			by: { role: "human" },
			body: "Buy",
		});
		// The reopened one is work, which comes first.
		const answered = (await watch()).payload;
		expect(answered.status).toBe("work");
		expect(answered.annotations).toHaveLength(1);
		expect(answered.annotations[0]).toMatchObject({
			annotationId: ids.pay,
			entries: expect.arrayContaining([
				expect.objectContaining({ kind: "remark", text: "Buy" }),
			]),
		});
		const verdict = (await watch()).payload;
		expect(verdict.status).toBe("verdict");
		expect(
			verdict.annotations
				.map((body: { annotationId: string }) => body.annotationId)
				.sort(),
		).toEqual([ids.title, ids.price].sort());
		expect(verdict.next).toContain("accepted 2 annotations");
		expect(verdict.round).toMatchObject({ counts: { closed: 2 } });

		await address(ids.pay as string, "pay");
		await close(roundId);
		const closed = (await watch()).payload;
		expect(closed).toMatchObject({
			status: "closed",
			round: {
				id: roundId,
				closedAt: expect.any(String),
				counts: { total: 3, closed: 2 },
			},
		});
		expect(
			closed.annotations.map(
				(body: { annotationId: string }) => body.annotationId,
			),
		).toEqual([ids.pay]);
		expect(closed.next).toContain("waits on the designer and needs nothing");
		expect(closed.next).toContain("End your turn");

		// Reported once; then there is nothing to wait on.
		expect((await watch()).payload.status).toBe("idle");
	}, 30_000);

	it("wakes on the designer's send while it waits", async () => {
		const { watch, sendRound } = await open();
		await sendRound({ title: "First" });
		expect((await watch()).payload.status).toBe("work");
		const waiting = watch({ timeoutMs: 15_000 });
		await new Promise((resolve) => setTimeout(resolve, 300));
		const { ids } = await sendRound({ price: "Second", pay: "Third" });
		const { payload } = await waiting;
		expect(payload.status).toBe("work");
		expect(
			payload.annotations
				.map((body: { annotationId: string }) => body.annotationId)
				.sort(),
		).toEqual([ids.price, ids.pay].sort());
	}, 30_000);

	it("reports a round closed between calls, once the session saw it in a result", async () => {
		const { sendRound, close, call, watch } = await open();
		const { roundId, ids } = await sendRound({ title: "Bigger" });
		// The work arrives through a design tool result, not the watch.
		const read = await call(TOOL.designRead, { designFileId: designId });
		expect(read.payload.annotations.new[0].annotationId).toBe(ids.title);
		await close(roundId);
		const { payload } = await watch();
		expect(payload).toMatchObject({ status: "closed", round: { id: roundId } });
		expect(payload.annotations).toHaveLength(1);
		expect(payload.next).toContain("still your work");
	});

	it("does not show an annotation before its round lists it", async () => {
		const { fixture, service, scope, call, watch } = await open();
		const current = await fixture.designFileService.readDesignFile(designId);
		await createAnnotation(service, {
			target: { kind: "layer", designId, boardId: "board", elementId: "title" },
			body: "Half a batch",
			by: { role: "human" },
			scope,
			design: { design: current.design, revision: current.revision },
			roundId: "round-being-written",
		});
		const read = await call(TOOL.designRead, { designFileId: designId });
		expect(read.payload).not.toHaveProperty("annotations");
		const list = await call(TOOL.annotationList, { designFileId: designId });
		expect(list.payload.annotations).toEqual([]);
		expect((await watch()).payload.status).toBe("idle");
		expect(
			(
				await call(TOOL.annotationWatch, {
					designFileId: designId,
					timeoutMs: 1_000,
				})
			).payload.status,
		).toBe("timeout");
	});

	it("shows the open round on design_list and project_list", async () => {
		const { sendRound, call } = await open();
		const { roundId } = await sendRound({ title: "Bigger", price: "Smaller" });
		const designs = await call(TOOL.designList);
		const listed = designs.payload.designFiles.find(
			(entry: { id: string }) => entry.id === designId,
		);
		expect(listed.annotations).toEqual({
			agentWork: 2,
			humanWork: 0,
			round: { id: roundId, open: true, sent: 2, closed: 0 },
		});
		const project = await call(TOOL.projectList);
		expect(project.payload.annotations).toMatchObject({
			rounds: [{ designFileId: designId, id: roundId, open: true, sent: 2 }],
		});
		expect(project.payload.annotations.next).toContain("round: true");
	});

	it("refuses propose with another action, blank, or on a closed annotation", async () => {
		const { sendRound, call, service } = await open();
		const { ids } = await sendRound({ title: "Bigger" });
		const both = await call(TOOL.annotationReply, {
			annotationId: ids.title,
			propose: { summary: "x" },
			question: "y",
		});
		expect(both.payload.code).toBe("INVALID_INPUT");
		const blank = await call(TOOL.annotationReply, {
			annotationId: ids.title,
			propose: { summary: " " },
		});
		expect(blank.payload.code).toBe("INVALID_INPUT");
		await transitionAnnotation(service, {
			annotationId: ids.title as string,
			by: { role: "human" },
			to: "dismissed",
			reason: "Not now",
		});
		const closed = await call(TOOL.annotationReply, {
			annotationId: ids.title,
			propose: { summary: "x" },
		});
		expect(closed.payload.code).toBe("ALREADY_CLOSED");
	});

	it("waits on a system component's round", async () => {
		const { fixture, call, service, scope } = await open();
		const systemName = "Core";
		const revision = async () =>
			(await call(TOOL.componentRead, { systemName })).payload
				.revision as string;
		const created = await call(TOOL.componentDraftCreate, {
			systemName,
			expectedRevision: await revision(),
			slug: "chip",
			name: "Chip",
			draft: {
				root: {
					path: "root",
					library: "trickroom",
					component: "container",
					children: [
						{
							path: "label",
							library: "trickroom",
							component: "text",
							text: "Chip",
						},
					],
				},
			},
		});
		expect(created.isError).toBe(false);
		const componentId = created.payload.componentId as string;
		const systemId = (await resolveAnnotationSystemId(
			fixture.projectRoot,
			systemName,
		)) as string;
		const componentContainer: AnnotationContainer = {
			kind: "component",
			systemId,
			componentId,
		};
		const watchComponent = () =>
			call(TOOL.annotationWatch, {
				systemId: systemName,
				componentId,
				round: true,
				timeoutMs: 1_000,
			});
		expect((await watchComponent()).payload.status).toBe("idle");
		const anchor = await readComponentAnchor(
			fixture.projectRoot,
			systemId,
			componentId,
		);
		const sent = await sendAnnotations(service, {
			container: componentContainer,
			scope,
			by: { role: "human" },
			drafts: [
				{
					key: "label",
					target: {
						kind: "componentNode",
						systemId,
						componentId,
						nodePath: "label",
					},
					body: "Bolder label",
					...(anchor
						? {
								component: {
									template: anchor.template,
									revision: anchor.revision,
								},
							}
						: {}),
				},
			],
		});
		const work = (await watchComponent()).payload;
		expect(work).toMatchObject({
			status: "work",
			component: { systemId, componentId },
			round: { id: sent.round?.id, counts: { total: 1 } },
		});
		expect(work.next).toContain(TOOL.componentDraftUpdate);
		await closeRound(service, {
			container: componentContainer,
			roundId: sent.round?.id as string,
			by: { role: "human" },
			scope,
		});
		expect((await watchComponent()).payload.status).toBe("closed");
		const missing = await call(TOOL.annotationWatch, {
			systemId: systemName,
			componentId: "no-such-component",
			round: true,
			timeoutMs: 1_000,
		});
		expect(missing.payload.code).toBe("COMPONENT_NOT_FOUND");
	});
});
