import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type { Context, Hono, MiddlewareHandler } from "hono";
import { jsonError } from "../server-utils";
import type { TrickroomConfig } from "../types";
import {
	addMemoryNote,
	deleteMemoryNote,
	MemoryManifestError,
	type MemoryScope,
	type MemoryScopeRef,
	readMemoryManifest,
	summarizeMemoryManifest,
	updateMemoryNote,
} from "../utils/memory-manifest-service";
import {
	collectMemoryReferenceWarnings,
	listMemoryReferenceTargets,
	MEMORY_REFERENCE_TYPES,
	type MemoryReferenceType,
} from "../utils/memory-references";

const getProjectRootFromContext = (c: Context) =>
	c.get("projectRoot") as string;
const getConfigFromContext = (c: Context) =>
	c.get("config") as TrickroomConfig | undefined;

const parseJsonBody = async (request: Request) =>
	request.json().catch(() => null) as Promise<unknown>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const readString = (
	body: Record<string, unknown>,
	key: string,
): string | undefined => {
	const value = body[key];
	return typeof value === "string" ? value : undefined;
};

const readNullableString = (
	body: Record<string, unknown>,
	key: string,
): string | null | undefined => {
	if (!Object.hasOwn(body, key)) return undefined;
	const value = body[key];
	if (value === null) return null;
	return typeof value === "string" ? value : undefined;
};

const readStringArrayOrNull = (
	body: Record<string, unknown>,
	key: string,
): string[] | null | undefined => {
	if (!Object.hasOwn(body, key)) return undefined;
	const value = body[key];
	if (value === null) return null;
	if (
		!Array.isArray(value) ||
		!value.every((entry) => typeof entry === "string")
	) {
		return undefined;
	}
	return value;
};

const readNullableBoolean = (
	body: Record<string, unknown>,
	key: string,
): boolean | null | undefined => {
	if (!Object.hasOwn(body, key)) return undefined;
	const value = body[key];
	if (value === null) return null;
	return typeof value === "boolean" ? value : undefined;
};

const readNullableNumber = (
	body: Record<string, unknown>,
	key: string,
): number | null | undefined => {
	if (!Object.hasOwn(body, key)) return undefined;
	const value = body[key];
	if (value === null) return null;
	return typeof value === "number" && Number.isFinite(value)
		? value
		: undefined;
};

const readExpectedRevision = (
	body: Record<string, unknown>,
): string | undefined => {
	const value = readString(body, "expectedRevision");
	return value?.startsWith("sha256:") ? value : undefined;
};

export const createMemoryErrorResponse = (error: unknown) => {
	if (error instanceof MemoryManifestError) {
		switch (error.code) {
			case "STALE_WRITE":
				return jsonError(error.message, 409);
			case "NOTE_NOT_FOUND":
			case "SCOPE_NOT_FOUND":
				return jsonError(error.message, 404);
			case "INVALID_SCOPE":
			case "INVALID_CATEGORY":
			case "INVALID_MANIFEST":
			case "MALFORMED_MANIFEST":
				return jsonError(error.message, 400);
		}
	}

	console.error(error);
	return jsonError("Failed to process memory request", 500);
};

/**
 * Best-effort, non-blocking reference validation. Bodies are stored verbatim, so
 * resolution failures never reject a write — they surface as warnings only.
 */
const safeReferenceWarnings = async (
	projectRoot: string,
	scope: MemoryScope,
	body: string,
) => {
	try {
		return await collectMemoryReferenceWarnings(projectRoot, scope, body);
	} catch {
		return [];
	}
};

type MemoryAuditEntry = {
	operation: string;
	scope: MemoryScopeRef;
	noteId?: string | null;
	expectedRevision?: string | null;
	resultingRevision?: string | null;
};

/**
 * Mirrors the MCP audit log so user-driven memory writes from the app are
 * recorded alongside agent writes. Gated by the same project audit flag and
 * tagged with source: "rest" to distinguish them from MCP tool calls.
 */
const appendMemoryAuditLog = async (
	projectRoot: string,
	config: TrickroomConfig | undefined,
	entry: MemoryAuditEntry,
) => {
	if (config?.mcp?.auditLog !== true) {
		return;
	}

	const auditLogPath = path.join(projectRoot, ".trickroom", "audit-log.jsonl");
	await mkdir(path.dirname(auditLogPath), { recursive: true });
	await appendFile(
		auditLogPath,
		`${JSON.stringify({
			timestamp: new Date().toISOString(),
			source: "rest",
			toolName: entry.operation,
			operation: entry.operation,
			projectId: config.projectId ?? null,
			projectRoot,
			designFileId: entry.scope.kind === "design" ? entry.scope.id : null,
			scope: entry.scope,
			noteId: entry.noteId ?? null,
			expectedRevision: entry.expectedRevision ?? null,
			resultingRevision: entry.resultingRevision ?? null,
			success: true,
			status: "success",
		})}\n`,
		"utf8",
	);
};

const listMemoryResponse = async (
	c: Context,
	projectRoot: string,
	scope: MemoryScope,
	scopeRef: MemoryScopeRef,
) => {
	const read = await readMemoryManifest(projectRoot, scope);
	return c.json({
		scope: scopeRef,
		revision: read.revision,
		exists: read.exists,
		summary: summarizeMemoryManifest(read.manifest),
		notes: Object.values(read.manifest.notes),
	});
};

const referenceTargetsResponse = async (
	c: Context,
	projectRoot: string,
	scope: MemoryScope,
	scopeRef: MemoryScopeRef,
) => {
	const type = c.req.query("type");
	if (!type || !(MEMORY_REFERENCE_TYPES as readonly string[]).includes(type)) {
		return jsonError(
			`Query parameter "type" must be one of: ${MEMORY_REFERENCE_TYPES.join(", ")}.`,
			400,
		);
	}
	const query = c.req.query("query") ?? "";
	const targets = await listMemoryReferenceTargets(
		projectRoot,
		scope,
		type as MemoryReferenceType,
		query,
	);
	return c.json({ scope: scopeRef, type, targets });
};

const getMemoryNoteResponse = async (
	c: Context,
	projectRoot: string,
	scope: MemoryScope,
	scopeRef: MemoryScopeRef,
	noteId: string,
) => {
	const read = await readMemoryManifest(projectRoot, scope);
	const note = read.manifest.notes[noteId];
	if (!note) {
		return jsonError(`Memory note "${noteId}" was not found.`, 404);
	}
	return c.json({ scope: scopeRef, revision: read.revision, note });
};

const addMemoryNoteResponse = async (
	c: Context,
	projectRoot: string,
	config: TrickroomConfig | undefined,
	scope: MemoryScope,
	scopeRef: MemoryScopeRef,
) => {
	const body = await parseJsonBody(c.req.raw);
	if (!isRecord(body)) {
		return jsonError("Request body must be a JSON object", 400);
	}

	const noteBody = readString(body, "body");
	const category = readString(body, "category");
	if (!noteBody || noteBody.trim().length === 0) {
		return jsonError("Request body must include a non-empty body", 400);
	}
	if (!category) {
		return jsonError("Request body must include a category", 400);
	}

	const authorLabel = readString(body, "authorLabel");
	const tags = readStringArrayOrNull(body, "tags");
	const pinned = readNullableBoolean(body, "pinned");
	const order = readNullableNumber(body, "order");

	const { read, note } = await addMemoryNote(
		projectRoot,
		scope,
		{
			body: noteBody,
			category: category as never,
			...(readString(body, "title")
				? { title: readString(body, "title") }
				: {}),
			...(tags ? { tags } : {}),
			...(typeof pinned === "boolean" ? { pinned } : {}),
			...(typeof order === "number" ? { order } : {}),
			author: { kind: "user", ...(authorLabel ? { label: authorLabel } : {}) },
		},
		{ expectedRevision: readExpectedRevision(body) },
	);

	await appendMemoryAuditLog(projectRoot, config, {
		operation: "addMemoryNote",
		scope: scopeRef,
		noteId: note.noteId,
		resultingRevision: read.revision,
	});

	const referenceWarnings = await safeReferenceWarnings(
		projectRoot,
		scope,
		note.body,
	);

	return c.json(
		{ scope: scopeRef, newRevision: read.revision, note, referenceWarnings },
		201,
	);
};

const updateMemoryNoteResponse = async (
	c: Context,
	projectRoot: string,
	config: TrickroomConfig | undefined,
	scope: MemoryScope,
	scopeRef: MemoryScopeRef,
	noteId: string,
) => {
	const body = await parseJsonBody(c.req.raw);
	if (!isRecord(body)) {
		return jsonError("Request body must be a JSON object", 400);
	}

	const expectedRevision = readExpectedRevision(body);
	if (!expectedRevision) {
		return jsonError(
			"Request body must include the current expectedRevision (sha256:...).",
			400,
		);
	}

	const category = readString(body, "category");
	const noteBody = readString(body, "body");
	const title = readNullableString(body, "title");
	const tags = readStringArrayOrNull(body, "tags");
	const pinned = readNullableBoolean(body, "pinned");
	const order = readNullableNumber(body, "order");
	const authorLabel = readString(body, "authorLabel");

	const { read, note } = await updateMemoryNote(
		projectRoot,
		scope,
		noteId,
		{
			...(category !== undefined ? { category: category as never } : {}),
			...(noteBody !== undefined ? { body: noteBody } : {}),
			...(title !== undefined ? { title } : {}),
			...(tags !== undefined ? { tags } : {}),
			...(pinned !== undefined ? { pinned } : {}),
			...(order !== undefined ? { order } : {}),
			...(authorLabel ? { author: { kind: "user", label: authorLabel } } : {}),
		},
		{ expectedRevision },
	);

	await appendMemoryAuditLog(projectRoot, config, {
		operation: "updateMemoryNote",
		scope: scopeRef,
		noteId,
		expectedRevision,
		resultingRevision: read.revision,
	});

	const referenceWarnings = await safeReferenceWarnings(
		projectRoot,
		scope,
		note.body,
	);

	return c.json({
		scope: scopeRef,
		newRevision: read.revision,
		note,
		referenceWarnings,
	});
};

const deleteMemoryNoteResponse = async (
	c: Context,
	projectRoot: string,
	config: TrickroomConfig | undefined,
	scope: MemoryScope,
	scopeRef: MemoryScopeRef,
	noteId: string,
) => {
	const expectedRevision =
		c.req.query("expectedRevision") ??
		(await (async () => {
			const body = await parseJsonBody(c.req.raw);
			return isRecord(body) ? readExpectedRevision(body) : undefined;
		})());
	if (!expectedRevision || !expectedRevision.startsWith("sha256:")) {
		return jsonError(
			"A current expectedRevision (sha256:...) is required to delete a note.",
			400,
		);
	}

	const read = await deleteMemoryNote(projectRoot, scope, noteId, {
		expectedRevision,
	});

	await appendMemoryAuditLog(projectRoot, config, {
		operation: "deleteMemoryNote",
		scope: scopeRef,
		noteId,
		expectedRevision,
		resultingRevision: read.revision,
	});

	return c.json({
		scope: scopeRef,
		newRevision: read.revision,
		noteId,
		deleted: true,
	});
};

/**
 * Registers system-scoped memory routes onto the existing systems router, which
 * already resolves the design system via its `/:systemName/*` middleware.
 */
export const registerSystemMemoryRoutes = (
	systemsRoutes: Hono,
	getProjectRoot: (c: Context) => string,
	getRouteSystem: (c: Context) => { systemId: string; systemName: string },
) => {
	const resolve = (c: Context) => {
		const { systemId } = getRouteSystem(c);
		return {
			projectRoot: getProjectRoot(c),
			config: getConfigFromContext(c),
			scope: { kind: "system", systemHandle: systemId } as MemoryScope,
			scopeRef: { kind: "system", id: systemId } as MemoryScopeRef,
		};
	};

	systemsRoutes.get("/:systemName/memory", async (c) => {
		const { projectRoot, scope, scopeRef } = resolve(c);
		try {
			return await listMemoryResponse(c, projectRoot, scope, scopeRef);
		} catch (error) {
			return createMemoryErrorResponse(error);
		}
	});

	systemsRoutes.post("/:systemName/memory", async (c) => {
		const { projectRoot, config, scope, scopeRef } = resolve(c);
		try {
			return await addMemoryNoteResponse(
				c,
				projectRoot,
				config,
				scope,
				scopeRef,
			);
		} catch (error) {
			return createMemoryErrorResponse(error);
		}
	});

	systemsRoutes.get("/:systemName/memory/reference-targets", async (c) => {
		const { projectRoot, scope, scopeRef } = resolve(c);
		try {
			return await referenceTargetsResponse(c, projectRoot, scope, scopeRef);
		} catch (error) {
			return createMemoryErrorResponse(error);
		}
	});

	systemsRoutes.get("/:systemName/memory/:noteId", async (c) => {
		const { projectRoot, scope, scopeRef } = resolve(c);
		try {
			return await getMemoryNoteResponse(
				c,
				projectRoot,
				scope,
				scopeRef,
				c.req.param("noteId"),
			);
		} catch (error) {
			return createMemoryErrorResponse(error);
		}
	});

	systemsRoutes.patch("/:systemName/memory/:noteId", async (c) => {
		const { projectRoot, config, scope, scopeRef } = resolve(c);
		try {
			return await updateMemoryNoteResponse(
				c,
				projectRoot,
				config,
				scope,
				scopeRef,
				c.req.param("noteId"),
			);
		} catch (error) {
			return createMemoryErrorResponse(error);
		}
	});

	systemsRoutes.delete("/:systemName/memory/:noteId", async (c) => {
		const { projectRoot, config, scope, scopeRef } = resolve(c);
		try {
			return await deleteMemoryNoteResponse(
				c,
				projectRoot,
				config,
				scope,
				scopeRef,
				c.req.param("noteId"),
			);
		} catch (error) {
			return createMemoryErrorResponse(error);
		}
	});
};

const resolveProjectMemory = (c: Context) => ({
	projectRoot: getProjectRootFromContext(c),
	config: getConfigFromContext(c),
	scope: { kind: "project" } as MemoryScope,
	scopeRef: { kind: "project" } as MemoryScopeRef,
});

const resolveDesignMemory = (c: Context) => {
	const designId = c.req.param("designId");
	return {
		projectRoot: getProjectRootFromContext(c),
		config: getConfigFromContext(c),
		scope: { kind: "design", designId } as MemoryScope,
		scopeRef: { kind: "design", id: designId } as MemoryScopeRef,
	};
};

/**
 * Mounts project- and design-scoped memory routes on the app, reusing the
 * provided middleware to attach projectRoot/config to each request.
 */
export const registerProjectAndDesignMemoryRoutes = (
	app: Hono,
	attachProject: MiddlewareHandler,
) => {
	app.use("/api/trickroom/memory", attachProject);
	app.use("/api/trickroom/memory/*", attachProject);
	app.use("/api/trickroom/designs/*", attachProject);

	app.get("/api/trickroom/memory", async (c) => {
		const { projectRoot, scope, scopeRef } = resolveProjectMemory(c);
		try {
			return await listMemoryResponse(c, projectRoot, scope, scopeRef);
		} catch (error) {
			return createMemoryErrorResponse(error);
		}
	});

	app.post("/api/trickroom/memory", async (c) => {
		const { projectRoot, config, scope, scopeRef } = resolveProjectMemory(c);
		try {
			return await addMemoryNoteResponse(
				c,
				projectRoot,
				config,
				scope,
				scopeRef,
			);
		} catch (error) {
			return createMemoryErrorResponse(error);
		}
	});

	app.get("/api/trickroom/memory/reference-targets", async (c) => {
		const { projectRoot, scope, scopeRef } = resolveProjectMemory(c);
		try {
			return await referenceTargetsResponse(c, projectRoot, scope, scopeRef);
		} catch (error) {
			return createMemoryErrorResponse(error);
		}
	});

	app.get("/api/trickroom/memory/:noteId", async (c) => {
		const { projectRoot, scope, scopeRef } = resolveProjectMemory(c);
		try {
			return await getMemoryNoteResponse(
				c,
				projectRoot,
				scope,
				scopeRef,
				c.req.param("noteId"),
			);
		} catch (error) {
			return createMemoryErrorResponse(error);
		}
	});

	app.patch("/api/trickroom/memory/:noteId", async (c) => {
		const { projectRoot, config, scope, scopeRef } = resolveProjectMemory(c);
		try {
			return await updateMemoryNoteResponse(
				c,
				projectRoot,
				config,
				scope,
				scopeRef,
				c.req.param("noteId"),
			);
		} catch (error) {
			return createMemoryErrorResponse(error);
		}
	});

	app.delete("/api/trickroom/memory/:noteId", async (c) => {
		const { projectRoot, config, scope, scopeRef } = resolveProjectMemory(c);
		try {
			return await deleteMemoryNoteResponse(
				c,
				projectRoot,
				config,
				scope,
				scopeRef,
				c.req.param("noteId"),
			);
		} catch (error) {
			return createMemoryErrorResponse(error);
		}
	});

	app.get("/api/trickroom/designs/:designId/memory", async (c) => {
		const { projectRoot, scope, scopeRef } = resolveDesignMemory(c);
		try {
			return await listMemoryResponse(c, projectRoot, scope, scopeRef);
		} catch (error) {
			return createMemoryErrorResponse(error);
		}
	});

	app.post("/api/trickroom/designs/:designId/memory", async (c) => {
		const { projectRoot, config, scope, scopeRef } = resolveDesignMemory(c);
		try {
			return await addMemoryNoteResponse(
				c,
				projectRoot,
				config,
				scope,
				scopeRef,
			);
		} catch (error) {
			return createMemoryErrorResponse(error);
		}
	});

	app.get(
		"/api/trickroom/designs/:designId/memory/reference-targets",
		async (c) => {
			const { projectRoot, scope, scopeRef } = resolveDesignMemory(c);
			try {
				return await referenceTargetsResponse(c, projectRoot, scope, scopeRef);
			} catch (error) {
				return createMemoryErrorResponse(error);
			}
		},
	);

	app.get("/api/trickroom/designs/:designId/memory/:noteId", async (c) => {
		const { projectRoot, scope, scopeRef } = resolveDesignMemory(c);
		try {
			return await getMemoryNoteResponse(
				c,
				projectRoot,
				scope,
				scopeRef,
				c.req.param("noteId"),
			);
		} catch (error) {
			return createMemoryErrorResponse(error);
		}
	});

	app.patch("/api/trickroom/designs/:designId/memory/:noteId", async (c) => {
		const { projectRoot, config, scope, scopeRef } = resolveDesignMemory(c);
		try {
			return await updateMemoryNoteResponse(
				c,
				projectRoot,
				config,
				scope,
				scopeRef,
				c.req.param("noteId"),
			);
		} catch (error) {
			return createMemoryErrorResponse(error);
		}
	});

	app.delete("/api/trickroom/designs/:designId/memory/:noteId", async (c) => {
		const { projectRoot, config, scope, scopeRef } = resolveDesignMemory(c);
		try {
			return await deleteMemoryNoteResponse(
				c,
				projectRoot,
				config,
				scope,
				scopeRef,
				c.req.param("noteId"),
			);
		} catch (error) {
			return createMemoryErrorResponse(error);
		}
	});
};
