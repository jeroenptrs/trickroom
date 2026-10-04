import { createHash } from "node:crypto";
import type { Node, TrickroomDesign } from "../types";
import type { DesignFileRevision } from "./design-file-service.types";

/**
 * Design revisions.
 *
 * A design is a manifest (name, system link and other top-level fields) plus
 * an ordered list of boards. Each part has its own revision, a short content
 * hash of its in-memory value. The design's revision is a composite token
 * built from the manifest revision and every board's id and revision, in
 * board order:
 *
 *   r2.<base64url(manifest[8] + (boardIdHash[4] + boardRevision[8])*)>
 *
 * The token is opaque to callers. The service decodes it to see which boards
 * a caller based a write on, so a write that changes board A only conflicts
 * with changes to board A, not with changes to board B.
 *
 * Revisions hash content, not bytes: keys are sorted before hashing, so the
 * same design has the same revision regardless of key order, formatting or
 * on-disk layout (one file or a folder of files).
 */

const tokenPrefix = "r2.";
const manifestRevisionBytes = 8;
const boardIdHashBytes = 4;
const boardRevisionBytes = 8;
const boardEntryBytes = boardIdHashBytes + boardRevisionBytes;

/** Revision of one board: hex of the first 8 bytes of its content hash. */
export type DesignBoardRevision = string;

export type DesignRevisionParts = {
	manifest: string;
	boards: { id: string; revision: DesignBoardRevision }[];
};

/** A decoded revision token. Boards are identified by a hash of their id. */
export type DecodedDesignRevision = {
	manifest: string;
	boards: { idHash: string; revision: DesignBoardRevision }[];
};

/**
 * JSON with object keys sorted at every level, so equal values serialize
 * identically whatever order their keys were assembled in.
 */
export const stableStringify = (value: unknown): string => {
	const out: string[] = [];
	const write = (entry: unknown) => {
		if (entry === null || typeof entry !== "object") {
			out.push(JSON.stringify(entry) ?? "null");
			return;
		}
		if (Array.isArray(entry)) {
			out.push("[");
			for (let index = 0; index < entry.length; index += 1) {
				if (index > 0) out.push(",");
				const item = entry[index];
				if (item === undefined) {
					out.push("null");
				} else {
					write(item);
				}
			}
			out.push("]");
			return;
		}
		const record = entry as Record<string, unknown>;
		out.push("{");
		let first = true;
		for (const key of Object.keys(record).sort()) {
			const item = record[key];
			if (item === undefined) continue;
			if (!first) out.push(",");
			first = false;
			out.push(JSON.stringify(key), ":");
			write(item);
		}
		out.push("}");
	};
	write(value);
	return out.join("");
};

const digest = (value: string) => createHash("sha256").update(value).digest();

const hashHex = (value: string, bytes: number) =>
	digest(value).subarray(0, bytes).toString("hex");

export const hashBoardId = (boardId: string) =>
	hashHex(boardId, boardIdHashBytes);

export const calculateBoardRevision = (board: Node): DesignBoardRevision =>
	hashHex(stableStringify(board), boardRevisionBytes);

/** The design's top-level fields other than `boards` and `version`. */
export const getDesignManifestFields = (
	design: TrickroomDesign | Record<string, unknown>,
): Record<string, unknown> => {
	const {
		boards: _boards,
		version: _version,
		...manifest
	} = design as Record<string, unknown>;
	return manifest;
};

export const calculateManifestRevision = (
	design: TrickroomDesign | Record<string, unknown>,
) => hashHex(stableStringify(getDesignManifestFields(design)), 8);

/**
 * `knownRevision` may supply a board's revision without hashing it again,
 * for example from a cache keyed on the board's unchanged file.
 */
export const getDesignRevisionParts = (
	design: TrickroomDesign,
	knownRevision?: (board: Node) => DesignBoardRevision | undefined,
): DesignRevisionParts => ({
	manifest: calculateManifestRevision(design),
	boards: design.boards.map((board) => ({
		id: board.id,
		revision: knownRevision?.(board) ?? calculateBoardRevision(board),
	})),
});

export const encodeDesignRevision = (
	parts: DesignRevisionParts,
): DesignFileRevision => {
	const buffer = Buffer.alloc(
		manifestRevisionBytes + parts.boards.length * boardEntryBytes,
	);
	buffer.write(parts.manifest, 0, "hex");
	parts.boards.forEach((board, index) => {
		const offset = manifestRevisionBytes + index * boardEntryBytes;
		buffer.write(hashBoardId(board.id), offset, "hex");
		buffer.write(board.revision, offset + boardIdHashBytes, "hex");
	});
	return `${tokenPrefix}${buffer.toString("base64url")}`;
};

export const calculateDesignRevision = (
	design: TrickroomDesign,
): DesignFileRevision => encodeDesignRevision(getDesignRevisionParts(design));

/** Decodes a revision token, or returns null for anything else. */
export const decodeDesignRevision = (
	revision: string,
): DecodedDesignRevision | null => {
	if (!revision.startsWith(tokenPrefix)) {
		return null;
	}
	const encoded = revision.slice(tokenPrefix.length);
	if (!/^[A-Za-z0-9_-]*$/.test(encoded)) {
		return null;
	}
	const buffer = Buffer.from(encoded, "base64url");
	if (
		buffer.length < manifestRevisionBytes ||
		(buffer.length - manifestRevisionBytes) % boardEntryBytes !== 0 ||
		buffer.toString("base64url") !== encoded
	) {
		return null;
	}

	const boards: DecodedDesignRevision["boards"] = [];
	for (
		let offset = manifestRevisionBytes;
		offset < buffer.length;
		offset += boardEntryBytes
	) {
		boards.push({
			idHash: buffer
				.subarray(offset, offset + boardIdHashBytes)
				.toString("hex"),
			revision: buffer
				.subarray(offset + boardIdHashBytes, offset + boardEntryBytes)
				.toString("hex"),
		});
	}
	return {
		manifest: buffer.subarray(0, manifestRevisionBytes).toString("hex"),
		boards,
	};
};

export const decodeDesignRevisionParts = (
	parts: DesignRevisionParts,
): DecodedDesignRevision => ({
	manifest: parts.manifest,
	boards: parts.boards.map((board) => ({
		idHash: hashBoardId(board.id),
		revision: board.revision,
	})),
});
