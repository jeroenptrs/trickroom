import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadTailwindDesignSystem } from "./tailwind-design-system";
import {
	inspectTailwindUtilityCandidate,
	inspectTailwindUtilityCandidates,
} from "./tailwind-utility-inspector";

const tempProjectRoots: string[] = [];

async function createFixtureProject() {
	const projectRoot = await mkdtemp(
		path.join(process.cwd(), ".tmp-tailwind-utility-inspector-"),
	);
	tempProjectRoots.push(projectRoot);

	await mkdir(path.join(projectRoot, "src"), { recursive: true });
	await writeFile(
		path.join(projectRoot, "src", "index.css"),
		['@import "tailwindcss";', ""].join("\n"),
		"utf8",
	);

	return projectRoot;
}

afterEach(async () => {
	await Promise.all(
		tempProjectRoots
			.splice(0)
			.map((projectRoot) => rm(projectRoot, { force: true, recursive: true })),
	);
});

describe("inspectTailwindUtilityCandidate", () => {
	it("uses Tailwind's design-system internals to validate candidates", async () => {
		const projectRoot = await createFixtureProject();
		const { designSystem } = await loadTailwindDesignSystem({
			projectRoot,
			cssPath: "src/index.css",
		});

		expect(
			inspectTailwindUtilityCandidate(designSystem, "ring-offset-blue-500"),
		).toMatchObject({
			candidate: "ring-offset-blue-500",
			supported: true,
		});
		expect(
			inspectTailwindUtilityCandidate(designSystem, "not-a-tailwind-utility"),
		).toMatchObject({
			candidate: "not-a-tailwind-utility",
			supported: false,
		});
	});

	it("inspects multiple candidates deterministically", async () => {
		const projectRoot = await createFixtureProject();
		const { designSystem } = await loadTailwindDesignSystem({
			projectRoot,
			cssPath: "src/index.css",
		});

		const inspections = inspectTailwindUtilityCandidates(designSystem, [
			"flex",
			"w-4",
			"ring-offset-2",
			"content-['hi']",
		]);

		expect(inspections.map((inspection) => inspection.supported)).toEqual([
			true,
			true,
			true,
			true,
		]);
	});
});
