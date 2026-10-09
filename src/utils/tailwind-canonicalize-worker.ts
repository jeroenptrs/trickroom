import { createHash } from "node:crypto";
import { parentPort } from "node:worker_threads";
import {
	loadCachedTailwindDesignSystem,
	type TailwindDesignSystem,
} from "./tailwind-design-system-loader.ts";
import { canonicalizeTailwindCandidate } from "./tailwind-utility-inspector.ts";

/**
 * Canonicalizes classes off the main thread. The first canonicalization on a
 * compiled system builds Tailwind's lookup tables, seconds of synchronous
 * work, which would stall every request of the server. The compiled system
 * comes from `loadCachedTailwindDesignSystem` (this worker's own cache,
 * checked against the stamps of every stylesheet it read), and results are
 * kept per compiled system, so a CSS change drops both. Compiled systems
 * whose stylesheets read the same text (every project on the default theme,
 * say) behave the same, so they share one set of warm tables and results:
 * the most recent few are kept by content.
 *
 * Runs bundled (`dist/tailwind-canonicalize-worker.js`) or from source under
 * Node's type stripping, so it imports only `.ts` modules that need nothing
 * else. The client is `tailwind-canonicalize-client.ts`.
 */

export type CanonicalizeRequest = {
	id: number;
	projectRoot: string;
	cssPath: string;
	candidates: string[];
};

export type CanonicalizeResponse =
	| { id: number; ok: true; results: string[] }
	| { id: number; ok: false; message: string };

type Warm = {
	designSystem: TailwindDesignSystem;
	results: Map<string, string>;
};

/** Warm systems by stylesheet content, most recently used last. */
const warmByContent = new Map<string, Warm>();
const WARM_SYSTEMS = 4;
const warmByLoaded = new WeakMap<TailwindDesignSystem, Warm>();

const warmFor = (loaded: TailwindDesignSystem, cssSource: string): Warm => {
	const known = warmByLoaded.get(loaded);
	if (known) return known;
	const key = createHash("sha256").update(cssSource).digest("hex");
	let warm = warmByContent.get(key);
	if (warm) {
		warmByContent.delete(key);
	} else {
		warm = { designSystem: loaded, results: new Map() };
		const oldest = warmByContent.keys().next();
		if (warmByContent.size >= WARM_SYSTEMS && !oldest.done) {
			warmByContent.delete(oldest.value);
		}
	}
	warmByContent.set(key, warm);
	warmByLoaded.set(loaded, warm);
	return warm;
};

const canonicalize = async ({
	projectRoot,
	cssPath,
	candidates,
}: CanonicalizeRequest): Promise<string[]> => {
	const loaded = await loadCachedTailwindDesignSystem({ projectRoot, cssPath });
	const { designSystem, results } = warmFor(
		loaded.designSystem,
		loaded.cssSource,
	);
	return candidates.map((candidate) => {
		let canonical = results.get(candidate);
		if (canonical === undefined) {
			canonical = canonicalizeTailwindCandidate(designSystem, candidate);
			results.set(candidate, canonical);
		}
		return canonical;
	});
};

parentPort?.on("message", (request: CanonicalizeRequest) => {
	canonicalize(request).then(
		(canonical) =>
			parentPort?.postMessage({
				id: request.id,
				ok: true,
				results: canonical,
			} satisfies CanonicalizeResponse),
		(error: unknown) =>
			parentPort?.postMessage({
				id: request.id,
				ok: false,
				message: error instanceof Error ? error.message : String(error),
			} satisfies CanonicalizeResponse),
	);
});
