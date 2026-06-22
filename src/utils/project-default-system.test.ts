import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { writeProjectConfig } from "../project";
import { createDesignSystemStorage } from "./design-system-store";
import {
	applyProjectDefaultSystemToDesign,
	clearDefaultSystemIfMatches,
	resolvePersistedDefaultSystemId,
	setConfigDefaultSystemId,
} from "./project-default-system";

describe("project default system helpers", () => {
	const tempRoots: string[] = [];

	afterEach(async () => {
		await Promise.all(
			tempRoots
				.splice(0)
				.map((root) => rm(root, { force: true, recursive: true })),
		);
	});

	const tempDir = async (prefix: string) => {
		const root = await mkdtemp(path.join(process.cwd(), prefix));
		tempRoots.push(root);
		await mkdir(root, { recursive: true });
		return root;
	};

	it("sets and clears the persisted default system id", () => {
		const base = { name: "Demo" };
		const withDefault = setConfigDefaultSystemId(base, "sys_default");
		expect(resolvePersistedDefaultSystemId(withDefault)).toBe("sys_default");
		expect(setConfigDefaultSystemId(withDefault, null)).not.toHaveProperty(
			"defaultSystemId",
		);
	});

	it("applies the project default system to designs without explicit links", async () => {
		const projectRoot = await tempDir(".tmp-trickroom-default-system-");
		const manifest = await createDesignSystemStorage(projectRoot, {
			systemName: "Core",
			cssPath: "src/index.css",
		});
		const config = setConfigDefaultSystemId({ name: "Demo" }, manifest.systemId);

		await expect(
			applyProjectDefaultSystemToDesign(projectRoot, config, {
				name: "Untitled",
				boards: [],
			}),
		).resolves.toMatchObject({
			systemId: manifest.systemId,
		});
	});

	it("does not override explicitly unlinked designs", async () => {
		const projectRoot = await tempDir(".tmp-trickroom-default-system-");
		const manifest = await createDesignSystemStorage(projectRoot, {
			systemName: "Core",
			cssPath: "src/index.css",
		});
		const config = setConfigDefaultSystemId({ name: "Demo" }, manifest.systemId);

		await expect(
			applyProjectDefaultSystemToDesign(projectRoot, config, {
				name: "Untitled",
				systemId: null,
				boards: [],
			}),
		).resolves.toMatchObject({
			systemId: null,
		});
	});

	it("resolves defaultSystemName during project config writes", async () => {
		const projectRoot = await tempDir(".tmp-trickroom-default-system-");
		const written = await writeProjectConfig(projectRoot, {
			name: "Demo",
			systems: { Core: "src/index.css" },
			defaultSystemName: "Core",
		});

		expect(written.defaultSystemId).toMatch(/^sys_/);
		expect(written).not.toHaveProperty("defaultSystemName");
		expect(clearDefaultSystemIfMatches(written, written.defaultSystemId!)).not.toHaveProperty(
			"defaultSystemId",
		);
	});
});
