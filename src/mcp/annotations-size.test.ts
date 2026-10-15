import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createAnnotation } from "../services/annotation-service";
import { AnnotationStore } from "../services/annotation-store";
import type {
	AnnotationScope,
	AnnotationTarget,
} from "../services/annotations.types";
import type { Node, TrickroomDesign } from "../types";
import { MAX_CHANGE_LAYER_IDS } from "./annotation-session";
import {
	createTrickroomMcpProjectFixture,
	createTrickroomMcpTestClient,
	toolPayload,
} from "./test-support";
import { TOOL } from "./tool-names";

const designId = "00000000-0000-4000-8000-0000000000a1";
const branch = "feature/size";
const LAYERS = 300;

/** One board with a few hundred text layers, like a real screen. */
const bigDesign = {
	name: "Big Design",
	systemName: "Core",
	boards: [
		{
			id: "board",
			props: {
				"data-trickroom-name": "Board",
				"data-trickroom-library": "trickroom",
				"data-trickroom-component": "container",
			},
			children: Array.from(
				{ length: LAYERS },
				(_, index): Node => ({
					id: `layer-${index}`,
					props: {
						"data-trickroom-name": `Layer ${index}`,
						"data-trickroom-library": "trickroom",
						"data-trickroom-component": "text",
						"data-trickroom-role": "text",
						className: "text-sm text-slate-700 leading-6 tracking-tight",
					},
					children: `Row ${index}: a line of copy long enough to look like real text`,
				}),
			),
		},
	],
} satisfies TrickroomDesign;

/**
 * Bytes of a result, leaving out entry texts (the agent's and designer's
 * own words are bounded by what they wrote, not by the design).
 */
const structuralSize = (value: unknown): number =>
	JSON.stringify(value, (key, field) =>
		key === "text" && typeof field === "string" ? "" : field,
	).length;

/** A few KB: ids, target, snapshot, entry metadata. */
const SIZE_BOUND = 6_000;

describe("MCP annotation result size", () => {
	const cleanups: Array<() => Promise<void>> = [];

	afterEach(async () => {
		for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
	});

	const open = async () => {
		const home = await mkdtemp(path.join(os.tmpdir(), "trickroom-ann-size-"));
		cleanups.push(() => rm(home, { recursive: true, force: true }));
		const fixture = await createTrickroomMcpProjectFixture({
			designs: { [designId]: bigDesign },
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
		const store = new AnnotationStore({
			projectId: fixture.config.projectId as string,
			trickroomHome: home,
		});
		const session = await createTrickroomMcpTestClient({
			...(await fixture.readMcpContext()),
			trickroomHome: home,
		});
		cleanups.push(() => session.close());
		const call = async (name: string, args: Record<string, unknown>) => {
			const result = await session.client.callTool({ name, arguments: args });
			expect(result.isError).not.toBe(true);
			return toolPayload(result);
		};
		const annotate = async (target: AnnotationTarget, body: string) => {
			const read = await fixture.designFileService.readDesignFile(designId);
			return (
				await createAnnotation(
					{ store },
					{
						target,
						body,
						by: { role: "human" },
						scope,
						design: { design: read.design, revision: read.revision },
					},
				)
			).annotation;
		};
		/** A write that touches every layer and addresses the annotation. */
		const restyleEverything = async (annotationId: string, round: number) => {
			const { revision } =
				await fixture.designFileService.readDesignFile(designId);
			return call(TOOL.designApply, {
				designFileId: designId,
				expectedRevision: revision,
				operations: Array.from({ length: LAYERS }, (_, index) => ({
					operation: "updateElementProps",
					parameters: {
						elementId: `layer-${index}`,
						className: `text-sm text-slate-${round + 7}00 leading-6 tracking-tight`,
					},
				})),
				addresses: [{ annotationId, reply: `Restyled every row (${round}).` }],
			});
		};
		const annotationFile = (annotationId: string) =>
			path.join(
				home,
				"annotations",
				fixture.config.projectId as string,
				"designs",
				designId,
				`${annotationId}.json`,
			);
		return { call, annotate, restyleEverything, annotationFile };
	};

	it("keeps a re-anchor result and the file it writes small", async () => {
		const { call, annotate, restyleEverything, annotationFile } = await open();
		const annotation = await annotate(
			{ kind: "board", designId, boardId: "board" },
			"Make every row darker",
		);
		for (const round of [0, 1, 2]) {
			await restyleEverything(annotation.id, round);
		}
		const fileBefore = (await readFile(annotationFile(annotation.id), "utf8"))
			.length;

		for (const reanchor of [{ elementId: "layer-12" }, { boardId: "board" }]) {
			const payload = await call(TOOL.annotationReply, {
				annotationId: annotation.id,
				reanchor,
			});
			expect(payload.written).toBe(true);
			const changes = payload.annotation.entries.filter(
				(entry: { kind: string }) => entry.kind === "change",
			);
			expect(changes).toHaveLength(3);
			expect(changes[1].change.layerIds).toHaveLength(MAX_CHANGE_LAYER_IDS);
			expect(changes[1].change.layerCount).toBe(LAYERS);
			expect(structuralSize(payload)).toBeLessThan(SIZE_BOUND);
		}
		// The re-anchor adds a small entry each time and rewrites nothing
		// the design carries.
		const fileAfter = (await readFile(annotationFile(annotation.id), "utf8"))
			.length;
		expect(fileAfter - fileBefore).toBeLessThan(2_000);
	});

	it("keeps replies, questions and listings small after large writes", async () => {
		const { call, annotate, restyleEverything } = await open();
		const annotation = await annotate(
			{ kind: "board", designId, boardId: "board" },
			"Make every row darker",
		);
		for (const round of [0, 1, 2]) {
			await restyleEverything(annotation.id, round);
		}

		const reply = await call(TOOL.annotationReply, {
			annotationId: annotation.id,
			body: "All rows use the darker slate now.",
		});
		expect(reply.annotation.entries).toHaveLength(5);
		expect(structuralSize(reply)).toBeLessThan(SIZE_BOUND);

		const question = await call(TOOL.annotationReply, {
			annotationId: annotation.id,
			question: "Should the header row follow?",
		});
		expect(question.annotation.status).toBe("needs_input");
		expect(structuralSize(question)).toBeLessThan(SIZE_BOUND);

		const list = await call(TOOL.annotationList, {
			designFileId: designId,
			status: "all",
		});
		expect(list.annotations).toHaveLength(1);
		expect(structuralSize(list)).toBeLessThan(SIZE_BOUND);
	});
});
