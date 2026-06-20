import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	assertUniqueDesignSystemSafeKeys,
	createDesignSystemStorage,
	DesignSystemStorageError,
	ensureDesignSystemManifest,
	listDesignSystems,
	resolveDesignSystemComponentsPath,
	readDesignSystemManifest,
	resolveDesignSystemAssetsPath,
	resolveDesignSystemDir,
	resolveDesignSystemIconsPath,
	resolveDesignSystemManifestPath,
	resolveDesignSystemFilePath,
	resolveDesignSystemSafeKey,
	resolveDesignSystemsDir,
	resolveDesignSystemTokensPath,
	systemNameToSafeKey,
	writeDesignSystemManifest,
} from "./design-system-store";
import { SYSTEM_COMPONENT_MANIFEST_FILE_NAME } from "./system-components";

const tempProjectRoots: string[] = [];

async function createProjectRoot() {
	const projectRoot = await mkdtemp(
		path.join(process.cwd(), ".tmp-design-system-store-"),
	);
	tempProjectRoots.push(projectRoot);
	return projectRoot;
}

async function writeRawManifest(
	projectRoot: string,
	systemName: string,
	value: unknown,
) {
	const manifestPath = resolveDesignSystemManifestPath(projectRoot, systemName);
	await mkdir(path.dirname(manifestPath), { recursive: true });
	await writeFile(manifestPath, JSON.stringify(value), "utf8");
}

async function writeRawManifestText(
	projectRoot: string,
	systemName: string,
	contents: string,
) {
	const manifestPath = resolveDesignSystemManifestPath(projectRoot, systemName);
	await mkdir(path.dirname(manifestPath), { recursive: true });
	await writeFile(manifestPath, contents, "utf8");
}

afterEach(async () => {
	await Promise.all(
		tempProjectRoots
			.splice(0)
			.map((projectRoot) => rm(projectRoot, { force: true, recursive: true })),
	);
});

describe("systemNameToSafeKey", () => {
	it("lowercases, normalizes spaces, and preserves safe punctuation", () => {
		expect(systemNameToSafeKey("My System_v1.0")).toBe("my-system_v1.0");
	});

	it("removes unsafe characters and surrounding dashes", () => {
		expect(systemNameToSafeKey("-my@system#name-")).toBe("mysystemname");
	});

	it("throws when a system name cannot produce a safe key", () => {
		expect(() => resolveDesignSystemSafeKey(" @@@ ")).toThrowError(
			DesignSystemStorageError,
		);
	});

	it("throws when a system name produces a reserved path segment", () => {
		expect(() => resolveDesignSystemSafeKey(".")).toThrow(/reserved/);
		expect(() => resolveDesignSystemSafeKey("..")).toThrow(/reserved/);
		expect(() => resolveDesignSystemDir("/project", "..")).toThrow(/reserved/);
	});

	it("detects safe-key collisions between configured systems", () => {
		expect(() =>
			assertUniqueDesignSystemSafeKeys(["My System", "my-system"]),
		).toThrow(/duplicate storage keys/i);
	});

	it("detects collisions after trimming system names", () => {
		expect(() => assertUniqueDesignSystemSafeKeys(["Core ", "Core"])).toThrow(
			/duplicate storage keys/i,
		);
	});
});

describe("system path helpers", () => {
	it("resolves system files under .trickroom/systems", () => {
		expect(resolveDesignSystemsDir("/project")).toBe(
			path.join("/project", ".trickroom", "systems"),
		);
		expect(resolveDesignSystemDir("/project", "My System")).toBe(
			path.join("/project", ".trickroom", "systems", "my-system"),
		);
		expect(resolveDesignSystemManifestPath("/project", "My System")).toBe(
			path.join(
				"/project",
				".trickroom",
				"systems",
				"my-system",
				"system.json",
			),
		);
		expect(resolveDesignSystemTokensPath("/project", "My System")).toBe(
			path.join(
				"/project",
				".trickroom",
				"systems",
				"my-system",
				"tokens.json",
			),
		);
		expect(resolveDesignSystemComponentsPath("/project", "My System")).toBe(
			path.join(
				"/project",
				".trickroom",
				"systems",
				"my-system",
				SYSTEM_COMPONENT_MANIFEST_FILE_NAME,
			),
		);
		expect(resolveDesignSystemAssetsPath("/project", "My System")).toBe(
			path.join(
				"/project",
				".trickroom",
				"systems",
				"my-system",
				"assets.json",
			),
		);
		expect(resolveDesignSystemIconsPath("/project", "My System")).toBe(
			path.join("/project", ".trickroom", "systems", "my-system", "icons.json"),
		);
	});

	it("resolves components.json using system handle semantics", async () => {
		const projectRoot = await createProjectRoot();
		const manifest = await createDesignSystemStorage(projectRoot, {
			systemName: "Core",
			cssPath: "src/core.css",
		});

		await expect(
			resolveDesignSystemFilePath(projectRoot, manifest.systemId, "components.json"),
		).resolves.toBe(
			path.join(projectRoot, ".trickroom", "systems", "core", "components.json"),
		);
		await expect(
			resolveDesignSystemFilePath(projectRoot, "core", "components.json"),
		).resolves.toBe(
			path.join(projectRoot, ".trickroom", "systems", "core", "components.json"),
		);
		await expect(
			resolveDesignSystemFilePath(projectRoot, "Core", "components.json"),
		).resolves.toBe(
			path.join(projectRoot, ".trickroom", "systems", "core", "components.json"),
		);
	});
});

describe("design system manifests", () => {
	it("returns null for a missing manifest", async () => {
		const projectRoot = await createProjectRoot();

		await expect(
			readDesignSystemManifest(projectRoot, "Core"),
		).resolves.toEqual({
			manifest: null,
			record: null,
			warnings: [],
		});
	});

	it("creates a default manifest when ensuring a missing system manifest", async () => {
		const projectRoot = await createProjectRoot();

		await expect(
			ensureDesignSystemManifest(projectRoot, "Core"),
		).resolves.toEqual({
			version: 1,
			systemId: expect.stringMatching(/^sys_/),
			systemName: "Core",
		});
		await expect(
			readDesignSystemManifest(projectRoot, "Core"),
		).resolves.toMatchObject({
			manifest: {
				version: 1,
				systemName: "Core",
			},
		});
	});

	it("returns an existing manifest when ensuring a system manifest", async () => {
		const projectRoot = await createProjectRoot();
		await mkdir(path.join(projectRoot, "src", "icons"), { recursive: true });
		await writeDesignSystemManifest(projectRoot, "Core", {
			iconFolderPaths: ["src/icons"],
		});

		await expect(
			ensureDesignSystemManifest(projectRoot, "Core"),
		).resolves.toEqual({
			version: 1,
			systemId: expect.stringMatching(/^sys_/),
			systemName: "Core",
			iconFolderPaths: ["src/icons"],
		});
	});

	it("writes and reads normalized manifests", async () => {
		const projectRoot = await createProjectRoot();
		await mkdir(path.join(projectRoot, "src", "icons"), { recursive: true });

		await writeDesignSystemManifest(projectRoot, "Core", {
			iconFolderPaths: [" ./src/icons "],
		});

		await expect(
			readDesignSystemManifest(projectRoot, "Core"),
		).resolves.toEqual({
			manifest: {
				version: 1,
				systemId: expect.stringMatching(/^sys_/),
				systemName: "Core",
				iconFolderPaths: ["src/icons"],
			},
			record: expect.objectContaining({
				storageKey: "core",
			}),
			warnings: [],
		});
	});

	it("returns warnings for missing icon folders without rejecting the manifest", async () => {
		const projectRoot = await createProjectRoot();
		await writeDesignSystemManifest(projectRoot, "Core", {
			iconFolderPaths: ["src/missing-icons"],
		});

		const result = await readDesignSystemManifest(projectRoot, "Core");

		expect(result.manifest).toMatchObject({
			systemName: "Core",
			iconFolderPaths: ["src/missing-icons"],
		});
		expect(result.warnings).toEqual([
			expect.objectContaining({
				code: "MISSING_ICON_FOLDER",
				path: "src/missing-icons",
			}),
		]);
	});

	it("rejects absolute and escaping manifest paths", async () => {
		const projectRoot = await createProjectRoot();

		await expect(
			writeDesignSystemManifest(projectRoot, "Core", {
				iconFolderPaths: [path.join(projectRoot, "icons")],
			}),
		).rejects.toThrow(/project-relative/);

		await expect(
			writeDesignSystemManifest(projectRoot, "Core", {
				iconFolderPaths: ["../icons"],
			}),
		).rejects.toThrow(/inside the project root/);
	});

	it("allows manifest names to diverge from the initial storage folder", async () => {
		const projectRoot = await createProjectRoot();
		await writeRawManifest(projectRoot, "Core", {
			version: 1,
			systemName: "Other",
		});

		await expect(
			readDesignSystemManifest(projectRoot, "Core"),
		).resolves.toMatchObject({
			manifest: {
				systemName: "Other",
			},
			record: {
				storageKey: "core",
			},
		});
	});

	it("rejects missing and malformed manifest system names", async () => {
		const projectRoot = await createProjectRoot();

		await writeRawManifest(projectRoot, "Core", {
			version: 1,
		});
		await expect(readDesignSystemManifest(projectRoot, "Core")).rejects.toThrow(
			/missing or malformed systemName/,
		);

		await writeRawManifest(projectRoot, "Core", {
			version: 1,
			systemName: "   ",
		});
		await expect(readDesignSystemManifest(projectRoot, "Core")).rejects.toThrow(
			/missing or malformed systemName/,
		);
	});

	it("rejects unsupported manifest versions", async () => {
		const projectRoot = await createProjectRoot();
		await writeRawManifest(projectRoot, "Core", {
			version: 2,
			systemName: "Core",
		});

		await expect(readDesignSystemManifest(projectRoot, "Core")).rejects.toThrow(
			/Unsupported design system manifest version/,
		);
	});

	it("rejects non-string icon folder paths", async () => {
		const projectRoot = await createProjectRoot();
		await writeRawManifest(projectRoot, "Core", {
			version: 1,
			systemName: "Core",
			iconFolderPaths: [123],
		});

		await expect(readDesignSystemManifest(projectRoot, "Core")).rejects.toThrow(
			/paths must be strings/,
		);
	});

	it("wraps invalid manifest JSON in a storage error", async () => {
		const projectRoot = await createProjectRoot();
		await writeRawManifestText(projectRoot, "Core", "{not json");

		await expect(readDesignSystemManifest(projectRoot, "Core")).rejects.toEqual(
			expect.objectContaining({
				code: "INVALID_MANIFEST",
				message: expect.stringContaining("Invalid design system manifest JSON"),
			}),
		);
	});

	it("wraps invalid manifest JSON during system listing", async () => {
		const projectRoot = await createProjectRoot();
		await writeRawManifestText(projectRoot, "Core", "{not json");

		await expect(listDesignSystems(projectRoot)).rejects.toEqual(
			expect.objectContaining({
				code: "INVALID_MANIFEST",
				message: expect.stringContaining("Invalid design system manifest JSON"),
			}),
		);
	});

	it("rejects creating a system whose name resolves to an existing storage key", async () => {
		const projectRoot = await createProjectRoot();
		const existing = await createDesignSystemStorage(projectRoot, {
			systemName: "foo",
			cssPath: "src/foo.css",
		});

		await expect(
			createDesignSystemStorage(projectRoot, {
				systemName: "Foo",
				cssPath: "src/other.css",
			}),
		).rejects.toEqual(
			expect.objectContaining({
				code: "DUPLICATE_SYSTEM_KEY",
			}),
		);
		await expect(readDesignSystemManifest(projectRoot, "foo")).resolves.toEqual(
			expect.objectContaining({
				manifest: expect.objectContaining({
					systemId: existing.systemId,
					systemName: "foo",
					cssPath: "src/foo.css",
				}),
			}),
		);
	});

	it("rejects renaming a system to a name that resolves to another storage key", async () => {
		const projectRoot = await createProjectRoot();
		await createDesignSystemStorage(projectRoot, {
			systemName: "foo",
			cssPath: "src/foo.css",
		});
		const other = await createDesignSystemStorage(projectRoot, {
			systemName: "bar",
			cssPath: "src/bar.css",
		});

		await expect(
			writeDesignSystemManifest(projectRoot, other.systemId, {
				systemName: "Foo",
			}),
		).rejects.toEqual(
			expect.objectContaining({
				code: "DUPLICATE_SYSTEM_KEY",
			}),
		);
	});

	it("rejects existing manifest names that resolve to duplicate safe keys", async () => {
		const projectRoot = await createProjectRoot();
		await writeRawManifest(projectRoot, "first", {
			version: 1,
			systemId: "sys_00000000-0000-4000-8000-000000000001",
			systemName: "My-System",
		});
		await writeRawManifest(projectRoot, "second", {
			version: 1,
			systemId: "sys_00000000-0000-4000-8000-000000000002",
			systemName: "my-system",
		});

		await expect(listDesignSystems(projectRoot)).rejects.toEqual(
			expect.objectContaining({
				code: "DUPLICATE_SYSTEM_KEY",
			}),
		);
	});
});
