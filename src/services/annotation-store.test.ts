import {
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rename,
	rm,
	stat,
	unlink,
	writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	AnnotationStore,
	AnnotationStoreError,
	annotationFileCacheLimits,
	annotationFileReads,
	classifyAnnotationFile,
	getAnnotationFileCacheSize,
	resetAnnotationFileCache,
} from "./annotation-store";
import type { Annotation, AnnotationContainer } from "./annotations.types";

const human = { role: "human" } as const;
const designContainer: AnnotationContainer = {
	kind: "design",
	designId: "home",
};
const componentContainer: AnnotationContainer = {
	kind: "component",
	systemId: "sys",
	componentId: "button",
};

const makeAnnotation = (overrides: Partial<Annotation> = {}): Annotation => ({
	version: 1,
	id: "ann-1",
	projectId: "proj-1",
	target: { kind: "layer", designId: "home", boardId: "b1", elementId: "e1" },
	branch: "main",
	worktreePath: "/work/tree",
	snapshot: { branch: "main", worktreePath: "/work/tree" },
	status: "open",
	createdAt: "2026-10-01T10:00:00.000Z",
	updatedAt: "2026-10-01T10:00:00.000Z",
	entries: [
		{
			id: "entry-0",
			kind: "remark",
			at: "2026-10-01T10:00:00.000Z",
			by: human,
			body: "Make this bigger",
		},
	],
	transitions: [
		{ from: null, to: "open", at: "2026-10-01T10:00:00.000Z", by: human },
	],
	...overrides,
});

const makeComponentAnnotation = (id: string) =>
	makeAnnotation({
		id,
		target: {
			kind: "componentNode",
			systemId: "sys",
			componentId: "button",
			nodePath: "0",
		},
	});

const appendEntry = (annotation: Annotation, id: string): Annotation => ({
	...annotation,
	entries: [
		...annotation.entries,
		{
			id,
			kind: "reply",
			at: "2026-10-01T11:00:00.000Z",
			by: { role: "agent", sessionId: "s-1" },
			body: id,
		},
	],
});

const expectStoreError = async (promise: Promise<unknown>, code: string) => {
	const error = await promise.then(
		() => null,
		(caught: unknown) => caught,
	);
	expect(error).toBeInstanceOf(AnnotationStoreError);
	expect((error as AnnotationStoreError).code).toBe(code);
	return error as AnnotationStoreError;
};

describe("annotation store", () => {
	let home: string;
	let store: AnnotationStore;

	beforeEach(async () => {
		home = await mkdtemp(path.join(os.tmpdir(), "trickroom-annotations-"));
		store = new AnnotationStore({ projectId: "proj-1", trickroomHome: home });
	});

	afterEach(async () => {
		await rm(home, { recursive: true, force: true });
	});

	describe("layout", () => {
		it("keeps design annotations under designs/<designId>", () => {
			expect(store.getAnnotationPath(designContainer, "ann-1")).toBe(
				path.join(
					home,
					"annotations",
					"proj-1",
					"designs",
					"home",
					"ann-1.json",
				),
			);
		});

		it("keeps component annotations under systems/<systemId>/components/<componentId>", () => {
			expect(store.getAnnotationPath(componentContainer, "ann-1")).toBe(
				path.join(
					home,
					"annotations",
					"proj-1",
					"systems",
					"sys",
					"components",
					"button",
					"ann-1.json",
				),
			);
		});

		it("keeps session files under sessions/<sessionId>.json", () => {
			expect(store.getSessionPath("sess-9")).toBe(
				path.join(home, "annotations", "proj-1", "sessions", "sess-9.json"),
			);
		});

		it("exposes the project directory", () => {
			expect(store.projectDirectory).toBe(
				path.join(home, "annotations", "proj-1"),
			);
		});
	});

	describe("modes", () => {
		it.skipIf(process.platform === "win32")(
			"creates folders 0700 and files 0600",
			async () => {
				await store.create(makeAnnotation());
				const filePath = store.getAnnotationPath(designContainer, "ann-1");
				expect((await stat(filePath)).mode & 0o777).toBe(0o600);
				for (const directory of [
					path.dirname(filePath),
					path.dirname(path.dirname(filePath)),
					store.projectDirectory,
				]) {
					expect((await stat(directory)).mode & 0o777, directory).toBe(0o700);
				}
			},
		);

		it.skipIf(process.platform === "win32")(
			"keeps files 0600 after an update and session folders 0700",
			async () => {
				await store.create(makeAnnotation());
				await store.update(designContainer, "ann-1", (current) => ({
					annotation: appendEntry(current.annotation, "entry-1"),
					result: null,
				}));
				const filePath = store.getAnnotationPath(designContainer, "ann-1");
				expect((await stat(filePath)).mode & 0o777).toBe(0o600);

				await store.writeSession("sess-1", new Date());
				const sessionPath = store.getSessionPath("sess-1");
				expect((await stat(sessionPath)).mode & 0o777).toBe(0o600);
				expect((await stat(path.dirname(sessionPath))).mode & 0o777).toBe(
					0o700,
				);
			},
		);
	});

	describe("create and read", () => {
		it("round-trips an annotation", async () => {
			const annotation = makeAnnotation();
			const created = await store.create(annotation);
			expect(created.annotation).toEqual(annotation);
			expect(created.migrated).toBe(false);
			const read = await store.read(designContainer, "ann-1");
			expect(read?.annotation).toEqual(annotation);
			expect(read?.revision).toBe(created.revision);
			expect(read?.migrated).toBe(false);
		});

		it("stores a component annotation in its component folder", async () => {
			await store.create(makeComponentAnnotation("c-1"));
			expect((await store.read(componentContainer, "c-1"))?.annotation.id).toBe(
				"c-1",
			);
			expect(await store.read(designContainer, "c-1")).toBeNull();
		});

		it("writes the file with version first and a trailing newline", async () => {
			await store.create(makeAnnotation());
			const text = await readFile(
				store.getAnnotationPath(designContainer, "ann-1"),
				"utf8",
			);
			expect(text.startsWith('{\n  "version": 1,')).toBe(true);
			expect(text.endsWith("}\n")).toBe(true);
		});

		it("returns null for a missing annotation", async () => {
			expect(await store.read(designContainer, "nope")).toBeNull();
		});

		it("fails with ANNOTATION_EXISTS when the id is taken", async () => {
			await store.create(makeAnnotation());
			await expectStoreError(
				store.create(makeAnnotation({ status: "resolved" })),
				"ANNOTATION_EXISTS",
			);
			expect(
				(await store.read(designContainer, "ann-1"))?.annotation.status,
			).toBe("open");
		});

		it("refuses an annotation of another project", async () => {
			await expectStoreError(
				store.create(makeAnnotation({ projectId: "proj-2" })),
				"INVALID_ID",
			);
		});

		it("refuses a store for an unsafe project id", () => {
			expect(
				() => new AnnotationStore({ projectId: "../x", trickroomHome: home }),
			).toThrow(AnnotationStoreError);
		});
	});

	describe("unsafe ids", () => {
		const unsafe = ["../x", "a/b", "a\\b", ".hidden", "", " padded ", "a:b"];

		it("refuses them as annotation ids", async () => {
			for (const id of unsafe) {
				await expectStoreError(store.read(designContainer, id), "INVALID_ID");
				await expectStoreError(
					store.update(designContainer, id, () => ({
						annotation: null,
						result: null,
					})),
					"INVALID_ID",
				);
				await expectStoreError(store.remove(designContainer, id), "INVALID_ID");
				await expectStoreError(store.locate(id), "INVALID_ID");
				await expectStoreError(
					store.create(makeAnnotation({ id })),
					"INVALID_ID",
				);
			}
		});

		it("refuses them as design, system and component ids", async () => {
			for (const id of unsafe) {
				await expectStoreError(
					store.read({ kind: "design", designId: id }, "ann-1"),
					"INVALID_ID",
				);
				await expectStoreError(
					store.read(
						{ kind: "component", systemId: id, componentId: "c" },
						"ann-1",
					),
					"INVALID_ID",
				);
				await expectStoreError(
					store.read(
						{ kind: "component", systemId: "s", componentId: id },
						"ann-1",
					),
					"INVALID_ID",
				);
			}
		});

		it("refuses them as session ids on write and answers null on read", async () => {
			for (const id of unsafe) {
				await expectStoreError(
					store.writeSession(id, new Date()),
					"INVALID_ID",
				);
				expect(await store.readSessionLastCall(id)).toBeNull();
			}
		});
	});

	describe("update", () => {
		it("writes the mutated annotation and returns the result", async () => {
			const created = await store.create(makeAnnotation());
			const outcome = await store.update(
				designContainer,
				"ann-1",
				(current) => ({
					annotation: appendEntry(current.annotation, "entry-1"),
					result: "done",
				}),
			);
			expect(outcome.written).toBe(true);
			expect(outcome.result).toBe("done");
			expect(outcome.stored.revision).not.toBe(created.revision);
			const read = await store.read(designContainer, "ann-1");
			expect(read?.annotation.entries.map((entry) => entry.id)).toEqual([
				"entry-0",
				"entry-1",
			]);
			expect(read?.revision).toBe(outcome.stored.revision);
		});

		it("hands the mutation the stored annotation and revision", async () => {
			const created = await store.create(makeAnnotation());
			await store.update(designContainer, "ann-1", (current) => {
				expect(current.annotation).toEqual(created.annotation);
				expect(current.revision).toBe(created.revision);
				return { annotation: null, result: null };
			});
		});

		it("writes nothing when the mutation returns null", async () => {
			const created = await store.create(makeAnnotation());
			const filePath = store.getAnnotationPath(designContainer, "ann-1");
			const before = await readFile(filePath, "utf8");
			const outcome = await store.update(designContainer, "ann-1", () => ({
				annotation: null,
				result: 42,
			}));
			expect(outcome.written).toBe(false);
			expect(outcome.result).toBe(42);
			expect(outcome.stored.revision).toBe(created.revision);
			expect(await readFile(filePath, "utf8")).toBe(before);
		});

		it("fails with the current revision on an expectedRevision mismatch", async () => {
			const created = await store.create(makeAnnotation());
			const error = await expectStoreError(
				store.update(
					designContainer,
					"ann-1",
					(current) => ({
						annotation: appendEntry(current.annotation, "entry-1"),
						result: null,
					}),
					{ expectedRevision: "sha256:stale" },
				),
				"ANNOTATION_REVISION_MISMATCH",
			);
			expect(error.details?.currentRevision).toBe(created.revision);
			expect(
				(await store.read(designContainer, "ann-1"))?.annotation.entries,
			).toHaveLength(1);
		});

		it("succeeds when expectedRevision matches", async () => {
			const created = await store.create(makeAnnotation());
			const outcome = await store.update(
				designContainer,
				"ann-1",
				(current) => ({
					annotation: appendEntry(current.annotation, "entry-1"),
					result: null,
				}),
				{ expectedRevision: created.revision },
			);
			expect(outcome.written).toBe(true);
		});

		it("does not call the mutation on a revision mismatch", async () => {
			await store.create(makeAnnotation());
			let called = false;
			await expectStoreError(
				store.update(
					designContainer,
					"ann-1",
					() => {
						called = true;
						return { annotation: null, result: null };
					},
					{ expectedRevision: "sha256:stale" },
				),
				"ANNOTATION_REVISION_MISMATCH",
			);
			expect(called).toBe(false);
		});

		it("fails with ANNOTATION_NOT_FOUND for a missing annotation", async () => {
			await expectStoreError(
				store.update(designContainer, "nope", () => ({
					annotation: null,
					result: null,
				})),
				"ANNOTATION_NOT_FOUND",
			);
		});

		it("refuses an update that moves the target to another design", async () => {
			await store.create(makeAnnotation());
			await expectStoreError(
				store.update(designContainer, "ann-1", (current) => ({
					annotation: {
						...current.annotation,
						target: {
							kind: "layer",
							designId: "other",
							boardId: "b1",
							elementId: "e1",
						},
					},
					result: null,
				})),
				"INVALID_ID",
			);
			expect(
				(await store.read(designContainer, "ann-1"))?.annotation.target,
			).toMatchObject({ designId: "home" });
		});

		it("refuses an update that moves the target to a component", async () => {
			await store.create(makeAnnotation());
			await expectStoreError(
				store.update(designContainer, "ann-1", (current) => ({
					annotation: {
						...current.annotation,
						target: makeComponentAnnotation("x").target,
					},
					result: null,
				})),
				"INVALID_ID",
			);
		});

		it("refuses an update that changes the annotation id", async () => {
			await store.create(makeAnnotation());
			await expectStoreError(
				store.update(designContainer, "ann-1", (current) => ({
					annotation: { ...current.annotation, id: "ann-2" },
					result: null,
				})),
				"INVALID_ID",
			);
		});

		it("allows a re-anchor within the same design", async () => {
			await store.create(makeAnnotation());
			const outcome = await store.update(
				designContainer,
				"ann-1",
				(current) => ({
					annotation: {
						...current.annotation,
						target: { kind: "board", designId: "home", boardId: "b2" },
					},
					result: null,
				}),
			);
			expect(outcome.written).toBe(true);
		});

		it("accepts an async mutation", async () => {
			await store.create(makeAnnotation());
			const outcome = await store.update(
				designContainer,
				"ann-1",
				async (current) => {
					await new Promise((resolve) => setTimeout(resolve, 5));
					return {
						annotation: { ...current.annotation, status: "resolved" as const },
						result: null,
					};
				},
			);
			expect(outcome.stored.annotation.status).toBe("resolved");
		});

		it("serialises 20 parallel updates so every append lands", async () => {
			await store.create(makeAnnotation());
			await Promise.all(
				Array.from({ length: 20 }, (_, index) =>
					store.update(designContainer, "ann-1", (current) => ({
						annotation: appendEntry(current.annotation, `entry-p${index}`),
						result: null,
					})),
				),
			);
			const read = await store.read(designContainer, "ann-1");
			expect(read?.annotation.entries).toHaveLength(21);
			const ids = new Set(read?.annotation.entries.map((entry) => entry.id));
			expect(ids.size).toBe(21);
		}, 30_000);

		it("leaves no temporary files behind", async () => {
			await store.create(makeAnnotation());
			for (let index = 0; index < 5; index += 1) {
				await store.update(designContainer, "ann-1", (current) => ({
					annotation: appendEntry(current.annotation, `entry-t${index}`),
					result: null,
				}));
			}
			await store.writeSession("sess-1", new Date());
			const folder = store.getContainerDirectory(designContainer);
			expect(await readdir(folder)).toEqual(["ann-1.json"]);
			const sessions = await readdir(
				path.dirname(store.getSessionPath("sess-1")),
			);
			expect(sessions.filter((name) => name.endsWith(".tmp"))).toEqual([]);
			expect(sessions).toEqual(["sess-1.json"]);
		});

		it("leaves no temporary file behind when the mutation throws", async () => {
			await store.create(makeAnnotation());
			await expect(
				store.update(designContainer, "ann-1", () => {
					throw new Error("boom");
				}),
			).rejects.toThrow("boom");
			expect(
				await readdir(store.getContainerDirectory(designContainer)),
			).toEqual(["ann-1.json"]);
		});
	});

	describe("list", () => {
		it("returns annotations oldest first", async () => {
			await store.create(
				makeAnnotation({ id: "c", createdAt: "2026-10-03T00:00:00.000Z" }),
			);
			await store.create(
				makeAnnotation({ id: "a", createdAt: "2026-10-01T00:00:00.000Z" }),
			);
			await store.create(
				makeAnnotation({ id: "b", createdAt: "2026-10-02T00:00:00.000Z" }),
			);
			const { annotations, problems } = await store.list(designContainer);
			expect(annotations.map((stored) => stored.annotation.id)).toEqual([
				"a",
				"b",
				"c",
			]);
			expect(problems).toEqual([]);
		});

		it("breaks createdAt ties by id", async () => {
			await store.create(makeAnnotation({ id: "z" }));
			await store.create(makeAnnotation({ id: "m" }));
			const { annotations } = await store.list(designContainer);
			expect(annotations.map((stored) => stored.annotation.id)).toEqual([
				"m",
				"z",
			]);
		});

		it("returns nothing for a missing folder", async () => {
			expect(await store.list(designContainer)).toEqual({
				annotations: [],
				problems: [],
			});
			expect(await store.list(componentContainer)).toEqual({
				annotations: [],
				problems: [],
			});
		});

		it("reports newer-version and invalid files as problems and skips them", async () => {
			await store.create(makeAnnotation({ id: "good" }));
			const folder = store.getContainerDirectory(designContainer);
			await writeFile(
				path.join(folder, "future.json"),
				JSON.stringify({ ...makeAnnotation({ id: "future" }), version: 2 }),
			);
			await writeFile(path.join(folder, "broken.json"), "{ not json");
			await writeFile(
				path.join(folder, "wrong-shape.json"),
				JSON.stringify({ version: 1, id: "wrong-shape" }),
			);
			const { annotations, problems } = await store.list(designContainer);
			expect(annotations.map((stored) => stored.annotation.id)).toEqual([
				"good",
			]);
			expect(
				problems.map(({ annotationId, code }) => [annotationId, code]),
			).toEqual([
				["broken", "INVALID_ANNOTATION_FILE"],
				["future", "UNSUPPORTED_ANNOTATION_VERSION"],
				["wrong-shape", "INVALID_ANNOTATION_FILE"],
			]);
			expect(problems.every((problem) => problem.message.length > 0)).toBe(
				true,
			);
		});

		it("lists a change entry without its record as a problem and refuses to update it", async () => {
			await store.create(makeAnnotation({ id: "good" }));
			const folder = store.getContainerDirectory(designContainer);
			const malformed = {
				...makeAnnotation({ id: "no-change" }),
				entries: [
					{
						id: "entry-c",
						kind: "change",
						at: "2026-10-01T10:00:00.000Z",
						by: { role: "agent", sessionId: "s-1" },
					},
				],
			};
			const file = path.join(folder, "no-change.json");
			await writeFile(file, JSON.stringify(malformed));
			const { annotations, problems } = await store.list(designContainer);
			expect(annotations.map((stored) => stored.annotation.id)).toEqual([
				"good",
			]);
			expect(problems).toEqual([
				expect.objectContaining({
					annotationId: "no-change",
					code: "INVALID_ANNOTATION_FILE",
				}),
			]);
			const bytes = await readFile(file, "utf8");
			await expectStoreError(
				store.update(designContainer, "no-change", ({ annotation }) => ({
					annotation,
					result: null,
				})),
				"INVALID_ANNOTATION_FILE",
			);
			expect(await readFile(file, "utf8")).toBe(bytes);
		});

		it("ignores temporary files, dot files, other extensions and folders", async () => {
			await store.create(makeAnnotation({ id: "good" }));
			const folder = store.getContainerDirectory(designContainer);
			await writeFile(path.join(folder, ".good.json.123.tmp"), "{}");
			await writeFile(path.join(folder, ".hidden.json"), "{}");
			await writeFile(path.join(folder, "notes.txt"), "hi");
			await mkdir(path.join(folder, "sub.json"));
			const { annotations, problems } = await store.list(designContainer);
			expect(annotations).toHaveLength(1);
			expect(problems).toEqual([]);
		});

		it("treats a file whose id differs from its file name as invalid", async () => {
			const folder = store.getContainerDirectory(designContainer);
			await mkdir(folder, { recursive: true });
			await writeFile(
				path.join(folder, "renamed.json"),
				JSON.stringify(makeAnnotation({ id: "original" })),
			);
			const { annotations, problems } = await store.list(designContainer);
			expect(annotations).toEqual([]);
			expect(problems).toHaveLength(1);
			expect(problems[0]).toMatchObject({
				annotationId: "renamed",
				code: "INVALID_ANNOTATION_FILE",
			});
			await expectStoreError(
				store.read(designContainer, "renamed"),
				"INVALID_ANNOTATION_FILE",
			);
		});
	});

	describe("newer and invalid files on write", () => {
		it("refuses to update a newer-version file and leaves its bytes alone", async () => {
			const folder = store.getContainerDirectory(designContainer);
			await mkdir(folder, { recursive: true });
			const filePath = path.join(folder, "future.json");
			const bytes = `${JSON.stringify({ ...makeAnnotation({ id: "future" }), version: 2, extra: "kept" })}\n`;
			await writeFile(filePath, bytes);
			let called = false;
			await expectStoreError(
				store.update(designContainer, "future", (current) => {
					called = true;
					return { annotation: current.annotation, result: null };
				}),
				"UNSUPPORTED_ANNOTATION_VERSION",
			);
			expect(called).toBe(false);
			expect(await readFile(filePath, "utf8")).toBe(bytes);
		});

		it("refuses to read a newer-version file", async () => {
			const folder = store.getContainerDirectory(designContainer);
			await mkdir(folder, { recursive: true });
			await writeFile(
				path.join(folder, "future.json"),
				JSON.stringify({ ...makeAnnotation({ id: "future" }), version: 2 }),
			);
			await expectStoreError(
				store.read(designContainer, "future"),
				"UNSUPPORTED_ANNOTATION_VERSION",
			);
		});

		it("refuses to create over a newer-version file", async () => {
			const folder = store.getContainerDirectory(designContainer);
			await mkdir(folder, { recursive: true });
			const filePath = path.join(folder, "future.json");
			const bytes = JSON.stringify({
				...makeAnnotation({ id: "future" }),
				version: 2,
			});
			await writeFile(filePath, bytes);
			await expectStoreError(
				store.create(makeAnnotation({ id: "future" })),
				"UNSUPPORTED_ANNOTATION_VERSION",
			);
			expect(await readFile(filePath, "utf8")).toBe(bytes);
		});

		it("refuses to update an invalid file", async () => {
			const folder = store.getContainerDirectory(designContainer);
			await mkdir(folder, { recursive: true });
			await writeFile(path.join(folder, "broken.json"), "nope");
			await expectStoreError(
				store.update(designContainer, "broken", () => ({
					annotation: null,
					result: null,
				})),
				"INVALID_ANNOTATION_FILE",
			);
		});
	});

	describe("locate", () => {
		beforeEach(async () => {
			await store.create(makeAnnotation({ id: "in-home" }));
			await store.create(
				makeAnnotation({
					id: "in-other",
					target: { kind: "design", designId: "other" },
				}),
			);
			await store.create(makeComponentAnnotation("in-button"));
		});

		it("finds annotations by id without a hint", async () => {
			expect(await store.locate("in-home")).toEqual(designContainer);
			expect(await store.locate("in-other")).toEqual({
				kind: "design",
				designId: "other",
			});
			expect(await store.locate("in-button")).toEqual(componentContainer);
		});

		it("finds annotations by id with a right or wrong hint", async () => {
			expect(await store.locate("in-home", designContainer)).toEqual(
				designContainer,
			);
			expect(await store.locate("in-button", componentContainer)).toEqual(
				componentContainer,
			);
			expect(await store.locate("in-button", designContainer)).toEqual(
				componentContainer,
			);
			expect(
				await store.locate("in-home", {
					kind: "design",
					designId: "never-made",
				}),
			).toEqual(designContainer);
		});

		it("returns null for an unknown id", async () => {
			expect(await store.locate("unknown")).toBeNull();
			expect(await store.locate("unknown", designContainer)).toBeNull();
		});

		it("returns null when nothing has been stored yet", async () => {
			const empty = new AnnotationStore({
				projectId: "proj-empty",
				trickroomHome: home,
			});
			expect(await empty.locate("in-home")).toBeNull();
		});
	});

	describe("listContainers", () => {
		it("lists design and component folders", async () => {
			expect(await store.listContainers()).toEqual([]);
			await store.create(makeAnnotation({ id: "a" }));
			await store.create(
				makeAnnotation({
					id: "b",
					target: { kind: "design", designId: "other" },
				}),
			);
			await store.create(makeComponentAnnotation("c"));
			await store.writeSession("sess-1", new Date());
			const containers = await store.listContainers();
			expect(containers).toHaveLength(3);
			expect(containers).toEqual(
				expect.arrayContaining([
					designContainer,
					{ kind: "design", designId: "other" },
					componentContainer,
				]),
			);
		});

		it("does not mix up projects", async () => {
			await store.create(makeAnnotation());
			const other = new AnnotationStore({
				projectId: "proj-2",
				trickroomHome: home,
			});
			expect(await other.listContainers()).toEqual([]);
		});
	});

	describe("remove", () => {
		it("deletes when the predicate approves", async () => {
			await store.create(makeAnnotation());
			expect(
				await store.remove(designContainer, "ann-1", (current) => {
					expect(current.annotation.id).toBe("ann-1");
					return true;
				}),
			).toBe(true);
			expect(await store.read(designContainer, "ann-1")).toBeNull();
		});

		it("deletes without a predicate", async () => {
			await store.create(makeAnnotation());
			expect(await store.remove(designContainer, "ann-1")).toBe(true);
			expect(await store.read(designContainer, "ann-1")).toBeNull();
		});

		it("keeps the file when the predicate declines", async () => {
			await store.create(makeAnnotation());
			expect(await store.remove(designContainer, "ann-1", () => false)).toBe(
				false,
			);
			expect(await store.read(designContainer, "ann-1")).not.toBeNull();
		});

		it("returns false for a missing annotation without asking the predicate", async () => {
			let asked = false;
			expect(
				await store.remove(designContainer, "nope", () => {
					asked = true;
					return true;
				}),
			).toBe(false);
			expect(asked).toBe(false);
		});
	});

	describe("sessions", () => {
		it("reads back the time that was written", async () => {
			const at = new Date("2026-10-01T12:34:56.789Z");
			await store.writeSession("sess-1", at);
			const read = await store.readSessionLastCall("sess-1");
			expect(read?.getTime()).toBe(at.getTime());
		});

		it("overwrites an earlier call", async () => {
			await store.writeSession("sess-1", new Date("2026-10-01T12:00:00.000Z"));
			await store.writeSession("sess-1", new Date("2026-10-01T13:00:00.000Z"));
			expect((await store.readSessionLastCall("sess-1"))?.toISOString()).toBe(
				"2026-10-01T13:00:00.000Z",
			);
		});

		it("writes the session file shape", async () => {
			await store.writeSession("sess-1", new Date("2026-10-01T12:00:00.000Z"));
			expect(
				JSON.parse(await readFile(store.getSessionPath("sess-1"), "utf8")),
			).toEqual({
				version: 1,
				sessionId: "sess-1",
				lastCallAt: "2026-10-01T12:00:00.000Z",
			});
		});

		it("returns null for an unknown session", async () => {
			expect(await store.readSessionLastCall("unknown")).toBeNull();
		});

		it("returns null for a garbage session file", async () => {
			const filePath = store.getSessionPath("sess-bad");
			await mkdir(path.dirname(filePath), { recursive: true });
			await writeFile(filePath, "not json at all");
			expect(await store.readSessionLastCall("sess-bad")).toBeNull();
			await writeFile(
				filePath,
				JSON.stringify({
					version: 1,
					sessionId: "sess-bad",
					lastCallAt: "never",
				}),
			);
			expect(await store.readSessionLastCall("sess-bad")).toBeNull();
			await writeFile(
				filePath,
				JSON.stringify({
					version: 2,
					sessionId: "sess-bad",
					lastCallAt: "2026-10-01T12:00:00.000Z",
				}),
			);
			expect(await store.readSessionLastCall("sess-bad")).toBeNull();
		});
	});
});

describe("classifyAnnotationFile", () => {
	it("classifies a design annotation path", () => {
		expect(classifyAnnotationFile("designs/home/ann-1.json")).toEqual({
			container: { kind: "design", designId: "home" },
			annotationId: "ann-1",
		});
	});

	it("classifies a component annotation path", () => {
		expect(
			classifyAnnotationFile("systems/sys/components/button/ann-1.json"),
		).toEqual({
			container: { kind: "component", systemId: "sys", componentId: "button" },
			annotationId: "ann-1",
		});
	});

	it("accepts backslash separators", () => {
		expect(classifyAnnotationFile("designs\\home\\ann-1.json")).toEqual({
			container: { kind: "design", designId: "home" },
			annotationId: "ann-1",
		});
	});

	it("ignores session files", () => {
		expect(classifyAnnotationFile("sessions/sess-1.json")).toBeNull();
	});

	it("ignores temporary files", () => {
		expect(classifyAnnotationFile("designs/home/.x.json.123.tmp")).toBeNull();
		expect(classifyAnnotationFile("designs/home/x.json.123.tmp")).toBeNull();
	});

	it("ignores dot files", () => {
		expect(classifyAnnotationFile("designs/home/.hidden.json")).toBeNull();
		expect(classifyAnnotationFile("designs/.home/ann-1.json")).toBeNull();
		expect(
			classifyAnnotationFile("systems/.sys/components/b/ann-1.json"),
		).toBeNull();
	});

	it("ignores paths at the wrong depth or under the wrong folder", () => {
		for (const file of [
			"ann-1.json",
			"designs/ann-1.json",
			"designs/home/sub/ann-1.json",
			"systems/sys/ann-1.json",
			"systems/sys/components/ann-1.json",
			"systems/sys/components/button/sub/ann-1.json",
			"systems/sys/other/button/ann-1.json",
			"other/home/ann-1.json",
			"",
		]) {
			expect(classifyAnnotationFile(file), file).toBeNull();
		}
	});

	it("ignores non-json files", () => {
		expect(classifyAnnotationFile("designs/home/ann-1.txt")).toBeNull();
		expect(classifyAnnotationFile("designs/home/.json")).toBeNull();
	});
});

describe("annotation file cache", () => {
	let home: string;
	let store: AnnotationStore;
	const limits = { ...annotationFileCacheLimits };

	beforeEach(async () => {
		home = await mkdtemp(path.join(os.tmpdir(), "trickroom-annotation-cache-"));
		store = new AnnotationStore({ projectId: "proj-1", trickroomHome: home });
		resetAnnotationFileCache();
	});

	afterEach(async () => {
		Object.assign(annotationFileCacheLimits, limits);
		resetAnnotationFileCache();
		await rm(home, { recursive: true, force: true });
	});

	const seed = async (count: number) => {
		for (let index = 0; index < count; index += 1) {
			await store.create(
				makeAnnotation({
					id: `ann-${index}`,
					status: index === 0 ? "open" : "resolved",
				}),
			);
		}
	};

	const reads = () => ({ ...annotationFileReads });

	it("reads an unchanged folder once, however many listings follow", async () => {
		await seed(200);
		const first = reads();
		const listed = await store.list(designContainer);
		expect(listed.annotations).toHaveLength(200);
		expect(annotationFileReads.parsed - first.parsed).toBe(200);
		// Another store of the same home (a new tool call) shares the cache.
		const again = reads();
		const other = new AnnotationStore({
			projectId: "proj-1",
			trickroomHome: home,
		});
		for (let call = 0; call < 5; call += 1) {
			expect((await other.list(designContainer)).annotations).toHaveLength(200);
		}
		expect(annotationFileReads.parsed - again.parsed).toBe(0);
		expect(annotationFileReads.cached - again.cached).toBe(1000);
	});

	it("reads a file again after any write: a store's, a rename, an in-place edit", async () => {
		await seed(3);
		await store.list(designContainer);
		const before = reads();

		await store.update(designContainer, "ann-0", ({ annotation }) => ({
			annotation: appendEntry(annotation, "by-store"),
			result: null,
		}));
		const afterUpdate = await store.list(designContainer);
		expect(
			afterUpdate.annotations
				.find((entry) => entry.annotation.id === "ann-0")
				?.annotation.entries.map((entry) => entry.id),
		).toEqual(["entry-0", "by-store"]);
		expect(annotationFileReads.parsed - before.parsed).toBe(1);

		// Another process's write: a new file renamed into place.
		const filePath = store.getAnnotationPath(designContainer, "ann-1");
		const renamed = appendEntry(makeAnnotation({ id: "ann-1" }), "renamed");
		await writeFile(`${filePath}.tmp`, JSON.stringify(renamed));
		await rename(`${filePath}.tmp`, filePath);
		// An edit in place: same inode, other size and times.
		const inPlacePath = store.getAnnotationPath(designContainer, "ann-2");
		await writeFile(
			inPlacePath,
			JSON.stringify(appendEntry(makeAnnotation({ id: "ann-2" }), "in-place")),
		);
		const listed = await store.list(designContainer);
		const entriesOf = (id: string) =>
			listed.annotations
				.find((entry) => entry.annotation.id === id)
				?.annotation.entries.map((entry) => entry.id);
		expect(entriesOf("ann-1")).toEqual(["entry-0", "renamed"]);
		expect(entriesOf("ann-2")).toEqual(["entry-0", "in-place"]);

		await unlink(inPlacePath);
		expect(
			(await store.list(designContainer)).annotations.map(
				(entry) => entry.annotation.id,
			),
		).toEqual(["ann-0", "ann-1"]);
	});

	it("shares frozen annotations, so a caller cannot change what the next one reads", async () => {
		await seed(1);
		const [listed] = (await store.list(designContainer)).annotations;
		expect(Object.isFrozen(listed?.annotation.entries)).toBe(true);
		expect(() => {
			(listed?.annotation.entries as unknown[]).push("x");
		}).toThrow(TypeError);
		// Single reads (the write path) are fresh, mutable objects.
		const read = await store.read(designContainer, "ann-0");
		expect(Object.isFrozen(read?.annotation)).toBe(false);
	});

	it("stays within its bounds, least recently used out first", async () => {
		annotationFileCacheLimits.maxFiles = 2;
		await seed(3);
		await store.list(designContainer);
		expect(getAnnotationFileCacheSize().files).toBe(2);
		const fileBytes = (
			await stat(store.getAnnotationPath(designContainer, "ann-0"))
		).size;
		annotationFileCacheLimits.maxFiles = 50;
		annotationFileCacheLimits.maxBytes = fileBytes * 2;
		resetAnnotationFileCache();
		await store.list(designContainer);
		expect(getAnnotationFileCacheSize().bytes).toBeLessThanOrEqual(
			fileBytes * 2,
		);
		// Still correct when nothing fits.
		annotationFileCacheLimits.maxBytes = 1;
		resetAnnotationFileCache();
		expect((await store.list(designContainer)).annotations).toHaveLength(3);
		expect(getAnnotationFileCacheSize().files).toBe(0);
	});

	it("does not cache a file it cannot read", async () => {
		await seed(1);
		const broken = store.getAnnotationPath(designContainer, "broken");
		await writeFile(broken, "{ not json");
		const first = await store.list(designContainer);
		expect(first.problems.map((problem) => problem.annotationId)).toEqual([
			"broken",
		]);
		await writeFile(broken, JSON.stringify(makeAnnotation({ id: "broken" })));
		const second = await store.list(designContainer);
		expect(second.problems).toEqual([]);
		expect(second.annotations).toHaveLength(2);
	});
});

describe("beforeWrite", () => {
	let home: string;

	beforeEach(async () => {
		home = await mkdtemp(path.join(os.tmpdir(), "trickroom-annotation-guard-"));
	});

	afterEach(async () => {
		await rm(home, { recursive: true, force: true });
	});

	it("runs under the lock before every write, and a refusal writes nothing", async () => {
		await new AnnotationStore({
			projectId: "proj-1",
			trickroomHome: home,
		}).create(makeAnnotation());
		let calls = 0;
		let refuse = false;
		const guarded = new AnnotationStore({
			projectId: "proj-1",
			trickroomHome: home,
			beforeWrite: async () => {
				calls += 1;
				if (refuse) throw new Error("scope changed");
			},
		});
		const reply = ({ annotation }: { annotation: Annotation }) => ({
			annotation: appendEntry(annotation, `reply-${calls}`),
			result: null,
		});
		await guarded.update(designContainer, "ann-1", reply);
		// Nothing to write: not called.
		await guarded.update(designContainer, "ann-1", () => ({
			annotation: null,
			result: null,
		}));
		expect(calls).toBe(1);

		refuse = true;
		await expect(
			guarded.update(designContainer, "ann-1", reply),
		).rejects.toThrow("scope changed");
		await expect(
			guarded.updateMany(designContainer, ["ann-1"], async (current) => ({
				annotations: [...current.values()].map(
					(stored) => reply(stored).annotation,
				),
				result: null,
			})),
		).rejects.toThrow("scope changed");
		await expect(
			guarded.create(makeAnnotation({ id: "ann-2" })),
		).rejects.toThrow("scope changed");
		await expect(guarded.remove(designContainer, "ann-1")).rejects.toThrow(
			"scope changed",
		);
		await expect(guarded.guardWrite()).rejects.toThrow("scope changed");

		const stored = await guarded.read(designContainer, "ann-1");
		expect(stored?.annotation.entries).toHaveLength(2);
		expect(await guarded.read(designContainer, "ann-2")).toBeNull();
	});
});
