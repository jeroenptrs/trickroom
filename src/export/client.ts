/**
 * Renderer-side export trigger. Serializes the chosen board(s) from the live
 * store, POSTs them to the Node export route, and saves the returned bytes via a
 * browser download using the server's Content-Disposition filename.
 *
 * Like the `/compile` client, the project is resolved server-side from request
 * context, so no project scope is sent.
 */

import type { DesignEntity } from "../stores/design-store";
import type { Node } from "../types";

export type ExportBoard = { name: string; node: Node };

export type ExportDesignPayload = {
	boards: ExportBoard[];
	systemId: string | null;
	projectName: string;
	designName: string;
};

function boardName(node: Node): string {
	const name = node.props["data-trickroom-name"];
	return typeof name === "string" && name.trim().length > 0 ? name : "Untitled";
}

/** Wrap every board (root Node) as an export board, preserving order. */
export function toExportBoards(boards: readonly Node[]): ExportBoard[] {
	return boards.map((node) => ({ name: boardName(node), node }));
}

/** The single export board matching `boardId`, or `[]` if not found. */
export function selectExportBoard(
	boards: readonly Node[],
	boardId: string | null,
): ExportBoard[] {
	if (!boardId) {
		return [];
	}
	const match = boards.find((node) => node.id === boardId);
	return match ? [{ name: boardName(match), node: match }] : [];
}

/** Walk up `parentId` to the root board id that contains `entityId`. */
export function findBoardIdForEntity(
	entitiesById: Record<string, DesignEntity>,
	entityId: string | null,
): string | null {
	if (!entityId || !entitiesById[entityId]) {
		return null;
	}
	let id = entityId;
	for (;;) {
		const parentId = entitiesById[id]?.parentId;
		if (!parentId || !entitiesById[parentId]) {
			return id;
		}
		id = parentId;
	}
}

/** Extract the download filename the server set (prefers the UTF-8 form). */
export function parseContentDispositionFilename(
	header: string | null,
): string | null {
	if (!header) {
		return null;
	}
	const utf8 = /filename\*=UTF-8''([^;]+)/i.exec(header);
	if (utf8) {
		try {
			return decodeURIComponent(utf8[1]);
		} catch {
			// fall through to the ASCII form
		}
	}
	const plain = /filename="([^"]+)"/i.exec(header);
	return plain ? plain[1] : null;
}

function triggerBrowserDownload(blob: Blob, filename: string): void {
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement("a");
	anchor.href = url;
	anchor.download = filename;
	document.body.appendChild(anchor);
	anchor.click();
	anchor.remove();
	setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** POST the payload and download the resulting `.html`/`.zip`. */
export async function downloadExport(
	payload: ExportDesignPayload,
): Promise<void> {
	const response = await fetch("/api/trickroom/export", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(payload),
	});
	if (!response.ok) {
		throw new Error(`Export failed (${response.status})`);
	}
	const blob = await response.blob();
	const filename =
		parseContentDispositionFilename(
			response.headers.get("content-disposition"),
		) ?? "trickroom-export.html";
	triggerBrowserDownload(blob, filename);
}
