// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenRound } from "../../queries/annotations";
import type {
	AnnotationStatus,
	AnnotationView,
} from "../../services/annotations.types";
import {
	annotationDraftStore,
	loadAnnotationDrafts,
	setAnnotationDraft,
} from "../../stores/annotation-draft-store";
import {
	applyOpenRound,
	beginRoundRead,
	editorAnnotationsStore,
	hydrateAnnotations,
	openAnnotationContainer,
	requestCloseRound,
	resetEditorAnnotations,
} from "../../stores/editor-annotations-store";
import { AnnotationEntries } from "./AnnotationEntries";
import { AnnotationRoundHeader } from "./AnnotationRoundHeader";

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const container = { kind: "design" as const, designId: "D" };
const scope = { branch: "main", worktreePath: "/work" };

const view = (id: string, status: AnnotationStatus): AnnotationView => ({
	version: 2,
	id,
	projectId: "p1",
	target: { kind: "design", designId: "D" },
	branch: "main",
	worktreePath: "/work",
	snapshot: { branch: "main", worktreePath: "/work" },
	status,
	createdAt: "2026-10-14T10:00:00.000Z",
	updatedAt: "2026-10-14T10:00:00.000Z",
	entries: [],
	transitions: [],
	revision: "r1",
});

const round = (annotationIds: string[]): OpenRound => ({
	version: 1,
	id: "R1",
	projectId: "p1",
	container,
	branch: "main",
	worktreePath: "/work",
	status: "open",
	openedAt: "2026-10-15T10:00:00.000Z",
	annotationIds,
	sends: [],
	counts: {
		total: annotationIds.length,
		closed: 0,
		agentWork: 0,
		humanWork: 0,
		byStatus: {},
	},
});

const open = (annotations: AnnotationView[]) => {
	openAnnotationContainer(container);
	hydrateAnnotations(container, scope, annotations);
	applyOpenRound(
		beginRoundRead(),
		container,
		scope,
		round(annotations.map((annotation) => annotation.id)),
	);
};

let host: HTMLElement;
let root: Root;

const render = async (drafts = annotationDraftStore.get().drafts) => {
	await act(async () => {
		root.render(
			<AnnotationRoundHeader
				container={container}
				drafts={Object.values(drafts)}
				getSnapshot={() => ({})}
			/>,
		);
	});
};

const button = (label: string) =>
	[...document.querySelectorAll("button")].find((entry) =>
		entry.textContent?.startsWith(label),
	);

const json = (body: unknown) =>
	new Response(JSON.stringify(body), {
		status: 200,
		headers: { "content-type": "application/json" },
	});

beforeEach(() => {
	window.sessionStorage.clear();
	loadAnnotationDrafts(null);
	loadAnnotationDrafts("project-a");
	resetEditorAnnotations();
	host = document.createElement("div");
	document.body.append(host);
	root = createRoot(host);
});

afterEach(() => {
	act(() => root.unmount());
	host.remove();
	vi.unstubAllGlobals();
});

describe("AnnotationRoundHeader", () => {
	it("shows nothing without a round and without drafts", async () => {
		await render();
		expect(host.textContent).toBe("");
	});

	it("shows Send round alone when drafts wait and no round is open", async () => {
		openAnnotationContainer(container);
		setAnnotationDraft({ kind: "design", designId: "D" }, "a remark");
		await render();
		expect(button("Send round")).toBeDefined();
		expect(button("Close round")).toBeUndefined();
		expect(host.textContent).not.toContain("Round ·");
	});

	it("shows progress, and counts proposed ones as waiting on the designer", async () => {
		open([view("a", "resolved"), view("b", "proposed"), view("c", "open")]);
		await render();
		expect(host.textContent).toContain(
			"Round · 1 of 3 closed · 1 waiting on you",
		);
		expect(button("Send round")?.disabled).toBe(true);
		expect(button("Accept all proposed (1)")).toBeDefined();
		expect(button("Close round")).toBeDefined();
	});

	it("leaves Accept all proposed out when nothing is proposed", async () => {
		open([view("a", "open")]);
		await render();
		expect(button("Accept all proposed")).toBeUndefined();
	});

	it("asks before closing a round with annotations left, and closes on confirm", async () => {
		open([view("a", "resolved"), view("b", "open"), view("c", "open")]);
		const fetchMock = vi.fn(async () =>
			json({ round: { ...round([]), status: "closed" }, written: true }),
		);
		vi.stubGlobal("fetch", fetchMock);
		await render();
		await act(async () => button("Close round")?.click());
		expect(document.body.textContent).toContain(
			"2 annotations stay open. Close the round?",
		);
		expect(fetchMock).not.toHaveBeenCalled();
		const confirm = [...document.querySelectorAll("button")]
			.filter((entry) => entry.textContent === "Close round")
			.at(-1);
		await act(async () => confirm?.click());
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(editorAnnotationsStore.get().round).toBeNull();
	});

	it("closes at once when every annotation is closed", async () => {
		open([view("a", "resolved")]);
		const fetchMock = vi.fn(async () =>
			json({ round: { ...round([]), status: "closed" }, written: true }),
		);
		vi.stubGlobal("fetch", fetchMock);
		await render();
		await act(async () => button("Close round")?.click());
		expect(document.body.textContent).not.toContain("stay open");
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("answers the command menu's close request", async () => {
		open([view("a", "open")]);
		await render();
		await act(async () => requestCloseRound());
		expect(document.body.textContent).toContain(
			"1 annotation stays open. Close the round?",
		);
		expect(editorAnnotationsStore.get().closeRoundRequested).toBe(false);
	});
});

describe("a proposal entry", () => {
	it("reads Proposed: followed by the summary", async () => {
		const annotation = view("a", "proposed");
		annotation.entries = [
			{
				id: "e1",
				kind: "proposal",
				summary: "It is already the case.",
				at: "2026-10-14T10:00:00.000Z",
				by: { role: "agent", sessionId: "s1" },
			},
		];
		await act(async () => {
			root.render(<AnnotationEntries annotation={annotation} />);
		});
		expect(host.textContent).toContain("Proposed: It is already the case.");
	});
});
