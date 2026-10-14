import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
	AnnotationContainer,
	AnnotationTarget,
	AnnotationView,
} from "../services/annotations.types";
import {
	AnnotationRequestError,
	annotationContainerOf,
	annotationContainerParams,
	annotationListQueryKey,
	containerKey,
	createAnnotationRequest,
	fetchAnnotation,
	fetchAnnotationList,
	isAnnotationRevisionMismatch,
	moveAnnotationRequest,
	reanchorAnnotationRequest,
	replyToAnnotationRequest,
	resolveAnnotationsRequest,
	revertAnnotationChangeRequest,
	transitionAnnotationRequest,
} from "./annotations";

const layerTarget: AnnotationTarget = {
	kind: "layer",
	designId: "design 1",
	boardId: "b1",
	elementId: "l1",
};
const nodeTarget: AnnotationTarget = {
	kind: "componentNode",
	systemId: "sys",
	componentId: "button",
	nodePath: "0",
};

const designContainer: AnnotationContainer = { kind: "design", designId: "d1" };
const componentContainer: AnnotationContainer = {
	kind: "component",
	systemId: "sys",
	componentId: "button",
};

const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});

const fetchMock =
	vi.fn<(url: string, init?: RequestInit) => Promise<Response>>();

const lastCall = () => {
	const [url, init] = fetchMock.mock.calls.at(-1) ?? [];
	return {
		url: String(url),
		method: init?.method,
		headers: init?.headers,
		body: init?.body ? JSON.parse(String(init.body)) : undefined,
	};
};

const annotation = { id: "a/1", target: layerTarget, revision: "rev-9" };

beforeEach(() => {
	fetchMock.mockReset();
	fetchMock.mockImplementation(async () =>
		json({ annotation: { id: "a/1" }, written: true }),
	);
	vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("containers", () => {
	it("maps targets to containers", () => {
		expect(annotationContainerOf(layerTarget)).toEqual({
			kind: "design",
			designId: "design 1",
		});
		expect(annotationContainerOf({ kind: "design", designId: "d" })).toEqual({
			kind: "design",
			designId: "d",
		});
		expect(annotationContainerOf(nodeTarget)).toEqual(componentContainer);
	});

	it("builds request params and keys", () => {
		expect(annotationContainerParams(designContainer)).toEqual({
			designId: "d1",
		});
		expect(annotationContainerParams(componentContainer)).toEqual({
			systemId: "sys",
			componentId: "button",
		});
		expect(containerKey(designContainer)).toBe("design:d1");
		expect(containerKey(componentContainer)).toBe("component:sys/button");
	});

	it("scopes the list query key by container, branch and project", () => {
		expect(annotationListQueryKey(designContainer, "current")).toEqual([
			"trickroom-annotations",
			"design:d1",
			"current",
		]);
		expect(annotationListQueryKey(designContainer, "all")).not.toEqual(
			annotationListQueryKey(designContainer, "current"),
		);
	});
});

describe("fetching", () => {
	it("lists the current branch without a branch parameter", async () => {
		fetchMock.mockResolvedValueOnce(json({ annotations: [] }));
		await fetchAnnotationList(designContainer);
		expect(lastCall().url).toBe("/api/trickroom/annotations?designId=d1");
		expect(lastCall().method).toBeUndefined();
	});

	it("adds branch=all only for all", async () => {
		fetchMock.mockImplementation(async () => json({ annotations: [] }));
		await fetchAnnotationList(designContainer, "current");
		expect(lastCall().url).not.toContain("branch");
		await fetchAnnotationList(designContainer, "all");
		expect(lastCall().url).toBe(
			"/api/trickroom/annotations?designId=d1&branch=all",
		);
		await fetchAnnotationList(componentContainer, "all");
		expect(lastCall().url).toBe(
			"/api/trickroom/annotations?systemId=sys&componentId=button&branch=all",
		);
	});

	it("returns the list response", async () => {
		const body = {
			scope: { branch: "main", worktreePath: "/w" },
			annotations: [],
			problems: [],
		};
		fetchMock.mockResolvedValueOnce(json(body));
		await expect(fetchAnnotationList(designContainer)).resolves.toEqual(body);
	});

	it("fetches one annotation with a container hint and unwraps it", async () => {
		const view = { id: "a/1" } as AnnotationView;
		fetchMock.mockResolvedValueOnce(json({ annotation: view }));
		await expect(fetchAnnotation("a/1", designContainer)).resolves.toEqual(
			view,
		);
		expect(lastCall().url).toBe("/api/trickroom/annotations/a%2F1?designId=d1");
	});
});

describe("writes", () => {
	it("creates an annotation by POSTing the input", async () => {
		const input = {
			target: layerTarget,
			body: "hello",
			snapshot: { stageMode: "canvas" },
		};
		await createAnnotationRequest(input);
		expect(lastCall()).toMatchObject({
			url: "/api/trickroom/annotations",
			method: "POST",
			headers: { "content-type": "application/json" },
			body: input,
		});
	});

	it("replies with the held revision and a design hint", async () => {
		await replyToAnnotationRequest(annotation, "thanks");
		expect(lastCall()).toMatchObject({
			url: "/api/trickroom/annotations/a%2F1/entries?designId=design+1",
			method: "POST",
			body: { body: "thanks", expectedRevision: "rev-9" },
		});
	});

	it("hints the component container for component node targets", async () => {
		await replyToAnnotationRequest({ ...annotation, target: nodeTarget }, "x");
		expect(lastCall().url).toBe(
			"/api/trickroom/annotations/a%2F1/entries?systemId=sys&componentId=button",
		);
	});

	it.each([
		[{ to: "resolved", summary: "done" } as const],
		[{ to: "dismissed", reason: "no" } as const],
		[{ to: "open" } as const],
	])("transitions with the revision: %j", async (input) => {
		await transitionAnnotationRequest(annotation, input);
		expect(lastCall()).toMatchObject({
			url: "/api/trickroom/annotations/a%2F1/transition?designId=design+1",
			method: "POST",
			body: { ...input, expectedRevision: "rev-9" },
		});
	});

	it("reanchors with the revision, and a snapshot when given", async () => {
		const target: AnnotationTarget = { kind: "design", designId: "d1" };
		await reanchorAnnotationRequest(annotation, target);
		expect(lastCall().url).toContain("/a%2F1/anchor?");
		expect(lastCall().body).toEqual({ target, expectedRevision: "rev-9" });

		await reanchorAnnotationRequest(annotation, target, {
			stageMode: "canvas",
		});
		expect(lastCall().body).toEqual({
			target,
			snapshot: { stageMode: "canvas" },
			expectedRevision: "rev-9",
		});
	});

	it("moves with the revision", async () => {
		await moveAnnotationRequest(annotation);
		expect(lastCall().url).toContain("/a%2F1/move?");
		expect(lastCall().body).toEqual({ expectedRevision: "rev-9" });
	});

	it("reverts a change entry with the revision", async () => {
		await revertAnnotationChangeRequest(annotation, "entry-3");
		expect(lastCall().url).toContain("/a%2F1/revert?");
		expect(lastCall().body).toEqual({
			entryId: "entry-3",
			expectedRevision: "rev-9",
		});
	});

	it("bulk resolves with per-annotation expected revisions", async () => {
		fetchMock.mockResolvedValueOnce(json({ resolved: [], skipped: [] }));
		await resolveAnnotationsRequest(designContainer, [
			{ id: "a1", revision: "r1" },
			{ id: "a2", revision: "r2" },
		]);
		expect(lastCall()).toMatchObject({
			url: "/api/trickroom/annotations/resolve",
			method: "POST",
			body: {
				designId: "d1",
				annotationIds: ["a1", "a2"],
				expectedRevisions: { a1: "r1", a2: "r2" },
			},
		});
	});

	it("bulk resolves a component container", async () => {
		fetchMock.mockResolvedValueOnce(json({ resolved: [], skipped: [] }));
		await resolveAnnotationsRequest(componentContainer, [
			{ id: "a1", revision: "r1" },
		]);
		expect(lastCall().body).toMatchObject({
			systemId: "sys",
			componentId: "button",
		});
	});
});

describe("errors", () => {
	it("turns an error response into an AnnotationRequestError", async () => {
		fetchMock.mockResolvedValueOnce(
			json(
				{
					error: "Stale",
					code: "ANNOTATION_REVISION_MISMATCH",
					details: { currentRevision: "rev-10" },
				},
				409,
			),
		);
		const error = await replyToAnnotationRequest(annotation, "x").catch(
			(caught) => caught,
		);
		expect(error).toBeInstanceOf(AnnotationRequestError);
		expect(error).toBeInstanceOf(Error);
		expect(error).toMatchObject({
			name: "AnnotationRequestError",
			message: "Stale",
			status: 409,
			code: "ANNOTATION_REVISION_MISMATCH",
			details: { currentRevision: "rev-10" },
		});
		expect(isAnnotationRevisionMismatch(error)).toBe(true);
	});

	it("falls back to the status when the body is not JSON", async () => {
		fetchMock.mockResolvedValueOnce(new Response("oops", { status: 502 }));
		const error = await createAnnotationRequest({
			target: layerTarget,
			body: "x",
		}).catch((caught) => caught);
		expect(error).toBeInstanceOf(AnnotationRequestError);
		expect(error).toMatchObject({
			status: 502,
			code: "HTTP_ERROR",
			message: "Request failed with status 502",
			details: undefined,
		});
	});

	it("rejects failed reads the same way", async () => {
		fetchMock.mockResolvedValueOnce(
			json({ error: "Nope", code: "NOT_FOUND" }, 404),
		);
		await expect(fetchAnnotation("a1", designContainer)).rejects.toMatchObject({
			status: 404,
			code: "NOT_FOUND",
			message: "Nope",
		});
	});

	it("recognizes only revision mismatches", () => {
		expect(
			isAnnotationRevisionMismatch(
				new AnnotationRequestError("x", 409, "ANNOTATION_REVISION_MISMATCH"),
			),
		).toBe(true);
		expect(
			isAnnotationRevisionMismatch(
				new AnnotationRequestError("x", 409, "OTHER"),
			),
		).toBe(false);
		expect(isAnnotationRevisionMismatch(new Error("x"))).toBe(false);
		expect(isAnnotationRevisionMismatch(null)).toBe(false);
	});
});
