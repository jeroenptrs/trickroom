import { Hono } from "hono";
import {
	type CaptureScreenshotOptions,
	captureScreenshot,
	ScreenshotServiceError,
} from "../screenshot/screenshot-service";
import {
	SCREENSHOT_VIEWPORT_PRESETS,
	type ScreenshotComponentTarget,
	type ScreenshotRequest,
	type ScreenshotResult,
	type ScreenshotShot,
	type ScreenshotTheme,
	type ScreenshotViewportInput,
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

const UNPARSEABLE = Symbol("unparseable");

function parseViewport(
	value: unknown,
): ScreenshotViewportInput | undefined | typeof UNPARSEABLE {
	if (value === undefined) return undefined;
	if (typeof value === "string") {
		return value in SCREENSHOT_VIEWPORT_PRESETS
			? (value as keyof typeof SCREENSHOT_VIEWPORT_PRESETS)
			: UNPARSEABLE;
	}
	if (typeof value === "number") return value;
	if (
		isRecord(value) &&
		typeof value.width === "number" &&
		typeof value.height === "number"
	) {
		return { width: value.width, height: value.height };
	}
	return UNPARSEABLE;
}

function parseTheme(
	value: unknown,
): ScreenshotTheme | undefined | typeof UNPARSEABLE {
	if (value === undefined) return undefined;
	return value === "light" || value === "dark" ? value : UNPARSEABLE;
}

function parseShot(value: unknown): ScreenshotShot | null {
	if (!isRecord(value)) return null;
	const viewport = parseViewport(value.viewport);
	const theme = parseTheme(value.theme);
	if (viewport === UNPARSEABLE || theme === UNPARSEABLE) return null;
	return {
		...(viewport !== undefined ? { viewport } : {}),
		...(theme ? { theme } : {}),
	};
}

function parseStringRecord(value: unknown): Record<string, string> | null {
	if (!isRecord(value)) return null;
	const entries = Object.entries(value);
	return entries.every(([, entry]) => typeof entry === "string")
		? (Object.fromEntries(entries) as Record<string, string>)
		: null;
}

function parseComponent(value: unknown): ScreenshotComponentTarget | null {
	if (!isRecord(value)) return null;
	const systemId = readOptionalString(value.systemId);
	const componentId = readOptionalString(value.componentId);
	if (!systemId || !componentId) return null;
	if (
		value.source !== undefined &&
		value.source !== "published" &&
		value.source !== "draft"
	) {
		return null;
	}
	const variants =
		value.variants === undefined
			? undefined
			: parseStringRecord(value.variants);
	if (variants === null) return null;
	return {
		systemId,
		componentId,
		...(value.source ? { source: value.source } : {}),
		...(variants ? { variants } : {}),
		...(readOptionalString(value.rows)
			? { rows: readOptionalString(value.rows) }
			: {}),
		...(readOptionalString(value.columns)
			? { columns: readOptionalString(value.columns) }
			: {}),
	};
}

export function parseScreenshotRequest(
	body: unknown,
): ScreenshotRequest | null {
	if (!isRecord(body)) return null;
	const designFileId = readOptionalString(body.designFileId);
	let component: ScreenshotComponentTarget | undefined;
	if (body.component !== undefined) {
		const parsed = parseComponent(body.component);
		if (!parsed) return null;
		component = parsed;
	}
	if (!designFileId && !component) return null;

	const viewport = parseViewport(body.viewport);
	const theme = parseTheme(body.theme);
	if (viewport === UNPARSEABLE || theme === UNPARSEABLE) return null;

	let shots: ScreenshotShot[] | undefined;
	if (body.shots !== undefined) {
		if (!Array.isArray(body.shots)) return null;
		shots = [];
		for (const value of body.shots) {
			const shot = parseShot(value);
			if (!shot) return null;
			shots.push(shot);
		}
	}
	for (const key of ["scale", "maxHeight"] as const) {
		if (body[key] !== undefined && typeof body[key] !== "number") return null;
	}

	return {
		...(designFileId ? { designFileId } : {}),
		...(readOptionalString(body.boardId)
			? { boardId: readOptionalString(body.boardId) }
			: {}),
		...(readOptionalString(body.nodeId)
			? { nodeId: readOptionalString(body.nodeId) }
			: {}),
		...(component ? { component } : {}),
		...(viewport !== undefined ? { viewport } : {}),
		...(theme ? { theme } : {}),
		...(shots ? { shots } : {}),
		...(typeof body.scale === "number" ? { scale: body.scale } : {}),
		...(typeof body.maxHeight === "number"
			? { maxHeight: body.maxHeight }
			: {}),
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
				"Invalid screenshot payload: expected designFileId or component, plus optional boardId, nodeId, viewport, theme, shots, scale, maxHeight, outputPath, and executablePath.",
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
