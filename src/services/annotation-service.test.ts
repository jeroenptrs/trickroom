import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Node, TrickroomDesign } from "../types";
import {
	ACKNOWLEDGEMENT_TTL_MS,
	type AnnotationServiceContext,
	acknowledgeAnnotation,
	buildAnnotationAnchorIndex,
	clearAnnotations,
	createAddressesRecorder,
	createAnnotation,
	deriveDetached,
	getAnnotation,
	getAnnotationAnchorIndex,
	getAnnotationMemoryReference,
	listAnnotations,
	moveAnnotationToBranch,
	reanchorAnnotation,
	recordChange,
	recordSessionCall,
	replyToAnnotation,
	resolveAnnotations,
	revertChange,
	transitionAnnotation,
	validateAddresses,
} from "./annotation-service";
import { AnnotationStore } from "./annotation-store";
import type {
	AnnotationActor,
	AnnotationChangeRecord,
	AnnotationScope,
	AnnotationTarget,
} from "./annotations.types";
import {
	createDesignFileService,
	type DesignFileService,
} from "./design-file-service";
import { applyDeleteElement } from "./design-transform-service";

const human: AnnotationActor = { role: "human" };
const agent: AnnotationActor = { role: "agent", sessionId: "session-a" };
const otherAgent: AnnotationActor = { role: "agent", sessionId: "session-b" };
const main: AnnotationScope = { branch: "main", worktreePath: "/repo" };
const feature: AnnotationScope = {
	branch: "feature",
	worktreePath: "/repo-wt",
};

const node = (
	id: string,
	name: string,
	children: Node[] | string = [],
	className?: string,
): Node => ({
	id,
	props: {
		"data-trickroom-name": name,
		"data-trickroom-library": "trickroom",
		"data-trickroom-component":
			typeof children === "string" ? "text" : "container",
		"data-trickroom-role": typeof children === "string" ? "text" : "branch",
		...(className ? { className } : {}),
	},
	children,
});

const checkout = (): TrickroomDesign => ({
	name: "Checkout",
	boards: [
		node("board-1", "Cart", [
			node("header", "Header", [node("title", "Title", "Your cart")]),
			node("card", "Card", [node("price", "Price", "$10")], "p-4"),
		]),
		node("board-2", "Payment", [node("pay", "Pay button", "Pay")]),
	],
});

const designId = "design-1";

let root: string;
let clock: Date;
let context: AnnotationServiceContext;
let store: AnnotationStore;
let designs: DesignFileService;

const tick = (ms = 1000) => {
	clock = new Date(clock.getTime() + ms);
};

beforeEach(async () => {
	root = await mkdtemp(path.join(os.tmpdir(), "trickroom-annotations-"));
	const projectRoot = path.join(root, "project");
	const trickroomHome = path.join(root, "home");
	await mkdir(path.join(projectRoot, ".trickroom", "designs"), {
		recursive: true,
	});
	clock = new Date("2026-10-14T10:00:00.000Z");
	store = new AnnotationStore({ projectId: "project-1", trickroomHome });
	context = { store, now: () => clock };
	designs = createDesignFileService(projectRoot, { trickroomHome });
	await designs.createDesignFile(designId, checkout());
});

afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

const readDesign = async () => {
	const read = await designs.readDesignFile(designId);
	return { design: read.design, revision: read.revision };
};

const layerTarget = (
	elementId = "title",
	boardId = "board-1",
): AnnotationTarget => ({
	kind: "layer",
	designId,
	boardId,
	elementId,
});

const create = async (
	options: {
		target?: AnnotationTarget;
		body?: string;
		by?: AnnotationActor;
		scope?: AnnotationScope;
	} = {},
) => {
	const { annotation } = await createAnnotation(context, {
		target: options.target ?? layerTarget(),
		body: options.body ?? "Make the title bigger",
		by: options.by ?? human,
		scope: options.scope ?? main,
		snapshot: { stageMode: "responsive", responsiveWidth: 390 },
		design: await readDesign(),
	});
	return annotation;
};

/** Writes `mutate` to the design addressing `annotationIds`, as `design_apply addresses` will. */
const writeAddressing = async (
	annotationIds: string[],
	mutate: (design: TrickroomDesign) => TrickroomDesign,
	{
		by = agent,
		expectedRevision,
	}: { by?: AnnotationActor; expectedRevision?: string } = {},
) => {
	const read = await designs.readDesignFile(designId);
	const recorder = createAddressesRecorder(context, {
		designId,
		addresses: annotationIds.map((annotationId) => ({
			annotationId,
			reply: `Done for ${annotationId}`,
		})),
		by,
		operations: [{ operation: "updateElementProps", summary: "Edited" }],
		summary: "Edited the design",
	});
	const outcome = await designs.updateDesignFile(designId, {
		expectedRevision: expectedRevision ?? read.revision,
		mutate: async (current) => ({ design: mutate(current.design) }),
		afterWrite: recorder.afterWrite,
	});
	return { outcome, results: recorder.results() };
};

const setClass =
	(elementId: string, className: string) => (design: TrickroomDesign) => {
		const next = structuredClone(design);
		const visit = (entry: Node) => {
			if (entry.id === elementId) entry.props = { ...entry.props, className };
			if (typeof entry.children !== "string") entry.children.forEach(visit);
		};
		next.boards.forEach(visit);
		return next;
	};

const findClass = (design: TrickroomDesign, elementId: string) => {
	let found: string | undefined;
	const visit = (entry: Node) => {
		if (entry.id === elementId) found = entry.props.className;
		if (typeof entry.children !== "string") entry.children.forEach(visit);
	};
	design.boards.forEach(visit);
	return found;
};

describe("create", () => {
	it("stores an open annotation with the remark, scope and a snapshot of the target", async () => {
		const annotation = await create();
		expect(annotation.status).toBe("open");
		expect(annotation.branch).toBe("main");
		expect(annotation.worktreePath).toBe("/repo");
		expect(annotation.entries).toEqual([
			expect.objectContaining({
				kind: "remark",
				by: human,
				body: "Make the title bigger",
			}),
		]);
		expect(annotation.transitions).toEqual([
			{ from: null, to: "open", at: clock.toISOString(), by: human },
		]);
		expect(annotation.snapshot).toEqual({
			layerName: "Title",
			component: "trickroom/text",
			ancestorNames: ["Cart", "Header"],
			designRevision: (await readDesign()).revision,
			branch: "main",
			worktreePath: "/repo",
			stageMode: "responsive",
			responsiveWidth: 390,
		});
		expect(annotation.revision).toMatch(/^sha256:/u);

		const file = path.join(
			store.projectDirectory,
			"designs",
			designId,
			`${annotation.id}.json`,
		);
		expect(JSON.parse(await readFile(file, "utf8"))).toMatchObject({
			version: 1,
			id: annotation.id,
		});
	});

	it("requires a branch", async () => {
		await expect(
			createAnnotation(context, {
				target: layerTarget(),
				body: "x",
				by: human,
				scope: { branch: " ", worktreePath: "/repo" },
				design: await readDesign(),
			}),
		).rejects.toMatchObject({ code: "INVALID_INPUT" });
	});

	it("requires a body and an existing target, and corrects a layer's board", async () => {
		await expect(create({ body: "  " })).rejects.toMatchObject({
			code: "INVALID_INPUT",
		});
		await expect(
			create({ target: layerTarget("missing") }),
		).rejects.toMatchObject({
			code: "TARGET_NOT_FOUND",
		});
		await expect(
			create({ target: { kind: "board", designId, boardId: "nope" } }),
		).rejects.toMatchObject({ code: "TARGET_NOT_FOUND" });
		const annotation = await create({ target: layerTarget("pay", "board-1") });
		expect(annotation.target).toMatchObject({ boardId: "board-2" });
	});

	it("records an agent-created annotation's first entry as a reply", async () => {
		const annotation = await create({ by: agent });
		expect(annotation.entries[0]).toMatchObject({ kind: "reply", by: agent });
	});
});

describe("lifecycle", () => {
	it("acknowledges an open annotation for the session that saw it", async () => {
		const annotation = await create();
		tick();
		const { annotation: seen } = await acknowledgeAnnotation(context, {
			annotationId: annotation.id,
			sessionId: "session-a",
		});
		expect(seen.status).toBe("acknowledged");
		expect(seen.acknowledged).toEqual({
			sessionId: "session-a",
			at: clock.toISOString(),
		});
		expect(seen.acknowledgement).toMatchObject({
			sessionId: "session-a",
			active: true,
		});
		expect(seen.transitions.at(-1)).toMatchObject({
			from: "open",
			to: "acknowledged",
			by: agent,
		});

		tick();
		const { annotation: again, written } = await acknowledgeAnnotation(
			context,
			{
				annotationId: annotation.id,
				sessionId: "session-b",
			},
		);
		expect(written).toBe(true);
		expect(again.acknowledged?.sessionId).toBe("session-b");
		expect(again.transitions).toHaveLength(seen.transitions.length);
	});

	it("never moves an addressed, needs-input or closed annotation back to acknowledged", async () => {
		for (const setUp of [
			async (id: string) =>
				writeAddressing([id], setClass("title", "text-2xl")),
			async (id: string) =>
				replyToAnnotation(context, {
					annotationId: id,
					by: agent,
					question: "Which size?",
				}),
			async (id: string) =>
				transitionAnnotation(context, {
					annotationId: id,
					by: human,
					to: "resolved",
				}),
			async (id: string) =>
				transitionAnnotation(context, {
					annotationId: id,
					by: human,
					to: "dismissed",
					reason: "No",
				}),
		]) {
			const annotation = await create();
			await setUp(annotation.id);
			const before = await getAnnotation(context, {
				annotationId: annotation.id,
			});
			const { written, annotation: after } = await acknowledgeAnnotation(
				context,
				{
					annotationId: annotation.id,
					sessionId: "session-c",
				},
			);
			expect(written).toBe(false);
			expect(after.status).toBe(before.status);
		}
	});

	it("expires an acknowledgement 15 minutes after the session's last call, without writing", async () => {
		const annotation = await create();
		await acknowledgeAnnotation(context, {
			annotationId: annotation.id,
			sessionId: "session-a",
		});
		const stored = await readFile(
			store.getAnnotationPath({ kind: "design", designId }, annotation.id),
			"utf8",
		);

		tick(ACKNOWLEDGEMENT_TTL_MS - 1000);
		expect(
			(await getAnnotation(context, { annotationId: annotation.id }))
				.acknowledgement?.active,
		).toBe(true);

		tick(2000);
		const expired = await getAnnotation(context, {
			annotationId: annotation.id,
		});
		expect(expired.status).toBe("acknowledged");
		expect(expired.acknowledgement?.active).toBe(false);

		// A later tool call from the session keeps it active.
		await recordSessionCall(context, "session-a");
		expect(
			(await getAnnotation(context, { annotationId: annotation.id }))
				.acknowledgement?.active,
		).toBe(true);
		tick(ACKNOWLEDGEMENT_TTL_MS + 1);
		expect(
			(await getAnnotation(context, { annotationId: annotation.id }))
				.acknowledgement?.active,
		).toBe(false);

		expect(
			await readFile(
				store.getAnnotationPath({ kind: "design", designId }, annotation.id),
				"utf8",
			),
		).toBe(stored);
	});

	it("an agent text reply acknowledges an open annotation and changes nothing else", async () => {
		const annotation = await create();
		const { annotation: replied } = await replyToAnnotation(context, {
			annotationId: annotation.id,
			by: agent,
			body: "Looking at it",
		});
		expect(replied.status).toBe("acknowledged");
		expect(replied.entries.at(-1)).toMatchObject({
			kind: "reply",
			by: agent,
			body: "Looking at it",
		});

		await writeAddressing([annotation.id], setClass("title", "text-2xl"));
		const { annotation: after } = await replyToAnnotation(context, {
			annotationId: annotation.id,
			by: agent,
			body: "Also tweaked the weight",
		});
		expect(after.status).toBe("addressed");
	});

	it("a question needs input, and only agents ask", async () => {
		const annotation = await create();
		const { annotation: asked } = await replyToAnnotation(context, {
			annotationId: annotation.id,
			by: agent,
			body: "Two options here.",
			question: "Should it be 24px or 32px?",
		});
		expect(asked.status).toBe("needs_input");
		expect(asked.entries.slice(-2).map((entry) => entry.kind)).toEqual([
			"reply",
			"question",
		]);

		await expect(
			replyToAnnotation(context, {
				annotationId: annotation.id,
				by: human,
				question: "?",
			}),
		).rejects.toMatchObject({ code: "INVALID_INPUT" });
	});

	it("rejects a reply with nothing in it or with two actions", async () => {
		const annotation = await create();
		await expect(
			replyToAnnotation(context, { annotationId: annotation.id, by: agent }),
		).rejects.toMatchObject({ code: "INVALID_INPUT" });
		await expect(
			replyToAnnotation(context, {
				annotationId: annotation.id,
				by: agent,
				question: "?",
				resolve: {},
			}),
		).rejects.toMatchObject({ code: "INVALID_INPUT" });
	});

	it.each([
		["addressed"],
		["needs_input"],
		["resolved"],
		["dismissed"],
	] as const)("a designer reply on a %s annotation reopens it", async (status) => {
		const annotation = await create();
		await acknowledgeAnnotation(context, {
			annotationId: annotation.id,
			sessionId: "session-a",
		});
		if (status === "addressed") {
			await writeAddressing([annotation.id], setClass("title", "text-2xl"));
		} else if (status === "needs_input") {
			await replyToAnnotation(context, {
				annotationId: annotation.id,
				by: agent,
				question: "?",
			});
		} else if (status === "resolved") {
			await transitionAnnotation(context, {
				annotationId: annotation.id,
				by: agent,
				to: "resolved",
			});
		} else {
			await transitionAnnotation(context, {
				annotationId: annotation.id,
				by: agent,
				to: "dismissed",
				reason: "Out of scope",
			});
		}
		expect(
			(await getAnnotation(context, { annotationId: annotation.id })).status,
		).toBe(status);

		tick();
		const { annotation: reopened } = await replyToAnnotation(context, {
			annotationId: annotation.id,
			by: human,
			body: "Not quite, try again",
		});
		expect(reopened.status).toBe("open");
		expect(reopened.acknowledged).toBeUndefined();
		expect(reopened.entries.at(-1)).toMatchObject({
			kind: "remark",
			by: human,
		});
		expect(reopened.transitions.at(-1)).toMatchObject({
			from: status,
			to: "open",
			by: human,
		});
	});

	it("a designer reply on an open or acknowledged annotation keeps its status", async () => {
		const annotation = await create();
		const { annotation: open } = await replyToAnnotation(context, {
			annotationId: annotation.id,
			by: human,
			body: "And the colour",
		});
		expect(open.status).toBe("open");
		await acknowledgeAnnotation(context, {
			annotationId: annotation.id,
			sessionId: "session-a",
		});
		const { annotation: acknowledged } = await replyToAnnotation(context, {
			annotationId: annotation.id,
			by: human,
			body: "One more thing",
		});
		expect(acknowledged.status).toBe("acknowledged");
		expect(acknowledged.acknowledged?.sessionId).toBe("session-a");
	});

	it("an agent reply never reopens a closed annotation", async () => {
		const annotation = await create();
		await transitionAnnotation(context, {
			annotationId: annotation.id,
			by: human,
			to: "resolved",
		});
		const { annotation: after } = await replyToAnnotation(context, {
			annotationId: annotation.id,
			by: agent,
			body: "Thanks",
		});
		expect(after.status).toBe("resolved");
	});

	it("both may resolve; attribution says who, and the human accepts an agent's resolve", async () => {
		const byAgent = await create();
		const { annotation: agentResolved } = await replyToAnnotation(context, {
			annotationId: byAgent.id,
			by: agent,
			resolve: { summary: "Done as asked" },
		});
		expect(agentResolved.status).toBe("resolved");
		expect(agentResolved.resolvedBy).toEqual(agent);
		expect(agentResolved.entries.at(-1)).toMatchObject({
			kind: "resolution",
			summary: "Done as asked",
		});

		tick();
		const { annotation: accepted, written } = await transitionAnnotation(
			context,
			{
				annotationId: byAgent.id,
				by: human,
				to: "resolved",
			},
		);
		expect(written).toBe(true);
		expect(accepted.resolvedBy).toEqual(human);
		expect(accepted.transitions.at(-1)).toMatchObject({
			from: "resolved",
			to: "resolved",
			by: human,
		});

		// Resolving a human-resolved one again changes nothing.
		const { written: again } = await transitionAnnotation(context, {
			annotationId: byAgent.id,
			by: human,
			to: "resolved",
		});
		expect(again).toBe(false);

		const byHuman = await create();
		const { annotation: humanResolved } = await transitionAnnotation(context, {
			annotationId: byHuman.id,
			by: human,
			to: "resolved",
		});
		expect(humanResolved.resolvedBy).toEqual(human);
	});

	it("dismissal needs a reason and is recorded as an entry", async () => {
		const annotation = await create();
		await expect(
			transitionAnnotation(context, {
				annotationId: annotation.id,
				by: agent,
				to: "dismissed",
			}),
		).rejects.toMatchObject({ code: "INVALID_INPUT" });
		const { annotation: dismissed } = await transitionAnnotation(context, {
			annotationId: annotation.id,
			by: agent,
			to: "dismissed",
			reason: "The design system fixes this size",
		});
		expect(dismissed.status).toBe("dismissed");
		expect(dismissed.entries.at(-1)).toMatchObject({
			kind: "dismissal",
			by: agent,
			reason: "The design system fixes this size",
		});
	});

	it("reopen returns a closed annotation to open, and refuses statuses agents own", async () => {
		const annotation = await create();
		await transitionAnnotation(context, {
			annotationId: annotation.id,
			by: agent,
			to: "resolved",
		});
		const { annotation: reopened } = await transitionAnnotation(context, {
			annotationId: annotation.id,
			by: human,
			to: "open",
		});
		expect(reopened.status).toBe("open");
		expect(reopened.resolvedBy).toBeUndefined();
		await expect(
			transitionAnnotation(context, {
				annotationId: annotation.id,
				by: human,
				to: "addressed" as "open",
			}),
		).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
	});

	it("records who and when for every transition", async () => {
		const annotation = await create();
		tick();
		await acknowledgeAnnotation(context, {
			annotationId: annotation.id,
			sessionId: "session-a",
		});
		tick();
		await writeAddressing([annotation.id], setClass("title", "text-2xl"));
		tick();
		await transitionAnnotation(context, {
			annotationId: annotation.id,
			by: human,
			to: "resolved",
		});
		const final = await getAnnotation(context, { annotationId: annotation.id });
		expect(
			final.transitions.map(({ from, to, by }) => ({
				from,
				to,
				role: by.role,
			})),
		).toEqual([
			{ from: null, to: "open", role: "human" },
			{ from: "open", to: "acknowledged", role: "agent" },
			{ from: "acknowledged", to: "addressed", role: "agent" },
			{ from: "addressed", to: "resolved", role: "human" },
		]);
		const times = final.transitions.map((transition) => transition.at);
		expect(new Set(times).size).toBe(4);
	});

	it("refuses a write against a stale revision", async () => {
		const annotation = await create();
		await replyToAnnotation(context, {
			annotationId: annotation.id,
			by: agent,
			question: "?",
		});
		await expect(
			transitionAnnotation(context, {
				annotationId: annotation.id,
				by: human,
				to: "resolved",
				expectedRevision: annotation.revision,
			}),
		).rejects.toMatchObject({ code: "ANNOTATION_REVISION_MISMATCH" });
		const current = await getAnnotation(context, {
			annotationId: annotation.id,
		});
		const { annotation: resolved } = await transitionAnnotation(context, {
			annotationId: annotation.id,
			by: human,
			to: "resolved",
			expectedRevision: current.revision,
		});
		expect(resolved.status).toBe("resolved");
	});

	it("rejects writes without a valid actor", async () => {
		const annotation = await create();
		await expect(
			replyToAnnotation(context, {
				annotationId: annotation.id,
				by: { role: "agent", sessionId: "" },
				body: "x",
			}),
		).rejects.toMatchObject({ code: "INVALID_INPUT" });
	});
});

describe("bulk resolve", () => {
	it("is per annotation: four addressed of five sent together resolve, one stays open", async () => {
		const sent = [];
		for (let index = 0; index < 5; index += 1) {
			sent.push(await create({ body: `Remark ${index}` }));
			tick();
		}
		await writeAddressing(
			sent.slice(0, 4).map((annotation) => annotation.id),
			setClass("title", "text-2xl"),
		);
		const listed = await listAnnotations(context, {
			container: { kind: "design", designId },
			scope: main,
		});
		expect(listed.annotations.map((annotation) => annotation.status)).toEqual([
			"addressed",
			"addressed",
			"addressed",
			"addressed",
			"open",
		]);

		const { resolved, skipped } = await resolveAnnotations(context, {
			container: { kind: "design", designId },
			by: human,
			scope: main,
			boardId: "board-1",
		});
		expect(resolved.map((annotation) => annotation.id).sort()).toEqual(
			sent
				.slice(0, 4)
				.map((annotation) => annotation.id)
				.sort(),
		);
		expect(skipped).toEqual([]);
		expect(
			(await getAnnotation(context, { annotationId: sent[4]?.id ?? "" }))
				.status,
		).toBe("open");
	});

	it("accepts every agent-resolved annotation as the human", async () => {
		const first = await create();
		const second = await create();
		const third = await create();
		await transitionAnnotation(context, {
			annotationId: first.id,
			by: agent,
			to: "resolved",
		});
		await transitionAnnotation(context, {
			annotationId: second.id,
			by: agent,
			to: "resolved",
		});
		await transitionAnnotation(context, {
			annotationId: third.id,
			by: human,
			to: "resolved",
		});
		const { resolved } = await resolveAnnotations(context, {
			container: { kind: "design", designId },
			by: human,
			scope: main,
			statuses: ["resolved"],
		});
		expect(resolved.map((annotation) => annotation.id).sort()).toEqual(
			[first.id, second.id].sort(),
		);
		expect(
			resolved.every((annotation) => annotation.resolvedBy?.role === "human"),
		).toBe(true);
	});

	it("resolves explicit ids and reports the ones it skipped", async () => {
		const annotation = await create();
		const { resolved, skipped } = await resolveAnnotations(context, {
			container: { kind: "design", designId },
			by: human,
			annotationIds: [annotation.id, "missing-id"],
		});
		expect(resolved.map((entry) => entry.id)).toEqual([annotation.id]);
		expect(skipped).toEqual([
			expect.objectContaining({ annotationId: "missing-id" }),
		]);
	});
});

describe("branch scope", () => {
	it("lists the checkout's branch by default and every branch on request", async () => {
		const onMain = await create({ scope: main });
		const onFeature = await create({ scope: feature });
		const unscoped = await create({
			scope: { branch: "*", worktreePath: "/repo" },
		});
		const container = { kind: "design", designId } as const;
		const ids = async (scope: AnnotationScope, branch?: string) =>
			(
				await listAnnotations(context, {
					container,
					scope,
					...(branch ? { branch } : {}),
				})
			).annotations.map((annotation) => annotation.id);
		expect(await ids(main)).toEqual([onMain.id]);
		expect(await ids(feature)).toEqual([onFeature.id]);
		expect(await ids({ branch: "*", worktreePath: "/x" })).toEqual([
			unscoped.id,
		]);
		expect((await ids(main, "all")).sort()).toEqual(
			[onMain.id, onFeature.id, unscoped.id].sort(),
		);
		expect(await ids(main, "feature")).toEqual([onFeature.id]);
	});

	it("moves an annotation to the current branch as a field change", async () => {
		const annotation = await create({ scope: feature });
		const { annotation: moved } = await moveAnnotationToBranch(context, {
			annotationId: annotation.id,
			by: human,
			scope: main,
		});
		expect(moved).toMatchObject({ branch: "main", worktreePath: "/repo" });
		expect(moved.snapshot).toMatchObject({
			branch: "feature",
			worktreePath: "/repo-wt",
		});
		expect(moved.entries.at(-1)).toMatchObject({
			kind: "move",
			from: feature,
			to: main,
		});
		expect(
			store.getAnnotationPath({ kind: "design", designId }, annotation.id),
		).toBe(store.getAnnotationPath({ kind: "design", designId }, moved.id));
		const { written } = await moveAnnotationToBranch(context, {
			annotationId: annotation.id,
			by: human,
			scope: main,
		});
		expect(written).toBe(false);
	});
});

describe("filters, detached and re-anchoring", () => {
	it("filters by status, board and element, following a layer that moved boards", async () => {
		const title = await create();
		const pay = await create({ target: layerTarget("pay", "board-2") });
		const board = await create({
			target: { kind: "board", designId, boardId: "board-1" },
		});
		await create({ target: { kind: "design", designId } });
		const container = { kind: "design", designId } as const;
		const list = async (
			input: Partial<Parameters<typeof listAnnotations>[1]>,
		) =>
			(
				await listAnnotations(context, {
					container,
					scope: main,
					design: (await readDesign()).design,
					...input,
				})
			).annotations.map((annotation) => annotation.id);

		expect((await list({ boardId: "board-1" })).sort()).toEqual(
			[title.id, board.id].sort(),
		);
		expect(await list({ elementId: "pay" })).toEqual([pay.id]);
		await replyToAnnotation(context, {
			annotationId: pay.id,
			by: agent,
			question: "?",
		});
		expect(await list({ statuses: ["needs_input"] })).toEqual([pay.id]);

		// Move "pay" to board-1: its annotation follows it.
		const read = await designs.readDesignFile(designId);
		const moved = structuredClone(read.design);
		const payNode = (moved.boards[1]?.children as Node[]).pop() as Node;
		(moved.boards[0]?.children as Node[]).push(payNode);
		await designs.writeDesignFile(designId, moved, {
			expectedRevision: read.revision,
		});
		expect((await list({ boardId: "board-1" })).sort()).toEqual(
			[title.id, pay.id, board.id].sort(),
		);
	});

	it("derives detached from the design, and reattaches when the id returns", async () => {
		const annotation = await create({ target: layerTarget("price") });
		const boardAnnotation = await create({
			target: { kind: "board", designId, boardId: "board-2" },
		});
		const original = await designs.readDesignFile(designId);
		const without = structuredClone(original.design);
		without.boards = [without.boards[0] as Node];
		((without.boards[0]?.children as Node[])[1] as Node).children = [];
		await designs.writeDesignFile(designId, without, {
			expectedRevision: original.revision,
		});
		const detachedRead = await designs.readDesignFile(designId);
		const detached = await getAnnotation(context, {
			annotationId: annotation.id,
			design: detachedRead.design,
		});
		expect(detached.detached).toBe(true);
		expect(detached.snapshot.layerName).toBe("Price");
		expect(deriveDetached(boardAnnotation.target, detachedRead.design)).toBe(
			true,
		);

		await designs.writeDesignFile(designId, original.design, {
			expectedRevision: detachedRead.revision,
		});
		const back = await getAnnotation(context, {
			annotationId: annotation.id,
			design: (await readDesign()).design,
		});
		expect(back.detached).toBe(false);
		expect(deriveDetached({ kind: "design", designId }, checkout())).toBe(
			false,
		);
	});

	it("re-anchors within the design, describing the new target", async () => {
		const annotation = await create({ target: layerTarget("price") });
		const { annotation: moved } = await reanchorAnnotation(context, {
			annotationId: annotation.id,
			by: agent,
			target: layerTarget("pay", "board-2"),
			design: await readDesign(),
		});
		expect(moved.target).toEqual(layerTarget("pay", "board-2"));
		expect(moved.snapshot).toMatchObject({
			layerName: "Pay button",
			ancestorNames: ["Payment"],
			stageMode: "responsive",
			branch: "main",
		});
		expect(moved.entries.at(-1)).toMatchObject({
			kind: "reanchor",
			from: layerTarget("price"),
			to: layerTarget("pay", "board-2"),
		});
		expect(moved.status).toBe("open");

		await designs.createDesignFile("design-2", checkout());
		const other = await designs.readDesignFile("design-2");
		await expect(
			reanchorAnnotation(context, {
				annotationId: annotation.id,
				by: human,
				target: { kind: "design", designId: "design-2" },
				design: { design: other.design, revision: other.revision },
			}),
		).rejects.toMatchObject({ code: "WRONG_CONTAINER" });
		await expect(
			reanchorAnnotation(context, {
				annotationId: annotation.id,
				by: human,
				target: layerTarget("missing"),
				design: await readDesign(),
			}),
		).rejects.toMatchObject({ code: "TARGET_NOT_FOUND" });
	});
});

describe("clear", () => {
	it("deletes resolved and dismissed annotations of the branch, per board", async () => {
		const resolved = await create();
		const dismissed = await create({ target: layerTarget("pay", "board-2") });
		const open = await create();
		const otherBranch = await create({ scope: feature });
		await transitionAnnotation(context, {
			annotationId: resolved.id,
			by: human,
			to: "resolved",
		});
		await transitionAnnotation(context, {
			annotationId: dismissed.id,
			by: human,
			to: "dismissed",
			reason: "No",
		});
		await transitionAnnotation(context, {
			annotationId: otherBranch.id,
			by: human,
			to: "resolved",
		});
		const container = { kind: "design", designId } as const;
		const design = (await readDesign()).design;

		const boardOnly = await clearAnnotations(context, {
			container,
			scope: main,
			boardId: "board-1",
			design,
		});
		expect(boardOnly.cleared).toEqual([resolved.id]);
		const rest = await clearAnnotations(context, {
			container,
			scope: main,
			design,
		});
		expect(rest.cleared).toEqual([dismissed.id]);

		const remaining = await listAnnotations(context, {
			container,
			scope: main,
			branch: "all",
		});
		expect(
			remaining.annotations.map((annotation) => annotation.id).sort(),
		).toEqual([open.id, otherBranch.id].sort());
	});
});

describe("change records", () => {
	it("records the change on each addressed annotation after the design write", async () => {
		const first = await create();
		const second = await create({ target: layerTarget("price") });
		const before = await readDesign();
		const { outcome, results } = await writeAddressing(
			[first.id, second.id],
			setClass("title", "text-2xl"),
		);
		expect(outcome.status).toBe("written");
		if (outcome.status !== "written") return;
		expect(results.map((result) => result.status)).toEqual([
			"recorded",
			"recorded",
		]);

		const addressed = await getAnnotation(context, { annotationId: first.id });
		expect(addressed.status).toBe("addressed");
		const entry = addressed.entries.at(-1);
		expect(entry).toMatchObject({
			kind: "change",
			by: agent,
			body: `Done for ${first.id}`,
			change: {
				revisionBefore: before.revision,
				revisionAfter: outcome.write.revision,
				boards: ["board-1"],
				layerIds: ["title"],
				operations: [{ operation: "updateElementProps", summary: "Edited" }],
				summary: "Edited the design",
			},
		});
		if (entry?.kind !== "change") throw new Error("expected a change entry");
		expect(Object.keys(entry.change.before?.layers ?? {})).toEqual(["title"]);
		expect(entry.change.before?.layers.title?.props.className).toBeUndefined();
	});

	it("records nothing when the design write is refused", async () => {
		const annotation = await create();
		const stale = (await readDesign()).revision;
		await designs.writeDesignFile(
			designId,
			setClass("title", "text-xl")(checkout()),
			{
				expectedRevision: stale,
			},
		);
		const { outcome, results } = await writeAddressing(
			[annotation.id],
			setClass("title", "text-2xl"),
			{ expectedRevision: stale },
		);
		expect(outcome.status).toBe("revision-mismatch");
		expect(results).toEqual([]);
		const unchanged = await getAnnotation(context, {
			annotationId: annotation.id,
		});
		expect(unchanged.status).toBe("open");
		expect(unchanged.entries).toHaveLength(1);
	});

	it("records the annotation write after the design write, under the design lock", async () => {
		const annotation = await create();
		const order: string[] = [];
		const read = await designs.readDesignFile(designId);
		const recorder = createAddressesRecorder(context, {
			designId,
			addresses: [{ annotationId: annotation.id }],
			by: agent,
			operations: [],
			summary: "x",
		});
		const outcome = await designs.updateDesignFile(designId, {
			expectedRevision: read.revision,
			mutate: async (current) => ({
				design: setClass("title", "a")(current.design),
			}),
			afterWrite: async (afterContext) => {
				order.push("after-write");
				// The design is already stored when the step runs.
				expect(
					findClass(
						(await designs.readDesignFileWithoutLock(designId)).design,
						"title",
					),
				).toBe("a");
				// Another writer waits for the lock until the step is done.
				const competing = designs
					.writeDesignFile(
						designId,
						setClass("title", "b")(afterContext.write.design),
					)
					.then(() => order.push("competing-write"));
				await recorder.afterWrite(afterContext);
				order.push("recorded");
				void competing;
			},
		});
		expect(outcome.status).toBe("written");
		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(order).toEqual(["after-write", "recorded", "competing-write"]);
	});

	it("validates addresses before a write: unknown, wrong design, closed", async () => {
		const live = await create();
		const closed = await create();
		await transitionAnnotation(context, {
			annotationId: closed.id,
			by: human,
			to: "resolved",
		});
		await designs.createDesignFile("design-2", checkout());
		const elsewhere = await createAnnotation(context, {
			target: { kind: "design", designId: "design-2" },
			body: "Other design",
			by: human,
			scope: main,
			design: {
				design: (await designs.readDesignFile("design-2")).design,
				revision: "r",
			},
		});
		const problems = await validateAddresses(context, {
			designId,
			addresses: [
				{ annotationId: live.id },
				{ annotationId: closed.id },
				{ annotationId: elsewhere.annotation.id },
				{ annotationId: "missing" },
			],
		});
		expect(
			problems.map(({ annotationId, code }) => ({ annotationId, code })),
		).toEqual([
			{ annotationId: closed.id, code: "ANNOTATION_CLOSED" },
			{ annotationId: elsewhere.annotation.id, code: "WRONG_DESIGN" },
			{ annotationId: "missing", code: "ANNOTATION_NOT_FOUND" },
		]);
	});

	it("records on an annotation closed meanwhile without revert state or a transition", async () => {
		const annotation = await create();
		await transitionAnnotation(context, {
			annotationId: annotation.id,
			by: human,
			to: "dismissed",
			reason: "No",
		});
		const change: AnnotationChangeRecord = {
			revisionBefore: "a",
			revisionAfter: "b",
			boards: [],
			layerIds: [],
			operations: [],
			summary: "s",
			before: { layers: {} },
			after: { layers: {} },
		};
		const [result] = await recordChange(context, {
			designId,
			addresses: [{ annotationId: annotation.id }, { annotationId: "missing" }],
			change,
			by: agent,
		});
		expect(result?.status).toBe("recorded");
		const after = await getAnnotation(context, { annotationId: annotation.id });
		expect(after.status).toBe("dismissed");
		const entry = after.entries.at(-1);
		expect(entry?.kind === "change" && entry.change.before).toBeFalsy();
	});

	it("reports a failed annotation write per annotation instead of throwing", async () => {
		const results = await recordChange(context, {
			designId,
			addresses: [{ annotationId: "missing" }],
			change: {
				revisionBefore: "a",
				revisionAfter: "b",
				boards: [],
				layerIds: [],
				operations: [],
				summary: "s",
			},
			by: agent,
		});
		expect(results).toEqual([
			expect.objectContaining({
				annotationId: "missing",
				status: "failed",
				code: "ANNOTATION_NOT_FOUND",
			}),
		]);
	});

	it.each([
		"resolved",
		"dismissed",
	] as const)("drops revert state when the annotation is %s", async (status) => {
		const annotation = await create();
		await writeAddressing([annotation.id], setClass("title", "text-2xl"));
		await transitionAnnotation(context, {
			annotationId: annotation.id,
			by: human,
			to: status,
			...(status === "dismissed" ? { reason: "No" } : {}),
		});
		const closed = await getAnnotation(context, {
			annotationId: annotation.id,
		});
		const entry = closed.entries.find(
			(candidate) => candidate.kind === "change",
		);
		if (entry?.kind !== "change") throw new Error("expected a change entry");
		expect(entry.change.before).toBeUndefined();
		expect(entry.change.after).toBeUndefined();
		expect(entry.change.layerIds).toEqual(["title"]);
		await expect(
			revertChange(context, {
				annotationId: annotation.id,
				entryId: entry.id,
				by: human,
				designService: designs,
			}),
		).rejects.toMatchObject({ code: "NOT_REVERTIBLE" });
	});
});

describe("revert", () => {
	const changeEntryId = async (annotationId: string) => {
		const annotation = await getAnnotation(context, { annotationId });
		const entry = annotation.entries.find(
			(candidate) => candidate.kind === "change",
		);
		if (!entry) throw new Error("expected a change entry");
		return entry.id;
	};

	it("restores the touched layers, keeps other edits, records the revert and reopens", async () => {
		const annotation = await create();
		await writeAddressing([annotation.id], setClass("title", "text-2xl"));
		// An unrelated later edit on the same board.
		const read = await designs.readDesignFile(designId);
		await designs.writeDesignFile(
			designId,
			setClass("price", "font-bold")(read.design),
			{
				expectedRevision: read.revision,
			},
		);

		tick();
		const entryId = await changeEntryId(annotation.id);
		const result = await revertChange(context, {
			annotationId: annotation.id,
			entryId,
			by: human,
			designService: designs,
		});
		const after = (await readDesign()).design;
		expect(findClass(after, "title")).toBeUndefined();
		expect(findClass(after, "price")).toBe("font-bold");
		expect(result.restoredLayerIds).toEqual(["title"]);
		expect(result.revision).toBe((await readDesign()).revision);

		const reverted = await getAnnotation(context, {
			annotationId: annotation.id,
		});
		expect(reverted.status).toBe("open");
		const revert = reverted.entries.at(-1);
		expect(revert).toMatchObject({
			kind: "revert",
			entryId,
			by: human,
			revisionAfter: result.revision,
		});
		const change = reverted.entries.find(
			(candidate) => candidate.id === entryId,
		);
		expect(change).toMatchObject({ revertedBy: revert?.id });
		expect(change?.kind === "change" && change.change.before).toBeFalsy();

		await expect(
			revertChange(context, {
				annotationId: annotation.id,
				entryId,
				by: human,
				designService: designs,
			}),
		).rejects.toMatchObject({ code: "NOT_REVERTIBLE" });
	});

	it("refuses with CHANGED_SINCE when a touched layer moved on", async () => {
		const annotation = await create();
		await writeAddressing([annotation.id], setClass("title", "text-2xl"));
		const read = await designs.readDesignFile(designId);
		await designs.writeDesignFile(
			designId,
			setClass("title", "text-3xl")(read.design),
			{
				expectedRevision: read.revision,
			},
		);
		await expect(
			revertChange(context, {
				annotationId: annotation.id,
				entryId: await changeEntryId(annotation.id),
				by: human,
				designService: designs,
			}),
		).rejects.toMatchObject({
			code: "CHANGED_SINCE",
			details: { layers: ["title"] },
		});
		expect(findClass((await readDesign()).design, "title")).toBe("text-3xl");
	});

	it("reverts a deletion by putting the subtree back where it was", async () => {
		const annotation = await create({ target: layerTarget("card") });
		await writeAddressing(
			[annotation.id],
			(design) => applyDeleteElement(design, { elementId: "card" }).design,
		);
		expect(findClass((await readDesign()).design, "card")).toBeUndefined();
		await revertChange(context, {
			annotationId: annotation.id,
			entryId: await changeEntryId(annotation.id),
			by: human,
			designService: designs,
		});
		expect((await readDesign()).design).toEqual(
			expect.objectContaining({ boards: checkout().boards }),
		);
	});

	it("refuses an entry that is not a change record", async () => {
		const annotation = await create();
		await expect(
			revertChange(context, {
				annotationId: annotation.id,
				entryId: annotation.entries[0]?.id ?? "",
				by: human,
				designService: designs,
			}),
		).rejects.toMatchObject({ code: "NOT_REVERTIBLE" });
	});
});

describe("delete warnings", () => {
	it("reports the live annotations on a deleted element and its descendants", async () => {
		const onCard = await create({ target: layerTarget("card") });
		const onPrice = await create({ target: layerTarget("price") });
		const resolved = await create({ target: layerTarget("price") });
		await transitionAnnotation(context, {
			annotationId: resolved.id,
			by: human,
			to: "resolved",
		});
		await create({ target: layerTarget("price"), scope: feature });
		const onBoard = await create({
			target: { kind: "board", designId, boardId: "board-2" },
		});

		const anchors = await getAnnotationAnchorIndex(context, {
			designId,
			scope: main,
		});
		const result = applyDeleteElement(
			checkout(),
			{ elementId: "card" },
			{ annotationAnchors: anchors },
		);
		expect(result.annotationWarnings).toEqual({
			elementId: "card",
			annotations: expect.arrayContaining([
				{ annotationId: onCard.id, anchorId: "card" },
				{ annotationId: onPrice.id, anchorId: "price" },
			]),
		});
		expect(result.annotationWarnings?.annotations).toHaveLength(2);

		const board = applyDeleteElement(
			checkout(),
			{ elementId: "board-2" },
			{ annotationAnchors: anchors },
		);
		expect(board.annotationWarnings?.annotations).toEqual([
			{ annotationId: onBoard.id, anchorId: "board-2" },
		]);
		expect(
			applyDeleteElement(
				checkout(),
				{ elementId: "header" },
				{ annotationAnchors: anchors },
			).annotationWarnings,
		).toBeUndefined();
		expect(
			applyDeleteElement(checkout(), { elementId: "card" }).annotationWarnings,
		).toBeUndefined();
	});

	it("indexes only live layer and board anchors", () => {
		const index = buildAnnotationAnchorIndex([]);
		expect(index.size).toBe(0);
	});
});

describe("memory references", () => {
	it("graduates each target kind to its reference", () => {
		expect(getAnnotationMemoryReference(layerTarget("title"))).toBe(
			`{{layer:${designId}/title}}`,
		);
		expect(
			getAnnotationMemoryReference({ kind: "board", designId, boardId: "b" }),
		).toBe(`{{board:${designId}/b}}`);
		expect(getAnnotationMemoryReference({ kind: "design", designId })).toBe(
			`{{design:${designId}}}`,
		);
		expect(
			getAnnotationMemoryReference({
				kind: "componentNode",
				systemId: "s",
				componentId: "c",
				nodePath: "0",
			}),
		).toBe("{{component:c}}");
	});
});

describe("attribution", () => {
	it("never takes `by` from anywhere but the call", async () => {
		const annotation = await create();
		const { annotation: replied } = await replyToAnnotation(context, {
			annotationId: annotation.id,
			by: otherAgent,
			body: "Hi",
		});
		expect(replied.entries.at(-1)?.by).toEqual(otherAgent);
		expect(replied.acknowledged?.sessionId).toBe("session-b");
	});
});
