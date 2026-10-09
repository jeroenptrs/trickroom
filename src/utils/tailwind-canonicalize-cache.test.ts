import { describe, expect, it } from "vitest";
import { createCanonicalizeCache } from "./tailwind-canonicalize-cache";

/**
 * Stand-in systems: each load returns a new object for the path's current
 * content, and `canonicalize` records which system answered, so a test can
 * tell a warm reuse from a fresh build.
 */
const harness = (options: { warmSystems?: number; paths?: number } = {}) => {
	const content = new Map<string, string>();
	const stamps = new Map<string, number>();
	let loads = 0;
	const cache = createCanonicalizeCache<{ id: number; content: string }>({
		warmSystems: options.warmSystems ?? 4,
		paths: options.paths ?? 32,
		load: async (rootPath) => {
			loads += 1;
			const css = content.get(rootPath) ?? "";
			return {
				system: { id: loads, content: css },
				cssSource: css,
				fileStamps: new Map([[rootPath, String(stamps.get(rootPath) ?? 0)]]),
			};
		},
		isFresh: async (fileStamps) =>
			[...fileStamps].every(
				([file, stamp]) => stamp === String(stamps.get(file) ?? 0),
			),
		canonicalize: (system, candidate) => `${candidate}@${system.id}`,
	});
	return {
		cache,
		write: (rootPath: string, css: string) => {
			content.set(rootPath, css);
			stamps.set(rootPath, (stamps.get(rootPath) ?? 0) + 1);
		},
		loads: () => loads,
		/** Canonicalizes one class and returns the stand-in id that answered. */
		systemOf: async (rootPath: string, candidate = "p-2") =>
			(await cache.canonicalize(rootPath, [candidate]))[0].split("@")[1],
	};
};

describe("createCanonicalizeCache", () => {
	it("evicts the least recently used warm system, counting every hit", async () => {
		const { cache, write, systemOf } = harness({ warmSystems: 4 });
		for (const name of ["a", "b", "c", "d", "e"]) write(`/${name}.css`, name);
		for (const name of ["a", "b", "c", "d"]) await systemOf(`/${name}.css`);
		// A is used again, so B is now the least recent.
		await systemOf("/a.css");
		await systemOf("/e.css");
		expect(cache.stats()).toMatchObject({ warmSystems: 4, built: 5 });
		const a = await systemOf("/a.css");
		expect(cache.stats().built).toBe(5);
		await systemOf("/b.css");
		expect(cache.stats().built).toBe(6);
		expect(a).toBe("1");
	});

	it("reuses warm tables for identical content, also after its path was evicted", async () => {
		const { cache, write, systemOf, loads } = harness({ paths: 2 });
		write("/one.css", "same");
		write("/two.css", "other");
		write("/three.css", "third");
		write("/four.css", "same");
		const first = await systemOf("/one.css");
		await systemOf("/two.css");
		await systemOf("/three.css");
		expect(cache.stats().paths).toBe(2);
		// one.css left the path index; another path with its text, and
		// one.css itself, load again but answer from the same warm system.
		expect(await systemOf("/four.css")).toBe(first);
		expect(await systemOf("/one.css")).toBe(first);
		expect(cache.stats().built).toBe(3);
		expect(loads()).toBe(5);
	});

	it("holds at most the bound of compiled systems, however many paths load", async () => {
		const { cache, write, systemOf } = harness({ warmSystems: 2, paths: 3 });
		for (let index = 0; index < 6; index += 1) {
			write(`/${index}.css`, `content ${index}`);
			await systemOf(`/${index}.css`);
		}
		expect(cache.stats()).toEqual({ warmSystems: 2, paths: 3, built: 6 });
	});

	it("loads again when a file changes, and builds only for new content", async () => {
		const { cache, write, systemOf, loads } = harness();
		write("/app.css", "v1");
		const v1 = await systemOf("/app.css");
		expect(await systemOf("/app.css")).toBe(v1);
		expect(loads()).toBe(1);
		write("/app.css", "v2");
		const v2 = await systemOf("/app.css");
		expect(v2).not.toBe(v1);
		write("/app.css", "v1");
		expect(await systemOf("/app.css")).toBe(v1);
		expect(cache.stats().built).toBe(2);
		expect(loads()).toBe(3);
	});

	it("shares one load between concurrent requests for a path", async () => {
		const { write, systemOf, loads } = harness();
		write("/app.css", "v1");
		const [first, second] = await Promise.all([
			systemOf("/app.css", "p-2"),
			systemOf("/app.css", "m-2"),
		]);
		expect(first).toBe(second);
		expect(loads()).toBe(1);
	});
});
