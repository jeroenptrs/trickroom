// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenRound } from "../../queries/annotations";
import type { AnnotationView } from "../../services/annotations.types";
import {
	annotationDraftStore,
	loadAnnotationDrafts,
	setAnnotationDraft,
	setReplyDraft,
} from "../../stores/annotation-draft-store";
import {
	applyOpenRound,
	beginRoundRead,
	editorAnnotationsStore,
	hydrateAnnotations,
	openAnnotationContainer,
	resetEditorAnnotations,
} from "../../stores/editor-annotations-store";
import {
	closeOpenRound,
	replyToAnnotation,
	sendAnnotationDraft,
	sendAnnotationDrafts,
} from "./annotation-actions";

const view = (id: string, revision = "r1"): AnnotationView => ({
	version: 2,
	id,
	projectId: "p1",
	target: { kind: "design", designId: "D" },
	branch: "main",
	worktreePath: "/work",
	snapshot: { branch: "main", worktreePath: "/work" },
	status: "open",
	createdAt: "2026-10-14T10:00:00.000Z",
	updatedAt: "2026-10-14T10:00:00.000Z",
	entries: [],
	transitions: [],
	revision,
});

const json = (body: unknown) =>
	new Response(JSON.stringify(body), {
		status: 200,
		headers: { "content-type": "application/json" },
	});

const scope = { branch: "main", worktreePath: "/work" };

const round = (id = "R1", annotationIds: string[] = []): OpenRound => ({
	version: 1,
	id,
	projectId: "p1",
	container: { kind: "design", designId: "D" },
	branch: "main",
	worktreePath: "/work",
	status: "open",
	openedAt: "2026-10-15T10:00:00.000Z",
	annotationIds,
	sends: [],
	counts: {
		total: annotationIds.length,
		closed: 0,
		agentWork: annotationIds.length,
		humanWork: 0,
		byStatus: { open: annotationIds.length },
	},
});

/** What `POST /send` answers: each key written as the given annotation. */
const sendAnswer = (
	written: Record<string, AnnotationView>,
	extra: {
		failed?: { key: string; code: string; error: string }[];
		round?: OpenRound | null;
		interrupted?: {
			code: string;
			error: string;
			details?: Record<string, unknown>;
		} | null;
	} = {},
) =>
	json({
		scope,
		round:
			extra.round === undefined
				? round(
						"R1",
						Object.values(written).map((entry) => entry.id),
					)
				: extra.round,
		annotations: Object.entries(written).map(([key, annotation]) => ({
			key,
			annotation,
		})),
		failed: extra.failed ?? [],
		interrupted: extra.interrupted ?? null,
	});

const deferred = <T>() => {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((settle) => {
		resolve = settle;
	});
	return { promise, resolve };
};

const target = { kind: "design" as const, designId: "D" };
const drafts = () => annotationDraftStore.get().drafts;

beforeEach(() => {
	window.sessionStorage.clear();
	loadAnnotationDrafts(null);
	loadAnnotationDrafts("project-a");
	resetEditorAnnotations();
	openAnnotationContainer({ kind: "design", designId: "D" });
	hydrateAnnotations(
		{ kind: "design", designId: "D" },
		{ branch: "main", worktreePath: "/work" },
		[view("a1")],
	);
});

afterEach(() => {
	vi.unstubAllGlobals();
});

// Review round 1: the composers stay editable while a write is in flight.
describe("Send and Reply clear only what they sent", () => {
	it("keeps text typed while Send was in flight", async () => {
		setAnnotationDraft(target, "first text");
		const draft = Object.values(drafts())[0];
		if (!draft) throw new Error("no draft");
		const pending = deferred<Response>();
		vi.stubGlobal(
			"fetch",
			vi.fn(() => pending.promise),
		);
		const sending = sendAnnotationDraft(draft);
		setAnnotationDraft(target, "new unsent text");
		pending.resolve(sendAnswer({ [draft.key]: view("a2") }));
		await sending;
		expect(drafts()[draft.key]?.body).toBe("new unsent text");
		expect(editorAnnotationsStore.get().byId.a2).toBeDefined();
	});

	it("clears the draft when nothing was typed meanwhile", async () => {
		setAnnotationDraft(target, "first text");
		const draft = Object.values(drafts())[0];
		if (!draft) throw new Error("no draft");
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => sendAnswer({ [draft.key]: view("a2") })),
		);
		await sendAnnotationDraft(draft);
		expect(drafts()[draft.key]).toBeUndefined();
	});

	it("keeps the draft when Send fails", async () => {
		setAnnotationDraft(target, "first text");
		const draft = Object.values(drafts())[0];
		if (!draft) throw new Error("no draft");
		vi.stubGlobal(
			"fetch",
			vi.fn(
				async () =>
					new Response(JSON.stringify({ error: "nope", code: "X" }), {
						status: 500,
					}),
			),
		);
		await sendAnnotationDraft(draft);
		expect(drafts()[draft.key]?.body).toBe("first text");
	});

	it("keeps a reply typed while Reply was in flight", async () => {
		setReplyDraft("a1", "first reply");
		const pending = deferred<Response>();
		vi.stubGlobal(
			"fetch",
			vi.fn(() => pending.promise),
		);
		const sending = replyToAnnotation(view("a1"), "first reply");
		setReplyDraft("a1", "new unsent reply");
		pending.resolve(json({ annotation: view("a1", "r2"), written: true }));
		await sending;
		expect(annotationDraftStore.get().replies.a1).toBe("new unsent reply");
	});

	it("Send all drafts is one request, with each draft as it is when it goes out", async () => {
		const layer = {
			kind: "layer" as const,
			designId: "D",
			boardId: "B",
			elementId: "L",
		};
		setAnnotationDraft(target, "design remark");
		setAnnotationDraft(layer, "layer remark");
		const listed = Object.values(drafts());
		const requests: { url: string; body: Record<string, unknown> }[] = [];
		vi.stubGlobal(
			"fetch",
			vi.fn(async (url: string, init: RequestInit) => {
				const body = JSON.parse(String(init.body));
				requests.push({ url, body });
				return sendAnswer(
					Object.fromEntries(
						(body.drafts as { key: string }[]).map((entry, index) => [
							entry.key,
							view(`a${index + 2}`),
						]),
					),
				);
			}),
		);
		const sending = sendAnnotationDrafts(listed, { stageMode: "responsive" });
		setAnnotationDraft(layer, "layer remark, edited");
		expect(await sending).toBe(2);
		expect(requests).toHaveLength(1);
		expect(requests[0]?.url).toBe("/api/trickroom/annotations/send");
		expect(requests[0]?.body.designId).toBe("D");
		// The request is built when Send starts: the edit made after is kept.
		expect(
			(requests[0]?.body.drafts as { body: string }[]).map((d) => d.body),
		).toEqual(["design remark", "layer remark"]);
		expect(
			(requests[0]?.body.drafts as { snapshot: unknown }[])[0]?.snapshot,
		).toEqual({ stageMode: "responsive" });
		expect(drafts()["layer:D/L"]?.body).toBe("layer remark, edited");
		expect(Object.keys(editorAnnotationsStore.get().byId).sort()).toEqual([
			"a1",
			"a2",
			"a3",
		]);
	});
});

describe("Send reports what the server did not write", () => {
	const layer = {
		kind: "layer" as const,
		designId: "D",
		boardId: "B",
		elementId: "L",
	};

	it("keeps the drafts the answer does not list and counts them", async () => {
		setAnnotationDraft(target, "design remark");
		setAnnotationDraft(layer, "layer remark");
		const listed = Object.values(drafts());
		const designKey = listed[0]?.key ?? "";
		const layerKey = listed[1]?.key ?? "";
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				sendAnswer(
					{ [designKey]: view("a2") },
					{
						failed: [
							{
								key: layerKey,
								code: "TARGET_NOT_FOUND",
								error: "Layer is gone",
							},
						],
					},
				),
			),
		);
		expect(await sendAnnotationDrafts(listed)).toBe(1);
		expect(drafts()[designKey]).toBeUndefined();
		expect(drafts()[layerKey]?.body).toBe("layer remark");
	});

	it("shows the round the answer carries, counted from the annotations held", async () => {
		setAnnotationDraft(target, "design remark");
		const draft = Object.values(drafts())[0];
		if (!draft) throw new Error("no draft");
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				sendAnswer({ [draft.key]: view("a2") }, { round: round("R1", ["a2"]) }),
			),
		);
		await sendAnnotationDraft(draft);
		expect(editorAnnotationsStore.get().round?.id).toBe("R1");
	});

	it("leaves the drafts of another design where they are", async () => {
		setAnnotationDraft(target, "design remark");
		const other = {
			kind: "layer" as const,
			designId: "E",
			boardId: "B",
			elementId: "L",
		};
		setAnnotationDraft(other, "other design remark");
		const bodies: string[] = [];
		vi.stubGlobal(
			"fetch",
			vi.fn(async (_url: string, init: RequestInit) => {
				const sent = JSON.parse(String(init.body)).drafts as {
					key: string;
					body: string;
				}[];
				bodies.push(...sent.map((entry) => entry.body));
				return sendAnswer({ [sent[0]?.key ?? ""]: view("a2") });
			}),
		);
		expect(await sendAnnotationDrafts(Object.values(drafts()))).toBe(1);
		expect(bodies).toEqual(["design remark"]);
		expect(drafts()["layer:E/L"]?.body).toBe("other design remark");
	});
});

// Review round 2: a batch belongs to the project and design it started in.
describe("Send all drafts stays in its project and design", () => {
	const layer = {
		kind: "layer" as const,
		designId: "D",
		boardId: "B",
		elementId: "L",
	};

	const holdAnswer = () => {
		const held = deferred<Response>();
		vi.stubGlobal(
			"fetch",
			vi.fn(() => held.promise),
		);
		return held;
	};

	it("clears the sent drafts in their own project when the tab moved on", async () => {
		setAnnotationDraft(target, "A design draft");
		setAnnotationDraft(layer, "A layer draft");
		const listed = Object.values(drafts());
		const held = holdAnswer();
		const sending = sendAnnotationDrafts(listed);
		loadAnnotationDrafts("project-b");
		setAnnotationDraft(layer, "B unsent layer draft");
		held.resolve(
			sendAnswer(
				Object.fromEntries(listed.map((d, i) => [d.key, view(`a${i + 2}`)])),
			),
		);
		expect(await sending).toBe(2);
		expect(drafts()["layer:D/L"]?.body).toBe("B unsent layer draft");
		// Project a's drafts went out with the request.
		loadAnnotationDrafts("project-a");
		expect(drafts()["layer:D/L"]).toBeUndefined();
	});

	it("does not show the answer in another design", async () => {
		setAnnotationDraft(target, "design remark");
		const listed = Object.values(drafts());
		const held = holdAnswer();
		const sending = sendAnnotationDrafts(listed);
		openAnnotationContainer({ kind: "design", designId: "E" });
		held.resolve(
			sendAnswer(Object.fromEntries(listed.map((d) => [d.key, view("a2")]))),
		);
		await sending;
		expect(editorAnnotationsStore.get().byId.a2).toBeUndefined();
		expect(editorAnnotationsStore.get().round).toBeNull();
		expect(drafts()[listed[0]?.key ?? ""]).toBeUndefined();
	});
});

describe("Close round", () => {
	it("posts the close and drops the round", async () => {
		hydrateAnnotations({ kind: "design", designId: "D" }, scope, [view("a1")]);
		applyOpenRound(
			beginRoundRead(),
			{ kind: "design", designId: "D" },
			scope,
			round("R1", ["a1"]),
		);
		const fetchMock = vi.fn(async (_url: string) =>
			json({
				round: { ...round("R1", ["a1"]), status: "closed" },
				written: true,
			}),
		);
		vi.stubGlobal("fetch", fetchMock);
		await closeOpenRound({ kind: "design", designId: "D" }, round("R1"));
		expect(fetchMock.mock.calls[0]?.[0]).toBe(
			"/api/trickroom/annotations/rounds/R1/close",
		);
		expect(editorAnnotationsStore.get().round).toBeNull();
	});

	it("keeps the round when the close fails", async () => {
		applyOpenRound(
			beginRoundRead(),
			{ kind: "design", designId: "D" },
			scope,
			round("R1", ["a1"]),
		);
		vi.stubGlobal(
			"fetch",
			vi.fn(
				async () =>
					new Response(JSON.stringify({ error: "nope", code: "X" }), {
						status: 500,
					}),
			),
		);
		await closeOpenRound({ kind: "design", designId: "D" }, round("R1"));
		expect(editorAnnotationsStore.get().round?.id).toBe("R1");
	});
});

// PR #36 review round 1: a send the checkout change cut short.
describe("Send interrupted by a checkout change", () => {
	it("drops the drafts it wrote and keeps the rest", async () => {
		const layer = {
			kind: "layer" as const,
			designId: "D",
			boardId: "B",
			elementId: "L",
		};
		setAnnotationDraft(target, "written before the checkout");
		setAnnotationDraft(layer, "not tried");
		const listed = Object.values(drafts());
		const writtenKey = listed[0]?.key ?? "";
		const keptKey = listed[1]?.key ?? "";
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				sendAnswer(
					{ [writtenKey]: view("a2") },
					{
						failed: [{ key: keptKey, code: "SCOPE_CHANGED", error: "Changed" }],
						interrupted: {
							code: "SCOPE_CHANGED",
							error: "Changed",
							details: {
								scope: { branch: "feature", worktreePath: "/work" },
							},
						},
					},
				),
			),
		);
		expect(await sendAnnotationDrafts(listed)).toBe(1);
		// A retry on the original branch cannot send the written one twice.
		expect(drafts()[writtenKey]).toBeUndefined();
		expect(drafts()[keptKey]?.body).toBe("not tried");
	});
});

// PR #36 review round 1: answers that arrive out of order.
describe("Round answers in reverse order", () => {
	const container = { kind: "design" as const, designId: "D" };

	/** Holds each request's answer until the test releases it. */
	const holdByUrl = () => {
		const close = deferred<Response>();
		const send = deferred<Response>();
		vi.stubGlobal(
			"fetch",
			vi.fn((url: string) =>
				url.endsWith("/close") ? close.promise : send.promise,
			),
		);
		return { close, send };
	};

	it("does not clear the next round when a close answers late", async () => {
		applyOpenRound(beginRoundRead(), container, scope, round("R1", ["a1"]));
		const held = holdByUrl();
		const closing = closeOpenRound(container, round("R1"));
		setAnnotationDraft(target, "next round");
		const draft = Object.values(drafts())[0];
		if (!draft) throw new Error("no draft");
		const sending = sendAnnotationDraft(draft);
		held.send.resolve(
			sendAnswer({ [draft.key]: view("a2") }, { round: round("R2", ["a2"]) }),
		);
		await sending;
		// The event for R2 arrives too.
		applyOpenRound(beginRoundRead(), container, scope, round("R2", ["a2"]));
		held.close.resolve(
			json({
				round: { ...round("R1", ["a1"]), status: "closed" },
				written: true,
			}),
		);
		await closing;
		expect(editorAnnotationsStore.get().round?.id).toBe("R2");
	});

	it("does not bring back a closed round when a send answers late", async () => {
		applyOpenRound(beginRoundRead(), container, scope, round("R1", ["a1"]));
		const held = holdByUrl();
		setAnnotationDraft(target, "into R1");
		const draft = Object.values(drafts())[0];
		if (!draft) throw new Error("no draft");
		const sending = sendAnnotationDraft(draft);
		// Meanwhile the designer closed R1 in another tab: the event's read.
		applyOpenRound(beginRoundRead(), container, scope, null);
		held.send.resolve(
			sendAnswer(
				{ [draft.key]: view("a2") },
				{ round: round("R1", ["a1", "a2"]) },
			),
		);
		await sending;
		expect(editorAnnotationsStore.get().round).toBeNull();
	});
});
