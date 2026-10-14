import {
	mkdir,
	mkdtemp,
	readFile,
	realpath,
	rename,
	rm,
	writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTrickroomApp } from "../server";
import {
	createAddressesRecorder,
	recordChange,
} from "../services/annotation-service";
import { AnnotationStore } from "../services/annotation-store";
import type { Annotation, AnnotationView } from "../services/annotations.types";
import { createDesignFileService } from "../services/design-file-service";
import type { Node, Props, TrickroomDesign } from "../types";

const PROJECT_ID = "proj_annotations_routes";
const DESIGN_ID = "design-1";

const layerProps = (name: string, className?: string): Props => ({
	"data-trickroom-name": name,
	"data-trickroom-library": "trickroom",
	"data-trickroom-component": "container",
	"data-trickroom-role": "branch",
	...(className ? { className } : {}),
});

const buildDesign = (
	options: { withLayer?: boolean; className?: string } = {},
): TrickroomDesign => {
	const { withLayer = true, className = "p-4" } = options;
	const children: Node[] = withLayer
		? [
				{
					id: "layer-1",
					props: {
						"data-trickroom-name": "Title",
						"data-trickroom-library": "trickroom",
						"data-trickroom-component": "text",
						"data-trickroom-role": "text",
						className,
					},
					children: "Hello",
				},
			]
		: [];
	return {
		name: "Annotated Design",
		boards: [
			{
				id: "board-1",
				props: layerProps("Main"),
				children,
			},
		],
	};
};

type ListBody = {
	scope: { branch: string; worktreePath: string };
	designRevision?: string;
	annotations: AnnotationView[];
	problems: unknown[];
};
type WriteBody = { annotation: AnnotationView; written: boolean };
type ErrorBody = {
	error: string;
	code: string;
	details?: Record<string, unknown>;
};

describe("annotation routes", () => {
	let projectRoot: string;
	let trickroomHome: string;
	let app: ReturnType<typeof createTrickroomApp>;
	let designService: ReturnType<typeof createDesignFileService>;
	let store: AnnotationStore;

	// The project root must sit outside any git checkout: the repository's
	// own worktree would give the annotations a real branch instead of "*".
	beforeEach(async () => {
		projectRoot = await mkdtemp(path.join(os.tmpdir(), "trickroom-ann-proj-"));
		trickroomHome = await mkdtemp(
			path.join(os.tmpdir(), "trickroom-ann-home-"),
		);
		await mkdir(path.join(projectRoot, ".trickroom", "designs"), {
			recursive: true,
		});
		await writeFile(
			path.join(projectRoot, ".trickroom", "config.json"),
			JSON.stringify({ name: "Annotation Project", projectId: PROJECT_ID }),
			"utf8",
		);
		designService = createDesignFileService(projectRoot, { trickroomHome });
		await designService.createDesignFile(DESIGN_ID, buildDesign());
		store = new AnnotationStore({ projectId: PROJECT_ID, trickroomHome });
		app = createTrickroomApp({
			trickroomHome,
			initialProjectRoot: projectRoot,
			registerInitialProject: false,
		});
	});

	afterEach(async () => {
		await rm(projectRoot, { force: true, recursive: true });
		await rm(trickroomHome, { force: true, recursive: true });
	});

	const base = "/api/trickroom/annotations";

	const request = (
		method: string,
		url: string,
		body?: unknown,
		headers: Record<string, string> = {},
	) =>
		app.request(url, {
			method,
			headers: { "content-type": "application/json", ...headers },
			...(body !== undefined ? { body: JSON.stringify(body) } : {}),
		});

	const json = async <T>(response: Response) => (await response.json()) as T;

	const layerTarget = {
		kind: "layer",
		designId: DESIGN_ID,
		boardId: "board-1",
		elementId: "layer-1",
	};

	const create = async (
		body = "Make this bigger",
		target: unknown = layerTarget,
	) => {
		const response = await request("POST", base, { target, body });
		expect(response.status).toBe(201);
		return (await json<WriteBody>(response)).annotation;
	};

	const annotationFile = (id: string, designId = DESIGN_ID) =>
		path.join(
			trickroomHome,
			"annotations",
			PROJECT_ID,
			"designs",
			designId,
			`${id}.json`,
		);

	const readAnnotationFile = async (id: string) =>
		JSON.parse(await readFile(annotationFile(id), "utf8")) as Annotation;

	const editAnnotationFile = async (
		id: string,
		edit: (annotation: Annotation) => void,
	) => {
		const annotation = await readAnnotationFile(id);
		edit(annotation);
		await writeFile(annotationFile(id), JSON.stringify(annotation), "utf8");
	};

	/** Puts an annotation in `addressed` the way an agent's write would leave it. */
	const markAddressed = (id: string) =>
		editAnnotationFile(id, (annotation) => {
			const at = new Date().toISOString();
			annotation.transitions.push({
				from: annotation.status,
				to: "addressed",
				at,
				by: { role: "agent", sessionId: "s1" },
			});
			annotation.status = "addressed";
		});

	const get = async (id: string, query = "") =>
		json<{ annotation: AnnotationView }>(
			await request("GET", `${base}/${id}${query}`),
		);

	const list = async (query: string) => {
		const response = await request("GET", `${base}?${query}`);
		expect(response.status).toBe(200);
		return json<ListBody>(response);
	};

	const mutateDesign = async (mutate: (design: TrickroomDesign) => void) => {
		const read = await designService.readDesignFile(DESIGN_ID);
		const outcome = await designService.updateDesignFile(DESIGN_ID, {
			expectedRevision: read.revision,
			mutate: async ({ design }) => {
				const next = structuredClone(design);
				mutate(next);
				return { design: next };
			},
		});
		expect(outcome.status).toBe("written");
	};

	const layerClassName = async () => {
		const { design } = await designService.readDesignFile(DESIGN_ID);
		const layer = (design.boards[0]?.children as Node[]).find(
			(node) => node.id === "layer-1",
		);
		return layer?.props.className;
	};

	describe("create", () => {
		it("creates an open annotation on a layer with a snapshot", async () => {
			const response = await request("POST", base, {
				target: layerTarget,
				body: "Make this bigger",
			});

			expect(response.status).toBe(201);
			const { annotation, written } = await json<WriteBody>(response);
			expect(written).toBe(true);
			expect(annotation.status).toBe("open");
			expect(annotation.target).toEqual(layerTarget);
			expect(annotation.branch).toBe("*");
			expect(annotation.entries).toHaveLength(1);
			expect(annotation.entries[0]).toMatchObject({
				kind: "remark",
				body: "Make this bigger",
				by: { role: "human" },
			});
			expect(annotation.snapshot).toMatchObject({
				layerName: "Title",
				ancestorNames: ["Main"],
				branch: "*",
				designRevision: (await designService.readDesignFile(DESIGN_ID))
					.revision,
			});

			const stored = await readAnnotationFile(annotation.id);
			expect(stored.id).toBe(annotation.id);
			expect(stored.projectId).toBe(PROJECT_ID);
			expect(stored.status).toBe("open");
		});

		it("never records anything but the human as the actor", async () => {
			const forged = { role: "agent", sessionId: "x" };
			const headers = { "x-trickroom-actor": "agent:x" };

			const created = await request(
				"POST",
				base,
				{ target: layerTarget, body: "Forged?", by: forged, actor: forged },
				headers,
			);
			expect(created.status).toBe(201);
			const { annotation } = await json<WriteBody>(created);
			expect(annotation.entries[0]).toMatchObject({
				kind: "remark",
				by: { role: "human" },
			});
			expect(annotation.transitions[0]?.by).toEqual({ role: "human" });

			const replied = await request(
				"POST",
				`${base}/${annotation.id}/entries`,
				{ body: "Reply", by: forged },
				headers,
			);
			expect(replied.status).toBe(200);
			const reply = (await json<WriteBody>(replied)).annotation;
			const lastEntry = reply.entries.at(-1);
			expect(lastEntry).toMatchObject({ kind: "remark", body: "Reply" });
			expect(lastEntry?.by).toEqual({ role: "human" });

			const resolved = await request(
				"POST",
				`${base}/${annotation.id}/transition`,
				{ to: "resolved", summary: "Done", by: forged },
				headers,
			);
			expect(resolved.status).toBe(200);
			const final = (await json<WriteBody>(resolved)).annotation;
			expect(final.status).toBe("resolved");
			expect(final.transitions.at(-1)?.by).toEqual({ role: "human" });
			expect(final.entries.at(-1)?.by).toEqual({ role: "human" });
			expect(final.resolvedBy).toEqual({ role: "human" });

			const stored = await readAnnotationFile(annotation.id);
			const actors = [
				...stored.entries.map((entry) => entry.by),
				...stored.transitions.map((transition) => transition.by),
			];
			expect(actors.every((actor) => actor.role === "human")).toBe(true);
		});

		it("returns 404 TARGET_NOT_FOUND for a missing layer", async () => {
			const response = await request("POST", base, {
				target: { ...layerTarget, elementId: "nope" },
				body: "Hello",
			});

			expect(response.status).toBe(404);
			expect((await json<ErrorBody>(response)).code).toBe("TARGET_NOT_FOUND");
		});

		it("returns 400 for an invalid target or body", async () => {
			const invalidTarget = await request("POST", base, {
				target: { kind: "layer", designId: DESIGN_ID },
				body: "Hello",
			});
			expect(invalidTarget.status).toBe(400);

			const missingBody = await request("POST", base, { target: layerTarget });
			expect(missingBody.status).toBe(400);

			const notJson = await app.request(base, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: "nope",
			});
			expect(notJson.status).toBe(400);
		});

		it("creates board and design annotations", async () => {
			const board = await create("Board remark", {
				kind: "board",
				designId: DESIGN_ID,
				boardId: "board-1",
			});
			expect(board.snapshot.layerName).toBe("Main");

			const design = await create("Design remark", {
				kind: "design",
				designId: DESIGN_ID,
			});
			expect(design.snapshot.layerName).toBe("Annotated Design");
		});
	});

	describe("list and read", () => {
		it("requires a design or component to list", async () => {
			const response = await request("GET", base);

			expect(response.status).toBe(400);
			expect((await json<ErrorBody>(response)).code).toBe("INVALID_REQUEST");
		});

		it("lists the annotations with the scope and design revision", async () => {
			const first = await create("One");

			const body = await list(`designId=${DESIGN_ID}`);

			expect(body.scope.branch).toBe("*");
			expect(body.designRevision).toBe(
				(await designService.readDesignFile(DESIGN_ID)).revision,
			);
			expect(body.annotations.map((annotation) => annotation.id)).toEqual([
				first.id,
			]);
			expect(body.annotations[0]?.revision).toMatch(/\S/u);
			expect(body.annotations[0]?.detached).toBe(false);
			expect(body.problems).toEqual([]);
		});

		it("counts agent and designer work per design", async () => {
			const empty = await json<{ designs: Record<string, unknown> }>(
				await request("GET", `${base}/counts`),
			);
			expect(empty.designs).toEqual({});

			await create("One");
			const addressed = await create("Two");
			await markAddressed(addressed.id);
			const closed = await create("Three");
			await request("POST", `${base}/${closed.id}/transition`, {
				to: "resolved",
			});

			const response = await request("GET", `${base}/counts`);
			expect(response.status).toBe(200);
			const body = await json<{
				scope: { branch: string };
				designs: Record<string, { agentWork: number; humanWork: number }>;
			}>(response);
			expect(body.scope.branch).toBe("*");
			expect(body.designs).toEqual({
				[DESIGN_ID]: { agentWork: 1, humanWork: 1 },
			});
		});

		it("filters by status, board and element", async () => {
			const onLayer = await create("On layer");
			const onBoard = await create("On board", {
				kind: "board",
				designId: DESIGN_ID,
				boardId: "board-1",
			});
			await request("POST", `${base}/${onBoard.id}/transition`, {
				to: "resolved",
			});

			const open = await list(`designId=${DESIGN_ID}&status=open`);
			expect(open.annotations.map((annotation) => annotation.id)).toEqual([
				onLayer.id,
			]);

			const resolved = await list(`designId=${DESIGN_ID}&status=resolved`);
			expect(resolved.annotations.map((annotation) => annotation.id)).toEqual([
				onBoard.id,
			]);

			const both = await list(`designId=${DESIGN_ID}&status=open,resolved`);
			expect(both.annotations).toHaveLength(2);

			const byBoard = await list(`designId=${DESIGN_ID}&boardId=board-1`);
			expect(byBoard.annotations).toHaveLength(2);
			const otherBoard = await list(`designId=${DESIGN_ID}&boardId=board-2`);
			expect(otherBoard.annotations).toEqual([]);

			const byElement = await list(`designId=${DESIGN_ID}&elementId=layer-1`);
			expect(byElement.annotations.map((annotation) => annotation.id)).toEqual([
				onLayer.id,
			]);
			const otherElement = await list(`designId=${DESIGN_ID}&elementId=nope`);
			expect(otherElement.annotations).toEqual([]);

			const badStatus = await request(
				"GET",
				`${base}?designId=${DESIGN_ID}&status=bogus`,
			);
			expect(badStatus.status).toBe(400);
		});

		it("hides other branches unless branch=all", async () => {
			const original = await create("Here");
			const other: Annotation = {
				...(await readAnnotationFile(original.id)),
				id: "other-branch-annotation",
				branch: "other",
				snapshot: { ...original.snapshot, branch: "other" },
			};
			await writeFile(annotationFile(other.id), JSON.stringify(other), "utf8");

			const current = await list(`designId=${DESIGN_ID}`);
			expect(current.annotations.map((annotation) => annotation.id)).toEqual([
				original.id,
			]);

			const all = await list(`designId=${DESIGN_ID}&branch=all`);
			expect(all.annotations.map((annotation) => annotation.id).sort()).toEqual(
				[original.id, other.id].sort(),
			);

			const named = await list(`designId=${DESIGN_ID}&branch=other`);
			expect(named.annotations.map((annotation) => annotation.id)).toEqual([
				other.id,
			]);
		});

		it("reads one annotation with and without a designId hint", async () => {
			const created = await create("Find me");

			const withoutHint = await get(created.id);
			expect(withoutHint.annotation.id).toBe(created.id);
			expect(withoutHint.annotation.detached).toBe(false);

			const withHint = await get(created.id, `?designId=${DESIGN_ID}`);
			expect(withHint.annotation.id).toBe(created.id);
			expect(withHint.annotation.revision).toBe(
				withoutHint.annotation.revision,
			);
		});

		it("returns 404 for an unknown annotation", async () => {
			const response = await request("GET", `${base}/does-not-exist`);

			expect(response.status).toBe(404);
			expect((await json<ErrorBody>(response)).code).toBe(
				"ANNOTATION_NOT_FOUND",
			);

			const hinted = await request(
				"GET",
				`${base}/does-not-exist?designId=${DESIGN_ID}`,
			);
			expect(hinted.status).toBe(404);
		});

		it("derives detached when the layer leaves the design and returns", async () => {
			const created = await create("Anchored");
			expect(
				(await list(`designId=${DESIGN_ID}`)).annotations[0]?.detached,
			).toBe(false);

			await mutateDesign((design) => {
				design.boards[0].children = [];
			});
			expect(
				(await list(`designId=${DESIGN_ID}`)).annotations[0]?.detached,
			).toBe(true);
			expect((await get(created.id)).annotation.detached).toBe(true);

			await mutateDesign((design) => {
				design.boards[0].children = buildDesign().boards[0]?.children as Node[];
			});
			expect(
				(await list(`designId=${DESIGN_ID}`)).annotations[0]?.detached,
			).toBe(false);
			expect((await get(created.id)).annotation.detached).toBe(false);
		});
	});

	describe("entries", () => {
		it("reopens an addressed annotation when the human replies", async () => {
			const created = await create("Fix it");
			const results = await recordChange(
				{ store },
				{
					designId: DESIGN_ID,
					addresses: [{ annotationId: created.id, reply: "Fixed" }],
					change: {
						revisionBefore: "a",
						revisionAfter: "b",
						boards: ["board-1"],
						layerIds: ["layer-1"],
						operations: [{ operation: "updateElementProps", summary: "x" }],
						summary: "Changed",
					},
					by: { role: "agent", sessionId: "s1" },
				},
			);
			expect(results[0]?.status).toBe("recorded");
			expect((await get(created.id)).annotation.status).toBe("addressed");

			const response = await request("POST", `${base}/${created.id}/entries`, {
				body: "Not quite",
			});

			expect(response.status).toBe(200);
			const { annotation } = await json<WriteBody>(response);
			expect(annotation.status).toBe("open");
			expect(annotation.entries.at(-1)).toMatchObject({
				kind: "remark",
				body: "Not quite",
				by: { role: "human" },
			});
			expect(annotation.transitions.at(-1)).toMatchObject({
				from: "addressed",
				to: "open",
				by: { role: "human" },
			});
		});

		it("reopens an addressed annotation edited on disk", async () => {
			const created = await create("Fix it");
			await markAddressed(created.id);

			const response = await request("POST", `${base}/${created.id}/entries`, {
				body: "Again",
			});

			expect(response.status).toBe(200);
			expect((await json<WriteBody>(response)).annotation.status).toBe("open");
		});

		it("checks expectedRevision", async () => {
			const created = await create("Fix it");

			const stale = await request("POST", `${base}/${created.id}/entries`, {
				body: "Stale",
				expectedRevision: "not-the-revision",
			});
			expect(stale.status).toBe(409);
			expect((await json<ErrorBody>(stale)).code).toBe(
				"ANNOTATION_REVISION_MISMATCH",
			);
			expect((await get(created.id)).annotation.entries).toHaveLength(1);

			const matching = await request("POST", `${base}/${created.id}/entries`, {
				body: "Fresh",
				expectedRevision: created.revision,
			});
			expect(matching.status).toBe(200);
			expect((await json<WriteBody>(matching)).annotation.entries).toHaveLength(
				2,
			);
		});

		it("rejects an empty body and an unknown annotation", async () => {
			const created = await create("Fix it");

			expect(
				(
					await request("POST", `${base}/${created.id}/entries`, {
						body: "  ",
					})
				).status,
			).toBe(400);
			expect(
				(await request("POST", `${base}/${created.id}/entries`, {})).status,
			).toBe(400);
			expect(
				(await request("POST", `${base}/missing/entries`, { body: "Hi" }))
					.status,
			).toBe(404);
		});
	});

	describe("transition", () => {
		it("resolves, dismisses and reopens", async () => {
			const created = await create("Decide");

			const resolved = await request(
				"POST",
				`${base}/${created.id}/transition`,
				{ to: "resolved", summary: "Looks right" },
			);
			expect(resolved.status).toBe(200);
			const resolvedBody = await json<WriteBody>(resolved);
			expect(resolvedBody.annotation.status).toBe("resolved");
			expect(resolvedBody.annotation.entries.at(-1)).toMatchObject({
				kind: "resolution",
				summary: "Looks right",
			});

			const reopened = await request(
				"POST",
				`${base}/${created.id}/transition`,
				{ to: "open" },
			);
			expect(reopened.status).toBe(200);
			expect((await json<WriteBody>(reopened)).annotation.status).toBe("open");

			const dismissed = await request(
				"POST",
				`${base}/${created.id}/transition`,
				{ to: "dismissed", reason: "Out of scope" },
			);
			expect(dismissed.status).toBe(200);
			const dismissedBody = await json<WriteBody>(dismissed);
			expect(dismissedBody.annotation.status).toBe("dismissed");
			expect(dismissedBody.annotation.entries.at(-1)).toMatchObject({
				kind: "dismissal",
				reason: "Out of scope",
			});
		});

		it("requires a reason to dismiss", async () => {
			const created = await create("Decide");

			const response = await request(
				"POST",
				`${base}/${created.id}/transition`,
				{ to: "dismissed" },
			);

			expect(response.status).toBe(400);
			expect((await get(created.id)).annotation.status).toBe("open");
		});

		it("refuses to move directly to addressed or anything else", async () => {
			const created = await create("Decide");

			for (const to of ["addressed", "acknowledged", "needs_input", "bogus"]) {
				const response = await request(
					"POST",
					`${base}/${created.id}/transition`,
					{ to },
				);
				expect(response.status).toBe(400);
			}
			expect(
				(await request("POST", `${base}/${created.id}/transition`)).status,
			).toBe(400);
			expect((await get(created.id)).annotation.status).toBe("open");
		});

		it("checks expectedRevision", async () => {
			const created = await create("Decide");

			const response = await request(
				"POST",
				`${base}/${created.id}/transition`,
				{ to: "resolved", expectedRevision: "stale" },
			);

			expect(response.status).toBe(409);
			expect((await json<ErrorBody>(response)).code).toBe(
				"ANNOTATION_REVISION_MISMATCH",
			);
		});
	});

	describe("bulk resolve", () => {
		it("resolves the addressed annotations and leaves the open one", async () => {
			const first = await create("One");
			const second = await create("Two");
			const third = await create("Three");
			await markAddressed(first.id);
			await markAddressed(second.id);

			const response = await request("POST", `${base}/resolve`, {
				designId: DESIGN_ID,
			});

			expect(response.status).toBe(200);
			const body = await json<{
				resolved: AnnotationView[];
				skipped: unknown[];
			}>(response);
			expect(body.resolved.map((annotation) => annotation.id).sort()).toEqual(
				[first.id, second.id].sort(),
			);
			expect(
				body.resolved.every((annotation) => annotation.status === "resolved"),
			).toBe(true);
			expect(body.resolved[0]?.resolvedBy).toEqual({ role: "human" });
			expect((await get(first.id)).annotation.status).toBe("resolved");
			expect((await get(second.id)).annotation.status).toBe("resolved");
			expect((await get(third.id)).annotation.status).toBe("open");
		});

		it("resolves exactly the annotationIds it is given", async () => {
			const first = await create("One");
			const second = await create("Two");
			const third = await create("Three");

			const response = await request("POST", `${base}/resolve`, {
				designId: DESIGN_ID,
				annotationIds: [first.id, third.id],
			});

			expect(response.status).toBe(200);
			const body = await json<{ resolved: AnnotationView[] }>(response);
			expect(body.resolved.map((annotation) => annotation.id).sort()).toEqual(
				[first.id, third.id].sort(),
			);
			expect((await get(first.id)).annotation.status).toBe("resolved");
			expect((await get(second.id)).annotation.status).toBe("open");
			expect((await get(third.id)).annotation.status).toBe("resolved");
		});

		it("skips unknown ids and validates its input", async () => {
			const first = await create("One");

			const response = await request("POST", `${base}/resolve`, {
				designId: DESIGN_ID,
				annotationIds: [first.id, "missing"],
			});
			expect(response.status).toBe(200);
			const body = await json<{
				resolved: AnnotationView[];
				skipped: { annotationId: string }[];
			}>(response);
			expect(body.resolved).toHaveLength(1);
			expect(body.skipped.map((entry) => entry.annotationId)).toEqual([
				"missing",
			]);

			expect(
				(await request("POST", `${base}/resolve`, { annotationIds: [] }))
					.status,
			).toBe(400);
			expect(
				(
					await request("POST", `${base}/resolve`, {
						designId: DESIGN_ID,
						annotationIds: [1],
					})
				).status,
			).toBe(400);
		});
	});

	describe("anchor", () => {
		it("re-anchors to the board and records a reanchor entry", async () => {
			const created = await create("Move me");

			const response = await request("POST", `${base}/${created.id}/anchor`, {
				target: { kind: "board", designId: DESIGN_ID, boardId: "board-1" },
			});

			expect(response.status).toBe(200);
			const { annotation } = await json<WriteBody>(response);
			expect(annotation.target).toEqual({
				kind: "board",
				designId: DESIGN_ID,
				boardId: "board-1",
			});
			expect(annotation.entries.at(-1)).toMatchObject({
				kind: "reanchor",
				from: layerTarget,
				to: { kind: "board", boardId: "board-1" },
				by: { role: "human" },
			});
			expect(annotation.snapshot.layerName).toBe("Main");
			expect(annotation.status).toBe("open");
		});

		it("refuses another design with WRONG_CONTAINER", async () => {
			await designService.createDesignFile("design-2", buildDesign());
			const created = await create("Move me");

			const response = await request("POST", `${base}/${created.id}/anchor`, {
				target: { kind: "board", designId: "design-2", boardId: "board-1" },
			});

			expect(response.status).toBe(400);
			expect((await json<ErrorBody>(response)).code).toBe("WRONG_CONTAINER");
			expect((await get(created.id)).annotation.target).toEqual(layerTarget);
		});

		it("rejects a missing target and an unknown layer", async () => {
			const created = await create("Move me");

			expect(
				(await request("POST", `${base}/${created.id}/anchor`, {})).status,
			).toBe(400);
			const missing = await request("POST", `${base}/${created.id}/anchor`, {
				target: { ...layerTarget, elementId: "nope" },
			});
			expect(missing.status).toBe(404);
		});
	});

	describe("move", () => {
		it("moves an annotation from another branch to the current scope", async () => {
			const created = await create("Merged work");
			await editAnnotationFile(created.id, (annotation) => {
				annotation.branch = "other";
				annotation.worktreePath = "/somewhere/else";
			});
			expect((await list(`designId=${DESIGN_ID}`)).annotations).toEqual([]);

			const response = await request("POST", `${base}/${created.id}/move`);

			expect(response.status).toBe(200);
			const { annotation } = await json<WriteBody>(response);
			expect(annotation.branch).toBe("*");
			expect(annotation.entries.at(-1)).toMatchObject({
				kind: "move",
				from: { branch: "other", worktreePath: "/somewhere/else" },
				to: { branch: "*" },
				by: { role: "human" },
			});
			expect(
				(await list(`designId=${DESIGN_ID}`)).annotations.map(
					(entry) => entry.id,
				),
			).toEqual([created.id]);
		});

		it("is a no-op on the current branch", async () => {
			const created = await create("Already here");

			const response = await request("POST", `${base}/${created.id}/move`, {});

			expect(response.status).toBe(200);
			const body = await json<WriteBody>(response);
			expect(body.written).toBe(false);
			expect(body.annotation.entries).toHaveLength(1);
		});
	});

	describe("clear", () => {
		it("deletes resolved and dismissed annotations only", async () => {
			const open = await create("Open");
			const addressed = await create("Addressed");
			const resolved = await create("Resolved");
			const dismissed = await create("Dismissed");
			await markAddressed(addressed.id);
			await request("POST", `${base}/${resolved.id}/transition`, {
				to: "resolved",
			});
			await request("POST", `${base}/${dismissed.id}/transition`, {
				to: "dismissed",
				reason: "No",
			});

			const response = await request("POST", `${base}/clear`, {
				designId: DESIGN_ID,
			});

			expect(response.status).toBe(200);
			const body = await json<{ cleared: string[] }>(response);
			expect(body.cleared.sort()).toEqual([resolved.id, dismissed.id].sort());
			const remaining = await list(`designId=${DESIGN_ID}`);
			expect(remaining.annotations.map((entry) => entry.id).sort()).toEqual(
				[open.id, addressed.id].sort(),
			);
			expect((await request("GET", `${base}/${resolved.id}`)).status).toBe(404);
		});

		it("requires a container", async () => {
			expect((await request("POST", `${base}/clear`, {})).status).toBe(400);
		});
	});

	describe("revert", () => {
		const agent = { role: "agent", sessionId: "s1" } as const;

		/** An agent write that changes layer-1's className and addresses the annotation. */
		const writeAddressing = async (annotationId: string) => {
			const recorder = createAddressesRecorder(
				{ store },
				{
					designId: DESIGN_ID,
					addresses: [{ annotationId, reply: "Bigger now" }],
					by: agent,
					operations: [
						{ operation: "updateElementProps", summary: "className" },
					],
					summary: "Made it bigger",
				},
			);
			const read = await designService.readDesignFile(DESIGN_ID);
			const outcome = await designService.updateDesignFile(DESIGN_ID, {
				expectedRevision: read.revision,
				mutate: async ({ design }) => {
					const next = structuredClone(design);
					const layer = (next.boards[0]?.children as Node[])[0] as Node;
					layer.props.className = "p-8 text-2xl";
					return { design: next };
				},
				afterWrite: recorder.afterWrite,
			});
			expect(outcome.status).toBe("written");
			expect(recorder.results()[0]?.status).toBe("recorded");
			const result = recorder.results()[0];
			if (result?.status !== "recorded") throw new Error("not recorded");
			return result.entryId;
		};

		it("restores the design and reopens the annotation", async () => {
			const created = await create("Make it bigger");
			const entryId = await writeAddressing(created.id);
			expect(await layerClassName()).toBe("p-8 text-2xl");
			expect((await get(created.id)).annotation.status).toBe("addressed");

			const response = await request("POST", `${base}/${created.id}/revert`, {
				entryId,
			});

			expect(response.status).toBe(200);
			const body = await json<{
				annotation: AnnotationView;
				revision: string;
				restoredLayerIds: string[];
			}>(response);
			expect(body.restoredLayerIds).toContain("layer-1");
			expect(body.revision).toBe(
				(await designService.readDesignFile(DESIGN_ID)).revision,
			);
			expect(await layerClassName()).toBe("p-4");
			expect(body.annotation.status).toBe("open");
			const revertEntry = body.annotation.entries.at(-1);
			expect(revertEntry).toMatchObject({
				kind: "revert",
				entryId,
				by: { role: "human" },
			});
			const changeEntry = body.annotation.entries.find(
				(entry) => entry.id === entryId,
			);
			expect(changeEntry).toMatchObject({
				kind: "change",
				revertedBy: revertEntry?.id,
			});
			expect(
				(changeEntry as { change: Record<string, unknown> }).change.before,
			).toBeUndefined();
			expect((await get(created.id)).annotation.status).toBe("open");
		});

		it("refuses a second revert with NOT_REVERTIBLE", async () => {
			const created = await create("Make it bigger");
			const entryId = await writeAddressing(created.id);
			const first = await request("POST", `${base}/${created.id}/revert`, {
				entryId,
			});
			expect(first.status).toBe(200);

			const second = await request("POST", `${base}/${created.id}/revert`, {
				entryId,
			});

			expect(second.status).toBe(400);
			expect((await json<ErrorBody>(second)).code).toBe("NOT_REVERTIBLE");
			expect(await layerClassName()).toBe("p-4");
		});

		it("refuses with CHANGED_SINCE when the layer changed again", async () => {
			const created = await create("Make it bigger");
			const entryId = await writeAddressing(created.id);
			await mutateDesign((design) => {
				const layer = (design.boards[0]?.children as Node[])[0] as Node;
				layer.props.className = "p-12";
			});

			const response = await request("POST", `${base}/${created.id}/revert`, {
				entryId,
			});

			expect(response.status).toBe(409);
			const body = await json<ErrorBody>(response);
			expect(body.code).toBe("CHANGED_SINCE");
			expect(body.details?.layers).toContain("layer-1");
			expect(await layerClassName()).toBe("p-12");
			expect((await get(created.id)).annotation.status).toBe("addressed");
		});

		it("honours expectedRevision: 409 when stale, design untouched", async () => {
			const created = await create("Make it bigger");
			const entryId = await writeAddressing(created.id);
			const seen = (await get(created.id)).annotation;
			// An agent replies after the editor read it.
			await editAnnotationFile(created.id, (annotation) => {
				annotation.entries.push({
					id: "late-reply",
					kind: "reply",
					at: new Date().toISOString(),
					by: agent,
					body: "Also changed the weight",
				});
			});

			const stale = await request("POST", `${base}/${created.id}/revert`, {
				entryId,
				expectedRevision: seen.revision,
			});
			expect(stale.status).toBe(409);
			expect((await json<ErrorBody>(stale)).code).toBe(
				"ANNOTATION_REVISION_MISMATCH",
			);
			expect(await layerClassName()).toBe("p-8 text-2xl");

			const current = (await get(created.id)).annotation;
			const fresh = await request("POST", `${base}/${created.id}/revert`, {
				entryId,
				expectedRevision: current.revision,
			});
			expect(fresh.status).toBe(200);
			expect(await layerClassName()).toBe("p-4");
		});

		it("rejects a missing or unknown entry id", async () => {
			const created = await create("Make it bigger");

			expect(
				(await request("POST", `${base}/${created.id}/revert`, {})).status,
			).toBe(400);
			const unknown = await request("POST", `${base}/${created.id}/revert`, {
				entryId: created.entries[0]?.id,
			});
			expect(unknown.status).toBe(400);
			expect((await json<ErrorBody>(unknown)).code).toBe("NOT_REVERTIBLE");
		});
	});

	describe("expected revisions on every write route", () => {
		it("refuses a stale expectedRevision on each single-annotation write", async () => {
			const routes: [string, Record<string, unknown>][] = [
				["entries", { body: "More" }],
				["transition", { to: "resolved" }],
				[
					"anchor",
					{
						target: { kind: "board", designId: DESIGN_ID, boardId: "board-1" },
					},
				],
				["move", {}],
				["revert", { entryId: "whatever" }],
			];
			for (const [route, body] of routes) {
				const created = await create(`For ${route}`);
				const stale = created.revision;
				await request("POST", `${base}/${created.id}/entries`, {
					body: "A newer remark",
				});
				const response = await request(
					"POST",
					`${base}/${created.id}/${route}`,
					{
						...body,
						expectedRevision: stale,
					},
				);
				expect([route, response.status]).toEqual([route, 409]);
				expect((await json<ErrorBody>(response)).code).toBe(
					"ANNOTATION_REVISION_MISMATCH",
				);
			}
		});

		it("rejects a malformed expectedRevision with 400 instead of ignoring it", async () => {
			const created = await create();
			for (const expectedRevision of [42, "", { revision: "x" }]) {
				const response = await request(
					"POST",
					`${base}/${created.id}/transition`,
					{
						to: "resolved",
						expectedRevision,
					},
				);
				expect(response.status).toBe(400);
			}
			expect((await get(created.id)).annotation.status).toBe("open");
			const bulk = await request("POST", `${base}/resolve`, {
				designId: DESIGN_ID,
				expectedRevisions: { [created.id]: 1 },
			});
			expect(bulk.status).toBe(400);
		});

		it("skips stale annotations in bulk resolve and clear", async () => {
			const first = await create("One");
			const second = await create("Two");
			const firstSeen = first.revision;
			await request("POST", `${base}/${first.id}/entries`, { body: "Newer" });

			const resolved = await request("POST", `${base}/resolve`, {
				designId: DESIGN_ID,
				annotationIds: [first.id, second.id],
				expectedRevisions: {
					[first.id]: firstSeen,
					[second.id]: second.revision,
				},
			});
			const resolvedBody = await json<{
				resolved: AnnotationView[];
				skipped: { annotationId: string; code: string }[];
			}>(resolved);
			expect(resolvedBody.resolved.map((entry) => entry.id)).toEqual([
				second.id,
			]);
			expect(resolvedBody.skipped).toEqual([
				expect.objectContaining({
					annotationId: first.id,
					code: "ANNOTATION_REVISION_MISMATCH",
				}),
			]);

			const seen = (await get(second.id)).annotation.revision;
			await editAnnotationFile(second.id, (annotation) => {
				annotation.entries.push({
					id: "late",
					kind: "reply",
					at: new Date().toISOString(),
					by: { role: "agent", sessionId: "s1" },
					body: "Late",
				});
			});
			const cleared = await request("POST", `${base}/clear`, {
				designId: DESIGN_ID,
				expectedRevisions: { [second.id]: seen },
			});
			const clearedBody = await json<{
				cleared: string[];
				skipped: { annotationId: string; code: string }[];
			}>(cleared);
			expect(clearedBody.cleared).toEqual([]);
			expect(clearedBody.skipped).toEqual([
				expect.objectContaining({
					annotationId: second.id,
					code: "ANNOTATION_REVISION_MISMATCH",
				}),
			]);
			expect((await request("GET", `${base}/${second.id}`)).status).toBe(200);
		});
	});

	describe("checkout scope", () => {
		/** Checks out `branch` the way git does: `HEAD.lock`, renamed over `HEAD`. */
		const checkout = async (branch: string) => {
			const gitDirectory = path.join(projectRoot, ".git");
			await mkdir(gitDirectory, { recursive: true });
			await writeFile(
				path.join(gitDirectory, "HEAD.lock"),
				`ref: refs/heads/${branch}\n`,
			);
			await rename(
				path.join(gitDirectory, "HEAD.lock"),
				path.join(gitDirectory, "HEAD"),
			);
		};

		const scopeOf = async (branch: string) => ({
			branch,
			worktreePath: await realpath(projectRoot),
		});

		it("answers reads with the checkout's scope", async () => {
			await checkout("feature/a");
			const created = await create();
			expect((await list(`designId=${DESIGN_ID}`)).scope).toEqual(
				await scopeOf("feature/a"),
			);
			const read = await json<{ scope: unknown; annotation: AnnotationView }>(
				await request("GET", `${base}/${created.id}?designId=${DESIGN_ID}`),
			);
			expect(read.scope).toEqual(await scopeOf("feature/a"));
			expect(read.annotation.id).toBe(created.id);
		});

		it("refuses every write from an editor that listed another checkout", async () => {
			await checkout("feature/a");
			const listedOn = await scopeOf("feature/a");
			const routes: [string, Record<string, unknown>][] = [
				["entries", { body: "More" }],
				["transition", { to: "resolved" }],
				[
					"anchor",
					{
						target: { kind: "board", designId: DESIGN_ID, boardId: "board-1" },
					},
				],
				["move", {}],
				["revert", { entryId: "whatever" }],
			];
			const created = await create("On branch a");
			await checkout("feature/b");
			const refused = async (response: Response) => {
				expect(response.status).toBe(409);
				const body = await json<ErrorBody>(response);
				expect(body.code).toBe("SCOPE_CHANGED");
				expect(body.details?.scope).toEqual(await scopeOf("feature/b"));
			};
			for (const [route, body] of routes) {
				await refused(
					await request("POST", `${base}/${created.id}/${route}`, {
						...body,
						expectedScope: listedOn,
					}),
				);
			}
			await refused(
				await request("POST", base, {
					target: layerTarget,
					body: "New",
					expectedScope: listedOn,
				}),
			);
			for (const route of ["resolve", "clear"]) {
				await refused(
					await request("POST", `${base}/${route}`, {
						designId: DESIGN_ID,
						expectedScope: listedOn,
					}),
				);
			}
			// Nothing was written: the annotation is as created, the only one.
			const stored = await readAnnotationFile(created.id);
			expect(stored.entries).toHaveLength(1);
			expect(stored.status).toBe("open");
			expect(
				(await list(`designId=${DESIGN_ID}&branch=all`)).annotations,
			).toHaveLength(1);
		});

		it("writes when the expected scope is the checkout's, and without one", async () => {
			await checkout("feature/a");
			const created = await create();
			const replied = await request("POST", `${base}/${created.id}/entries`, {
				body: "With scope",
				expectedScope: await scopeOf("feature/a"),
			});
			expect(replied.status).toBe(200);
			const unscoped = await request("POST", `${base}/${created.id}/entries`, {
				body: "Without scope",
			});
			expect(unscoped.status).toBe(200);
		});

		it("rejects a malformed expectedScope with 400", async () => {
			const created = await create();
			for (const expectedScope of ["main", { branch: "main" }, 42]) {
				const response = await request(
					"POST",
					`${base}/${created.id}/entries`,
					{ body: "More", expectedScope },
				);
				expect(response.status).toBe(400);
			}
		});
	});

	describe("without an active project", () => {
		it("answers 409", async () => {
			const bare = createTrickroomApp({ trickroomHome });

			const listed = await bare.request(`${base}?designId=${DESIGN_ID}`);
			expect(listed.status).toBe(409);

			const created = await bare.request(base, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ target: layerTarget, body: "Hi" }),
			});
			expect(created.status).toBe(409);
		});
	});

	describe("event stream", () => {
		it("sends an annotation event when one is created through the API", async () => {
			const controller = new AbortController();
			const response = await app.request("/api/trickroom/events", {
				signal: controller.signal,
			});
			expect(response.status).toBe(200);
			const reader = response.body?.getReader();
			if (!reader) throw new Error("event stream body is unavailable");
			const decoder = new TextDecoder();

			let received = "";
			// Drain frames in the background so every read has a consumer.
			const pump = (async () => {
				for (;;) {
					const chunk = await reader.read().catch(() => null);
					if (!chunk || chunk.done) return;
					received += decoder.decode(chunk.value, { stream: true });
				}
			})();

			try {
				// The stream says ready once annotation writes are reported.
				const readyDeadline = Date.now() + 8_000;
				while (
					!received.includes("event: ready") &&
					Date.now() < readyDeadline
				) {
					await new Promise((resolve) => setTimeout(resolve, 10));
				}
				expect(received).toContain("event: ready");
				const annotation = await create("Streamed");

				const frame = () =>
					received
						.split("\n\n")
						.find(
							(candidate) =>
								candidate.includes("event: annotation") &&
								candidate.includes(annotation.id),
						);
				const deadline = Date.now() + 8_000;
				while (!frame() && Date.now() < deadline) {
					await new Promise((resolve) => setTimeout(resolve, 50));
				}

				const found = frame();
				expect(found).toBeDefined();
				const data = JSON.parse(
					(found as string)
						.split("\n")
						.find((line) => line.startsWith("data:"))
						?.slice("data:".length)
						.trim() ?? "null",
				);
				expect(data).toMatchObject({
					annotationId: annotation.id,
					container: { kind: "design", designId: DESIGN_ID },
					operation: "changed",
				});
				expect(data.revision).toBe(annotation.revision);
			} finally {
				controller.abort();
				await reader.cancel().catch(() => undefined);
				await pump;
			}
		}, 15_000);

		it("sends an annotation-scope event when another branch is checked out", async () => {
			const gitDirectory = path.join(projectRoot, ".git");
			await mkdir(gitDirectory, { recursive: true });
			await writeFile(path.join(gitDirectory, "HEAD"), "ref: refs/heads/a\n");
			const controller = new AbortController();
			const response = await app.request("/api/trickroom/events", {
				signal: controller.signal,
			});
			const reader = response.body?.getReader();
			if (!reader) throw new Error("event stream body is unavailable");
			const decoder = new TextDecoder();
			let received = "";
			const pump = (async () => {
				for (;;) {
					const chunk = await reader.read().catch(() => null);
					if (!chunk || chunk.done) return;
					received += decoder.decode(chunk.value, { stream: true });
				}
			})();
			const waitFor = async (predicate: () => boolean) => {
				const deadline = Date.now() + 8_000;
				while (!predicate() && Date.now() < deadline) {
					await new Promise((resolve) => setTimeout(resolve, 20));
				}
			};
			try {
				await waitFor(() => received.includes("event: ready"));
				expect(received).toContain("event: ready");
				// An unrelated git file does not count; HEAD does, renamed into place.
				await writeFile(path.join(gitDirectory, "index"), "x");
				await writeFile(
					path.join(gitDirectory, "HEAD.lock"),
					"ref: refs/heads/b\n",
				);
				await rename(
					path.join(gitDirectory, "HEAD.lock"),
					path.join(gitDirectory, "HEAD"),
				);
				await waitFor(() => received.includes("event: annotation-scope"));
				const frames = received
					.split("\n\n")
					.filter((frame) => frame.includes("event: annotation-scope"));
				expect(frames).toHaveLength(1);
				const data = JSON.parse(
					(frames[0] as string)
						.split("\n")
						.find((line) => line.startsWith("data:"))
						?.slice("data:".length)
						.trim() ?? "null",
				);
				expect(data).toEqual({
					branch: "b",
					worktreePath: await realpath(projectRoot),
				});
			} finally {
				controller.abort();
				await reader.cancel().catch(() => undefined);
				await pump;
			}
		}, 15_000);
	});
});
