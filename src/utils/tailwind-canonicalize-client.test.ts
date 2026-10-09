import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { canonicalizeTailwindCandidatesInWorker } from "./tailwind-canonicalize-client";

const tempProjectRoots: string[] = [];

const createProject = async (css: string) => {
	const projectRoot = await mkdtemp(
		path.join(process.cwd(), ".tmp-tailwind-canonicalize-"),
	);
	tempProjectRoots.push(projectRoot);
	await mkdir(path.join(projectRoot, "src"), { recursive: true });
	await writeFile(path.join(projectRoot, "src", "index.css"), css, "utf8");
	return { projectRoot, cssPath: "src/index.css" };
};

afterEach(() =>
	Promise.all(
		tempProjectRoots
			.splice(0)
			.map((projectRoot) => rm(projectRoot, { force: true, recursive: true })),
	),
);

describe("canonicalizeTailwindCandidatesInWorker", () => {
	it("keeps the event loop free while a cold system builds its tables", async () => {
		const system = await createProject('@import "tailwindcss";\n');
		let zeroDelayFired = false;
		let ticks = 0;
		let last = performance.now();
		let longestGap = 0;
		const interval = setInterval(() => {
			const now = performance.now();
			longestGap = Math.max(longestGap, now - last);
			last = now;
			ticks += 1;
		}, 10);
		try {
			const pending = canonicalizeTailwindCandidatesInWorker(system, [
				"bg-[#FFF]",
				"p-2",
			]);
			setTimeout(() => {
				zeroDelayFired = true;
			}, 0);
			const started = performance.now();
			expect(await pending).toEqual(["bg-white", "p-2"]);
			const elapsed = performance.now() - started;
			expect(zeroDelayFired).toBe(true);
			// The cold build takes seconds; on the main thread the loop would
			// stall for all of it. Allow for a loaded test machine.
			expect(longestGap).toBeLessThan(Math.max(500, elapsed / 2));
			expect(ticks).toBeGreaterThan(0);
		} finally {
			clearInterval(interval);
		}
	}, 30_000);

	it("recomputes after the system CSS changes", async () => {
		const system = await createProject('@import "tailwindcss";\n');
		expect(
			await canonicalizeTailwindCandidatesInWorker(system, ["bg-[#123456]"]),
		).toEqual(["bg-[#123456]"]);
		await writeFile(
			path.join(system.projectRoot, system.cssPath),
			'@import "tailwindcss";\n@theme {\n\t--color-brand: #123456;\n}\n',
			"utf8",
		);
		expect(
			await canonicalizeTailwindCandidatesInWorker(system, ["bg-[#123456]"]),
		).toEqual(["bg-brand"]);
	}, 30_000);

	it("rejects when the system CSS cannot be loaded, and keeps serving", async () => {
		const system = await createProject('@import "tailwindcss";\n');
		await expect(
			canonicalizeTailwindCandidatesInWorker(
				{ projectRoot: system.projectRoot, cssPath: "src/missing.css" },
				["p-2"],
			),
		).rejects.toThrow();
		expect(
			await canonicalizeTailwindCandidatesInWorker(system, ["p-2"]),
		).toEqual(["p-2"]);
	}, 30_000);
});
