import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	createTrickroomMcpProjectFixture,
	createTrickroomMcpTestClient,
	type TrickroomMcpClientSession,
	type TrickroomMcpProjectFixture,
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
			arguments: { scope },
		});
		expect(empty.structuredContent).toMatchObject({
			status: "success",
			exists: false,
			summary: { noteCount: 0, categories: [] },
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
		expect(added.structuredContent).toMatchObject({
			status: "success",
			note: { category: "intent", title: "Why", author: { kind: "agent" } },
		});
		const addedContent = added.structuredContent as {
			note: { noteId: string };
			newRevision: string;
		};
		const noteId = String(addedContent.note.noteId);
		const revisionAfterAdd = String(addedContent.newRevision);

		const fetched = await session.client.callTool({
			name: "getMemoryNote",
			arguments: { scope, noteId },
		});
		expect(fetched.structuredContent).toMatchObject({
			status: "success",
			note: { noteId, body: "This project exists to validate memory tooling." },
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
		expect(updated.structuredContent).toMatchObject({
			status: "success",
			note: {
				noteId,
				category: "decision",
				body: "Locked the memory tooling shape.",
			},
		});
		const revisionAfterUpdate = String(
			(updated.structuredContent as { newRevision: string }).newRevision,
		);
		expect(revisionAfterUpdate).not.toBe(revisionAfterAdd);

		const deleted = await session.client.callTool({
			name: "deleteMemoryNote",
			arguments: { scope, noteId, expectedRevision: revisionAfterUpdate },
		});
		expect(deleted.structuredContent).toMatchObject({
			status: "success",
			deleted: true,
			noteId,
		});

		const finalList = await session.client.callTool({
			name: "listMemoryNotes",
			arguments: { scope },
		});
		expect(finalList.structuredContent).toMatchObject({
			summary: { noteCount: 0 },
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
		const noteId = String(
			(added.structuredContent as { note: { noteId: string } }).note.noteId,
		);

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
		expect(stale.structuredContent).toMatchObject({ code: "STALE_WRITE" });
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
		expect(list.structuredContent).toMatchObject({
			scope: { kind: "system", systemName: "Core" },
			summary: { noteCount: 1, categories: ["conventions"] },
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
			name: "readDesignFile",
			arguments: { designFileId: trickroomMcpTestDesignUuid },
		});
		expect(read.structuredContent).toMatchObject({
			memory: { noteCount: 1, categories: ["intent"] },
		});
		expect(
			typeof (read.structuredContent as { memoryHint?: unknown }).memoryHint,
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
		const notes = (list.structuredContent as { notes: Array<{ references: unknown[] }> })
			.notes;
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
		expect(result.structuredContent).toMatchObject({
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
