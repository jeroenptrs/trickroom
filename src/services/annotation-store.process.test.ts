import { spawn } from "node:child_process";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	AnnotationStore,
	annotationFileReads,
	resetAnnotationFileCache,
} from "./annotation-store";
import type { Annotation, AnnotationContainer } from "./annotations.types";

// The HTTP server and an MCP stdio process may reach the Trickroom home
// through different paths (a symlink, a relative TRICKROOM_HOME). Their
// writes to one annotation must still serialise: the lock identity is the
// canonical path, not the path each was given.

const storePath = fileURLToPath(
	new URL("./annotation-store.ts", import.meta.url),
);

const resolveHook = `
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";

registerHooks({
	resolve(specifier, context, next) {
		if (specifier.startsWith(".") && context.parentURL?.startsWith("file:")) {
			const url = new URL(specifier, context.parentURL);
			const filePath = fileURLToPath(url);
			if (!existsSync(filePath) || !/\\.[cm]?[jt]s$/.test(filePath)) {
				for (const extension of [".ts", "/index.ts"]) {
					if (existsSync(filePath + extension)) {
						return next(url.href + extension, context);
					}
				}
			}
		}
		return next(specifier, context);
	},
});
`;

const worker = `
const [storeUrl, home, label, count, startAt] = process.argv.slice(2);
const { AnnotationStore } = await import(storeUrl);
const store = new AnnotationStore({ projectId: "proj-1", trickroomHome: home });
while (Date.now() < Number(startAt)) {}
for (let index = 0; index < Number(count); index += 1) {
	await store.update({ kind: "design", designId: "home" }, "ann-1", ({ annotation }) => ({
		annotation: {
			...annotation,
			entries: [
				...annotation.entries,
				{
					id: label + "-" + index,
					kind: "reply",
					at: "2026-10-01T11:00:00.000Z",
					by: { role: "agent", sessionId: label },
					body: label,
				},
			],
		},
		result: null,
	}));
}
`;

const container: AnnotationContainer = { kind: "design", designId: "home" };

const annotation = (): Annotation => ({
	version: 1,
	id: "ann-1",
	projectId: "proj-1",
	target: { kind: "design", designId: "home" },
	branch: "main",
	worktreePath: "/work",
	snapshot: { branch: "main", worktreePath: "/work" },
	status: "open",
	createdAt: "2026-10-01T10:00:00.000Z",
	updatedAt: "2026-10-01T10:00:00.000Z",
	entries: [],
	transitions: [
		{
			from: null,
			to: "open",
			at: "2026-10-01T10:00:00.000Z",
			by: { role: "human" },
		},
	],
});

let root: string;
let home: string;
let alias: string;

beforeEach(async () => {
	root = await mkdtemp(path.join(os.tmpdir(), "trickroom-annotation-alias-"));
	home = path.join(root, "home");
	alias = path.join(root, "home-link");
	await new AnnotationStore({
		projectId: "proj-1",
		trickroomHome: home,
	}).create(annotation());
	await symlink(home, alias, "dir");
});

afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

const entryCount = async () =>
	(
		await new AnnotationStore({
			projectId: "proj-1",
			trickroomHome: home,
		}).read(container, "ann-1")
	)?.annotation.entries.length;

describe.skipIf(process.platform === "win32")("aliased Trickroom homes", () => {
	it("serialises two stores in one process, one through a symlink", async () => {
		const stores = [home, alias].map(
			(trickroomHome) =>
				new AnnotationStore({ projectId: "proj-1", trickroomHome }),
		);
		await Promise.all(
			Array.from({ length: 20 }, (_, index) =>
				(stores[index % 2] as AnnotationStore).update(
					container,
					"ann-1",
					({ annotation: current }) => ({
						annotation: {
							...current,
							entries: [
								...current.entries,
								{
									id: `entry-${index}`,
									kind: "remark",
									at: "2026-10-01T11:00:00.000Z",
									by: { role: "human" },
									body: String(index),
								},
							],
						},
						result: null,
					}),
				),
			),
		);
		expect(await entryCount()).toBe(20);
	});

	it("lists what another process wrote after this one cached the file", async () => {
		const hookPath = path.join(root, "hook.mjs");
		const workerPath = path.join(root, "worker.mjs");
		await writeFile(hookPath, resolveHook, "utf8");
		await writeFile(workerPath, worker, "utf8");
		resetAnnotationFileCache();
		const reader = new AnnotationStore({
			projectId: "proj-1",
			trickroomHome: home,
		});
		const entriesListed = async () =>
			(await reader.list(container)).annotations[0]?.annotation.entries.length;
		expect(await entriesListed()).toBe(0);
		expect(await entriesListed()).toBe(0);
		expect(annotationFileReads).toMatchObject({ parsed: 1, cached: 1 });
		await new Promise<void>((resolve, reject) => {
			const child = spawn(
				process.execPath,
				[
					"--no-warnings",
					"--import",
					pathToFileURL(hookPath).href,
					workerPath,
					pathToFileURL(storePath).href,
					home,
					"other",
					"3",
					String(Date.now()),
				],
				{ stdio: ["ignore", "pipe", "pipe"] },
			);
			let stderr = "";
			child.stderr.on("data", (chunk) => {
				stderr += chunk;
			});
			child.on("error", reject);
			child.on("exit", (code) =>
				code === 0 ? resolve() : reject(new Error(`exited ${code}: ${stderr}`)),
			);
		});
		expect(await entriesListed()).toBe(3);
		expect(annotationFileReads.parsed).toBe(2);
		resetAnnotationFileCache();
	}, 30_000);

	it("serialises two processes, one through a symlink", async () => {
		const hookPath = path.join(root, "hook.mjs");
		const workerPath = path.join(root, "worker.mjs");
		await writeFile(hookPath, resolveHook, "utf8");
		await writeFile(workerPath, worker, "utf8");
		const perWriter = 15;
		const startAt = Date.now() + 1_500;
		await Promise.all(
			[home, alias].map(
				(trickroomHome, index) =>
					new Promise<void>((resolve, reject) => {
						const child = spawn(
							process.execPath,
							[
								"--no-warnings",
								"--import",
								pathToFileURL(hookPath).href,
								workerPath,
								pathToFileURL(storePath).href,
								trickroomHome,
								`writer-${index}`,
								String(perWriter),
								String(startAt),
							],
							{ stdio: ["ignore", "pipe", "pipe"] },
						);
						let stderr = "";
						child.stderr.on("data", (chunk) => {
							stderr += chunk;
						});
						child.on("error", reject);
						child.on("exit", (code) =>
							code === 0
								? resolve()
								: reject(
										new Error(`writer-${index} exited ${code}: ${stderr}`),
									),
						);
					}),
			),
		);
		expect(await entryCount()).toBe(perWriter * 2);
	}, 30_000);
});
