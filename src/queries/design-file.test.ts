import { afterEach, describe, expect, it, vi } from "vitest";
import type { TrickroomDesign } from "../types";
import { saveDesignFile } from "./design-file";

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((innerResolve, innerReject) => {
		resolve = innerResolve;
		reject = innerReject;
	});

	return { promise, reject, resolve };
}

function designFixture(name: string): TrickroomDesign {
	return {
		name,
		boards: [],
	};
}

const firstRevision = `sha256:${"1".repeat(64)}` as const;
const secondRevision = `sha256:${"2".repeat(64)}` as const;

function jsonResponse(body: unknown, status = 200, revision = firstRevision) {
	return new Response(JSON.stringify(body), {
		status,
		headers: {
			"Content-Type": "application/json",
			"x-trickroom-revision": revision,
		},
	});
}

describe("design file queries", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("serializes saves for the same design file", async () => {
		const firstResponse = deferred<Response>();
		const secondResponse = deferred<Response>();
		const firstDesign = designFixture("First");
		const secondDesign = designFixture("Second");
		const fetchMock = vi
			.fn<typeof fetch>()
			.mockReturnValueOnce(firstResponse.promise)
			.mockReturnValueOnce(secondResponse.promise);
		vi.stubGlobal("fetch", fetchMock);

		const firstSave = saveDesignFile("design.json", firstDesign);
		const secondSave = saveDesignFile("design.json", secondDesign);

		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(fetchMock.mock.calls[0][1]?.body).toBe(JSON.stringify(firstDesign));

		firstResponse.resolve(jsonResponse(firstDesign));
		await expect(firstSave).resolves.toEqual({
			design: firstDesign,
			revision: firstRevision,
		});

		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(fetchMock.mock.calls[1][1]?.body).toBe(JSON.stringify(secondDesign));

		secondResponse.resolve(jsonResponse(secondDesign, 200, secondRevision));
		await expect(secondSave).resolves.toEqual({
			design: secondDesign,
			revision: secondRevision,
		});
	});

	it("continues queued saves after an earlier save fails", async () => {
		const firstResponse = deferred<Response>();
		const secondResponse = deferred<Response>();
		const firstDesign = designFixture("First");
		const secondDesign = designFixture("Second");
		const fetchMock = vi
			.fn<typeof fetch>()
			.mockReturnValueOnce(firstResponse.promise)
			.mockReturnValueOnce(secondResponse.promise);
		vi.stubGlobal("fetch", fetchMock);

		const firstSave = saveDesignFile("design.json", firstDesign);
		const secondSave = saveDesignFile("design.json", secondDesign);

		firstResponse.resolve(jsonResponse({ error: "Save failed" }, 500));
		await expect(firstSave).rejects.toThrow("Save failed");

		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(fetchMock.mock.calls[1][1]?.body).toBe(JSON.stringify(secondDesign));

		secondResponse.resolve(jsonResponse(secondDesign, 200, secondRevision));
		await expect(secondSave).resolves.toEqual({
			design: secondDesign,
			revision: secondRevision,
		});
	});

	it("sends the expected disk revision with a checked save", async () => {
		const design = designFixture("Checked");
		const fetchMock = vi
			.fn<typeof fetch>()
			.mockResolvedValue(jsonResponse(design, 200, secondRevision));
		vi.stubGlobal("fetch", fetchMock);

		await saveDesignFile("design.json", design, firstRevision);

		expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({
			"x-trickroom-expected-revision": firstRevision,
		});
	});
});
