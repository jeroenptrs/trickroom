import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { RecipeTemplateNode } from "../types";
import { createDesignSystemStorage } from "./design-system-store";
import { readSystemComponentManifest } from "./system-component-manifest-service";
import {
	createSystemComponentDraft,
	updateSystemComponent,
} from "./system-component-operations";

// The HTTP server and an MCP stdio process both write `components.json`.
// A writer holds the manifest's cross-process lock from its revision check
// through `aroundWrite` (annotation change records and reverts wait for an
// annotation lock there) and the store, so another process's write cannot
// land in between and be overwritten.

const operationsPath = fileURLToPath(
	new URL("./system-component-operations.ts", import.meta.url),
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

// Writer A: passes its revision check, then (like a revert waiting for the
// annotation lock) holds inside aroundWrite until the parent says go.
const worker = `
import { existsSync, writeFileSync } from "node:fs";
const [operationsUrl, projectRoot, systemId, componentId, expectedRevision, insidePath, releasePath, root] = process.argv.slice(2);
const { updateSystemComponent } = await import(operationsUrl);
await updateSystemComponent(
	projectRoot,
	systemId,
	componentId,
	{ draft: { root: JSON.parse(root) } },
	{
		expectedRevision,
		aroundWrite: async (write) => {
			writeFileSync(insidePath, "inside");
			const deadline = Date.now() + 4000;
			while (!existsSync(releasePath) && Date.now() < deadline) {
				await new Promise((resolve) => setTimeout(resolve, 20));
			}
			await write();
		},
	},
);
`;

const template = (className: string): RecipeTemplateNode => ({
	path: "root",
	library: "trickroom",
	component: "container",
	className,
});

const waitFor = async (filePath: string, timeoutMs = 10_000) => {
	const deadline = Date.now() + timeoutMs;
	while (!existsSync(filePath)) {
		if (Date.now() > deadline) throw new Error(`${filePath} never appeared`);
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
};

let root: string;
let projectRoot: string;
let systemId: string;
let componentId: string;

beforeEach(async () => {
	root = await mkdtemp(path.join(os.tmpdir(), "trickroom-manifest-process-"));
	projectRoot = path.join(root, "project");
	await mkdir(path.join(projectRoot, ".trickroom"), { recursive: true });
	systemId = (
		await createDesignSystemStorage(projectRoot, {
			systemName: "Core",
			cssPath: "src/core.css",
		})
	).systemId;
	const initial = await readSystemComponentManifest(projectRoot, systemId);
	componentId = (
		await createSystemComponentDraft(
			projectRoot,
			systemId,
			{ slug: "button", name: "Button", draft: { root: template("p-1") } },
			{ expectedRevision: initial.revision },
		)
	).componentId;
});

afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

describe.skipIf(process.platform === "win32")(
	"component manifest writes across processes",
	() => {
		it("a write cannot land between another process's revision check and its store", async () => {
			const hookPath = path.join(root, "hook.mjs");
			const workerPath = path.join(root, "worker.mjs");
			const insidePath = path.join(root, "inside");
			const releasePath = path.join(root, "release");
			await writeFile(hookPath, resolveHook, "utf8");
			await writeFile(workerPath, worker, "utf8");
			const before = await readSystemComponentManifest(projectRoot, systemId);

			const writerA = new Promise<void>((resolve, reject) => {
				const child = spawn(
					process.execPath,
					[
						"--no-warnings",
						"--import",
						pathToFileURL(hookPath).href,
						workerPath,
						pathToFileURL(operationsPath).href,
						projectRoot,
						systemId,
						componentId,
						before.revision,
						insidePath,
						releasePath,
						JSON.stringify(template("p-2")),
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
						: reject(new Error(`writer A exited ${code}: ${stderr}`)),
				);
			});

			// A has checked the revision and holds inside aroundWrite. B, in
			// this process, writes against the same revision.
			await waitFor(insidePath);
			const writerB = updateSystemComponent(
				projectRoot,
				systemId,
				componentId,
				{ draft: { root: template("bg-cyan-500") } },
				{ expectedRevision: before.revision },
			).then(
				() => "written" as const,
				(error: Error & { code?: string }) => error.code ?? error.message,
			);
			await new Promise((resolve) => setTimeout(resolve, 400));
			await writeFile(releasePath, "go", "utf8");
			await writerA;

			// B waited for A's lock, then found the revision moved on.
			expect(await writerB).toBe("STALE_WRITE");
			const after = await readSystemComponentManifest(projectRoot, systemId);
			expect(
				after.manifest.components[componentId]?.draft?.root.className,
			).toBe("p-2");
		}, 30_000);
	},
);
