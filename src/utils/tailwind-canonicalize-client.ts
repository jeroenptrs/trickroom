import path from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import type {
	CanonicalizeRequest,
	CanonicalizeResponse,
} from "./tailwind-canonicalize-worker.ts";

/**
 * The main-thread side of `tailwind-canonicalize-worker.ts`: one worker per
 * process, started on first use. It holds the process open only while a
 * request is pending, so a CLI run still exits. A worker that fails or exits
 * rejects what is pending and is replaced on the next request.
 */

type Pending = {
	resolve: (results: string[]) => void;
	reject: (error: Error) => void;
};

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();

/**
 * The worker module next to this one: the `.ts` source when this runs from
 * source (the dev server, tests), the bundle when it runs from `dist/`, where
 * every entry and the worker bundle sit side by side.
 */
const workerPath = () => {
	const here = fileURLToPath(import.meta.url);
	const extension = path.extname(here) === ".ts" ? ".ts" : ".js";
	return path.join(
		path.dirname(here),
		`tailwind-canonicalize-worker${extension}`,
	);
};

const failAll = (error: Error) => {
	for (const entry of pending.values()) entry.reject(error);
	pending.clear();
};

const getWorker = (): Worker => {
	if (worker) return worker;
	const started = new Worker(workerPath());
	started.unref();
	started.on("message", (response: CanonicalizeResponse) => {
		const entry = pending.get(response.id);
		if (!entry) return;
		pending.delete(response.id);
		if (pending.size === 0) started.unref();
		if (response.ok) entry.resolve(response.results);
		else entry.reject(new Error(response.message));
	});
	started.on("error", (error) => {
		if (worker === started) worker = null;
		failAll(error);
	});
	started.on("exit", (code) => {
		if (worker === started) worker = null;
		failAll(
			new Error(`The Tailwind canonicalization worker exited (${code}).`),
		);
	});
	worker = started;
	return started;
};

/**
 * Each candidate as the system's Tailwind writes it, in order (see
 * `canonicalizeTailwindCandidate`), computed in the worker.
 */
export const canonicalizeTailwindCandidatesInWorker = (
	system: { projectRoot: string; cssPath: string },
	candidates: readonly string[],
): Promise<string[]> => {
	if (candidates.length === 0) return Promise.resolve([]);
	const active = getWorker();
	const id = nextId++;
	return new Promise<string[]>((resolve, reject) => {
		pending.set(id, { resolve, reject });
		active.ref();
		active.postMessage({
			id,
			projectRoot: system.projectRoot,
			cssPath: system.cssPath,
			candidates: [...candidates],
		} satisfies CanonicalizeRequest);
	});
};
