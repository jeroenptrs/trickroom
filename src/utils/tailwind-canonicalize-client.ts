import path from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import type {
	CanonicalizeRequest,
	CanonicalizeResponse,
} from "./tailwind-canonicalize-worker.ts";

/**
 * The main-thread side of `tailwind-canonicalize-worker.ts`: one worker per
 * process, started on first use. Each worker is a generation that owns the
 * requests sent to it. It holds the process open only while it has requests
 * pending, so a CLI run still exits. When it fails or exits, its own pending
 * requests are rejected, once, and the next request starts a new generation;
 * later events of a superseded worker touch nothing else.
 */

type Pending = {
	resolve: (results: string[]) => void;
	reject: (error: Error) => void;
};

type Generation = {
	worker: Worker;
	pending: Map<number, Pending>;
	ended: boolean;
};

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

/** A client over the worker at `workerFile`; tests point it at stand-ins. */
export const createCanonicalizeClient = (workerFile: string) => {
	let active: Generation | null = null;
	let nextId = 1;

	const end = (generation: Generation, error: Error) => {
		if (generation.ended) return;
		generation.ended = true;
		if (active === generation) active = null;
		const rejected = [...generation.pending.values()];
		generation.pending.clear();
		generation.worker.unref();
		for (const entry of rejected) entry.reject(error);
	};

	const start = (): Generation => {
		const generation: Generation = {
			worker: new Worker(workerFile),
			pending: new Map(),
			ended: false,
		};
		const { worker } = generation;
		worker.unref();
		worker.on("message", (response: CanonicalizeResponse) => {
			const entry = generation.pending.get(response.id);
			if (!entry) return;
			generation.pending.delete(response.id);
			if (generation.pending.size === 0) worker.unref();
			if (response.ok) entry.resolve(response.results);
			else entry.reject(new Error(response.message));
		});
		worker.on("error", (error) => end(generation, error));
		worker.on("exit", (code) =>
			end(
				generation,
				new Error(`The Tailwind canonicalization worker exited (${code}).`),
			),
		);
		return generation;
	};

	return {
		/**
		 * Each candidate as the system's Tailwind writes it, in order (see
		 * `canonicalizeTailwindCandidate`), computed in the worker.
		 */
		canonicalize: (
			system: { projectRoot: string; cssPath: string },
			candidates: readonly string[],
		): Promise<string[]> => {
			if (candidates.length === 0) return Promise.resolve([]);
			active ??= start();
			const generation = active;
			const id = nextId++;
			return new Promise<string[]>((resolve, reject) => {
				generation.pending.set(id, { resolve, reject });
				generation.worker.ref();
				generation.worker.postMessage({
					id,
					projectRoot: system.projectRoot,
					cssPath: system.cssPath,
					candidates: [...candidates],
				} satisfies CanonicalizeRequest);
			});
		},
	};
};

let client: ReturnType<typeof createCanonicalizeClient> | null = null;

/**
 * Each candidate as the system's Tailwind writes it, in order (see
 * `canonicalizeTailwindCandidate`), computed in this process's worker.
 */
export const canonicalizeTailwindCandidatesInWorker = (
	system: { projectRoot: string; cssPath: string },
	candidates: readonly string[],
): Promise<string[]> => {
	client ??= createCanonicalizeClient(workerPath());
	return client.canonicalize(system, candidates);
};
