// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	replyToAnnotation,
	resolveAnnotation,
} from "../components/annotations/annotation-actions";
import {
	deliverAnnotationEvent,
	deliverAnnotationScope,
	requestAnnotationResync,
} from "../queries/annotation-live-events";
import { ACKNOWLEDGEMENT_TTL_MS } from "../services/annotation-model";
import type {
	AnnotationContainer,
	AnnotationScope,
	AnnotationView,
} from "../services/annotations.types";
import {
	editorAnnotationsStore,
	resetEditorAnnotations,
	upsertAnnotation,
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

const deferred = <T,>() => {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((settle) => {
		resolve = settle;
	});
	return { promise, resolve };
};

const isList = (url: string) => url.startsWith("/api/trickroom/annotations?");

/** The default server, except that the requests `hold` matches wait. */
const serveHolding = (hold: (url: string) => Promise<Response> | null) => {
	const serve = fetchMock.getMockImplementation();
	fetchMock.mockImplementation(async (url) => {
		const held = hold(String(url));
		return held ?? (serve as (url: string) => Promise<Response>)(url);
	});
};

const changed = (annotationId: string, revision: string | null) =>
	act(async () => {
		deliverAnnotationEvent({
			annotationId,
			container,
			operation: "changed",
			revision,
		});
	});

// Review round 1: responses arrive in any order.
describe("useAnnotationLiveSync ordering", () => {
	it("keeps a live update over an older list answer", async () => {
		const list = deferred<Response>();
		serveHolding((url) => (isList(url) ? list.promise : null));
		await mount();
		// The list is out holding r1; an agent moves a1 to r2 meanwhile.
		served.a1 = view("a1", "r2", { status: "needs_input" });
		await changed("a1", "r2");
		await flush();
		expect(state().byId.a1?.revision).toBe("r2");
		list.resolve(
			json({ scope, annotations: [view("a1", "r1")], problems: [] }),
		);
		await flush();
		expect(state().byId.a1?.revision).toBe("r2");
		expect(state().byId.a1?.status).toBe("needs_input");
		expect(state().status).toBe("ready");
	});

	it("keeps an annotation added after the list started", async () => {
		const list = deferred<Response>();
		serveHolding((url) => (isList(url) ? list.promise : null));
		await mount();
		served.a2 = view("a2", "r1");
		await changed("a2", "r1");
		await flush();
		list.resolve(
			json({ scope, annotations: [view("a1", "r1")], problems: [] }),
		);
		await flush();
		expect(Object.keys(state().byId).sort()).toEqual(["a1", "a2"]);
	});

	it("does not let a pending read undo the editor's own later write", async () => {
		await mount();
		const read = deferred<Response>();
		let holdNext = true;
		serveHolding((url) => {
			if (isList(url) || !holdNext) return null;
			holdNext = false;
			return read.promise;
		});
		// An agent's r2 is being read when the human resolves it (r3).
		await changed("a1", "r2");
		const resolved = view("a1", "r3", {
			status: "resolved",
			resolvedBy: { role: "human" },
		});
		served.a1 = resolved;
		upsertAnnotation(resolved);
		// The write's own event echoes back and is skipped.
		await changed("a1", "r3");
		expect(singleCalls()).toHaveLength(1);
		read.resolve(
			json({ annotation: view("a1", "r2", { status: "needs_input" }) }),
		);
		await flush();
		// The stale r2 answer is not shown; reading again finds r3.
		expect(state().byId.a1?.revision).toBe("r3");
		expect(state().byId.a1?.status).toBe("resolved");
	});

	it("reads again when a stale answer may be newer than what is shown", async () => {
		await mount();
		const read = deferred<Response>();
		let holdNext = true;
		serveHolding((url) => {
			if (isList(url) || !holdNext) return null;
			holdNext = false;
			return read.promise;
		});
		await changed("a1", "r2");
		// The human's write lands (r3), then an agent writes r4 before the
		// pending read answers with r4.
		upsertAnnotation(view("a1", "r3", { status: "resolved" }));
		served.a1 = view("a1", "r4", { status: "open" });
		read.resolve(json({ annotation: served.a1 }));
		await flush();
		expect(singleCalls()).toHaveLength(2);
		expect(state().byId.a1?.revision).toBe("r4");
	});

	it("lets the newest of two overlapping reads win", async () => {
		await mount();
		const first = deferred<Response>();
		let holdNext = true;
		serveHolding((url) => {
			if (isList(url) || !holdNext) return null;
			holdNext = false;
			return first.promise;
		});
		await changed("a1", "r2");
		served.a1 = view("a1", "r3");
		await changed("a1", "r3");
		await flush();
		expect(state().byId.a1?.revision).toBe("r3");
		first.resolve(json({ annotation: view("a1", "r2") }));
		await flush();
		expect(state().byId.a1?.revision).toBe("r3");
	});

	it("never applies a read from the previous design to the next one", async () => {
		await mount();
		const read = deferred<Response>();
		serveHolding((url) => (isList(url) ? null : read.promise));
		await changed("a1", "r2");
		await flush();
		const next: AnnotationContainer = { kind: "design", designId: "E" };
		served = {};
		await mount(next);
		expect(state().container).toEqual(next);
		read.resolve(json({ annotation: view("a1", "r2") }));
		await flush();
		expect(state().container).toEqual(next);
		expect(state().byId).toEqual({});
		// The pending read was aborted on cleanup.
		const [, init] = fetchMock.mock.calls.find(([url]) =>
			String(url).startsWith("/api/trickroom/annotations/a1"),
		) as unknown as [string, RequestInit];
		expect(init.signal?.aborted).toBe(true);
	});
});

// Review round 2: the editor's own writes are ordered like reads, and a
// list's removals hold against older reads.
describe("useAnnotationLiveSync and the editor's writes", () => {
	const holdWrites = () => {
		const pending = deferred<Response>();
		const serve = fetchMock.getMockImplementation() as (
			url: string,
		) => Promise<Response>;
		fetchMock.mockImplementation(async (url, init?: RequestInit) =>
			init?.method === "POST" ? pending.promise : serve(url),
		);
		return pending;
	};

	it("does not let a late write answer undo a newer agent change", async () => {
		await mount();
		const pending = holdWrites();
		// The server committed the reply (r2) but its answer is slow; an
		// agent then asks a question (r3), which arrives live.
		const replying = replyToAnnotation(view("a1"), "human reply");
		served.a1 = view("a1", "r3", { status: "needs_input" });
		await changed("a1", "r3");
		await flush();
		expect(state().byId.a1?.revision).toBe("r3");
		pending.resolve(json({ annotation: view("a1", "r2"), written: true }));
		await replying;
		await flush();
		// The answer is older than r3: read again, and r3 stays.
		expect(state().byId.a1?.revision).toBe("r3");
		expect(state().byId.a1?.status).toBe("needs_input");
	});

	it("shows a write's answer when nothing changed meanwhile", async () => {
		await mount();
		const pending = holdWrites();
		const resolving = resolveAnnotation(view("a1"));
		pending.resolve(
			json({
				annotation: view("a1", "r2", { status: "resolved" }),
				written: true,
			}),
		);
		await resolving;
		await flush();
		expect(state().byId.a1?.status).toBe("resolved");
		// No read again: only the write itself went out.
		expect(singleCalls()).toEqual([
			"/api/trickroom/annotations/a1/transition?designId=D",
		]);
	});

	it("never applies a write from an earlier visit to the reopened design", async () => {
		await mount();
		const pending = holdWrites();
		const replying = replyToAnnotation(view("a1"), "human reply");
		await mount({ kind: "design", designId: "E" });
		served.a1 = view("a1", "r3", { status: "needs_input" });
		await mount(container);
		expect(state().byId.a1?.revision).toBe("r3");
		pending.resolve(json({ annotation: view("a1", "r2"), written: true }));
		await replying;
		await flush();
		expect(state().byId.a1?.revision).toBe("r3");
	});

	it("does not let an older read bring back what a newer list removed", async () => {
		await mount();
		const read = deferred<Response>();
		let holdNext = true;
		serveHolding((url) => {
			if (isList(url) || !holdNext) return null;
			holdNext = false;
			return read.promise;
		});
		await changed("a1", "r2");
		await flush();
		// Deleted while the stream was down; the reconnect's list says so.
		served = {};
		await act(async () => requestAnnotationResync());
		await flush();
		expect(state().byId).toEqual({});
		read.resolve(json({ annotation: view("a1", "r2") }));
		await flush();
		expect(state().byId).toEqual({});
	});

	it("does not let an older read add what a newer list never had", async () => {
		await mount();
		const read = deferred<Response>();
		let holdNext = true;
		serveHolding((url) => {
			if (isList(url) || !holdNext) return null;
			holdNext = false;
			return read.promise;
		});
		await changed("a9", "r1");
		await act(async () => requestAnnotationResync());
		await flush();
		read.resolve(json({ annotation: view("a9", "r1") }));
		await flush();
		expect(state().byId.a9).toBeUndefined();
	});
});

// Release review: a checkout of another branch with the design open.
describe("useAnnotationLiveSync and checkout scope changes", () => {
	const feature: AnnotationScope = { branch: "feature", worktreePath: "/work" };

	/** The server after `git checkout feature`: its list, reads and writes. */
	const checkOutFeature = (onFeature: AnnotationView[]) => {
		served = Object.fromEntries(onFeature.map((entry) => [entry.id, entry]));
		fetchMock.mockImplementation(async (url, init?: RequestInit) => {
			const path = String(url);
			if (init?.method === "POST") {
				return new Response(
					JSON.stringify({
						error: "The checkout changed",
						code: "SCOPE_CHANGED",
						details: { scope: feature },
					}),
					{ status: 409, headers: { "content-type": "application/json" } },
				);
			}
			if (isList(path)) {
				return json({ scope: feature, annotations: onFeature, problems: [] });
			}
			const id = path.slice("/api/trickroom/annotations/".length).split("?")[0];
			const found = id ? served[id] : undefined;
			return found
				? json({ scope: feature, annotation: found })
				: new Response("{}", { status: 404 });
		});
	};

	it("lists the new branch's annotations when the server reports the checkout", async () => {
		await mount();
		expect(Object.keys(state().byId)).toEqual(["a1"]);
		checkOutFeature([view("b1", "r1", { branch: "feature" })]);
		await act(async () => deliverAnnotationScope(feature));
		await flush();
		expect(listCalls()).toHaveLength(2);
		expect(state().scope).toEqual(feature);
		expect(Object.keys(state().byId)).toEqual(["b1"]);
		// The new branch's annotations arrive live; the old branch's do not.
		served.b2 = view("b2", "r1", { branch: "feature" });
		await changed("b2", "r1");
		await flush();
		expect(Object.keys(state().byId).sort()).toEqual(["b1", "b2"]);
	});

	it("does nothing for the scope it already holds", async () => {
		await mount();
		await act(async () => deliverAnnotationScope({ ...scope }));
		await flush();
		expect(listCalls()).toHaveLength(1);
		expect(Object.keys(state().byId)).toEqual(["a1"]);
	});

	it("lists again when a single read reports another checkout", async () => {
		await mount();
		checkOutFeature([view("a1", "r2", { branch: "feature" })]);
		await changed("a1", "r2");
		await flush();
		expect(listCalls()).toHaveLength(2);
		expect(state().scope).toEqual(feature);
		expect(state().byId.a1?.branch).toBe("feature");
	});

	it("refuses a stale tab's write and shows the new branch instead", async () => {
		await mount();
		checkOutFeature([view("b1", "r1", { branch: "feature" })]);
		const result = await act(async () =>
			replyToAnnotation(view("a1"), "a reply meant for main"),
		);
		await flush();
		expect(result).toBeNull();
		const calls = fetchMock.mock.calls as unknown as [string, RequestInit?][];
		const [, init] = calls.find(
			([, request]) => request?.method === "POST",
		) as [string, RequestInit];
		expect(JSON.parse(String(init.body))).toMatchObject({
			body: "a reply meant for main",
			expectedScope: scope,
		});
		expect(state().scope).toEqual(feature);
		expect(Object.keys(state().byId)).toEqual(["b1"]);
	});

	it("reads an acknowledgement again when it would go idle", async () => {
		const at = new Date(Date.now() - ACKNOWLEDGEMENT_TTL_MS).toISOString();
		// Goes idle on the editor's clock 30 ms from now.
		const lastSeenAt = new Date(
			Date.now() - ACKNOWLEDGEMENT_TTL_MS + 30,
		).toISOString();
		const acknowledged = (active: boolean) =>
			view("a1", "r1", {
				status: "acknowledged",
				acknowledged: { sessionId: "s1", at },
				acknowledgement: { sessionId: "s1", at, active, lastSeenAt },
			});
		served = { a1: acknowledged(true) };
		await mount();
		expect(state().byId.a1?.acknowledgement?.active).toBe(true);
		served = { a1: acknowledged(false) };
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 1_200));
		});
		await flush();
		expect(singleCalls()).toEqual(["/api/trickroom/annotations/a1?designId=D"]);
		expect(state().byId.a1?.acknowledgement?.active).toBe(false);
		expect(state().byId.a1?.revision).toBe("r1");
	});
});
