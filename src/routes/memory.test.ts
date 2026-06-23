import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MemoryNote } from "../utils/memory-manifest-service.types";

type ListResponse = {
	scope: { kind: string; id?: string };
	revision: string;
	exists: boolean;
	summary: { noteCount: number; categories: string[] };
	notes: MemoryNote[];
};

type WriteResponse = {
	scope: { kind: string };
	newRevision: string;
	note: MemoryNote;
};

describe("memory routes", () => {
	let tempProjectRoot: string;
	let previousProjectDirOverride: string | undefined;

	const writeConfig = async (extra: Record<string, unknown> = {}) => {
		await writeFile(
			path.join(tempProjectRoot, "trickroom.config.json"),
			JSON.stringify({
				name: "Test Project",
				projectId: "proj_test",
				systems: { Core: "src/index.css" },
				...extra,
			}),
			"utf8",
		);
	};

	beforeEach(async () => {
		tempProjectRoot = await mkdtemp(
			path.join(process.cwd(), ".tmp-trickroom-memory-routes-"),
		);
		previousProjectDirOverride = process.env.TRICKROOM_PROJECT_DIR;
		process.env.TRICKROOM_PROJECT_DIR = tempProjectRoot;
		vi.resetModules();
		await writeConfig();
	});

	afterEach(async () => {
		if (previousProjectDirOverride === undefined) {
			delete process.env.TRICKROOM_PROJECT_DIR;
		} else {
			process.env.TRICKROOM_PROJECT_DIR = previousProjectDirOverride;
		}
		await rm(tempProjectRoot, { force: true, recursive: true });
	});

	const importTestServer = async () => {
		const { default: app } = await import("../server");
		return app;
	};

	it("supports the project memory CRUD lifecycle with revision chaining", async () => {
		const app = await importTestServer();

		const emptyResponse = await app.request("/api/trickroom/memory");
		expect(emptyResponse.status).toBe(200);
		const empty = (await emptyResponse.json()) as ListResponse;
		expect(empty.exists).toBe(false);
		expect(empty.summary.noteCount).toBe(0);
		expect(empty.scope).toEqual({ kind: "project" });

		const addResponse = await app.request("/api/trickroom/memory", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				category: "intent",
				body: "This project exists to test memory.",
				title: "Why",
			}),
		});
		expect(addResponse.status).toBe(201);
		const added = (await addResponse.json()) as WriteResponse;
		expect(added.note.noteId).toMatch(/^note_/);
		expect(added.note.author).toEqual({ kind: "user" });
		expect(added.newRevision).toMatch(/^sha256:/);

		const listResponse = await app.request("/api/trickroom/memory");
		const list = (await listResponse.json()) as ListResponse;
		expect(list.exists).toBe(true);
		expect(list.summary.noteCount).toBe(1);
		expect(list.notes[0]?.body).toBe("This project exists to test memory.");

		const getResponse = await app.request(
			`/api/trickroom/memory/${added.note.noteId}`,
		);
		expect(getResponse.status).toBe(200);

		const patchResponse = await app.request(
			`/api/trickroom/memory/${added.note.noteId}`,
			{
				method: "PATCH",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					expectedRevision: list.revision,
					body: "Updated body.",
					category: "decision",
				}),
			},
		);
		expect(patchResponse.status).toBe(200);
		const patched = (await patchResponse.json()) as WriteResponse;
		expect(patched.note.body).toBe("Updated body.");
		expect(patched.note.category).toBe("decision");

		const deleteResponse = await app.request(
			`/api/trickroom/memory/${added.note.noteId}`,
			{
				method: "DELETE",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ expectedRevision: patched.newRevision }),
			},
		);
		expect(deleteResponse.status).toBe(200);

		const afterDelete = await app.request("/api/trickroom/memory");
		const afterDeleteList = (await afterDelete.json()) as ListResponse;
		expect(afterDeleteList.summary.noteCount).toBe(0);
	});

	it("rejects stale writes with a 409", async () => {
		const app = await importTestServer();

		const addResponse = await app.request("/api/trickroom/memory", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ category: "todo", body: "Initial." }),
		});
		const added = (await addResponse.json()) as WriteResponse;

		const staleResponse = await app.request(
			`/api/trickroom/memory/${added.note.noteId}`,
			{
				method: "PATCH",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					expectedRevision: "sha256:deadbeef",
					body: "Should fail.",
				}),
			},
		);
		expect(staleResponse.status).toBe(409);
	});

	it("rejects invalid categories with a 400", async () => {
		const app = await importTestServer();
		const response = await app.request("/api/trickroom/memory", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ category: "bogus", body: "x" }),
		});
		expect(response.status).toBe(400);
	});

	it("stores design-scoped memory under the design uuid", async () => {
		const app = await importTestServer();
		const designId = "11111111-1111-4111-8111-111111111111";

		const addResponse = await app.request(
			`/api/trickroom/designs/${designId}/memory`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					category: "intent",
					body: "Design rationale.",
				}),
			},
		);
		expect(addResponse.status).toBe(201);
		const added = (await addResponse.json()) as WriteResponse;
		expect(added.scope).toEqual({ kind: "design", id: designId });

		const siblingPath = path.join(
			tempProjectRoot,
			".trickroom",
			"designs",
			`${designId}.memory.json`,
		);
		const stored = JSON.parse(await readFile(siblingPath, "utf8")) as {
			notes: Record<string, MemoryNote>;
		};
		expect(Object.values(stored.notes)[0]?.body).toBe("Design rationale.");
	});

	it("stores system-scoped memory under the configured system", async () => {
		const app = await importTestServer();

		const createSystem = await app.request("/api/trickroom/systems", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ systemName: "Brand", cssPath: "src/brand.css" }),
		});
		const { systemId } = (await createSystem.json()) as { systemId: string };

		const addResponse = await app.request(
			`/api/trickroom/systems/${systemId}/memory`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					category: "usage",
					body: "Use the brand system for marketing pages.",
				}),
			},
		);
		expect(addResponse.status).toBe(201);
		const added = (await addResponse.json()) as WriteResponse;
		expect(added.scope).toEqual({ kind: "system", id: systemId });

		const listResponse = await app.request(
			`/api/trickroom/systems/${systemId}/memory`,
		);
		const list = (await listResponse.json()) as ListResponse;
		expect(list.summary.noteCount).toBe(1);
	});

	it("audits REST memory writes when audit logging is enabled", async () => {
		await writeConfig({
			mcp: { enabled: true, mode: "read-write", auditLog: true },
		});
		const app = await importTestServer();

		await app.request("/api/trickroom/memory", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ category: "intent", body: "Audited." }),
		});

		const auditLog = await readFile(
			path.join(tempProjectRoot, ".trickroom", "audit-log.jsonl"),
			"utf8",
		);
		const entry = JSON.parse(auditLog.trim().split("\n").at(-1) ?? "{}") as {
			source?: string;
			operation?: string;
			scope?: { kind?: string };
		};
		expect(entry.source).toBe("rest");
		expect(entry.operation).toBe("addMemoryNote");
		expect(entry.scope?.kind).toBe("project");
	});

	it("does not write an audit log when auditing is disabled", async () => {
		const app = await importTestServer();
		await app.request("/api/trickroom/memory", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ category: "intent", body: "Not audited." }),
		});

		await expect(
			readFile(
				path.join(tempProjectRoot, ".trickroom", "audit-log.jsonl"),
				"utf8",
			),
		).rejects.toMatchObject({ code: "ENOENT" });
	});
});
