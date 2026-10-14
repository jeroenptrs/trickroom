// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	deliverAnnotationEvent,
	requestAnnotationResync,
} from "../queries/annotation-live-events";
import type {
	AnnotationContainer,
	AnnotationScope,
	AnnotationView,
} from "../services/annotations.types";
import {
	editorAnnotationsStore,
	resetEditorAnnotations,
} from "../stores/editor-annotations-store";
import { useAnnotationLiveSync } from "./useAnnotationLiveSync";

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const container: AnnotationContainer = { kind: "design", designId: "D" };
const scope: AnnotationScope = { branch: "main", worktreePath: "/work" };

const view = (
	id: string,
	revision = "r1",
	overrides: Partial<AnnotationView> = {},
): AnnotationView => ({
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
	...overrides,
});

const json = (body: unknown) =>
	new Response(JSON.stringify(body), {
		status: 200,
		headers: { "content-type": "application/json" },
	});

// What the server holds: the list answer and single reads.
let served: Record<string, AnnotationView>;
const fetchMock = vi.fn<(url: string) => Promise<Response>>();

const urls = () => fetchMock.mock.calls.map(([url]) => String(url));
const listCalls = () =>
	urls().filter((url) => url === "/api/trickroom/annotations?designId=D");
const singleCalls = () =>
	urls().filter((url) => url.startsWith("/api/trickroom/annotations/"));

const flush = async () => {
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 0));
		await new Promise((resolve) => setTimeout(resolve, 0));
	});
};

function Probe({ container }: { container: AnnotationContainer | null }) {
	useAnnotationLiveSync(container);
	return null;
}

let root: Root;
let host: HTMLElement;
let queryClient: QueryClient;

const mount = async (value: AnnotationContainer | null = container) => {
	await act(async () => {
		root.render(
			<QueryClientProvider client={queryClient}>
				<Probe container={value} />
			</QueryClientProvider>,
		);
	});
	await flush();
};

const state = () => editorAnnotationsStore.get();

beforeEach(() => {
	resetEditorAnnotations();
	served = { a1: view("a1", "r1") };
	fetchMock.mockReset();
	fetchMock.mockImplementation(async (url) => {
		const path = String(url);
		if (path.startsWith("/api/trickroom/annotations?")) {
			return json({
				scope,
				annotations: Object.values(served),
				problems: [],
			});
		}
		const id = decodeURIComponent(
			path.slice("/api/trickroom/annotations/".length).split("?")[0] ?? "",
		);
		const found = served[id];
		return found
			? json({ annotation: found })
			: new Response("{}", { status: 404 });
	});
	vi.stubGlobal("fetch", fetchMock);
	queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	host = document.createElement("div");
	document.body.append(host);
	root = createRoot(host);
});

afterEach(() => {
	act(() => root.unmount());
	host.remove();
	queryClient.clear();
	vi.unstubAllGlobals();
	resetEditorAnnotations();
});

describe("useAnnotationLiveSync", () => {
	it("lists the container's annotations and hydrates the store", async () => {
		await mount();
		expect(listCalls()).toHaveLength(1);
		expect(state().container).toEqual(container);
		expect(state().status).toBe("ready");
		expect(state().scope).toEqual(scope);
		expect(Object.keys(state().byId)).toEqual(["a1"]);
		expect(state().byId.a1?.revision).toBe("r1");
	});

	it("refetches and upserts an annotation changed to a new revision", async () => {
		await mount();
		served.a1 = view("a1", "r2", { status: "acknowledged" });
		await act(async () => {
			deliverAnnotationEvent({
				annotationId: "a1",
				container,
				operation: "changed",
				revision: "r2",
			});
		});
		await flush();
		expect(singleCalls()).toEqual(["/api/trickroom/annotations/a1?designId=D"]);
		expect(state().byId.a1?.revision).toBe("r2");
		expect(state().byId.a1?.status).toBe("acknowledged");
	});

	it("adds an annotation it has not held yet", async () => {
		await mount();
		served.a2 = view("a2", "r1");
		await act(async () => {
			deliverAnnotationEvent({
				annotationId: "a2",
				container,
				operation: "changed",
				revision: "r1",
			});
		});
		await flush();
		expect(singleCalls()).toEqual(["/api/trickroom/annotations/a2?designId=D"]);
		expect(Object.keys(state().byId).sort()).toEqual(["a1", "a2"]);
	});

	it("does not fetch for an event with the held revision", async () => {
		await mount();
		await act(async () => {
			deliverAnnotationEvent({
				annotationId: "a1",
				container,
				operation: "changed",
				revision: "r1",
			});
		});
		await flush();
		expect(singleCalls()).toEqual([]);
	});

	it("fetches for an event without a revision", async () => {
		await mount();
		served.a1 = view("a1", "r3");
		await act(async () => {
			deliverAnnotationEvent({
				annotationId: "a1",
				container,
				operation: "changed",
				revision: null,
			});
		});
		await flush();
		expect(singleCalls()).toHaveLength(1);
		expect(state().byId.a1?.revision).toBe("r3");
	});

	it("ignores events of another design", async () => {
		await mount();
		await act(async () => {
			deliverAnnotationEvent({
				annotationId: "a1",
				container: { kind: "design", designId: "other" },
				operation: "changed",
				revision: "r9",
			});
			deliverAnnotationEvent({
				annotationId: "a1",
				container: { kind: "design", designId: "other" },
				operation: "deleted",
				revision: null,
			});
		});
		await flush();
		expect(singleCalls()).toEqual([]);
		expect(state().byId.a1?.revision).toBe("r1");
	});

	it("removes a deleted annotation without fetching", async () => {
		await mount();
		await act(async () => {
			deliverAnnotationEvent({
				annotationId: "a1",
				container,
				operation: "deleted",
				revision: null,
			});
		});
		await flush();
		expect(singleCalls()).toEqual([]);
		expect(state().byId).toEqual({});
	});

	it("lists again on a resync request", async () => {
		await mount();
		expect(listCalls()).toHaveLength(1);
		served.a2 = view("a2", "r1");
		await act(async () => {
			requestAnnotationResync();
		});
		await flush();
		expect(listCalls()).toHaveLength(2);
		expect(Object.keys(state().byId).sort()).toEqual(["a1", "a2"]);
	});

	it("marks the store as errored when the list fails", async () => {
		fetchMock.mockImplementation(
			async () => new Response(JSON.stringify({ error: "x" }), { status: 500 }),
		);
		await mount();
		expect(state().status).toBe("error");
	});

	it("does nothing without a container", async () => {
		await mount(null);
		expect(fetchMock).not.toHaveBeenCalled();
		expect(state().container).toBeNull();
		expect(state().status).toBe("idle");
	});

	it("resets the container on unmount", async () => {
		await mount();
		expect(state().container).toEqual(container);
		await act(async () => {
			root.unmount();
		});
		expect(state().container).toBeNull();
		// A fresh root so afterEach can unmount again.
		root = createRoot(host);
	});

	it("stops reacting to events after unmount", async () => {
		await mount();
		await act(async () => {
			root.unmount();
		});
		await act(async () => {
			deliverAnnotationEvent({
				annotationId: "a1",
				container,
				operation: "changed",
				revision: "r2",
			});
		});
		await flush();
		expect(singleCalls()).toEqual([]);
		root = createRoot(host);
	});
});
