import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { unzipSync } from "fflate";
import { afterEach, describe, expect, it } from "vitest";
import { exportDesignBoards } from "./export-design";
import {
	ExportDestinationError,
	resolveExportDestinationDir,
	writeExportArtifacts,
} from "./write-export-artifacts";

const config = { name: "Demo Project" };

function board(name: string) {
	return {
		id: `board-${name}`,
		props: {
			"data-trickroom-library": "trickroom",
			"data-trickroom-component": "container",
			"data-trickroom-role": "branch",
			"data-trickroom-name": name,
			className: "flex p-4",
		},
		children: [
			{
				id: `text-${name}`,
				props: {
					"data-trickroom-library": "trickroom",
					"data-trickroom-component": "text",
					"data-trickroom-role": "text",
					"data-trickroom-name": "Label",
					className: "text-sm",
				},
				children: "Hi",
			},
		],
	};
}

describe("resolveExportDestinationDir", () => {
	it("resolves project-relative folders inside the project root", () => {
		const projectRoot = "/tmp/project";
		expect(resolveExportDestinationDir(projectRoot, "exports/html")).toBe(
			path.resolve(projectRoot, "exports/html"),
		);
	});

	it("rejects project-relative paths that escape the project root", () => {
		expect(() =>
			resolveExportDestinationDir("/tmp/project", "../outside"),
		).toThrow(ExportDestinationError);
	});

	it("allows absolute destination folders outside the project root", () => {
		const absolute = path.resolve("/tmp/downloads");
		expect(
			resolveExportDestinationDir("/tmp/project", absolute),
		).toBe(absolute);
	});
});

describe("writeExportArtifacts", () => {
	const tempDirs: string[] = [];

	afterEach(async () => {
		await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
	});

	it("writes one html file for a single-board export", async () => {
		const projectRoot = await mkdtemp(path.join(os.tmpdir(), "trickroom-export-"));
		tempDirs.push(projectRoot);
		const destinationDir = path.join(projectRoot, "exports");
		const exportResult = await exportDesignBoards({
			projectRoot: process.cwd(),
			config,
			boards: [board("Home")],
			systemId: null,
			projectName: "Demo Project",
			designName: "Landing",
			epoch: 1_700_000_000,
		});

		const written = await writeExportArtifacts(
			projectRoot,
			destinationDir,
			"Demo Project",
			"Landing",
			exportResult,
		);

		expect(written.artifacts).toHaveLength(1);
		expect(written.artifacts[0]).toMatchObject({
			kind: "html",
			filename: "Demo Project — Landing — Home — 1700000000.html",
			boardNames: ["Home"],
		});
		const contents = await readFile(written.artifacts[0].path, "utf8");
		expect(contents).toContain("<!doctype html>");
	});

	it("writes one zip file for a multi-board export", async () => {
		const projectRoot = await mkdtemp(path.join(os.tmpdir(), "trickroom-export-"));
		tempDirs.push(projectRoot);
		const destinationDir = path.join(projectRoot, "exports");
		const exportResult = await exportDesignBoards({
			projectRoot: process.cwd(),
			config,
			boards: [board("Home"), board("About")],
			systemId: null,
			projectName: "Demo Project",
			designName: "Landing",
			epoch: 1_700_000_000,
		});

		const written = await writeExportArtifacts(
			projectRoot,
			destinationDir,
			"Demo Project",
			"Landing",
			exportResult,
		);

		expect(written.artifacts).toHaveLength(1);
		expect(written.artifacts[0]).toMatchObject({
			kind: "zip",
			filename: "Demo Project — Landing — 1700000000.zip",
			boardNames: ["Home", "About"],
		});

		const zipBytes = await readFile(written.artifacts[0].path);
		const entries = Object.keys(unzipSync(zipBytes));
		expect(entries).toEqual([
			"Demo Project — Landing — Home — 1700000000.html",
			"Demo Project — Landing — About — 1700000000.html",
		]);
	});

	it("rejects destination paths that point at files", async () => {
		const projectRoot = await mkdtemp(path.join(os.tmpdir(), "trickroom-export-"));
		tempDirs.push(projectRoot);
		const filePath = path.join(projectRoot, "not-a-dir");
		await writeFile(filePath, "nope", "utf8");
		const exportResult = await exportDesignBoards({
			projectRoot: process.cwd(),
			config,
			boards: [board("Home")],
			systemId: null,
			projectName: "Demo Project",
			designName: "Landing",
			epoch: 1_700_000_000,
		});

		await expect(
			writeExportArtifacts(
				projectRoot,
				filePath,
				"Demo Project",
				"Landing",
				exportResult,
			),
		).rejects.toMatchObject({
			code: "INVALID_EXPORT_DESTINATION",
		});
	});

	it("creates missing destination directories", async () => {
		const projectRoot = await mkdtemp(path.join(os.tmpdir(), "trickroom-export-"));
		tempDirs.push(projectRoot);
		const destinationDir = path.join(projectRoot, "nested", "exports");
		const exportResult = await exportDesignBoards({
			projectRoot: process.cwd(),
			config,
			boards: [board("Home")],
			systemId: null,
			projectName: "Demo Project",
			designName: "Landing",
			epoch: 1_700_000_000,
		});

		const written = await writeExportArtifacts(
			projectRoot,
			destinationDir,
			"Demo Project",
			"Landing",
			exportResult,
		);

		const stats = await stat(written.destinationDir);
		expect(stats.isDirectory()).toBe(true);
	});
});
