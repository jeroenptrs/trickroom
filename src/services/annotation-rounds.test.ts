import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Node, TrickroomDesign } from "../types";
import { ROUND_PENDING_MS } from "./annotation-model";
import {
	closeRound,
	getOpenRound,
	type SendDraft,
	sendAnnotations,
	summarizeRound,
	viewRound,
} from "./annotation-rounds";
import {
	countAnnotations,
	createAnnotation,
	listAnnotations,
	replyToAnnotation,
	transitionAnnotation,
} from "./annotation-service";
import { AnnotationStore } from "./annotation-store";
import type {
	AnnotationActor,
	AnnotationContainer,
	AnnotationScope,
} from "./annotations.types";

const human: AnnotationActor = { role: "human" };
const agent: AnnotationActor = { role: "agent", sessionId: "session-a" };
const main: AnnotationScope = { branch: "main", worktreePath: "/repo" };
const feature: AnnotationScope = { branch: "feature", worktreePath: "/wt" };
const designId = "design-1";
const container: AnnotationContainer = { kind: "design", designId };

const text = (id: string, name: string, children: string): Node => ({
	id,
	props: {
		"data-trickroom-name": name,
		"data-trickroom-library": "trickroom",
		"data-trickroom-component": "text",
		"data-trickroom-role": "text",
	},
	children,
});

const design: TrickroomDesign = {
	name: "Checkout",
	boards: [
		{
			id: "board-1",
			props: {
				"data-trickroom-name": "Cart",
				"data-trickroom-library": "trickroom",
				"data-trickroom-component": "container",
			},
			children: [
				text("title", "Title", "Your cart"),
				text("price", "Price", "$10"),
				text("pay", "Pay", "Pay"),
			],
		},
	],
};

let root: string;
let clock: Date;
let store: AnnotationStore;
const context = () => ({ store, now: () => clock });

beforeEach(async () => {
	root = await mkdtemp(path.join(os.tmpdir(), "trickroom-rounds-"));
	clock = new Date("2026-10-15T10:00:00.000Z");
	store = new AnnotationStore({
		projectId: "project-1",
		trickroomHome: path.join(root, "home"),
	});
});

afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

const draft = (elementId: string, body = `Fix ${elementId}`): SendDraft => ({
	key: `layer:${designId}/${elementId}`,
	target: { kind: "layer", designId, boardId: "board-1", elementId },
	body,
	design: { design, revision: "r1" },
});

const send = (drafts: SendDraft[], scope = main) =>
	sendAnnotations(context(), { container, scope, by: human, drafts });

const landed = async (scope = main) =>
	(
		await listAnnotations(context(), { container, scope, landedOnly: true })
	).annotations.map((view) => view.id);

describe("sending", () => {
	it("opens a round, writes each annotation with its id, then lists them in one send", async () => {
		const result = await send([draft("title"), draft("price")]);
		expect(result.failed).toEqual([]);
		expect(result.annotations.map(({ key }) => key)).toEqual([
			`layer:${designId}/title`,
			`layer:${designId}/price`,
		]);
		const round = result.round;
		expect(round).toMatchObject({
			version: 1,
			projectId: "project-1",
			container,
			branch: "main",
			worktreePath: "/repo",
			status: "open",
			openedAt: clock.toISOString(),
		});
		const ids = result.annotations.map(({ annotation }) => annotation.id);
		expect(round?.annotationIds).toEqual(ids);
		expect(round?.sends).toEqual([
			{ id: expect.any(String), at: clock.toISOString(), annotationIds: ids },
		]);
		for (const { annotation } of result.annotations) {
			expect(annotation.roundId).toBe(round?.id);
			expect(annotation.status).toBe("open");
		}
		const file = store.getRoundPath(container, round?.id as string);
		expect(JSON.parse(await readFile(file, "utf8"))).toEqual(round);
		expect((await stat(file)).mode & 0o777).toBe(0o600);
		expect((await stat(path.dirname(file))).mode & 0o777).toBe(0o700);
		expect((await landed()).sort()).toEqual([...ids].sort());
	});

	it("adds later sends to the open round", async () => {
		const first = await send([draft("title")]);
		clock = new Date(clock.getTime() + 60_000);
		const second = await send([draft("price"), draft("pay")]);
		expect(second.round?.id).toBe(first.round?.id);
		expect(second.round?.annotationIds).toHaveLength(3);
		expect(
			second.round?.sends.map((entry) => entry.annotationIds.length),
		).toEqual([1, 2]);
		expect((await store.listRounds(container)).rounds).toHaveLength(1);
	});

	it("reports a draft that cannot be written and sends the others", async () => {
		const result = await send([draft("title"), draft("missing"), draft("pay")]);
		expect(result.annotations).toHaveLength(2);
		expect(result.failed).toEqual([
			{
				key: `layer:${designId}/missing`,
				code: expect.any(String),
				error: expect.any(String),
			},
		]);
		expect(result.round?.annotationIds).toHaveLength(2);
	});

	it("writes no round when nothing was sent", async () => {
		const result = await send([draft("missing")]);
		expect(result.round).toBeNull();
		expect((await store.listRounds(container)).rounds).toEqual([]);
	});

	it("refuses drafts of another container, an empty send and an agent", async () => {
		await expect(
			sendAnnotations(context(), {
				container: { kind: "design", designId: "other" },
				scope: main,
				by: human,
				drafts: [draft("title")],
			}),
		).rejects.toMatchObject({ code: "WRONG_CONTAINER" });
		await expect(send([])).rejects.toMatchObject({ code: "INVALID_INPUT" });
		await expect(
			sendAnnotations(context(), {
				container,
				scope: main,
				by: agent,
				drafts: [draft("title")],
			}),
		).rejects.toMatchObject({ code: "INVALID_INPUT" });
	});

	it("opens one round when two sends race", async () => {
		const results = await Promise.all(
			["title", "price", "pay"].map((id) => send([draft(id)])),
		);
		const roundIds = new Set(results.map((result) => result.round?.id));
		expect(roundIds.size).toBe(1);
		const { rounds } = await store.listRounds(container);
		expect(rounds).toHaveLength(1);
		expect(rounds[0]?.annotationIds).toHaveLength(3);
		expect(rounds[0]?.sends).toHaveLength(3);
	});

	it("keeps one open round per branch", async () => {
		const onMain = await send([draft("title")], main);
		const onFeature = await send([draft("price")], feature);
		expect(onFeature.round?.id).not.toBe(onMain.round?.id);
		expect(
			(await getOpenRound(context(), { container, scope: main }))?.id,
		).toBe(onMain.round?.id);
		expect(
			(await getOpenRound(context(), { container, scope: feature }))?.id,
		).toBe(onFeature.round?.id);
	});
});

describe("pending annotations", () => {
	it("hides an annotation its round does not list, until the round lists it or 30 s pass", async () => {
		const result = await send([draft("title")]);
		const round = result.round as NonNullable<typeof result.round>;
		const sent = result.annotations[0]?.annotation.id as string;
		// Written into the round and not yet listed: what an agent would see
		// between a send's annotation writes and its round append.
		const { annotation: unlisted } = await createAnnotation(context(), {
			...draft("price"),
			by: human,
			scope: main,
			roundId: round.id,
		});
		expect(await landed()).toEqual([sent]);
		// Without the filter (the editor's listing) it is there.
		expect(
			(await listAnnotations(context(), { container, scope: main }))
				.annotations,
		).toHaveLength(2);
		clock = new Date(clock.getTime() + ROUND_PENDING_MS);
		expect((await landed()).sort()).toEqual([sent, unlisted.id].sort());
	});

	it("lands an annotation whose round file is missing after 30 s", async () => {
		const result = await send([draft("title")]);
		const round = result.round as NonNullable<typeof result.round>;
		await rm(store.getRoundPath(container, round.id));
		expect(await landed()).toEqual([]);
		clock = new Date(clock.getTime() + ROUND_PENDING_MS);
		expect(await landed()).toHaveLength(1);
	});
});

describe("closing", () => {
	it("closes the round, keeps its annotations as they are, and a new send opens another", async () => {
		const result = await send([draft("title"), draft("price")]);
		const roundId = result.round?.id as string;
		clock = new Date(clock.getTime() + 1000);
		const closed = await closeRound(context(), {
			container,
			roundId,
			by: human,
			scope: main,
		});
		expect(closed).toMatchObject({
			written: true,
			round: {
				status: "closed",
				closedAt: clock.toISOString(),
				closedBy: human,
			},
		});
		expect(
			await getOpenRound(context(), { container, scope: main }),
		).toBeNull();
		const again = await closeRound(context(), {
			container,
			roundId,
			by: human,
			scope: main,
		});
		expect(again.written).toBe(false);
		expect(await landed()).toHaveLength(2);

		// A reply reopens the annotation, not the round.
		const first = result.annotations[0]?.annotation.id as string;
		await replyToAnnotation(context(), {
			annotationId: first,
			by: agent,
			question: "Which size?",
		});
		await replyToAnnotation(context(), {
			annotationId: first,
			by: human,
			body: "Larger",
		});
		expect(
			await getOpenRound(context(), { container, scope: main }),
		).toBeNull();

		const next = await send([draft("pay")]);
		expect(next.round?.id).not.toBe(roundId);
		expect(next.round?.annotationIds).toHaveLength(1);
	});

	it("is the designer's, on the round's own branch", async () => {
		const result = await send([draft("title")]);
		const roundId = result.round?.id as string;
		await expect(
			closeRound(context(), { container, roundId, by: agent, scope: main }),
		).rejects.toMatchObject({ code: "INVALID_INPUT" });
		await expect(
			closeRound(context(), { container, roundId, by: human, scope: feature }),
		).rejects.toMatchObject({ code: "WRONG_BRANCH" });
		await expect(
			closeRound(context(), {
				container,
				roundId: "nope",
				by: human,
				scope: main,
			}),
		).rejects.toMatchObject({ code: "ROUND_NOT_FOUND" });
	});
});

describe("round progress", () => {
	it("counts the round's annotations as they are now, cleared ones as closed", async () => {
		const result = await send([draft("title"), draft("price"), draft("pay")]);
		const [title, price, pay] = result.annotations.map(
			({ annotation }) => annotation.id,
		) as [string, string, string];
		await replyToAnnotation(context(), {
			annotationId: title,
			by: agent,
			propose: { summary: "Already the size you asked for." },
		});
		await transitionAnnotation(context(), {
			annotationId: price,
			by: human,
			to: "resolved",
		});
		const view = await viewRound(context(), result.round as never);
		expect(view.counts).toEqual({
			total: 3,
			closed: 1,
			agentWork: 1,
			humanWork: 1,
			byStatus: { proposed: 1, resolved: 1, open: 1 },
		});
		expect(
			summarizeRound({ annotationIds: [title, price, pay, "cleared"] }, [
				{ id: title, status: "proposed" },
			]).closed,
		).toBe(3);
	});
});

describe("proposing a resolution", () => {
	it("sets proposed with a proposal entry; the designer accepts or reopens it", async () => {
		const result = await send([draft("title"), draft("price")]);
		const [title, price] = result.annotations.map(
			({ annotation }) => annotation.id,
		) as [string, string];
		const proposed = await replyToAnnotation(context(), {
			annotationId: title,
			by: agent,
			body: "Checked it at 375 px.",
			propose: { summary: "It already wraps on two lines." },
		});
		expect(proposed.annotation.status).toBe("proposed");
		expect(proposed.annotation.entries.map((entry) => entry.kind)).toEqual([
			"remark",
			"reply",
			"proposal",
		]);
		expect(proposed.annotation.entries.at(-1)).toMatchObject({
			kind: "proposal",
			by: agent,
			summary: "It already wraps on two lines.",
		});
		const counts = await countAnnotations(context(), {
			container,
			scope: main,
		});
		expect(counts.total).toMatchObject({ agentWork: 1, humanWork: 1, live: 2 });

		const accepted = await transitionAnnotation(context(), {
			annotationId: title,
			by: human,
			to: "resolved",
		});
		expect(accepted.annotation).toMatchObject({
			status: "resolved",
			resolvedBy: human,
		});

		await replyToAnnotation(context(), {
			annotationId: price,
			by: agent,
			propose: { summary: "Out of scope for this board." },
		});
		const reopened = await replyToAnnotation(context(), {
			annotationId: price,
			by: human,
			body: "It is in scope, change it.",
		});
		expect(reopened.annotation.status).toBe("open");
	});

	it("is an agent's, exclusive with the other actions, and not on a closed annotation", async () => {
		const result = await send([draft("title")]);
		const id = result.annotations[0]?.annotation.id as string;
		await expect(
			replyToAnnotation(context(), {
				annotationId: id,
				by: human,
				propose: { summary: "x" },
			}),
		).rejects.toMatchObject({ code: "INVALID_INPUT" });
		await expect(
			replyToAnnotation(context(), {
				annotationId: id,
				by: agent,
				propose: { summary: "x" },
				question: "y",
			}),
		).rejects.toMatchObject({ code: "INVALID_INPUT" });
		await expect(
			replyToAnnotation(context(), {
				annotationId: id,
				by: agent,
				propose: { summary: " " },
			}),
		).rejects.toMatchObject({ code: "INVALID_INPUT" });
		await transitionAnnotation(context(), {
			annotationId: id,
			by: human,
			to: "dismissed",
			reason: "Not now",
		});
		await expect(
			replyToAnnotation(context(), {
				annotationId: id,
				by: agent,
				propose: { summary: "x" },
			}),
		).rejects.toMatchObject({ code: "ALREADY_CLOSED" });
	});

	it("keeps proposed when proposed again, with the new entry", async () => {
		const result = await send([draft("title")]);
		const id = result.annotations[0]?.annotation.id as string;
		await replyToAnnotation(context(), {
			annotationId: id,
			by: agent,
			propose: { summary: "One" },
		});
		const again = await replyToAnnotation(context(), {
			annotationId: id,
			by: agent,
			propose: { summary: "Two" },
		});
		expect(again.annotation.status).toBe("proposed");
		expect(
			again.annotation.transitions.filter((entry) => entry.to === "proposed"),
		).toHaveLength(1);
	});
});

describe("round files", () => {
	it("lists a newer or broken round file as a problem and leaves it alone", async () => {
		const result = await send([draft("title")]);
		const directory = store.getRoundDirectory(container);
		const future = `${JSON.stringify({ ...result.round, id: "future", version: 2 })}\n`;
		await writeFile(path.join(directory, "future.json"), future);
		await writeFile(path.join(directory, "broken.json"), "{");
		const { rounds, problems } = await store.listRounds(container);
		expect(rounds.map((round) => round.id)).toEqual([result.round?.id]);
		expect(problems).toEqual([
			{
				roundId: "broken",
				code: "INVALID_ROUND_FILE",
				message: expect.any(String),
			},
			{
				roundId: "future",
				code: "UNSUPPORTED_ROUND_VERSION",
				message: expect.stringContaining("version 2"),
			},
		]);
		expect(await readFile(path.join(directory, "future.json"), "utf8")).toBe(
			future,
		);
	});
});
