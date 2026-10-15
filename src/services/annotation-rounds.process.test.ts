import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listAnnotations } from "./annotation-service";
import { AnnotationStore } from "./annotation-store";
import type { AnnotationContainer } from "./annotations.types";

// Two processes (two Trickroom servers on one home, say) send into the same
// design at once. The round lock holds across processes: they open one
// round between them, and every annotation lands in it.

const roundsPath = fileURLToPath(
	new URL("./annotation-rounds.ts", import.meta.url),
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
const [roundsUrl, storeUrl, home, label, count, startAt] = process.argv.slice(2);
const { sendAnnotations } = await import(roundsUrl);
const { AnnotationStore } = await import(storeUrl);
const store = new AnnotationStore({ projectId: "proj-1", trickroomHome: home });
const design = { name: "Home", boards: [] };
while (Date.now() < Number(startAt)) {}
for (let index = 0; index < Number(count); index += 1) {
	const result = await sendAnnotations({ store }, {
		container: { kind: "design", designId: "home" },
		scope: { branch: "main", worktreePath: "/work" },
		by: { role: "human" },
		drafts: [0, 1].map((part) => ({
			key: label + "-" + index + "-" + part,
			target: { kind: "design", designId: "home" },
			body: label + " " + index + " " + part,
			design: { design, revision: "r1" },
		})),
	});
	if (result.failed.length > 0) throw new Error(JSON.stringify(result.failed));
}
`;

const container: AnnotationContainer = { kind: "design", designId: "home" };

let root: string;
let home: string;

beforeEach(async () => {
	root = await mkdtemp(path.join(os.tmpdir(), "trickroom-round-process-"));
	home = path.join(root, "home");
});

afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

describe.skipIf(process.platform === "win32")("rounds across processes", () => {
	it("opens one round between two processes sending at once", async () => {
		const hookPath = path.join(root, "hook.mjs");
		const workerPath = path.join(root, "worker.mjs");
		await writeFile(hookPath, resolveHook, "utf8");
		await writeFile(workerPath, worker, "utf8");
		const startAt = String(Date.now() + 1500);
		const run = (label: string) =>
			new Promise<void>((resolve, reject) => {
				const child = spawn(
					process.execPath,
					[
						"--no-warnings",
						"--import",
						pathToFileURL(hookPath).href,
						workerPath,
						pathToFileURL(roundsPath).href,
						pathToFileURL(
							fileURLToPath(new URL("./annotation-store.ts", import.meta.url)),
						).href,
						home,
						label,
						"5",
						startAt,
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
						: reject(new Error(`exited ${code}: ${stderr}`)),
				);
			});
		await Promise.all([run("a"), run("b")]);

		const store = new AnnotationStore({
			projectId: "proj-1",
			trickroomHome: home,
		});
		const { rounds, problems } = await store.listRounds(container);
		expect(problems).toEqual([]);
		expect(rounds).toHaveLength(1);
		const round = rounds[0];
		expect(round?.sends).toHaveLength(10);
		expect(round?.annotationIds).toHaveLength(20);
		// Each send's annotations are listed together, in draft order.
		for (const send of round?.sends ?? []) {
			expect(send.annotationIds).toHaveLength(2);
		}
		const { annotations } = await listAnnotations(
			{ store },
			{
				container,
				scope: { branch: "main", worktreePath: "/work" },
				landedOnly: true,
			},
		);
		expect(annotations).toHaveLength(20);
		expect(new Set(annotations.map((view) => view.roundId))).toEqual(
			new Set([round?.id]),
		);
	}, 60_000);
});
