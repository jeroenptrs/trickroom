import { createHash } from "node:crypto";

/**
 * The canonicalization worker's caches, kept apart from the worker so they
 * can be tested with stand-in systems (building real tables takes seconds).
 *
 * - **Warm systems**, by stylesheet content: a compiled system whose tables
 *   are built and the results computed on it. Systems whose stylesheets read
 *   the same text behave the same, so they share one. At most `warmSystems`,
 *   least recently used evicted; this is the only place a compiled system
 *   is kept, so it bounds what the worker holds.
 * - **Paths**: per entry stylesheet, the stamps of the files it read and the
 *   content key it loaded as. No compiled system, so a path whose content
 *   was evicted loads again (cheap) and builds again (the cost). At most
 *   `paths`, least recently used evicted.
 *
 * Every hit refreshes recency in both. Only `.ts` imports, so the worker can
 * import this from source under Node's type stripping.
 */

export type LoadedForCanonicalization<System> = {
	system: System;
	/** Every stylesheet the system read, concatenated (`cssSource`). */
	cssSource: string;
	fileStamps: ReadonlyMap<string, string | null>;
};

export type CanonicalizeCacheOptions<System> = {
	warmSystems: number;
	paths: number;
	load: (rootPath: string) => Promise<LoadedForCanonicalization<System>>;
	isFresh: (fileStamps: ReadonlyMap<string, string | null>) => Promise<boolean>;
	canonicalize: (system: System, candidate: string) => string;
};

type Warm<System> = { system: System; results: Map<string, string> };

type PathEntry = {
	fileStamps: ReadonlyMap<string, string | null>;
	contentKey: string;
};

/** Moves `key` to the most recent end of an insertion-ordered map. */
const touch = <Value>(map: Map<string, Value>, key: string, value: Value) => {
	map.delete(key);
	map.set(key, value);
};

const evictBeyond = (map: Map<string, unknown>, limit: number) => {
	while (map.size > limit) {
		const oldest = map.keys().next();
		if (oldest.done) return;
		map.delete(oldest.value);
	}
};

export const createCanonicalizeCache = <System>(
	options: CanonicalizeCacheOptions<System>,
) => {
	const warmByContent = new Map<string, Warm<System>>();
	const paths = new Map<string, PathEntry>();
	const loading = new Map<string, Promise<Warm<System>>>();
	let built = 0;

	const remember = (rootPath: string, entry: PathEntry, warm: Warm<System>) => {
		touch(paths, rootPath, entry);
		evictBeyond(paths, options.paths);
		touch(warmByContent, entry.contentKey, warm);
		evictBeyond(warmByContent, options.warmSystems);
	};

	const loadWarm = async (rootPath: string): Promise<Warm<System>> => {
		const loaded = await options.load(rootPath);
		const contentKey = createHash("sha256")
			.update(loaded.cssSource)
			.digest("hex");
		let warm = warmByContent.get(contentKey);
		if (!warm) {
			warm = { system: loaded.system, results: new Map() };
			built += 1;
		}
		remember(rootPath, { fileStamps: loaded.fileStamps, contentKey }, warm);
		return warm;
	};

	const warmFor = async (rootPath: string): Promise<Warm<System>> => {
		const entry = paths.get(rootPath);
		if (entry && (await options.isFresh(entry.fileStamps))) {
			const warm = warmByContent.get(entry.contentKey);
			if (warm) {
				remember(rootPath, entry, warm);
				return warm;
			}
		}
		// One load per path at a time, so concurrent requests share it.
		let pending = loading.get(rootPath);
		if (!pending) {
			pending = loadWarm(rootPath).finally(() => loading.delete(rootPath));
			loading.set(rootPath, pending);
		}
		return pending;
	};

	return {
		canonicalize: async (
			rootPath: string,
			candidates: readonly string[],
		): Promise<string[]> => {
			const { system, results } = await warmFor(rootPath);
			return candidates.map((candidate) => {
				let canonical = results.get(candidate);
				if (canonical === undefined) {
					canonical = options.canonicalize(system, candidate);
					results.set(candidate, canonical);
				}
				return canonical;
			});
		},
		/** What is held, for tests: warm systems and paths, and how many were built. */
		stats: () => ({
			warmSystems: warmByContent.size,
			paths: paths.size,
			built,
		}),
	};
};
