import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Node, TrickroomDesign } from "../types";
import {
	createDesignFileService,
	type DesignFileService,
	DesignWriteNotStoredError,
} from "./design-file-service";

const board = (className: string): Node => ({
	id: "board-1",
	props: {
		"data-trickroom-name": "Board",
		"data-trickroom-library": "trickroom",
		"data-trickroom-component": "container",
		"data-trickroom-role": "branch",
		className,
	},
	children: [],
});

const design = (className: string): TrickroomDesign => ({
	name: "Hooks",
	boards: [board(className)],
});

let root: string;
let service: DesignFileService;

beforeEach(async () => {
	root = await mkdtemp(path.join(os.tmpdir(), "trickroom-write-hooks-"));
	await mkdir(path.join(root, "project", ".trickroom", "designs"), {
		recursive: true,
	});
	service = createDesignFileService(path.join(root, "project"), {
		trickroomHome: path.join(root, "home"),
	});
	await service.createDesignFile("d", design("a"));
});

afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

const storedClass = async () =>
	(await service.readDesignFile("d")).design.boards[0]?.props.className;

describe("aroundStore", () => {
	it("stores when the wrapper calls store, with the before design", async () => {
		const read = await service.readDesignFile("d");
		const seen: string[] = [];
		const write = await service.writeDesignFile(
			"d",
			design("b"),
			{ expectedRevision: read.revision },
			{
				aroundStore: async (store) => {
					seen.push(String(await storedClass()));
					const { before, write: stored } = await store();
					seen.push(String(before?.boards[0]?.props.className));
					seen.push(String(stored.design.boards[0]?.props.className));
				},
			},
		);
		expect(seen).toEqual(["a", "a", "b"]);
		expect(write.revision).toBe((await service.readDesignFile("d")).revision);
	});

	it("refuses the write when the wrapper throws before storing", async () => {
		const read = await service.readDesignFile("d");
		await expect(
			service.writeDesignFile(
				"d",
				design("b"),
				{ expectedRevision: read.revision },
				{
					aroundStore: async () => {
						throw new Error("not now");
					},
				},
			),
		).rejects.toThrow("not now");
		expect(await storedClass()).toBe("a");
	});

	it("fails when the wrapper returns without storing", async () => {
		await expect(
			service.writeDesignFile(
				"d",
				design("b"),
				{},
				{ aroundStore: async () => {} },
			),
		).rejects.toBeInstanceOf(DesignWriteNotStoredError);
		expect(await storedClass()).toBe("a");
	});

	it("refuses a second store", async () => {
		await expect(
			service.writeDesignFile(
				"d",
				design("b"),
				{},
				{
					aroundStore: async (store) => {
						await store();
						await store();
					},
				},
			),
		).rejects.toThrow(/already stored/u);
		expect(await storedClass()).toBe("b");
	});

	it("never runs when the revision check refuses the write", async () => {
		const stale = (await service.readDesignFile("d")).revision;
		await service.writeDesignFile("d", design("c"), {
			expectedRevision: stale,
		});
		const aroundStore = vi.fn();
		const afterWrite = vi.fn();
		const outcome = await service.updateDesignFile("d", {
			expectedRevision: stale,
			read: () => service.readDesignFile("d"),
			mutate: async () => ({ design: design("b") }),
			aroundStore,
			afterWrite,
		});
		expect(outcome.status).toBe("revision-mismatch");
		expect(aroundStore).not.toHaveBeenCalled();
		expect(afterWrite).not.toHaveBeenCalled();
		expect(await storedClass()).toBe("c");
	});
});

describe("afterWrite", () => {
	it("logs a failing step without failing the stored write", async () => {
		const error = vi.spyOn(console, "error").mockImplementation(() => {});
		const write = await service.writeDesignFile(
			"d",
			design("b"),
			{},
			{
				afterWrite: async () => {
					throw new Error("boom");
				},
			},
		);
		expect(write.design.boards[0]?.props.className).toBe("b");
		expect(await storedClass()).toBe("b");
		expect(error).toHaveBeenCalled();
		error.mockRestore();
	});
});
