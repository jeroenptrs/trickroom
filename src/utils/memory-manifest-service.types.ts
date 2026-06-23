export const MEMORY_MANIFEST_VERSION = 1 as const;

export const MEMORY_MANIFEST_FILE_NAME = "memory.json" as const;

export const MEMORY_NOTE_ID_PREFIX = "note_" as const;

/** Fixed epoch timestamp so an empty manifest has a deterministic revision. */
export const MEMORY_EMPTY_TIMESTAMP = new Date(0).toISOString();

export const MEMORY_CATEGORIES = [
	"intent",
	"usage",
	"conventions",
	"constraints",
	"decision",
	"todo",
] as const;

export type MemoryCategory = (typeof MEMORY_CATEGORIES)[number];

export const isMemoryCategory = (value: unknown): value is MemoryCategory =>
	typeof value === "string" &&
	(MEMORY_CATEGORIES as readonly string[]).includes(value);

export type MemoryNoteAuthorKind = "agent" | "user";

export type MemoryNoteAuthor = {
	kind: MemoryNoteAuthorKind;
	label?: string;
};

export type MemoryNote = {
	noteId: string;
	title?: string;
	body: string;
	category: MemoryCategory;
	tags?: string[];
	pinned?: boolean;
	order?: number;
	createdAt: string;
	updatedAt: string;
	author: MemoryNoteAuthor;
};

/**
 * The owner this memory manifest is attached to, denormalized into the file for
 * safety/inspectability. The MCP/UI scope input is resolved to one of these.
 */
export type MemoryScopeRef =
	| { kind: "system"; id: string }
	| { kind: "design"; id: string }
	| { kind: "project" };

/** Caller-facing scope used to resolve a manifest path. */
export type MemoryScope =
	| { kind: "system"; systemHandle: string }
	| { kind: "design"; designId: string }
	| { kind: "project" };

export type MemoryManifest = {
	version: typeof MEMORY_MANIFEST_VERSION;
	scope: MemoryScopeRef;
	metadata: {
		createdAt: string;
		updatedAt: string;
	};
	notes: Record<string, MemoryNote>;
};

export type MemoryManifestRevision = `sha256:${string}`;

export type MemoryManifestRead = {
	manifest: MemoryManifest;
	revision: MemoryManifestRevision;
	exists: boolean;
	path: string;
	scope: MemoryScopeRef;
};

export type MemorySummary = {
	noteCount: number;
	categories: MemoryCategory[];
	updatedAt: string | null;
};
