import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	createTrickroomMcpProjectFixture,
	createTrickroomMcpTestClient,
	type TrickroomMcpClientSession,
	type TrickroomMcpProjectFixture,
	toolPayload,
	trickroomMcpTestDesignUuid,
} from "./test-support";

describe("trickroom MCP memory tools", () => {
	let fixture: TrickroomMcpProjectFixture;
	let session: TrickroomMcpClientSession;

	const open = async (
		overrides?: Parameters<typeof createTrickroomMcpProjectFixture>[0],
	) => {
		fixture = await createTrickroomMcpProjectFixture(overrides);
		session = await createTrickroomMcpTestClient(
			await fixture.readMcpContext(),
		);
	};

	afterEach(async () => {
		await session?.close();
		await fixture?.cleanup();
	});

	it("supports the full project-scope note lifecycle with revision chaining", async () => {
		await open();
		const scope = { kind: "project" } as const;

		const empty = await session.client.callTool({
			name: "listMemoryNotes",
			arguments: {},
		});
		expect(toolPayload(empty)).toMatchObject({
			status: "success",
			scope: { kind: "project" },
			noteCount: 0,
			notes: [],
		});

		const added = await session.client.callTool({
			name: "addMemoryNote",
			arguments: {
				scope,
				category: "intent",
				body: "This project exists to validate memory tooling.",
				title: "Why",
			},
		});
		// Writes acknowledge with id, revision, and size; no note echo.
		expect(toolPayload(added)).toEqual({
			status: "success",
			project: expect.any(Object),
			scope: { kind: "project" },
			noteId: expect.stringMatching(/^note_/),
			newRevision: expect.any(String),
			scopeRevision: expect.any(String),
			size: 47,
		});
		const addedContent = toolPayload(added) as {
			noteId: string;
			newRevision: string;
		};
		const noteId = addedContent.noteId;
		const revisionAfterAdd = addedContent.newRevision;

		const index = await session.client.callTool({
			name: "listMemoryNotes",
			arguments: { scope },
		});
		expect(toolPayload(index)).toMatchObject({
			noteCount: 1,
			categories: ["intent"],
			notes: [
				{
					noteId,
					title: "Why",
					category: "intent",
					size: 47,
					revision: revisionAfterAdd,
					summary: "This project exists to validate memory tooling.",
				},
			],
		});
		expect(
			(toolPayload(index) as { notes: Array<Record<string, unknown>> })
				.notes[0],
		).not.toHaveProperty("body");

		const fetched = await session.client.callTool({
			name: "getMemoryNote",
			arguments: { scope, noteId },
		});
		expect(toolPayload(fetched)).toMatchObject({
			status: "success",
			note: {
				noteId,
				body: "This project exists to validate memory tooling.",
				author: { kind: "agent" },
				revision: revisionAfterAdd,
			},
		});

		const updated = await session.client.callTool({
			name: "updateMemoryNote",
			arguments: {
				scope,
				noteId,
				expectedRevision: revisionAfterAdd,
				category: "decision",
				body: "Locked the memory tooling shape.",
			},
		});
		expect(toolPayload(updated)).toMatchObject({
			status: "success",
			noteId,
			size: "Locked the memory tooling shape.".length,
		});
		expect(toolPayload(updated)).not.toHaveProperty("note");
		const revisionAfterUpdate = String(
			(toolPayload(updated) as { newRevision: string }).newRevision,
		);
		expect(revisionAfterUpdate).not.toBe(revisionAfterAdd);

		const deleted = await session.client.callTool({
			name: "deleteMemoryNote",
			arguments: { scope, noteId, expectedRevision: revisionAfterUpdate },
		});
		expect(toolPayload(deleted)).toMatchObject({
			status: "success",
			deleted: true,
			noteId,
			scopeRevision: expect.any(String),
		});

		const finalList = await session.client.callTool({
			name: "listMemoryNotes",
			arguments: { scope },
		});
		expect(toolPayload(finalList)).toMatchObject({
			noteCount: 0,
			notes: [],
		});
	});

	it("rejects a stale revision on update", async () => {
		await open();
		const scope = { kind: "project" } as const;
		const added = await session.client.callTool({
			name: "addMemoryNote",
			arguments: { scope, category: "usage", body: "first" },
		});
		const noteId = String((toolPayload(added) as { noteId: string }).noteId);

		const stale = await session.client.callTool({
			name: "updateMemoryNote",
			arguments: {
				scope,
				noteId,
				expectedRevision: "sha256:stale",
				body: "second",
			},
		});
		expect(stale.isError).toBe(true);
		expect(toolPayload(stale)).toMatchObject({
			code: "STALE_WRITE",
			noteId,
			noteRevision: (toolPayload(added) as { newRevision: string }).newRevision,
			scopeRevision: expect.any(String),
		});
	});

	it("stores and lists system-scope notes", async () => {
		await open();
		const scope = { kind: "system", systemName: "Core" } as const;
		await session.client.callTool({
			name: "addMemoryNote",
			arguments: {
				scope,
				category: "conventions",
				body: "Use brand tokens only.",
			},
		});

		const list = await session.client.callTool({
			name: "listMemoryNotes",
			arguments: { scope },
		});
		expect(toolPayload(list)).toMatchObject({
			scope: { kind: "system", systemName: "Core" },
			noteCount: 1,
			categories: ["conventions"],
		});
	});

	it("accepts shorthand memory scope shapes", async () => {
		await open();
		await session.client.callTool({
			name: "addMemoryNote",
			arguments: {
				scope: { kind: "system", systemName: "Core" },
				category: "conventions",
				body: "Use brand tokens only.",
			},
		});
		await session.client.callTool({
			name: "addMemoryNote",
			arguments: {
				scope: { kind: "design", designFileId: trickroomMcpTestDesignUuid },
				category: "intent",
				body: "Design note.",
			},
		});

		const shorthandScopes: Array<[unknown, Record<string, unknown>]> = [
			["project", { kind: "project" }],
			["system:Core", { kind: "system", systemName: "Core" }],
			[{ systemId: "Core" }, { kind: "system", systemName: "Core" }],
			[
				{ kind: "system", name: "Core" },
				{ kind: "system", systemName: "Core" },
			],
			// The fixture has one configured system, so the name can be inferred.
			[{ kind: "system" }, { kind: "system", systemName: "Core" }],
			[
				`design:${trickroomMcpTestDesignUuid}`,
				{ kind: "design", designFileId: trickroomMcpTestDesignUuid },
			],
			[
				{ designId: trickroomMcpTestDesignUuid },
				{ kind: "design", designFileId: trickroomMcpTestDesignUuid },
			],
			[
				{ kind: "design", id: trickroomMcpTestDesignUuid },
				{ kind: "design", designFileId: trickroomMcpTestDesignUuid },
			],
		];
		for (const [scope, expected] of shorthandScopes) {
			const list = await session.client.callTool({
				name: "listMemoryNotes",
				arguments: { scope },
			});
			expect(list.isError, JSON.stringify(scope)).toBeFalsy();
			expect(toolPayload(list)).toMatchObject({ scope: expected });
		}
	});

	it("edits note bodies in place and keeps edits to different notes independent", async () => {
		await open();
		const scope = "project";
		const add = async (body: string) =>
			toolPayload(
				await session.client.callTool({
					name: "addMemoryNote",
					arguments: { scope, category: "conventions", body },
				}),
			) as { noteId: string; newRevision: string };
		const first = await add("Use brand tokens.");
		const second = await add("Prefer flexbox.");

		const appended = await session.client.callTool({
			name: "updateMemoryNote",
			arguments: {
				scope,
				noteId: first.noteId,
				expectedRevision: first.newRevision,
				edits: [
					{ op: "replace", oldText: "brand", newText: "system" },
					{ op: "append", text: "No raw hex." },
				],
			},
		});
		expect(appended.isError).toBeFalsy();

		// The second note's revision predates the first edit and still applies.
		const replaced = await session.client.callTool({
			name: "updateMemoryNote",
			arguments: {
				scope,
				noteId: second.noteId,
				expectedRevision: second.newRevision,
				edits: [{ op: "replace", oldText: "flexbox", newText: "flex rows" }],
			},
		});
		expect(replaced.isError).toBeFalsy();

		const notFound = await session.client.callTool({
			name: "updateMemoryNote",
			arguments: {
				scope,
				noteId: second.noteId,
				expectedRevision: (toolPayload(replaced) as { newRevision: string })
					.newRevision,
				edits: [{ op: "replace", oldText: "grid", newText: "x" }],
			},
		});
		expect(notFound.isError).toBe(true);
		expect(toolPayload(notFound)).toMatchObject({
			code: "EDIT_TEXT_NOT_FOUND",
			editIndex: 0,
		});

		const both = await session.client.callTool({
			name: "getMemoryNote",
			arguments: {
				scope,
				noteIds: [first.noteId, second.noteId, "note_missing"],
			},
		});
		expect(toolPayload(both)).toMatchObject({
			notes: [
				{ noteId: first.noteId, body: "Use system tokens.\n\nNo raw hex." },
				{ noteId: second.noteId, body: "Prefer flex rows." },
			],
			missingNoteIds: ["note_missing"],
		});
	});

	it("indexes the project, linked system, and design scopes for one design", async () => {
		await open();
		const designScope = {
			kind: "design",
			designFileId: trickroomMcpTestDesignUuid,
		} as const;
		for (const [scope, body] of [
			["project", "Project note."],
			["system:Core", "System note."],
			[designScope, "Design note."],
		] as const) {
			await session.client.callTool({
				name: "addMemoryNote",
				arguments: { scope, category: "intent", body },
			});
		}

		const bundle = await session.client.callTool({
			name: "listMemoryNotes",
			arguments: { designFileId: trickroomMcpTestDesignUuid },
		});
		expect(bundle.isError).toBeFalsy();
		const scopes = (
			toolPayload(bundle) as {
				scopes: Array<{
					scope: Record<string, unknown>;
					notes: Array<{ summary: string }>;
				}>;
			}
		).scopes;
		expect(scopes.map((entry) => entry.scope.kind)).toEqual([
			"project",
			"system",
			"design",
		]);
		expect(scopes.map((entry) => entry.notes[0]?.summary)).toEqual([
			"Project note.",
			"System note.",
			"Design note.",
		]);
	});

	it("lists the accepted shapes when a memory scope cannot be resolved", async () => {
		await open();
		const list = await session.client.callTool({
			name: "listMemoryNotes",
			arguments: { scope: { kind: "design" } },
		});
		expect(list.isError).toBe(true);
		expect(toolPayload(list)).toMatchObject({
			code: "INVALID_OPERATION_PARAMETERS",
			message: expect.stringContaining('{ "kind": "design", "designFileId"'),
			acceptedScopeShapes: expect.arrayContaining(['{ "kind": "project" }']),
		});
	});

	it("surfaces design-scope memory in readDesignFile", async () => {
		await open();
		const scope = {
			kind: "design",
			designFileId: trickroomMcpTestDesignUuid,
		} as const;
		await session.client.callTool({
			name: "addMemoryNote",
			arguments: {
				scope,
				category: "intent",
				body: "Hero board demonstrates the marketing layout.",
			},
		});

		const read = await session.client.callTool({
			name: "design_read",
			arguments: { designFileId: trickroomMcpTestDesignUuid },
		});
		expect(toolPayload(read)).toMatchObject({
			memory: { noteCount: 1, categories: ["intent"] },
		});
		expect(
			typeof (toolPayload(read) as { memoryHint?: unknown }).memoryHint,
		).toBe("string");
	});

	it("attaches resolved references when resolveReferences is true", async () => {
		await open();
		const scope = {
			kind: "design",
			designFileId: trickroomMcpTestDesignUuid,
		} as const;
		await session.client.callTool({
			name: "addMemoryNote",
			arguments: {
				scope,
				category: "usage",
				body: `See {{design:${trickroomMcpTestDesignUuid}}} and {{design:99999999-9999-4999-8999-999999999999}}.`,
			},
		});

		const list = await session.client.callTool({
			name: "listMemoryNotes",
			arguments: { scope, resolveReferences: true },
		});
		const notes = (
			toolPayload(list) as { notes: Array<{ references: unknown[] }> }
		).notes;
		expect(notes[0]?.references).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ status: "valid", type: "design" }),
				expect.objectContaining({ status: "broken", type: "design" }),
			]),
		);
	});

	it("blocks writes in read-only mode", async () => {
		await open({ config: { mcp: { enabled: true, mode: "read-only" } } });
		const result = await session.client.callTool({
			name: "addMemoryNote",
			arguments: {
				scope: { kind: "project" },
				category: "intent",
				body: "should not persist",
			},
		});
		expect(result.isError).toBe(true);
		expect(toolPayload(result)).toMatchObject({
			status: "POLICY_DENIED",
			code: "MCP_READ_ONLY",
		});
	});

	it("writes an audit entry when auditing is enabled", async () => {
		await open({ config: { mcp: { enabled: true, auditLog: true } } });
		await session.client.callTool({
			name: "addMemoryNote",
			arguments: {
				scope: { kind: "project" },
				category: "todo",
				body: "audited note",
			},
		});

		const auditPath = path.join(
			fixture.projectRoot,
			".trickroom",
			"audit-log.jsonl",
		);
		const contents = await readFile(auditPath, "utf8");
		expect(contents).toContain("addMemoryNote");
	});
});
