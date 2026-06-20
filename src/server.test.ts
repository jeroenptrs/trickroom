import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { afterEach, beforeEach, vi } from "vitest";
import { isTrickroomConfig, isTrickroomDesign } from "./server-utils";

const validDesign = {
	name: "Valid Design",
	boards: [
		{
			id: "root",
			props: {
				"data-trickroom-name": "Root",
				"data-trickroom-library": "trickroom",
				"data-trickroom-component": "container",
			},
			children: [
				{
					id: "title",
					props: {
						"data-trickroom-name": "Title",
						"data-trickroom-library": "trickroom",
						"data-trickroom-component": "text",
						"data-trickroom-role": "text",
					},
					children: "Demo UI",
				},
			],
		},
	],
};

describe("server design validation", () => {
	it("accepts the registry-backed serialized design shape", () => {
		expect(isTrickroomDesign(validDesign)).toBe(true);
	});

	// TODO: this can be deleted
	it("rejects deprecated node host type", () => {
		expect(
			isTrickroomDesign({
				...validDesign,
				boards: [{ ...validDesign.boards[0], type: "div" }],
			}),
		).toBe(false);
	});

	// TODO: this can be deleted
	it("rejects deprecated data-trickroom-type props", () => {
		expect(
			isTrickroomDesign({
				...validDesign,
				boards: [
					{
						...validDesign.boards[0],
						props: {
							...validDesign.boards[0].props,
							"data-trickroom-type": "container",
						},
					},
				],
			}),
		).toBe(false);
	});

	it("rejects invalid component role metadata", () => {
		expect(
			isTrickroomDesign({
				...validDesign,
				boards: [
					{
						...validDesign.boards[0],
						props: {
							...validDesign.boards[0].props,
							"data-trickroom-role": "text",
						},
						children: "Root text",
					},
				],
			}),
		).toBe(false);
	});
});

describe("server config validation", () => {
	it("accepts a config with optional systems", () => {
		expect(
			isTrickroomConfig({
				name: "Valid Project",
				systems: {
					Core: "src/index.css",
				},
			}),
		).toBe(true);
	});

	it("accepts a config without systems", () => {
		expect(
			isTrickroomConfig({
				name: "Valid Project",
			}),
		).toBe(true);
	});

	it("rejects empty project names", () => {
		expect(
			isTrickroomConfig({
				name: " ",
				systems: {
					Core: "src/index.css",
				},
			}),
		).toBe(false);
	});

	it("rejects empty system names", () => {
		expect(
			isTrickroomConfig({
				name: "Valid Project",
				systems: {
					" ": "src/index.css",
				},
			}),
		).toBe(false);
	});

	it("rejects empty system css paths", () => {
		expect(
			isTrickroomConfig({
				name: "Valid Project",
				systems: {
					Core: " ",
				},
			}),
		).toBe(false);
	});

	it("rejects deprecated tailwind roots", () => {
		expect(
			isTrickroomConfig({
				name: "Valid Project",
				tailwindRoot: "src/index.css",
			}),
		).toBe(false);
	});
});
