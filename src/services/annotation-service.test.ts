import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { holdForeignAnnotationLock } from "../test-utils/foreign-annotation-lock";
import type { Node, TrickroomDesign } from "../types";
import {
	ACKNOWLEDGEMENT_TTL_MS,
	type AnnotationServiceContext,
	acknowledgeAnnotation,
	buildAnnotationAnchorIndex,
	clearAnnotations,
	countAnnotations,
	countDesignAnnotations,
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
	summarizeAnnotationCounts,
	transitionAnnotation,
	validateAddresses,
} from "./annotation-service";
import {
	type AnnotationManyMutation,
	type AnnotationMutation,
	AnnotationStore,
} from "./annotation-store";
import type {
	Annotation,
	AnnotationActor,
	AnnotationChangeRecord,
	AnnotationContainer,
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
		recordContext = context,
	}: {
		by?: AnnotationActor;
		expectedRevision?: string;
		/** Records the change with another store (to pause it, say). */
		recordContext?: AnnotationServiceContext;
	} = {},
) => {
	const read = await designs.readDesignFile(designId);
	const recorder = createAddressesRecorder(recordContext, {
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

	it("drops an acknowledgement when the annotation moves to another branch", async () => {
		const annotation = await create({ scope: feature });
		await acknowledgeAnnotation(context, {
			annotationId: annotation.id,
			sessionId: "feature-session",
			branch: "feature",
		});
		tick();
		const { annotation: moved } = await moveAnnotationToBranch(context, {
			annotationId: annotation.id,
			by: human,
			scope: main,
		});
		expect(moved.status).toBe("open");
		expect(moved.acknowledged).toBeUndefined();
		expect(moved.transitions.at(-1)).toMatchObject({
			from: "acknowledged",
			to: "open",
			by: human,
		});

		// Another worktree of the same branch keeps it: its sessions can
		// still write it.
		const sameBranch = await create({ scope: main });
		await acknowledgeAnnotation(context, {
			annotationId: sameBranch.id,
			sessionId: "main-session",
			branch: "main",
		});
		const { annotation: kept } = await moveAnnotationToBranch(context, {
			annotationId: sameBranch.id,
			by: human,
			scope: { branch: "main", worktreePath: "/repo-other" },
		});
		expect(kept.status).toBe("acknowledged");
		expect(kept.acknowledged).toMatchObject({ sessionId: "main-session" });
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

	it("reverts a write that addressed several annotations on all of them", async () => {
		const title = await create();
		const card = await create({ target: layerTarget("card") });
		const closed = await create({ target: layerTarget("price") });
		await writeAddressing(
			[title.id, card.id, closed.id],
			setClass("title", "text-2xl"),
		);
		await transitionAnnotation(context, {
			annotationId: closed.id,
			by: human,
			to: "resolved",
		});

		tick();
		const result = await revertChange(context, {
			annotationId: title.id,
			entryId: await changeEntryId(title.id),
			by: human,
			designService: designs,
		});
		expect(findClass((await readDesign()).design, "title")).toBeUndefined();
		// Only live annotations hold revert state; the resolved one is left alone.
		expect(result.alsoReverted).toEqual([card.id]);

		const sibling = await getAnnotation(context, { annotationId: card.id });
		expect(sibling.status).toBe("open");
		const change = sibling.entries.find(
			(candidate) => candidate.kind === "change",
		);
		const revert = sibling.entries.at(-1);
		expect(revert).toMatchObject({
			kind: "revert",
			entryId: change?.id,
			by: human,
			revisionAfter: result.revision,
		});
		expect(change).toMatchObject({ revertedBy: revert?.id });
		expect(change?.kind === "change" && change.change.before).toBeFalsy();
		await expect(
			revertChange(context, {
				annotationId: card.id,
				entryId: change?.id ?? "",
				by: human,
				designService: designs,
			}),
		).rejects.toMatchObject({ code: "NOT_REVERTIBLE" });
		expect(
			(await getAnnotation(context, { annotationId: closed.id })).status,
		).toBe("resolved");
	});

	const revisionOf = async (annotationId: string) =>
		(await store.read({ kind: "design", designId }, annotationId))?.revision;

	it("refuses before the design changes when a sibling's lock is held", async () => {
		const title = await create();
		const card = await create({ target: layerTarget("card") });
		await writeAddressing([title.id, card.id], setClass("title", "text-2xl"));
		const titleRevision = await revisionOf(title.id);
		const cardRevision = await revisionOf(card.id);
		const designBefore = (await readDesign()).revision;

		// Another process holds the sibling's lockfile for the whole revert.
		const lockFile = await holdForeignAnnotationLock(
			path.join(root, "home"),
			store.getAnnotationPath({ kind: "design", designId }, card.id),
		);
		const impatient = new AnnotationStore({
			projectId: "project-1",
			trickroomHome: path.join(root, "home"),
			lock: { acquireTimeoutMs: 200, retryDelayMs: 20 },
		});
		try {
			await expect(
				revertChange(
					{ store: impatient, now: () => clock },
					{
						annotationId: title.id,
						entryId: await changeEntryId(title.id),
						by: human,
						designService: designs,
					},
				),
			).rejects.toMatchObject({
				code: "ANNOTATION_LOCKED",
				details: { annotationId: card.id },
			});
		} finally {
			await rm(lockFile, { force: true });
		}
		// Nothing changed: not the design, the source or the sibling.
		expect((await readDesign()).revision).toBe(designBefore);
		expect(findClass((await readDesign()).design, "title")).toBe("text-2xl");
		expect(await revisionOf(title.id)).toBe(titleRevision);
		expect(await revisionOf(card.id)).toBe(cardRevision);
	});

	it("refuses, naming it, when a sibling closes between planning and locking", async () => {
		const title = await create();
		const card = await create({ target: layerTarget("card") });
		await writeAddressing([title.id, card.id], setClass("title", "text-2xl"));
		const designBefore = (await readDesign()).revision;
		// The designer resolves the sibling just before the revert locks it.
		class Racing extends AnnotationStore {
			override async updateMany<Result>(
				container: AnnotationContainer,
				annotationIds: readonly string[],
				mutate: AnnotationManyMutation<Result>,
			) {
				await transitionAnnotation(context, {
					annotationId: card.id,
					by: human,
					to: "resolved",
				});
				return super.updateMany<Result>(container, annotationIds, mutate);
			}
		}
		const racing = new Racing({
			projectId: "project-1",
			trickroomHome: path.join(root, "home"),
		});
		await expect(
			revertChange(
				{ store: racing, now: () => clock },
				{
					annotationId: title.id,
					entryId: await changeEntryId(title.id),
					by: human,
					designService: designs,
				},
			),
		).rejects.toMatchObject({
			code: "NOT_REVERTIBLE",
			details: { annotationId: card.id },
		});
		expect((await readDesign()).revision).toBe(designBefore);
		expect(
			(await getAnnotation(context, { annotationId: title.id })).status,
		).toBe("addressed");
	});

	it("leaves a sibling on another branch alone, to its own checkout's content", async () => {
		const title = await create();
		const card = await create({ target: layerTarget("card") });
		await writeAddressing([title.id, card.id], setClass("title", "text-2xl"));
		// The feature worktree has its own copy of the design, with the write.
		const featureDesigns = createDesignFileService(
			path.join(root, "feature-project"),
			{ trickroomHome: path.join(root, "home") },
		);
		await mkdir(path.join(root, "feature-project", ".trickroom", "designs"), {
			recursive: true,
		});
		await featureDesigns.createDesignFile(
			designId,
			(await readDesign()).design,
		);
		await moveAnnotationToBranch(context, {
			annotationId: card.id,
			by: human,
			scope: feature,
		});
		const cardRevision = await revisionOf(card.id);

		const result = await revertChange(context, {
			annotationId: title.id,
			entryId: await changeEntryId(title.id),
			by: human,
			designService: designs,
			scope: main,
		});
		expect(result.alsoReverted).toEqual([]);
		expect(findClass((await readDesign()).design, "title")).toBeUndefined();
		expect(await revisionOf(card.id)).toBe(cardRevision);
		expect(
			(await getAnnotation(context, { annotationId: card.id })).status,
		).toBe("addressed");

		// The feature checkout still has the write: its own revert works there.
		const onFeature = await revertChange(context, {
			annotationId: card.id,
			entryId: await changeEntryId(card.id),
			by: human,
			designService: featureDesigns,
			scope: feature,
		});
		expect(onFeature.annotation.status).toBe("open");
		expect(
			findClass(
				(await featureDesigns.readDesignFile(designId)).design,
				"title",
			),
		).toBeUndefined();
	});

	it("refuses to revert another branch's annotation, with nothing written", async () => {
		const title = await create();
		await writeAddressing([title.id], setClass("title", "text-2xl"));
		await moveAnnotationToBranch(context, {
			annotationId: title.id,
			by: human,
			scope: feature,
		});
		const designBefore = (await readDesign()).revision;
		const revision = await revisionOf(title.id);
		await expect(
			revertChange(context, {
				annotationId: title.id,
				entryId: await changeEntryId(title.id),
				by: human,
				designService: designs,
				scope: main,
				...(revision ? { expectedRevision: revision } : {}),
			}),
		).rejects.toMatchObject({
			code: "WRONG_BRANCH",
			details: { annotationId: title.id, branch: "feature" },
		});
		expect((await readDesign()).revision).toBe(designBefore);
		expect(await revisionOf(title.id)).toBe(revision);
	});

	it("plans the shared set inside the design lock, after an in-flight recording", async () => {
		const title = await create();
		const card = await create({ target: layerTarget("card") });
		let cardReached = () => {};
		const reached = new Promise<void>((resolve) => {
			cardReached = resolve;
		});
		let releaseCard = () => {};
		const released = new Promise<void>((resolve) => {
			releaseCard = resolve;
		});
		// The agent's write records the title, then pauses before the card.
		class Pausing extends AnnotationStore {
			override async update<Result>(
				container: AnnotationContainer,
				annotationId: string,
				mutate: AnnotationMutation<Result>,
				options?: { expectedRevision?: string },
			) {
				if (annotationId === card.id) {
					cardReached();
					await released;
				}
				return super.update<Result>(container, annotationId, mutate, options);
			}
		}
		const writing = writeAddressing(
			[title.id, card.id],
			setClass("title", "text-2xl"),
			{
				recordContext: {
					store: new Pausing({
						projectId: "project-1",
						trickroomHome: path.join(root, "home"),
					}),
					now: () => clock,
				},
			},
		);
		await reached;
		const reverting = revertChange(context, {
			annotationId: title.id,
			entryId: await changeEntryId(title.id),
			by: human,
			designService: designs,
			scope: main,
		});
		// The revert waits for the design lock the recording holds.
		await new Promise((resolve) => setTimeout(resolve, 100));
		releaseCard();
		await writing;
		const result = await reverting;

		expect(result.alsoReverted).toEqual([card.id]);
		expect(findClass((await readDesign()).design, "title")).toBeUndefined();
		const sibling = await getAnnotation(context, { annotationId: card.id });
		expect(sibling.status).toBe("open");
		expect(sibling.entries.at(-1)).toMatchObject({ kind: "revert" });
	});

	it("plans again when a sibling moves into this branch while locking", async () => {
		const title = await create();
		const card = await create({
			target: layerTarget("card"),
			scope: feature,
		});
		await writeAddressing([title.id, card.id], setClass("title", "text-2xl"));
		let moved = false;
		// The designer moves the card here between planning and the locks.
		class Moving extends AnnotationStore {
			override async updateMany<Result>(
				container: AnnotationContainer,
				annotationIds: readonly string[],
				mutate: AnnotationManyMutation<Result>,
			) {
				if (!moved) {
					moved = true;
					await moveAnnotationToBranch(context, {
						annotationId: card.id,
						by: human,
						scope: main,
					});
				}
				return super.updateMany<Result>(container, annotationIds, mutate);
			}
		}
		const result = await revertChange(
			{
				store: new Moving({
					projectId: "project-1",
					trickroomHome: path.join(root, "home"),
				}),
				now: () => clock,
			},
			{
				annotationId: title.id,
				entryId: await changeEntryId(title.id),
				by: human,
				designService: designs,
				scope: main,
			},
		);
		expect(result.alsoReverted).toEqual([card.id]);
		expect(
			(await getAnnotation(context, { annotationId: card.id })).status,
		).toBe("open");
	});

	it("does not treat two identical writes as one", async () => {
		const first = await create();
		const second = await create({ target: layerTarget("card") });
		const original = (await readDesign()).design;
		await writeAddressing([first.id], setClass("title", "text-2xl"));
		// Back to the original, then the identical edit again for the other.
		const read = await designs.readDesignFile(designId);
		await designs.writeDesignFile(designId, original, {
			expectedRevision: read.revision,
		});
		await writeAddressing([second.id], setClass("title", "text-2xl"));
		const changeOf = async (annotationId: string) => {
			const entry = (
				await getAnnotation(context, { annotationId })
			).entries.find((candidate) => candidate.kind === "change");
			if (entry?.kind !== "change") throw new Error("expected a change entry");
			return entry.change;
		};
		const [one, two] = [await changeOf(first.id), await changeOf(second.id)];
		expect(two.revisionBefore).toBe(one.revisionBefore);
		expect(two.revisionAfter).toBe(one.revisionAfter);
		expect(two.writeId).not.toBe(one.writeId);
		const firstRevision = await revisionOf(first.id);

		const result = await revertChange(context, {
			annotationId: second.id,
			entryId: await changeEntryId(second.id),
			by: human,
			designService: designs,
		});
		expect(result.alsoReverted).toEqual([]);
		expect(await revisionOf(first.id)).toBe(firstRevision);
	});

	it("reverts only the source of a record without a write id (older files)", async () => {
		const title = await create();
		const card = await create({ target: layerTarget("card") });
		await writeAddressing([title.id, card.id], setClass("title", "text-2xl"));
		// As written before write ids existed.
		for (const id of [title.id, card.id]) {
			const file = store.getAnnotationPath({ kind: "design", designId }, id);
			const stored = JSON.parse(await readFile(file, "utf8")) as Annotation;
			for (const entry of stored.entries) {
				if (entry.kind === "change") delete entry.change.writeId;
			}
			await writeFile(file, JSON.stringify(stored), "utf8");
		}
		const cardRevision = await revisionOf(card.id);

		const result = await revertChange(context, {
			annotationId: title.id,
			entryId: await changeEntryId(title.id),
			by: human,
			designService: designs,
		});
		expect(result.alsoReverted).toEqual([]);
		expect(await revisionOf(card.id)).toBe(cardRevision);
		expect(
			(await getAnnotation(context, { annotationId: title.id })).status,
		).toBe("open");
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

describe("revert races", () => {
	const changeEntryId = async (annotationId: string) => {
		const annotation = await getAnnotation(context, { annotationId });
		const entry = annotation.entries.find(
			(candidate) => candidate.kind === "change",
		);
		if (!entry) throw new Error("expected a change entry");
		return entry.id;
	};

	/**
	 * A design service whose read (the revert's last step before writing)
	 * lets `race` run first: another writer acting between the revert's
	 * checks and its design write.
	 */
	const racingDesigns = (race: () => Promise<unknown>) => {
		const service = createDesignFileService(path.join(root, "project"), {
			trickroomHome: path.join(root, "home"),
		});
		const read = service.readDesignFile.bind(service);
		let raced = false;
		service.readDesignFile = async (id: string) => {
			const result = await read(id);
			if (!raced) {
				raced = true;
				await race();
			}
			return result;
		};
		return service;
	};

	it.each([
		[
			"resolved",
			(id: string) =>
				transitionAnnotation(context, {
					annotationId: id,
					by: human,
					to: "resolved",
				}),
			"NOT_REVERTIBLE",
		],
		[
			"dismissed",
			(id: string) =>
				transitionAnnotation(context, {
					annotationId: id,
					by: agent,
					to: "dismissed",
					reason: "No",
				}),
			"NOT_REVERTIBLE",
		],
		[
			"cleared",
			async (id: string) => {
				await transitionAnnotation(context, {
					annotationId: id,
					by: human,
					to: "resolved",
				});
				await clearAnnotations(context, {
					container: { kind: "design", designId },
					scope: main,
				});
			},
			"ANNOTATION_NOT_FOUND",
		],
	] as const)("refuses before touching the design when the annotation is %s meanwhile", async (_label, race, code) => {
		const annotation = await create();
		await writeAddressing([annotation.id], setClass("title", "text-2xl"));
		const entryId = await changeEntryId(annotation.id);
		const before = await readDesign();

		await expect(
			revertChange(context, {
				annotationId: annotation.id,
				entryId,
				by: human,
				designService: racingDesigns(() => race(annotation.id)),
			}),
		).rejects.toMatchObject({ code });

		const after = await readDesign();
		expect(after.revision).toBe(before.revision);
		expect(findClass(after.design, "title")).toBe("text-2xl");
	});

	it("refuses a stale expectedRevision before touching the design", async () => {
		const annotation = await create();
		await writeAddressing([annotation.id], setClass("title", "text-2xl"));
		const entryId = await changeEntryId(annotation.id);
		const seen = await getAnnotation(context, { annotationId: annotation.id });
		const before = await readDesign();

		// Changed between the editor's read and its revert, before the lock.
		await expect(
			revertChange(context, {
				annotationId: annotation.id,
				entryId,
				by: human,
				designService: racingDesigns(() =>
					replyToAnnotation(context, {
						annotationId: annotation.id,
						by: agent,
						body: "One more note",
					}),
				),
				expectedRevision: seen.revision,
			}),
		).rejects.toMatchObject({ code: "ANNOTATION_REVISION_MISMATCH" });
		expect((await readDesign()).revision).toBe(before.revision);

		// Stale from the start.
		await expect(
			revertChange(context, {
				annotationId: annotation.id,
				entryId,
				by: human,
				designService: designs,
				expectedRevision: seen.revision,
			}),
		).rejects.toMatchObject({ code: "ANNOTATION_REVISION_MISMATCH" });

		const current = await getAnnotation(context, {
			annotationId: annotation.id,
		});
		const result = await revertChange(context, {
			annotationId: annotation.id,
			entryId,
			by: human,
			designService: designs,
			expectedRevision: current.revision,
		});
		expect(result.annotation.entries.at(-1)?.kind).toBe("revert");
	});

	it("holds the annotation lock through both writes: a resolve waits for the revert", async () => {
		const annotation = await create();
		await writeAddressing([annotation.id], setClass("title", "text-2xl"));
		const entryId = await changeEntryId(annotation.id);
		const order: string[] = [];
		const service = createDesignFileService(path.join(root, "project"), {
			trickroomHome: path.join(root, "home"),
		});
		const update = service.updateDesignFile.bind(service);
		let resolving: Promise<unknown> | null = null;
		service.updateDesignFile = ((id, options) =>
			update(id, {
				...options,
				aroundStore: async (storeDesign) =>
					options.aroundStore?.(async () => {
						// Annotation lock held: a resolve now has to wait.
						resolving = transitionAnnotation(context, {
							annotationId: annotation.id,
							by: human,
							to: "resolved",
						}).then(() => order.push("resolved"));
						const written = await storeDesign();
						order.push("design written");
						return written;
					}),
			})) as typeof service.updateDesignFile;

		await revertChange(context, {
			annotationId: annotation.id,
			entryId,
			by: human,
			designService: service,
		});
		order.push("revert returned");
		await resolving;
		expect(order).toEqual(["design written", "revert returned", "resolved"]);
		const final = await getAnnotation(context, { annotationId: annotation.id });
		expect(final.status).toBe("resolved");
		expect(final.entries.map((entry) => entry.kind)).toEqual([
			"remark",
			"change",
			"revert",
		]);
	});

	it("reports a design reverted without its annotation record", async () => {
		const annotation = await create();
		await writeAddressing([annotation.id], setClass("title", "text-2xl"));
		const entryId = await changeEntryId(annotation.id);

		class FailingStore extends AnnotationStore {
			override updateMany<Result>(
				container: AnnotationContainer,
				annotationIds: readonly string[],
				mutate: AnnotationManyMutation<Result>,
			) {
				return super.updateMany<Result>(
					container,
					annotationIds,
					async (current) => {
						await mutate(current);
						throw new Error("disk full");
					},
				);
			}
		}
		const failing = new FailingStore({
			projectId: "project-1",
			trickroomHome: path.join(root, "home"),
		});
		const error = await revertChange(
			{ store: failing, now: () => clock },
			{
				annotationId: annotation.id,
				entryId,
				by: human,
				designService: designs,
			},
		).catch((caught: unknown) => caught);
		const design = await readDesign();
		expect(error).toMatchObject({
			code: "REVERT_NOT_RECORDED",
			details: { revision: design.revision, annotationId: annotation.id },
		});
		expect(findClass(design.design, "title")).toBeUndefined();
	});
});

describe("repeated resolves through the reply API", () => {
	it("an agent resolving a resolved annotation changes nothing, even after the human accepted", async () => {
		const annotation = await create();
		await replyToAnnotation(context, {
			annotationId: annotation.id,
			by: agent,
			resolve: { summary: "Done" },
		});
		tick();
		const { annotation: accepted } = await replyToAnnotation(context, {
			annotationId: annotation.id,
			by: human,
			resolve: {},
		});
		expect(accepted.resolvedBy).toEqual(human);
		expect(accepted.transitions.at(-1)).toMatchObject({
			from: "resolved",
			to: "resolved",
			by: human,
		});

		tick();
		const retry = await replyToAnnotation(context, {
			annotationId: annotation.id,
			by: agent,
			resolve: { summary: "Done again" },
		});
		expect(retry.written).toBe(false);
		expect(retry.annotation.resolvedBy).toEqual(human);
		expect(retry.annotation.revision).toBe(accepted.revision);
	});

	it("an agent resolving a human-resolved annotation changes nothing", async () => {
		const annotation = await create();
		await transitionAnnotation(context, {
			annotationId: annotation.id,
			by: human,
			to: "resolved",
		});
		const retry = await replyToAnnotation(context, {
			annotationId: annotation.id,
			by: agent,
			resolve: {},
		});
		expect(retry.written).toBe(false);
		expect(retry.annotation.resolvedBy).toEqual(human);
	});

	it("keeps the text of a repeated resolve or dismiss, without a transition", async () => {
		const resolved = await create();
		await transitionAnnotation(context, {
			annotationId: resolved.id,
			by: human,
			to: "resolved",
		});
		const { annotation: withReply, written } = await replyToAnnotation(
			context,
			{
				annotationId: resolved.id,
				by: agent,
				body: "Thanks",
				resolve: {},
			},
		);
		expect(written).toBe(true);
		expect(withReply.entries.at(-1)).toMatchObject({ kind: "reply" });
		expect(withReply.resolvedBy).toEqual(human);
		expect(withReply.transitions.at(-1)?.by).toEqual(human);

		const dismissed = await create();
		await transitionAnnotation(context, {
			annotationId: dismissed.id,
			by: human,
			to: "dismissed",
			reason: "No",
		});
		const repeat = await replyToAnnotation(context, {
			annotationId: dismissed.id,
			by: agent,
			dismiss: { reason: "Agreed" },
		});
		expect(repeat.written).toBe(false);
	});

	it("bulk resolve follows the same rule and honours expected revisions", async () => {
		const agentResolved = await create();
		const humanResolved = await create();
		const stale = await create();
		await transitionAnnotation(context, {
			annotationId: agentResolved.id,
			by: agent,
			to: "resolved",
		});
		await transitionAnnotation(context, {
			annotationId: humanResolved.id,
			by: human,
			to: "resolved",
		});
		const { resolved, skipped } = await resolveAnnotations(context, {
			container: { kind: "design", designId },
			by: agent,
			annotationIds: [agentResolved.id, humanResolved.id, stale.id],
			expectedRevisions: { [stale.id]: "sha256:old" },
		});
		expect(resolved).toEqual([]);
		expect(
			skipped.map(({ annotationId, code }) => ({ annotationId, code })),
		).toEqual([
			{ annotationId: agentResolved.id, code: "ALREADY_RESOLVED" },
			{ annotationId: humanResolved.id, code: "ALREADY_RESOLVED" },
			{ annotationId: stale.id, code: "ANNOTATION_REVISION_MISMATCH" },
		]);
	});
});

describe("clear with revisions", () => {
	it("skips an annotation changed since it was read", async () => {
		const annotation = await create();
		const { annotation: resolved } = await transitionAnnotation(context, {
			annotationId: annotation.id,
			by: human,
			to: "resolved",
		});
		await replyToAnnotation(context, {
			annotationId: annotation.id,
			by: agent,
			body: "One last thing to note",
		});
		const result = await clearAnnotations(context, {
			container: { kind: "design", designId },
			scope: main,
			expectedRevisions: { [annotation.id]: resolved.revision },
		});
		expect(result.cleared).toEqual([]);
		expect(result.skipped).toEqual([
			expect.objectContaining({
				annotationId: annotation.id,
				code: "ANNOTATION_REVISION_MISMATCH",
			}),
		]);
	});
});

describe("counts", () => {
	it("counts per design, reading a folder again only after it changed", async () => {
		let reads = 0;
		class Counting extends AnnotationStore {
			override async list(container: AnnotationContainer) {
				reads += 1;
				return super.list(container);
			}
		}
		const counting: AnnotationServiceContext = {
			store: new Counting({
				projectId: "project-1",
				trickroomHome: path.join(root, "home"),
			}),
			now: () => clock,
		};
		const first = await create();
		await create({ target: layerTarget("card") });

		expect(await countDesignAnnotations(counting, { scope: main })).toEqual(
			new Map([[designId, { agentWork: 2, humanWork: 0 }]]),
		);
		expect(reads).toBe(1);
		await countDesignAnnotations(counting, { scope: main });
		expect(reads).toBe(1);

		// Any write is seen at once, however soon after the last count.
		await replyToAnnotation(context, {
			annotationId: first.id,
			by: agent,
			question: "Which size?",
		});
		expect(await countDesignAnnotations(counting, { scope: main })).toEqual(
			new Map([[designId, { agentWork: 1, humanWork: 1 }]]),
		);
		expect(reads).toBe(2);
		// Another branch is counted on its own.
		expect(await countDesignAnnotations(counting, { scope: feature })).toEqual(
			new Map(),
		);
	});

	it("counts work by owner, status, board and layer on the current branch", async () => {
		const open = await create();
		const acknowledged = await create({ target: layerTarget("price") });
		const question = await create({ target: layerTarget("price") });
		const addressed = await create({ target: layerTarget("pay", "board-2") });
		const resolved = await create();
		await create({ target: { kind: "design", designId } });
		await create({ target: { kind: "board", designId, boardId: "board-2" } });
		await create({ scope: feature });
		await acknowledgeAnnotation(context, {
			annotationId: acknowledged.id,
			sessionId: "session-a",
		});
		await replyToAnnotation(context, {
			annotationId: question.id,
			by: agent,
			question: "?",
		});
		await writeAddressing([addressed.id], setClass("pay", "w-full"));
		await transitionAnnotation(context, {
			annotationId: resolved.id,
			by: human,
			to: "resolved",
		});
		void open;

		const counts = await countAnnotations(context, {
			container: { kind: "design", designId },
			scope: main,
			design: (await readDesign()).design,
		});
		expect(counts.total).toMatchObject({
			live: 6,
			agentWork: 4,
			humanWork: 2,
			detached: 0,
			byStatus: {
				open: 3,
				acknowledged: 1,
				needs_input: 1,
				addressed: 1,
				resolved: 1,
				dismissed: 0,
			},
		});
		expect(counts.design).toMatchObject({ live: 1, agentWork: 1 });
		expect(counts.boards["board-1"]).toMatchObject({
			live: 3,
			agentWork: 2,
			humanWork: 1,
		});
		expect(counts.boards["board-2"]).toMatchObject({
			live: 2,
			agentWork: 1,
			humanWork: 1,
		});
		expect(counts.layers.title).toMatchObject({
			live: 1,
			byStatus: expect.objectContaining({ resolved: 1 }),
		});
		expect(counts.layers.price).toMatchObject({
			live: 2,
			agentWork: 1,
			humanWork: 1,
		});

		const all = await countAnnotations(context, {
			container: { kind: "design", designId },
			scope: main,
			branch: "all",
		});
		expect(all.total.live).toBe(7);
	});

	it("counts detached live annotations against a design", async () => {
		const annotation = await create({ target: layerTarget("price") });
		const design = structuredClone((await readDesign()).design);
		((design.boards[0]?.children as Node[])[1] as Node).children = [];
		const summary = summarizeAnnotationCounts([annotation], design);
		expect(summary.total.detached).toBe(1);
		expect(summary.boards["board-1"]?.detached).toBe(1);
	});
});

describe("ids that name Object.prototype members", () => {
	const prototypeDesign = (): TrickroomDesign => ({
		name: "Prototype ids",
		boards: [
			node("constructor", "Board", [
				node("__proto__", "Proto layer", "Text"),
				node("toString", "Other layer"),
			]),
		],
	});

	it("counts a board `constructor` and a layer `__proto__`", async () => {
		await designs.createDesignFile("design-proto", prototypeDesign());
		const read = await designs.readDesignFile("design-proto");
		const design = { design: read.design, revision: read.revision };
		const make = (target: AnnotationTarget) =>
			createAnnotation(context, {
				target,
				body: "x",
				by: human,
				scope: main,
				design,
			});
		await make({
			kind: "board",
			designId: "design-proto",
			boardId: "constructor",
		});
		await make({
			kind: "layer",
			designId: "design-proto",
			boardId: "constructor",
			elementId: "__proto__",
		});
		await make({
			kind: "layer",
			designId: "design-proto",
			boardId: "constructor",
			elementId: "toString",
		});

		const counts = await countAnnotations(context, {
			container: { kind: "design", designId: "design-proto" },
			scope: main,
			design: read.design,
		});
		expect(counts.boards.constructor).toMatchObject({ live: 3, agentWork: 3 });
		expect(Object.keys(counts.boards)).toEqual(["constructor"]);
		expect(counts.layers.__proto__).toMatchObject({ live: 1 });
		expect(counts.layers.toString).toMatchObject({ live: 1 });
		expect(Object.keys(counts.layers).sort()).toEqual([
			"__proto__",
			"toString",
		]);

		// Without the design, too (boards come from the targets).
		const bare = await countAnnotations(context, {
			container: { kind: "design", designId: "design-proto" },
			scope: main,
		});
		const boardId: string = "constructor";
		expect(bare.boards[boardId]?.live).toBe(3);
	});

	it("does not take an inherited member for an expected revision", async () => {
		const created = await create();
		for (const id of ["constructor", "toString"]) {
			await store.create({
				...(await getAnnotation(context, { annotationId: created.id })),
				id,
			} as never);
		}
		const container = { kind: "design", designId } as const;
		const { resolved, skipped } = await resolveAnnotations(context, {
			container,
			by: human,
			annotationIds: ["constructor"],
			expectedRevisions: {},
		});
		expect(skipped).toEqual([]);
		expect(resolved.map((annotation) => annotation.id)).toEqual([
			"constructor",
		]);

		await transitionAnnotation(context, {
			annotationId: "toString",
			by: human,
			to: "resolved",
		});
		const { cleared } = await clearAnnotations(context, {
			container,
			scope: main,
			expectedRevisions: {},
		});
		expect(cleared.sort()).toEqual(["constructor", "toString"]);
	});
});

describe("WP3 options", () => {
	const changeRecord: AnnotationChangeRecord = {
		revisionBefore: "r-before",
		revisionAfter: "r-after",
		boards: ["board-1"],
		layerIds: ["title"],
		operations: [{ operation: "updateElementProps", summary: "Edited" }],
		summary: "Edited the design",
	};

	it("records a change without addressing when a designer remark is not among the known entries", async () => {
		const annotation = await create();
		const known = annotation.entries.map((entry) => entry.id);
		const { annotation: replied } = await replyToAnnotation(context, {
			annotationId: annotation.id,
			by: human,
			body: "Also make it red",
		});
		const remarkId = replied.entries.at(-1)?.id;
		const [result] = await recordChange(context, {
			designId,
			addresses: [
				{ annotationId: annotation.id, reply: "Larger", knownEntryIds: known },
			],
			change: changeRecord,
			by: agent,
		});
		expect(result).toMatchObject({
			status: "recorded",
			unseenRemarkIds: [remarkId],
		});
		const after = await getAnnotation(context, { annotationId: annotation.id });
		expect(after.status).toBe("open");
		expect(after.entries.map((entry) => entry.kind)).toEqual([
			"remark",
			"remark",
			"change",
		]);

		// With every remark known, or without knownEntryIds, it is addressed.
		const [again] = await recordChange(context, {
			designId,
			addresses: [
				{
					annotationId: annotation.id,
					knownEntryIds: after.entries.map((entry) => entry.id),
				},
			],
			change: changeRecord,
			by: agent,
		});
		expect(again).not.toHaveProperty("unseenRemarkIds");
		expect(
			(await getAnnotation(context, { annotationId: annotation.id })).status,
		).toBe("addressed");
	});

	it("acknowledges only on the given branch, and keeps another session's active acknowledgement", async () => {
		const annotation = await create();
		const elsewhere = await acknowledgeAnnotation(context, {
			annotationId: annotation.id,
			sessionId: "session-a",
			branch: "feature",
		});
		expect(elsewhere.written).toBe(false);
		expect(elsewhere.annotation.status).toBe("open");

		await acknowledgeAnnotation(context, {
			annotationId: annotation.id,
			sessionId: "session-a",
			branch: "main",
			keepActive: true,
		});
		await recordSessionCall(context, "session-a");
		const kept = await acknowledgeAnnotation(context, {
			annotationId: annotation.id,
			sessionId: "session-b",
			keepActive: true,
		});
		expect(kept.written).toBe(false);
		expect(kept.annotation.acknowledged?.sessionId).toBe("session-a");

		// Once session-a has gone quiet, session-b takes it over.
		tick(ACKNOWLEDGEMENT_TTL_MS + 1000);
		const taken = await acknowledgeAnnotation(context, {
			annotationId: annotation.id,
			sessionId: "session-b",
			keepActive: true,
		});
		expect(taken.written).toBe(true);
		expect(taken.annotation.acknowledged?.sessionId).toBe("session-b");
	});

	it("re-anchors and adds a reply in one write, or writes nothing for a blank body", async () => {
		const annotation = await create();
		await expect(
			reanchorAnnotation(context, {
				annotationId: annotation.id,
				by: agent,
				target: { kind: "board", designId, boardId: "board-1" },
				design: await readDesign(),
				body: "  ",
			}),
		).rejects.toMatchObject({ code: "INVALID_INPUT" });
		expect(
			(await getAnnotation(context, { annotationId: annotation.id })).target,
		).toEqual(annotation.target);

		const { annotation: moved } = await reanchorAnnotation(context, {
			annotationId: annotation.id,
			by: agent,
			target: { kind: "board", designId, boardId: "board-1" },
			design: await readDesign(),
			body: "Moved to the board.",
		});
		expect(moved.status).toBe("open");
		expect(moved.entries.map((entry) => entry.kind)).toEqual([
			"remark",
			"reanchor",
			"reply",
		]);
	});
});

describe("WP3 branch checks", () => {
	it("refuses addresses, change records and replies for another branch when asked", async () => {
		const annotation = await create({ scope: main });
		const problems = await validateAddresses(context, {
			designId,
			addresses: [{ annotationId: annotation.id }],
			branch: "feature",
		});
		expect(problems).toEqual([
			expect.objectContaining({
				annotationId: annotation.id,
				code: "WRONG_BRANCH",
				branch: "main",
			}),
		]);
		expect(
			await validateAddresses(context, {
				designId,
				addresses: [{ annotationId: annotation.id }],
				branch: "main",
			}),
		).toEqual([]);

		const [recorded] = await recordChange(context, {
			designId,
			addresses: [{ annotationId: annotation.id }],
			change: {
				revisionBefore: "a",
				revisionAfter: "b",
				boards: [],
				layerIds: [],
				operations: [],
				summary: "Edited",
			},
			by: agent,
			branch: "feature",
		});
		expect(recorded).toMatchObject({ status: "failed", code: "WRONG_BRANCH" });

		await expect(
			replyToAnnotation(context, {
				annotationId: annotation.id,
				by: agent,
				body: "On it",
				branch: "feature",
			}),
		).rejects.toMatchObject({ code: "WRONG_BRANCH" });
		await expect(
			reanchorAnnotation(context, {
				annotationId: annotation.id,
				by: agent,
				target: { kind: "board", designId, boardId: "board-1" },
				design: await readDesign(),
				branch: "feature",
			}),
		).rejects.toMatchObject({ code: "WRONG_BRANCH" });
		const after = await getAnnotation(context, { annotationId: annotation.id });
		expect(after.entries).toHaveLength(1);

		// Without branch, nothing changes for existing callers.
		const { written } = await replyToAnnotation(context, {
			annotationId: annotation.id,
			by: human,
			body: "Still here",
		});
		expect(written).toBe(true);
	});
});

describe("acknowledge onlyIf", () => {
	it("acknowledges only when the predicate holds on the stored annotation", async () => {
		const annotation = await create();
		const refused = await acknowledgeAnnotation(context, {
			annotationId: annotation.id,
			sessionId: "session-a",
			onlyIf: (stored) => stored.target.kind === "board",
		});
		expect(refused.written).toBe(false);
		expect(refused.annotation.status).toBe("open");
		const accepted = await acknowledgeAnnotation(context, {
			annotationId: annotation.id,
			sessionId: "session-a",
			onlyIf: (stored) => stored.status === "open",
		});
		expect(accepted.written).toBe(true);
		expect(accepted.annotation.status).toBe("acknowledged");
	});
});

describe("acknowledge previousStatus", () => {
	it("reports the status stored before the call", async () => {
		const annotation = await create();
		const first = await acknowledgeAnnotation(context, {
			annotationId: annotation.id,
			sessionId: "session-a",
		});
		expect(first).toMatchObject({ written: true, previousStatus: "open" });
		tick(ACKNOWLEDGEMENT_TTL_MS + 1000);
		const takeover = await acknowledgeAnnotation(context, {
			annotationId: annotation.id,
			sessionId: "session-b",
			keepActive: true,
		});
		expect(takeover).toMatchObject({
			written: true,
			previousStatus: "acknowledged",
		});
		expect(takeover.annotation.acknowledged?.sessionId).toBe("session-b");
	});
});
