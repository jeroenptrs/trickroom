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

export type CanonicalizeCacheOptions<System, Result, Contextual = never> = {
	warmSystems: number;
	paths: number;
	load: (rootPath: string) => Promise<LoadedForCanonicalization<System>>;
	isFresh: (fileStamps: ReadonlyMap<string, string | null>) => Promise<boolean>;
	/** One candidate's result, computed once per warm system. */
	canonicalize: (system: System, candidate: string) => Result;
	/**
	 * One check of a class among other classes, computed once per warm
	 * system and `key` (at most `contextResults` kept per system).
	 */
	contextual?: (system: System, check: ContextualCheck) => Contextual;
	contextResults?: number;
};

/** A check whose result depends on the classes only, keyed by them. */
export type ContextualCheck = {
	classes: readonly string[];
	candidate: string;
	canonical: string;
};

type Warm<System, Result, Contextual> = {
	system: System;
	results: Map<string, Result>;
	contextual: Map<string, Contextual>;
};

/** The same classes in any order, repeats included, are one key. */
const contextKey = ({ classes, candidate, canonical }: ContextualCheck) =>
	JSON.stringify([[...new Set(classes)].sort(), candidate, canonical]);

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

export const createCanonicalizeCache = <System, Result, Contextual = never>(
	options: CanonicalizeCacheOptions<System, Result, Contextual>,
) => {
	const warmByContent = new Map<string, Warm<System, Result, Contextual>>();
	const paths = new Map<string, PathEntry>();
	const loading = new Map<string, Promise<Warm<System, Result, Contextual>>>();
	let built = 0;

	const remember = (
		rootPath: string,
		entry: PathEntry,
		warm: Warm<System, Result, Contextual>,
	) => {
		touch(paths, rootPath, entry);
		evictBeyond(paths, options.paths);
		touch(warmByContent, entry.contentKey, warm);
		evictBeyond(warmByContent, options.warmSystems);
	};

	const loadWarm = async (
		rootPath: string,
	): Promise<Warm<System, Result, Contextual>> => {
		const loaded = await options.load(rootPath);
		const contentKey = createHash("sha256")
			.update(loaded.cssSource)
			.digest("hex");
		let warm = warmByContent.get(contentKey);
		if (!warm) {
			warm = {
				system: loaded.system,
				results: new Map(),
				contextual: new Map(),
			};
			built += 1;
		}
		remember(rootPath, { fileStamps: loaded.fileStamps, contentKey }, warm);
		return warm;
	};

	const warmFor = async (
		rootPath: string,
	): Promise<Warm<System, Result, Contextual>> => {
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
		): Promise<Result[]> => {
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
		/** Each check's result among its classes (`options.contextual`), in order. */
		contextual: async (
			rootPath: string,
			checks: readonly ContextualCheck[],
		): Promise<Contextual[]> => {
			const compute = options.contextual;
			if (!compute) throw new Error("This cache has no contextual check");
			const { system, contextual } = await warmFor(rootPath);
			const limit = options.contextResults ?? 10_000;
			return checks.map((check) => {
				const key = contextKey(check);
				let result = contextual.get(key);
				if (result === undefined) {
					result = compute(system, check);
					if (contextual.size >= limit) contextual.clear();
					contextual.set(key, result);
				}
				return result;
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
