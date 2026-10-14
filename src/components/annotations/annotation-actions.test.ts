// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AnnotationView } from "../../services/annotations.types";
import {
	annotationDraftStore,
	loadAnnotationDrafts,
	setAnnotationDraft,
	setReplyDraft,
} from "../../stores/annotation-draft-store";
import {
	editorAnnotationsStore,
	hydrateAnnotations,
	openAnnotationContainer,
	resetEditorAnnotations,
} from "../../stores/editor-annotations-store";
import {
	replyToAnnotation,
	sendAnnotationDraft,
	sendAnnotationDrafts,
} from "./annotation-actions";

const view = (id: string, revision = "r1"): AnnotationView => ({
	version: 1,
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
		pending.resolve(json({ annotation: view("a2"), written: true }));
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
			vi.fn(async () => json({ annotation: view("a2"), written: true })),
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

	it("Send all drafts sends each draft as it is when its turn comes", async () => {
		const layer = {
			kind: "layer" as const,
			designId: "D",
			boardId: "B",
			elementId: "L",
		};
		setAnnotationDraft(target, "design remark");
		setAnnotationDraft(layer, "layer remark");
		const listed = Object.values(drafts());
		const first = deferred<Response>();
		const bodies: string[] = [];
		let call = 0;
		vi.stubGlobal(
			"fetch",
			vi.fn(async (_url: string, init: RequestInit) => {
				bodies.push(JSON.parse(String(init.body)).body);
				call += 1;
				return call === 1
					? first.promise
					: json({ annotation: view(`a${call + 1}`), written: true });
			}),
		);
		const sending = sendAnnotationDrafts(listed);
		setAnnotationDraft(layer, "layer remark, edited");
		first.resolve(json({ annotation: view("a2"), written: true }));
		await sending;
		expect(bodies).toEqual(["design remark", "layer remark, edited"]);
		expect(Object.keys(drafts())).toEqual([]);
	});
});
