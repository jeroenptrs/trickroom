import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import {
	findDesignSystem,
	resolveDesignSystemFilePath,
} from "./design-system-store.ts";
import {
	isMemoryCategory,
	MEMORY_EMPTY_TIMESTAMP,
	MEMORY_MANIFEST_FILE_NAME,
	MEMORY_MANIFEST_VERSION,
	MEMORY_NOTE_ID_PREFIX,
	type MemoryCategory,
	type MemoryManifest,
	type MemoryManifestRead,
	type MemoryManifestRevision,
	type MemoryNote,
	type MemoryNoteAuthor,
	type MemoryScope,
	type MemoryScopeRef,
	type MemorySummary,
} from "./memory-manifest-service.types.ts";

export * from "./memory-manifest-service.types.ts";

export class MemoryManifestError extends Error {
	readonly code:
		| "MALFORMED_MANIFEST"
		| "INVALID_MANIFEST"
		| "INVALID_CATEGORY"
		| "STALE_WRITE"
		| "SCOPE_NOT_FOUND"
		| "NOTE_NOT_FOUND"
		| "INVALID_SCOPE";

	constructor(code: MemoryManifestError["code"], message: string) {
		super(message);
		this.name = "MemoryManifestError";
		this.code = code;
	}
}

export type AddMemoryNoteInput = {
	title?: string;
	body: string;
	category: MemoryCategory;
	tags?: string[];
	pinned?: boolean;
	order?: number;
	author?: MemoryNoteAuthor;
};

export type UpdateMemoryNotePatch = {
	title?: string | null;
	body?: string;
	category?: MemoryCategory;
	tags?: string[] | null;
	pinned?: boolean | null;
	order?: number | null;
	author?: MemoryNoteAuthor;
};

const isSafeDesignUuid = (uuid: string) =>
	uuid.trim().length > 0 &&
	uuid === uuid.trim() &&
	uuid !== "." &&
	uuid !== ".." &&
	!uuid.includes("/") &&
	!uuid.includes("\\");

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

export function serializeMemoryManifest(manifest: MemoryManifest): string {
	return `${JSON.stringify(manifest, null, "\t")}\n`;
}

export function memoryManifestRevision(
	contents: string,
): MemoryManifestRevision {
	return `sha256:${createHash("sha256").update(contents).digest("hex")}`;
}

export function emptyMemoryManifest(scope: MemoryScopeRef): MemoryManifest {
	return {
		version: MEMORY_MANIFEST_VERSION,
		scope,
		metadata: {
			createdAt: MEMORY_EMPTY_TIMESTAMP,
			updatedAt: MEMORY_EMPTY_TIMESTAMP,
		},
		notes: {},
	};
}

export function summarizeMemoryManifest(
	manifest: MemoryManifest,
): MemorySummary {
	const notes = Object.values(manifest.notes);
	const categories = [
		...new Set(notes.map((note) => note.category)),
	].sort() as MemoryCategory[];
	return {
		noteCount: notes.length,
		categories,
		updatedAt:
			manifest.metadata.updatedAt === MEMORY_EMPTY_TIMESTAMP
				? null
				: manifest.metadata.updatedAt,
	};
}

async function resolveMemoryLocation(
	projectRoot: string,
	scope: MemoryScope,
): Promise<{ path: string; scopeRef: MemoryScopeRef }> {
	if (scope.kind === "project") {
		return {
			path: path.join(path.resolve(projectRoot), ".trickroom", "memory.json"),
			scopeRef: { kind: "project" },
		};
	}

	if (scope.kind === "design") {
		if (!isSafeDesignUuid(scope.designId)) {
			throw new MemoryManifestError(
				"INVALID_SCOPE",
				"Design id must be a single path segment.",
			);
		}
		return {
			path: path.join(
				path.resolve(projectRoot),
				".trickroom",
				"designs",
				`${scope.designId}.memory.json`,
			),
			scopeRef: { kind: "design", id: scope.designId },
		};
	}

	const record = await findDesignSystem(projectRoot, scope.systemHandle);
	if (!record) {
		throw new MemoryManifestError(
			"SCOPE_NOT_FOUND",
			`Design system "${scope.systemHandle}" was not found.`,
		);
	}

	const filePath = await resolveDesignSystemFilePath(
		projectRoot,
		record.manifest.systemId,
		MEMORY_MANIFEST_FILE_NAME,
	);
	return {
		path: filePath,
		scopeRef: { kind: "system", id: record.manifest.systemId },
	};
}

function normalizeMemoryNote(
	value: unknown,
	noteKey: string,
	manifestPath: string,
): MemoryNote {
	if (!isRecord(value)) {
		throw new MemoryManifestError(
			"INVALID_MANIFEST",
			`Memory note "${noteKey}" must be an object in ${manifestPath}.`,
		);
	}

	const noteId =
		typeof value.noteId === "string" && value.noteId.trim().length > 0
			? value.noteId.trim()
			: noteKey.trim();
	if (noteId !== noteKey) {
		throw new MemoryManifestError(
			"INVALID_MANIFEST",
			`Memory note key "${noteKey}" must match noteId "${noteId}" in ${manifestPath}.`,
		);
	}

	if (typeof value.body !== "string") {
		throw new MemoryManifestError(
			"INVALID_MANIFEST",
			`Memory note "${noteId}" must include a string body in ${manifestPath}.`,
		);
	}

	if (!isMemoryCategory(value.category)) {
		throw new MemoryManifestError(
			"INVALID_CATEGORY",
			`Memory note "${noteId}" has an invalid category "${String(value.category)}".`,
		);
	}

	const author = normalizeAuthor(value.author);

	const note: MemoryNote = {
		noteId,
		body: value.body,
		category: value.category,
		createdAt:
			typeof value.createdAt === "string"
				? value.createdAt
				: MEMORY_EMPTY_TIMESTAMP,
		updatedAt:
			typeof value.updatedAt === "string"
				? value.updatedAt
				: MEMORY_EMPTY_TIMESTAMP,
		author,
	};

	if (typeof value.title === "string" && value.title.trim().length > 0) {
		note.title = value.title.trim();
	}
	if (Array.isArray(value.tags)) {
		const tags = [
			...new Set(
				value.tags
					.filter((tag): tag is string => typeof tag === "string")
					.map((tag) => tag.trim())
					.filter(Boolean),
			),
		];
		if (tags.length > 0) {
			note.tags = tags;
		}
	}
	if (typeof value.pinned === "boolean") {
		note.pinned = value.pinned;
	}
	if (typeof value.order === "number" && Number.isFinite(value.order)) {
		note.order = value.order;
	}

	return note;
}

function normalizeAuthor(value: unknown): MemoryNoteAuthor {
	if (!isRecord(value)) {
		return { kind: "agent" };
	}
	const kind = value.kind === "user" ? "user" : "agent";
	const author: MemoryNoteAuthor = { kind };
	if (typeof value.label === "string" && value.label.trim().length > 0) {
		author.label = value.label.trim();
	}
	return author;
}

export function migrateMemoryManifest(value: unknown): unknown {
	if (!isRecord(value)) {
		return value;
	}

	// Version hops run here before normalizeMemoryManifest enforces the current
	// MEMORY_MANIFEST_VERSION. Example for a future bump:
	// if (value.version === 1) return migrateMemoryManifestV1ToV2(value);

	return value;
}

export function normalizeMemoryManifest(
	value: unknown,
	scopeRef: MemoryScopeRef,
	manifestPath: string,
): MemoryManifest {
	const migrated = migrateMemoryManifest(value);
	if (!isRecord(migrated)) {
		throw new MemoryManifestError(
			"INVALID_MANIFEST",
			`Memory manifest at ${manifestPath} must be a JSON object.`,
		);
	}

	if (migrated.version !== MEMORY_MANIFEST_VERSION) {
		throw new MemoryManifestError(
			"INVALID_MANIFEST",
			`Unsupported memory manifest version: ${String(migrated.version)}.`,
		);
	}

	const metadata = isRecord(migrated.metadata) ? migrated.metadata : {};
	const notesValue = migrated.notes;
	if (notesValue !== undefined && !isRecord(notesValue)) {
		throw new MemoryManifestError(
			"INVALID_MANIFEST",
			`Memory manifest notes must be an object in ${manifestPath}.`,
		);
	}

	const notes: Record<string, MemoryNote> = {};
	for (const [noteKey, rawNote] of Object.entries(notesValue ?? {})) {
		const note = normalizeMemoryNote(rawNote, noteKey, manifestPath);
		notes[note.noteId] = note;
	}

	return {
		version: MEMORY_MANIFEST_VERSION,
		scope: scopeRef,
		metadata: {
			createdAt:
				typeof metadata.createdAt === "string"
					? metadata.createdAt
					: MEMORY_EMPTY_TIMESTAMP,
			updatedAt:
				typeof metadata.updatedAt === "string"
					? metadata.updatedAt
					: MEMORY_EMPTY_TIMESTAMP,
		},
		notes,
	};
}

function parseMemoryManifestContents(
	contents: string,
	scopeRef: MemoryScopeRef,
	manifestPath: string,
): MemoryManifest {
	let parsed: unknown;
	try {
		parsed = JSON.parse(contents) as unknown;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new MemoryManifestError(
			"MALFORMED_MANIFEST",
			`Malformed memory manifest JSON at ${manifestPath}: ${message}`,
		);
	}
	return normalizeMemoryManifest(parsed, scopeRef, manifestPath);
}

export async function readMemoryManifest(
	projectRoot: string,
	scope: MemoryScope,
): Promise<MemoryManifestRead> {
	const { path: manifestPath, scopeRef } = await resolveMemoryLocation(
		projectRoot,
		scope,
	);

	try {
		const contents = await readFile(manifestPath, "utf8");
		const manifest = parseMemoryManifestContents(
			contents,
			scopeRef,
			manifestPath,
		);
		return {
			manifest,
			revision: memoryManifestRevision(contents),
			exists: true,
			path: manifestPath,
			scope: scopeRef,
		};
	} catch (error) {
		if (error instanceof MemoryManifestError) {
			throw error;
		}
		const fsError = error as NodeJS.ErrnoException;
		if (fsError.code === "ENOENT") {
			const manifest = emptyMemoryManifest(scopeRef);
			return {
				manifest,
				revision: memoryManifestRevision(serializeMemoryManifest(manifest)),
				exists: false,
				path: manifestPath,
				scope: scopeRef,
			};
		}
		throw error;
	}
}

const memoryWriteQueues = new Map<string, Promise<unknown>>();

async function runExclusiveMemoryWrite<T>(
	manifestPath: string,
	operation: () => Promise<T>,
): Promise<T> {
	const previousWrite = memoryWriteQueues.get(manifestPath);
	const queuedWrite = previousWrite
		? previousWrite.catch(() => undefined).then(operation)
		: operation();

	memoryWriteQueues.set(manifestPath, queuedWrite);
	queuedWrite.then(
		() => {
			if (memoryWriteQueues.get(manifestPath) === queuedWrite) {
				memoryWriteQueues.delete(manifestPath);
			}
		},
		() => {
			if (memoryWriteQueues.get(manifestPath) === queuedWrite) {
				memoryWriteQueues.delete(manifestPath);
			}
		},
	);

	return queuedWrite;
}

async function writeJsonAtomically(filePath: string, value: unknown) {
	const contents = `${JSON.stringify(value, null, "\t")}\n`;
	const tempPath = `${filePath}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`;
	try {
		await writeFile(tempPath, contents, "utf8");
		await rename(tempPath, filePath);
	} catch (error) {
		await unlink(tempPath).catch(() => undefined);
		throw error;
	}
}

async function mutateMemoryManifest(
	projectRoot: string,
	scope: MemoryScope,
	options: { expectedRevision?: string; now?: string },
	mutate: (manifest: MemoryManifest, now: string) => MemoryManifest,
): Promise<MemoryManifestRead> {
	const { path: manifestPath, scopeRef } = await resolveMemoryLocation(
		projectRoot,
		scope,
	);

	return runExclusiveMemoryWrite(manifestPath, async () => {
		let current: MemoryManifest;
		let currentRevision: MemoryManifestRevision;
		try {
			const contents = await readFile(manifestPath, "utf8");
			current = parseMemoryManifestContents(contents, scopeRef, manifestPath);
			currentRevision = memoryManifestRevision(contents);
		} catch (error) {
			if (error instanceof MemoryManifestError) {
				throw error;
			}
			const fsError = error as NodeJS.ErrnoException;
			if (fsError.code !== "ENOENT") {
				throw error;
			}
			current = emptyMemoryManifest(scopeRef);
			currentRevision = memoryManifestRevision(
				serializeMemoryManifest(current),
			);
		}

		if (
			options.expectedRevision !== undefined &&
			options.expectedRevision !== currentRevision
		) {
			throw new MemoryManifestError(
				"STALE_WRITE",
				`Memory manifest revision mismatch for ${manifestPath}. Re-read and retry with the current revision.`,
			);
		}

		const now = options.now ?? new Date().toISOString();
		const createdAt =
			current.metadata.createdAt === MEMORY_EMPTY_TIMESTAMP
				? now
				: current.metadata.createdAt;
		const mutated = mutate(structuredClone(current), now);
		const next: MemoryManifest = {
			...mutated,
			version: MEMORY_MANIFEST_VERSION,
			scope: scopeRef,
			metadata: { createdAt, updatedAt: now },
		};
		const normalized = normalizeMemoryManifest(next, scopeRef, manifestPath);
		const contents = serializeMemoryManifest(normalized);

		await mkdir(path.dirname(manifestPath), { recursive: true });
		await writeJsonAtomically(manifestPath, normalized);

		return {
			manifest: normalized,
			revision: memoryManifestRevision(contents),
			exists: true,
			path: manifestPath,
			scope: scopeRef,
		};
	});
}

export function generateMemoryNoteId(): string {
	return `${MEMORY_NOTE_ID_PREFIX}${randomUUID()}`;
}

export async function addMemoryNote(
	projectRoot: string,
	scope: MemoryScope,
	input: AddMemoryNoteInput,
	options: { expectedRevision?: string; now?: string } = {},
): Promise<{ read: MemoryManifestRead; note: MemoryNote }> {
	if (!isMemoryCategory(input.category)) {
		throw new MemoryManifestError(
			"INVALID_CATEGORY",
			`Invalid memory category "${String(input.category)}".`,
		);
	}

	const noteId = generateMemoryNoteId();
	const read = await mutateMemoryManifest(
		projectRoot,
		scope,
		options,
		(manifest, now) => {
			const note: MemoryNote = {
				noteId,
				body: input.body,
				category: input.category,
				createdAt: now,
				updatedAt: now,
				author: input.author ?? { kind: "agent" },
				...(input.title && input.title.trim().length > 0
					? { title: input.title.trim() }
					: {}),
				...(input.tags && input.tags.length > 0 ? { tags: input.tags } : {}),
				...(typeof input.pinned === "boolean" ? { pinned: input.pinned } : {}),
				...(typeof input.order === "number" ? { order: input.order } : {}),
			};
			manifest.notes[noteId] = note;
			return manifest;
		},
	);

	const note = read.manifest.notes[noteId];
	if (!note) {
		throw new MemoryManifestError(
			"INVALID_MANIFEST",
			"Failed to persist the new memory note.",
		);
	}
	return { read, note };
}

export async function updateMemoryNote(
	projectRoot: string,
	scope: MemoryScope,
	noteId: string,
	patch: UpdateMemoryNotePatch,
	options: { expectedRevision: string; now?: string },
): Promise<{ read: MemoryManifestRead; note: MemoryNote }> {
	if (patch.category !== undefined && !isMemoryCategory(patch.category)) {
		throw new MemoryManifestError(
			"INVALID_CATEGORY",
			`Invalid memory category "${String(patch.category)}".`,
		);
	}

	const read = await mutateMemoryManifest(
		projectRoot,
		scope,
		options,
		(manifest, now) => {
			const existing = manifest.notes[noteId];
			if (!existing) {
				throw new MemoryManifestError(
					"NOTE_NOT_FOUND",
					`Memory note "${noteId}" was not found.`,
				);
			}

			const next: MemoryNote = { ...existing, updatedAt: now };
			if (patch.body !== undefined) {
				next.body = patch.body;
			}
			if (patch.category !== undefined) {
				next.category = patch.category;
			}
			if (patch.author !== undefined) {
				next.author = patch.author;
			}
			if (patch.title !== undefined) {
				if (patch.title === null || patch.title.trim().length === 0) {
					delete next.title;
				} else {
					next.title = patch.title.trim();
				}
			}
			if (patch.tags !== undefined) {
				if (patch.tags === null || patch.tags.length === 0) {
					delete next.tags;
				} else {
					next.tags = [
						...new Set(patch.tags.map((tag) => tag.trim()).filter(Boolean)),
					];
				}
			}
			if (patch.pinned !== undefined) {
				if (patch.pinned === null) {
					delete next.pinned;
				} else {
					next.pinned = patch.pinned;
				}
			}
			if (patch.order !== undefined) {
				if (patch.order === null) {
					delete next.order;
				} else {
					next.order = patch.order;
				}
			}

			manifest.notes[noteId] = next;
			return manifest;
		},
	);

	const note = read.manifest.notes[noteId];
	if (!note) {
		throw new MemoryManifestError(
			"NOTE_NOT_FOUND",
			`Memory note "${noteId}" was not found.`,
		);
	}
	return { read, note };
}

export async function deleteMemoryNote(
	projectRoot: string,
	scope: MemoryScope,
	noteId: string,
	options: { expectedRevision: string; now?: string },
): Promise<MemoryManifestRead> {
	return mutateMemoryManifest(projectRoot, scope, options, (manifest) => {
		if (!manifest.notes[noteId]) {
			throw new MemoryManifestError(
				"NOTE_NOT_FOUND",
				`Memory note "${noteId}" was not found.`,
			);
		}
		delete manifest.notes[noteId];
		return manifest;
	});
}
