import { Hono } from "hono";
import {
	type CaptureScreenshotOptions,
	captureScreenshot,
	ScreenshotServiceError,
} from "../screenshot/screenshot-service";
import {
	SCREENSHOT_VIEWPORT_PRESETS,
	type ScreenshotRequest,
	type ScreenshotResult,
} from "../screenshot/types";
import { isRecord, jsonError } from "../server-utils";
import type { TrickroomConfig } from "../types";

type ScreenshotEnv = {
	Variables: { projectRoot: string; config: TrickroomConfig };
};

export type ScreenshotCapture = (
	request: ScreenshotRequest,
	options: CaptureScreenshotOptions,
) => Promise<ScreenshotResult>;

function readOptionalString(value: unknown) {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function parseScreenshotRequest(
	body: unknown,
): ScreenshotRequest | null {
	if (!isRecord(body)) return null;
	const designFileId = readOptionalString(body.designFileId);
	if (!designFileId) return null;

	let viewport: ScreenshotRequest["viewport"];
	if (typeof body.viewport === "string") {
		if (!(body.viewport in SCREENSHOT_VIEWPORT_PRESETS)) return null;
		viewport = body.viewport as keyof typeof SCREENSHOT_VIEWPORT_PRESETS;
	} else if (isRecord(body.viewport)) {
		if (
			typeof body.viewport.width !== "number" ||
			typeof body.viewport.height !== "number"
		) {
			return null;
		}
		viewport = {
			width: body.viewport.width,
			height: body.viewport.height,
		};
	} else if (body.viewport !== undefined) {
		return null;
	}

	if (
		body.theme !== undefined &&
		body.theme !== "light" &&
		body.theme !== "dark"
	) {
		return null;
	}

	return {
		designFileId,
		...(readOptionalString(body.boardId)
			? { boardId: readOptionalString(body.boardId) }
			: {}),
		...(readOptionalString(body.nodeId)
			? { nodeId: readOptionalString(body.nodeId) }
			: {}),
		...(viewport ? { viewport } : {}),
		...(body.theme ? { theme: body.theme } : {}),
		...(readOptionalString(body.outputPath)
			? { outputPath: readOptionalString(body.outputPath) }
			: {}),
		...(readOptionalString(body.executablePath)
			? { executablePath: readOptionalString(body.executablePath) }
			: {}),
	};
}

function statusForScreenshotError(error: ScreenshotServiceError) {
	switch (error.code) {
		case "INVALID_SCREENSHOT_REQUEST":
			return 400 as const;
		case "SCREENSHOT_RUNTIME_MISSING":
			return 501 as const;
		case "CHROME_NOT_FOUND":
			return 503 as const;
		case "CAPTURE_TIMEOUT":
			return 504 as const;
		case "CAPTURE_RENDER_FAILED":
			return 422 as const;
		default:
			return 500 as const;
	}
}

export function createScreenshotRoutes(
	capture: ScreenshotCapture = captureScreenshot,
) {
	const routes = new Hono<ScreenshotEnv>();
	routes.post("/", async (c) => {
		const body = await c.req.json().catch(() => null);
		const request = parseScreenshotRequest(body);
		if (!request) {
			return jsonError(
				"Invalid screenshot payload: expected designFileId plus optional boardId, nodeId, viewport, theme, outputPath, and executablePath.",
				400,
			);
		}

		const requestHeaders: Record<string, string> = {};
		const cookie = c.req.header("cookie");
		const sessionHeader = c.req.header("x-trickroom-session");
		if (cookie) requestHeaders.cookie = cookie;
		if (sessionHeader) requestHeaders["x-trickroom-session"] = sessionHeader;

		try {
			const result = await capture(request, {
				baseUrl: new URL(c.req.url).origin,
				projectRoot: c.get("projectRoot"),
				requestHeaders,
			});
			return c.json(result);
		} catch (error) {
			if (error instanceof ScreenshotServiceError) {
				return c.json(
					{ error: error.message, code: error.code },
					statusForScreenshotError(error),
				);
			}
			throw error;
		}
	});
	return routes;
}
