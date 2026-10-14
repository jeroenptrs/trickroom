import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	createAnnotation,
	getAnnotation,
	moveAnnotationToBranch,
	reanchorAnnotation,
} from "../services/annotation-service";
import { AnnotationStore } from "../services/annotation-store";
import type {
	AnnotationScope,
	AnnotationTarget,
} from "../services/annotations.types";
import {
	createTrickroomMcpProjectFixture,
	createTrickroomMcpTestClient,
	toolPayload,
	trickroomMcpTestDesignUuid,
} from "./test-support";
import { TOOL } from "./tool-names";

/**
 * The designer moves an annotation to another branch in the middle of a
 * tool call: between listing and acknowledging, between validating
 * `addresses` and the write, between finding an annotation and replying.
 * Hooks around the service functions put the move exactly there; the
 * assertions read the complete tool responses.
 */
const hooks = vi.hoisted(() => ({
	beforeAcknowledge: null as null | ((annotationId: string) => Promise<void>),
	afterValidateAddresses: null as null | (() => Promise<void>),
	beforeReply: null as null | (() => Promise<void>),
}));

vi.mock("../services/annotation-service", async (importOriginal) => {
	const original =
		await importOriginal<typeof import("../services/annotation-service")>();
	return {
		...original,
		acknowledgeAnnotation: async (
			...args: Parameters<typeof original.acknowledgeAnnotation>
		) => {
			await hooks.beforeAcknowledge?.(args[1].annotationId);
			return original.acknowledgeAnnotation(...args);
		},
		validateAddresses: async (
			...args: Parameters<typeof original.validateAddresses>
		) => {
			const problems = await original.validateAddresses(...args);
			await hooks.afterValidateAddresses?.();
			return problems;
		},
		replyToAnnotation: async (
			...args: Parameters<typeof original.replyToAnnotation>
		) => {
			await hooks.beforeReply?.();
			return original.replyToAnnotation(...args);
		},
	};
});

const designId = trickroomMcpTestDesignUuid;
const branch = "feature/annotations";
const main: AnnotationScope = { branch: "main", worktreePath: "/main" };
const layer: AnnotationTarget = {
	kind: "layer",
	designId,
	boardId: "board",
	elementId: "title",
};

describe("MCP annotations: moved to another branch during a call", () => {
	const cleanups: Array<() => Promise<void>> = [];

	afterEach(async () => {
		hooks.beforeAcknowledge = null;
		hooks.afterValidateAddresses = null;
		hooks.beforeReply = null;
		for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
	});

	const open = async () => {
		const home = await mkdtemp(path.join(os.tmpdir(), "trickroom-ann-race-"));
		cleanups.push(() => rm(home, { recursive: true, force: true }));
		const fixture = await createTrickroomMcpProjectFixture();
		cleanups.push(() => fixture.cleanup());
		await mkdir(path.join(fixture.projectRoot, ".git"), { recursive: true });
		await writeFile(
			path.join(fixture.projectRoot, ".git", "HEAD"),
			`ref: refs/heads/${branch}\n`,
		);
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
		const annotate = async (body: string) => {
			const read = await fixture.designFileService.readDesignFile(designId);
			return (
				await createAnnotation(service, {
					target: layer,
					body,
					by: { role: "human" },
					scope: { branch, worktreePath: fixture.projectRoot },
					design: { design: read.design, revision: read.revision },
				})
			).annotation;
		};
		/** The designer's "Move here" on the main checkout. */
		const moveToMain = (annotationId: string) =>
			moveAnnotationToBranch(service, {
				annotationId,
				by: { role: "human" },
				scope: main,
			});
		const moveOnFirstAcknowledge = (annotationId: string) => {
			hooks.beforeAcknowledge = async (id) => {
				if (id !== annotationId) return;
				hooks.beforeAcknowledge = null;
				await moveToMain(annotationId);
			};
		};
		/** The designer's re-anchor to the board, in the editor. */
		const reanchorToBoard = async (annotationId: string) => {
			const read = await fixture.designFileService.readDesignFile(designId);
			await reanchorAnnotation(service, {
				annotationId,
				by: { role: "human" },
				target: { kind: "board", designId, boardId: "board" },
				design: { design: read.design, revision: read.revision },
			});
		};
		const stored = (annotationId: string) =>
			getAnnotation(service, { annotationId });
		const revision = async () =>
			(await fixture.designFileService.readDesignFile(designId)).revision;
		return {
			call,
			annotate,
			moveToMain,
			moveOnFirstAcknowledge,
			reanchorToBoard,
			stored,
			revision,
		};
	};

	const retitle = (expectedRevision: string, annotationId: string) => ({
		designFileId: designId,
		expectedRevision,
		operations: [
			{
				operation: "updateElementProps",
				parameters: { elementId: "title", className: "text-2xl" },
			},
		],
		addresses: [{ annotationId, reply: "Larger now." }],
	});

	it("annotation_list: bodies, total, more and counts leave the moved one out", async () => {
		const { call, annotate, moveOnFirstAcknowledge, stored } = await open();
		const moved = await annotate("Moves away");
		const kept = await annotate("Stays");
		moveOnFirstAcknowledge(moved.id);

		const { payload } = await call(TOOL.annotationList, {
			designFileId: designId,
			limit: 1,
		});
		expect(payload.branch).toBe(branch);
		expect(payload.annotations).toEqual([]);
		expect(payload.total).toBe(1);
		expect(payload.more).toBe(1);
		expect(payload.counts).toMatchObject({ agentWork: 1 });

		const again = await call(TOOL.annotationList, { designFileId: designId });
		expect(
			again.payload.annotations.map(
				(entry: { annotationId: string }) => entry.annotationId,
			),
		).toEqual([kept.id]);
		expect(again.payload.total).toBe(1);
		expect((await stored(moved.id)).status).toBe("open");
	});

	it("annotation_list: one re-anchored away from the requested element is neither returned nor acknowledged", async () => {
		const { call, annotate, reanchorToBoard, stored } = await open();
		const annotation = await annotate("Moves to the board");
		hooks.beforeAcknowledge = async (id) => {
			if (id !== annotation.id) return;
			hooks.beforeAcknowledge = null;
			await reanchorToBoard(annotation.id);
		};
		const { payload } = await call(TOOL.annotationList, {
			designFileId: designId,
			elementId: "title",
			status: "open",
		});
		expect(payload.annotations).toEqual([]);
		expect(payload.total).toBe(0);
		const after = await stored(annotation.id);
		expect(after.target.kind).toBe("board");
		expect(after.status).toBe("open");
		expect(after).not.toHaveProperty("acknowledged");
	});

	it("design_read surfacing: new, openIds, counts and more come from the same fresh set", async () => {
		const { call, annotate, moveOnFirstAcknowledge, stored } = await open();
		const moved = await annotate("Moves away");
		const kept = await annotate("Stays");
		moveOnFirstAcknowledge(moved.id);

		const { annotations } = (
			await call(TOOL.designRead, { designFileId: designId })
		).payload;
		expect(
			annotations.new.map(
				(entry: { annotationId: string }) => entry.annotationId,
			),
		).toEqual([kept.id]);
		expect(annotations.openIds).toEqual([kept.id]);
		expect(annotations.counts).toEqual({
			agentWork: 1,
			humanWork: 0,
			byStatus: { acknowledged: 1 },
		});
		expect(annotations).not.toHaveProperty("more");
		expect(annotations.next).not.toContain(moved.id);
		const after = await stored(moved.id);
		expect(after.branch).toBe("main");
		expect(after.status).toBe("open");
	});

	it("design_read surfacing: a block whose only annotation moved away is left out", async () => {
		const { call, annotate, moveOnFirstAcknowledge } = await open();
		const moved = await annotate("Moves away");
		moveOnFirstAcknowledge(moved.id);
		const { payload } = await call(TOOL.designRead, {
			designFileId: designId,
		});
		expect(payload).not.toHaveProperty("annotations");
	});

	it("annotation_watch: keeps waiting instead of naming a moved annotation", async () => {
		const { call, annotate, moveOnFirstAcknowledge, revision, stored } =
			await open();
		const moved = await annotate("Moves away");
		moveOnFirstAcknowledge(moved.id);

		const { payload } = await call(TOOL.annotationWatch, {
			designFileId: designId,
			timeoutMs: 1500,
		});
		expect(payload.status).toBe("timeout");
		expect(payload.counts).toMatchObject({ agentWork: 0 });
		expect(JSON.stringify(payload)).not.toContain(moved.id);

		// Addressing it anyway is refused before the write.
		const before = await revision();
		const write = await call(TOOL.designApply, retitle(before, moved.id));
		expect(write.isError).toBe(true);
		expect(write.payload.code).toBe("WRONG_BRANCH");
		expect(write.payload.addressProblems).toEqual([
			expect.objectContaining({
				annotationId: moved.id,
				code: "WRONG_BRANCH",
				branch: "main",
			}),
		]);
		expect(write.payload.message).toContain('branch: "all"');
		expect(write.payload.message).toContain("Move here");
		expect(await revision()).toBe(before);
		expect((await stored(moved.id)).entries.map((entry) => entry.kind)).toEqual(
			["remark", "move"],
		);
	});

	it("annotation_watch: returns the annotations still on this branch", async () => {
		const { call, annotate, moveOnFirstAcknowledge } = await open();
		const moved = await annotate("Moves away");
		const kept = await annotate("Stays");
		moveOnFirstAcknowledge(moved.id);
		const { payload } = await call(TOOL.annotationWatch, {
			designFileId: designId,
			timeoutMs: 1500,
		});
		expect(payload.status).toBe("success");
		expect(
			payload.annotations.map(
				(entry: { annotationId: string }) => entry.annotationId,
			),
		).toEqual([kept.id]);
		expect(payload.counts).toMatchObject({ agentWork: 1 });
		expect(payload).not.toHaveProperty("more");
		expect(payload.next).toContain(kept.id);
		expect(payload.next).not.toContain(moved.id);
	});

	it("design_apply addresses: a move after validation is not recorded on the moved annotation", async () => {
		const { call, annotate, moveToMain, stored, revision } = await open();
		const annotation = await annotate("Make it larger");
		hooks.afterValidateAddresses = async () => {
			hooks.afterValidateAddresses = null;
			await moveToMain(annotation.id);
		};
		const before = await revision();
		const { isError, payload } = await call(
			TOOL.designApply,
			retitle(before, annotation.id),
		);
		// The design write stands; the annotation on main is untouched.
		expect(isError).toBe(false);
		expect(payload.newRevision).not.toBe(before);
		expect(payload.addressed).toEqual([
			expect.objectContaining({
				annotationId: annotation.id,
				status: "failed",
				code: "WRONG_BRANCH",
			}),
		]);
		const after = await stored(annotation.id);
		expect(after.branch).toBe("main");
		expect(after.status).toBe("open");
		expect(after.entries.map((entry) => entry.kind)).toEqual([
			"remark",
			"move",
		]);
	});

	it("annotation_reply: a move during the call refuses the reply", async () => {
		const { call, annotate, moveToMain, stored } = await open();
		const annotation = await annotate("Make it larger");
		hooks.beforeReply = async () => {
			hooks.beforeReply = null;
			await moveToMain(annotation.id);
		};
		const { isError, payload } = await call(TOOL.annotationReply, {
			annotationId: annotation.id,
			question: "How much larger?",
		});
		expect(isError).toBe(true);
		expect(payload).toMatchObject({
			code: "WRONG_BRANCH",
			branch: "main",
			currentBranch: branch,
		});
		const after = await stored(annotation.id);
		expect(after.status).toBe("open");
		expect(after.entries.map((entry) => entry.kind)).toEqual([
			"remark",
			"move",
		]);
	});
});
