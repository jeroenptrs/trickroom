import { strToU8, zipSync } from "fflate";
import { Hono } from "hono";
import { exportDesignBoards } from "../export/export-design";
import {
	contentDispositionAttachment,
	dedupeFilename,
	makeZipFilename,
} from "../export/filenames";
import { isRecord, jsonError } from "../server-utils";
import type { Node, TrickroomConfig } from "../types";

type ExportEnv = {
	Variables: { projectRoot: string; config: TrickroomConfig };
};

export const exportRoutes = new Hono<ExportEnv>();

type ExportBoardInput = { name: string; node: Node };

type ExportRequest = {
	boards: ExportBoardInput[];
	systemId: string | null;
	projectName: string;
	designName: string;
};

function readExportRequest(body: unknown): ExportRequest | null {
	if (
		!isRecord(body) ||
		!Array.isArray(body.boards) ||
		body.boards.length === 0
	) {
		return null;
	}
	const boards: ExportBoardInput[] = [];
	for (const entry of body.boards) {
		if (
			!isRecord(entry) ||
			typeof entry.name !== "string" ||
			!isRecord(entry.node)
		) {
			return null;
		}
		boards.push({ name: entry.name, node: entry.node as unknown as Node });
	}
	const trimmedString = (value: unknown, fallback: string) =>
		typeof value === "string" && value.trim().length > 0 ? value : fallback;
	return {
		boards,
		systemId:
			typeof body.systemId === "string" && body.systemId.trim().length > 0
				? body.systemId.trim()
				: null,
		projectName: trimmedString(body.projectName, "Project"),
		designName: trimmedString(body.designName, "Design"),
	};
}

/**
 * POST /api/trickroom/export — render the supplied board(s) to self-contained,
 * live-interactive HTML. One board returns the `.html`; multiple return a `.zip`.
 * The board trees come from the renderer's live store; the shared export core
 * reads tokens, icons and assets from disk and precompiles Tailwind.
 */
exportRoutes.post("/", async (c) => {
	const projectRoot = c.get("projectRoot");
	const config = c.get("config");

	const body = await c.req.json().catch(() => null);
	const request = readExportRequest(body);
	if (!request) {
		return jsonError(
			"Invalid export payload: expected { boards: [{ name, node }], projectName, designName }",
			400,
		);
	}

	try {
		const { epoch, files } = await exportDesignBoards({
			projectRoot,
			config,
			boards: request.boards.map((board) => board.node),
			systemId: request.systemId,
			projectName: request.projectName,
			designName: request.designName,
		});

		if (files.length === 1) {
			const only = files[0];
			return new Response(only.html, {
				headers: {
					"content-type": "text/html; charset=utf-8",
					"content-disposition": contentDispositionAttachment(only.filename),
					"cache-control": "no-store",
				},
			});
		}

		const taken = new Set<string>();
		const zipped = zipSync(
			Object.fromEntries(
				files.map((file) => [
					dedupeFilename(file.filename, taken),
					strToU8(file.html),
				]),
			),
		);
		const zipBuffer = zipped.buffer.slice(
			zipped.byteOffset,
			zipped.byteOffset + zipped.byteLength,
		) as ArrayBuffer;
		return new Response(zipBuffer, {
			headers: {
				"content-type": "application/zip",
				"content-disposition": contentDispositionAttachment(
					makeZipFilename(request.projectName, request.designName, epoch),
				),
				"cache-control": "no-store",
			},
		});
	} catch (error) {
		console.error(error);
		return jsonError("Failed to export design", 500);
	}
});
