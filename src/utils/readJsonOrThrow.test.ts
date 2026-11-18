import { describe, expect, it } from "vitest";
import {
	HttpError,
	readJsonOrThrow,
	UNEXPECTED_RESPONSE_MESSAGE,
} from "./readJsonOrThrow";

describe("readJsonOrThrow", () => {
	it("returns the parsed body", async () => {
		await expect(readJsonOrThrow(Response.json({ a: 1 }))).resolves.toEqual({
			a: 1,
		});
	});

	it("throws the server's error message", async () => {
		const error = await readJsonOrThrow(
			Response.json({ error: "Design not found" }, { status: 404 }),
		).catch((caught) => caught);
		expect(error).toBeInstanceOf(HttpError);
		expect(error).toMatchObject({ message: "Design not found", status: 404 });
	});

	it("names the status when an error body is not JSON", async () => {
		const error = await readJsonOrThrow(
			new Response("oops", { status: 502 }),
		).catch((caught) => caught);
		expect(error).toMatchObject({
			message: "The Trickroom server returned an error (502).",
			status: 502,
		});
	});

	it("replaces a raw parse error when a page arrives instead of JSON", async () => {
		const error = await readJsonOrThrow(
			new Response("<!doctype html><html></html>", { status: 200 }),
		).catch((caught) => caught);
		expect(error).toBeInstanceOf(HttpError);
		expect(error).toMatchObject({ message: UNEXPECTED_RESPONSE_MESSAGE });
		expect(String(error)).not.toContain("Unexpected token");
	});
});
