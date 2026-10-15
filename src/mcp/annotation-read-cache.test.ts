import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAnnotation } from "../services/annotation-service";
import {
	AnnotationStore,
	annotationFileReads,
	resetAnnotationFileCache,
} from "../services/annotation-store";
import type {
	Annotation,
	AnnotationScope,
} from "../services/annotations.types";
import {
	createTrickroomMcpProjectFixture,
	createTrickroomMcpTestClient,
	type TrickroomMcpClientSession,
	type TrickroomMcpProjectFixture,
	toolPayload,
	trickroomMcpTestDesign,
	trickroomMcpTestDesignUuid,
} from "./test-support";
import { TOOL } from "./tool-names";

// Release review: a design with a long closed history made every MCP
// result that surfaces annotations read and parse every file again. This
// counts the files read (not milliseconds): after the first call, only
// files that changed are read.

const designId = trickroomMcpTestDesignUuid;
const branch = "main";
const CLOSED = 500;

describe("MCP surfacing over a long closed history", () => {
	const cleanups: Array<() => Promise<void>> = [];

	beforeEach(() => {
		resetAnnotationFileCache();
	});

	afterEach(async () => {
		for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
		resetAnnotationFileCache();
	});

	const open = async () => {
		const home = await mkdtemp(path.join(os.tmpdir(), "trickroom-ann-cache-"));
		cleanups.push(() => rm(home, { recursive: true, force: true }));
		const fixture: TrickroomMcpProjectFixture =
			await createTrickroomMcpProjectFixture({
				designs: { [designId]: trickroomMcpTestDesign },
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
		const projectId = fixture.config.projectId as string;
		const store = new AnnotationStore({ projectId, trickroomHome: home });
		const session: TrickroomMcpClientSession =
			await createTrickroomMcpTestClient({
				...(await fixture.readMcpContext()),
				trickroomHome: home,
			});
		cleanups.push(() => session.close());
		return { fixture, scope, projectId, store, session };
	};

	it("reads only the files that changed on every later call", async () => {
		const { fixture, scope, projectId, store, session } = await open();
		const read = await fixture.designFileService.readDesignFile(designId);
		const closed = (index: number): Annotation => ({
			version: 2,
			id: `closed-${String(index).padStart(4, "0")}`,
			projectId,
			target: { kind: "board", designId, boardId: "board" },
			branch,
			worktreePath: scope.worktreePath,
			snapshot: { ...scope },
			status: "resolved",
			createdAt: "2026-10-01T10:00:00.000Z",
			updatedAt: "2026-10-01T10:00:00.000Z",
			entries: [
				{
					id: `entry-${index}`,
					kind: "remark",
					at: "2026-10-01T10:00:00.000Z",
					by: { role: "human" },
					body: `Old remark ${index}`,
				},
			],
			transitions: [
				{
					from: null,
					to: "resolved",
					at: "2026-10-01T10:00:00.000Z",
					by: { role: "human" },
				},
			],
		});
		await Promise.all(
			Array.from({ length: CLOSED }, (_, index) => store.create(closed(index))),
		);
		const { annotation: live } = await createAnnotation(
			{ store },
			{
				target: { kind: "board", designId, boardId: "board" },
				body: "The one live remark",
				by: { role: "human" },
				scope,
				design: { design: read.design, revision: read.revision },
			},
		);

		const designRead = async () => {
			const before = { ...annotationFileReads };
			const payload = toolPayload(
				await session.client.callTool({
					name: TOOL.designRead,
					arguments: { designFileId: designId },
				}),
			) as { annotations?: { new: { annotationId: string }[] } };
			return {
				payload,
				parsed: annotationFileReads.parsed - before.parsed,
				cached: annotationFileReads.cached - before.cached,
			};
		};

		const first = await designRead();
		expect(
			first.payload.annotations?.new.map((body) => body.annotationId),
		).toEqual([live.id]);
		expect(first.parsed).toBeGreaterThanOrEqual(CLOSED + 1);

		// The first call acknowledged the live one (a write): only it is read.
		const second = await designRead();
		expect(second.parsed).toBeLessThanOrEqual(1);
		expect(second.cached).toBeGreaterThanOrEqual(CLOSED);

		const third = await designRead();
		expect(third.parsed).toBe(0);

		// A designer's reply on the live one is read on the next call.
		await store.update(
			{ kind: "design", designId },
			live.id,
			({ annotation }) => ({
				annotation: {
					...annotation,
					entries: [
						...annotation.entries,
						{
							id: "late-remark",
							kind: "remark",
							at: "2026-10-14T12:00:00.000Z",
							by: { role: "human" },
							body: "One more thing",
						},
					],
				},
				result: null,
			}),
		);
		const fourth = await designRead();
		expect(fourth.parsed).toBe(1);
		expect(
			fourth.payload.annotations?.new.map((body) => body.annotationId),
		).toEqual([live.id]);
	}, 30_000);
});
