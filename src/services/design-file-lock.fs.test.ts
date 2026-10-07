import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withFileLock } from "./design-file-lock";

/**
 * Writing a new lock's contents can fail after the exclusive create (a full
 * disk); the failure is injected on the file handle.
 */

const injected = vi.hoisted(() => ({
	/** Lock paths whose next handle write fails with this code. */
	writeFailures: new Map<string, string>(),
}));

vi.mock("node:fs/promises", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:fs/promises")>();
	return {
		...actual,
		open: (async (...args: Parameters<typeof actual.open>) => {
			const handle = await actual.open(...args);
			const code = injected.writeFailures.get(String(args[0]));
			if (!code) return handle;
			injected.writeFailures.delete(String(args[0]));
			const writeFile = handle.writeFile.bind(handle);
			handle.writeFile = (async (data: string) => {
				// Part of the contents lands before the failure.
				await writeFile(data.slice(0, 5));
				throw Object.assign(new Error(`${code}: injected write failure`), {
					code,
				});
			}) as typeof handle.writeFile;
			return handle;
		}) as typeof actual.open,
	};
});

describe("file lock initialisation", () => {
	let directory: string;
	let lockPath: string;

	beforeEach(async () => {
		directory = await mkdtemp(path.join(os.tmpdir(), "trickroom-lock-init-"));
		lockPath = path.join(directory, "lint-report.json.lock");
	});

	afterEach(async () => {
		injected.writeFailures.clear();
		await rm(directory, { recursive: true, force: true });
	});

	it("removes a lock whose contents could not be written, so it blocks no one", async () => {
		injected.writeFailures.set(lockPath, "ENOSPC");
		const failed = await withFileLock(lockPath, async () => "never").catch(
			(error: unknown) => error,
		);
		expect(failed).toMatchObject({ code: "ENOSPC" });
		expect(await readdir(directory)).toEqual([]);

		// The next run gets the lock at once, without waiting for it to age.
		await expect(
			withFileLock(lockPath, async () => "acquired", { acquireTimeoutMs: 50 }),
		).resolves.toBe("acquired");
		expect(await readdir(directory)).toEqual([]);
	});
});
